package com.openminis.app.offload

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Manages offload permissions for privacy-sensitive agent tools.
 * Three levels: BYPASS (auto-allow), ASK_ONCE (per-session), NOT_ALLOWED.
 *
 * Mirrors iOS OffloadPermissionManager behavior.
 */
object OffloadPermissionManager {

    enum class PermissionLevel {
        BYPASS,      // Always allowed
        ASK_ONCE,    // Ask once per session
        NOT_ALLOWED, // Always denied
    }

    data class PermissionRequest(
        val toolName: String,
        val toolTitle: String,
        val description: String,
        val sessionId: String,
    )

    enum class PermissionCategory(val displayName: String) {
        PRIVACY("Privacy"),
        MEDIA("Media"),
        SYSTEM("System"),
        // T330: privileged automation CLIs (Shizuku binder / Accessibility
        // service). These run via the offload bridge as shell tools, not as
        // named LLM tool calls, so the gate happens inside the
        // NativeOffloadHandler entry point rather than ChatViewModel.
        INTEGRATIONS("Integrations"),
    }

    data class ToolPermissionInfo(
        val toolName: String,
        val displayName: String,
        val category: PermissionCategory,
        val defaultLevel: PermissionLevel,
        /**
         * Mirrors iOS `OffloadCommandInfo.showInSettings`. When false the tool
         * is registered (so the dialog/check pipeline still recognises its
         * name) but hidden from the Permissions settings page — Media + System
         * tools carry no personal data and have no reason to clutter the UI.
         */
        val showInSettings: Boolean = true,
    )

    /**
     * Registry of all tools and their permission categories. Defaults are
     * BYPASS across the board to mirror iOS — the user opted into running an
     * agent app, so background access is permitted unless they explicitly
     * downgrade an entry to ASK_ONCE / NOT_ALLOWED. Tools omitted from this
     * registry (e.g. the former `open_url` and `model_use` entries) fall
     * through to BYPASS via [getLevel]'s unknown-tool branch — no separate
     * "always permit" carve-out needed.
     */
    val toolRegistry: List<ToolPermissionInfo> = listOf(
        // Privacy — user-configurable, visible in Settings.
        ToolPermissionInfo("calendar", "Calendar", PermissionCategory.PRIVACY, PermissionLevel.BYPASS),
        ToolPermissionInfo("location", "Location", PermissionCategory.PRIVACY, PermissionLevel.BYPASS),
        ToolPermissionInfo("clipboard", "Clipboard", PermissionCategory.PRIVACY, PermissionLevel.BYPASS),
        ToolPermissionInfo("contacts", "Contacts", PermissionCategory.PRIVACY, PermissionLevel.BYPASS),
        ToolPermissionInfo("photos", "Photos", PermissionCategory.PRIVACY, PermissionLevel.BYPASS),
        // Media — no personal data, hidden from Settings.
        ToolPermissionInfo("speak", "Text-to-Speech", PermissionCategory.MEDIA, PermissionLevel.BYPASS, showInSettings = false),
        ToolPermissionInfo("media_player", "Media Player", PermissionCategory.MEDIA, PermissionLevel.BYPASS, showInSettings = false),
        ToolPermissionInfo("speech_recognition", "Speech Recognition", PermissionCategory.MEDIA, PermissionLevel.BYPASS, showInSettings = false),
        // System — no personal data, hidden from Settings.
        ToolPermissionInfo("alarm", "Alarms & Timers", PermissionCategory.SYSTEM, PermissionLevel.BYPASS, showInSettings = false),
        ToolPermissionInfo("weather", "Weather", PermissionCategory.SYSTEM, PermissionLevel.BYPASS, showInSettings = false),
        ToolPermissionInfo("notification", "Notifications", PermissionCategory.SYSTEM, PermissionLevel.BYPASS, showInSettings = false),
        ToolPermissionInfo("device_info", "Device Info", PermissionCategory.SYSTEM, PermissionLevel.BYPASS, showInSettings = false),
        // T330: integrations — opt-in by default. These tools can drive
        // other apps and read on-screen content, so the safer posture is
        // NOT_ALLOWED until the user picks otherwise even when the
        // underlying system layer (Shizuku binder / Accessibility service)
        // is already authorized.
        ToolPermissionInfo("a11y_cli", "android-a11y-cli", PermissionCategory.INTEGRATIONS, PermissionLevel.NOT_ALLOWED),
        ToolPermissionInfo("shizuku_cli", "android-shizuku-cli", PermissionCategory.INTEGRATIONS, PermissionLevel.NOT_ALLOWED),
    )

    /** Stable session-id used by NativeOffloadHandlers when calling
     *  [checkPermission] from the offload IPC thread. The shell-CLI gate
     *  (T330) lives outside ChatViewModel.executeTool, so there's no
     *  per-chat-session id available to scope ASK_ONCE grants. We use
     *  one process-lifetime grant slot instead — the user "Always Allow"
     *  upgrades naturally to BYPASS via [respondToRequest]. */
    const val OFFLOAD_GLOBAL_SESSION_ID = "offload-global"

    private lateinit var prefs: SharedPreferences

    /** Session-scoped grants for ASK_ONCE tools. Populated by the
     *  "Allow in this session" dialog response. Cleared when the
     *  hosting session ends (or process death — see
     *  OFFLOAD_GLOBAL_SESSION_ID for offload-CLI-backed tools, which
     *  share one process-lifetime slot). */
    private val sessionGrants = mutableMapOf<String, MutableSet<String>>() // sessionId -> set of toolNames

    /** T338: session-scoped denials. Populated by the "Deny in this
     *  session" dialog response. Once a tool is in here for a given
     *  session, [checkPermission] returns false without re-prompting
     *  — prevents the agent from spamming the user with the same
     *  request after they already said no. Cleared with
     *  [clearSessionGrants]. */
    private val sessionDenials = mutableMapOf<String, MutableSet<String>>() // sessionId -> set of toolNames

    /** Active permission request waiting for user response. */
    private val _pendingRequest = MutableStateFlow<PermissionRequest?>(null)
    val pendingRequest: StateFlow<PermissionRequest?> = _pendingRequest.asStateFlow()

    private var pendingContinuation: kotlin.coroutines.Continuation<Response>? = null

    // ── Android system runtime permission request (for location etc.) ──────────

    /** Result of a runtime permission or settings-gate flow. */
    enum class AndroidPermissionResult { GRANTED, DENIED, TIMEOUT }

    /** Timeout for a single system permission dialog round-trip. */
    const val SYSTEM_DIALOG_TIMEOUT_MS: Long = 120_000L

    /** Timeout for the "bounce the user to a settings page" flow. */
    const val SETTINGS_GATE_TIMEOUT_MS: Long = 120_000L

    data class AndroidPermissionRequest(val permissions: List<String>)

    private val _pendingAndroidPermission = MutableStateFlow<AndroidPermissionRequest?>(null)
    val pendingAndroidPermission: StateFlow<AndroidPermissionRequest?> = _pendingAndroidPermission.asStateFlow()

    private var androidPermissionContinuation: kotlin.coroutines.Continuation<AndroidPermissionResult>? = null

    /**
     * Ask the UI layer to drive the system runtime-permission flow for the
     * given permissions. The UI is responsible for:
     *
     *  - Detecting whether the permission has already been permanently denied
     *    (so the system dialog would be a no-op). If so, responding with
     *    [AndroidPermissionResult.DENIED] so the caller can fall back to the
     *    in-app "go to settings" flow via [requestSettingsGate].
     *  - Otherwise launching the `RequestMultiplePermissions` contract and
     *    returning the result.
     *
     * The call is suspended until the UI responds or [SYSTEM_DIALOG_TIMEOUT_MS]
     * elapses.
     */
    suspend fun requestAndroidPermission(permissions: List<String>): AndroidPermissionResult {
        val timed = withTimeoutOrNull(SYSTEM_DIALOG_TIMEOUT_MS) {
            suspendCancellableCoroutine<AndroidPermissionResult> { cont ->
                androidPermissionContinuation = cont
                _pendingAndroidPermission.value = AndroidPermissionRequest(permissions)
                cont.invokeOnCancellation {
                    _pendingAndroidPermission.value = null
                    androidPermissionContinuation = null
                }
            }
        }
        if (timed == null) {
            // Timed out — clear the pending request so the UI doesn't fire a
            // stale permission dialog later.
            _pendingAndroidPermission.value = null
            androidPermissionContinuation = null
            return AndroidPermissionResult.TIMEOUT
        }
        return timed
    }

    /** Called from UI after the system permission dialog returns. */
    fun respondToAndroidPermission(result: AndroidPermissionResult) {
        _pendingAndroidPermission.value = null
        androidPermissionContinuation?.resume(result)
        androidPermissionContinuation = null
    }

    /** Overload kept for callers that only have a granted/denied bool. */
    fun respondToAndroidPermission(granted: Boolean) =
        respondToAndroidPermission(
            if (granted) AndroidPermissionResult.GRANTED else AndroidPermissionResult.DENIED
        )

    // ── In-app "go to settings" gate ───────────────────────────────────────────

    /**
     * Describes a gate we can't resolve with the standard permission dialog:
     * either the user has already permanently denied the runtime permission,
     * or the capability (e.g. Notification Access) requires a trip to a
     * system settings page.
     */
    data class SettingsGateRequest(
        /** Stable id for the gate (e.g. "POST_NOTIFICATIONS" or "notification_access"). */
        val id: String,
        /** Title shown in the in-app AlertDialog. */
        val title: String,
        /** Body shown in the in-app AlertDialog. */
        val message: String,
        /** Intent action used to open the appropriate settings page. */
        val settingsAction: String,
        /**
         * Set when the target settings page is "Application details" and the
         * Intent must include a `package:<pkg>` data URI.
         */
        val requiresPackageUri: Boolean,
        /** "Allow" button label for the in-app dialog. */
        val positiveLabel: String = "Open Settings",
        /** "Cancel" button label for the in-app dialog. */
        val negativeLabel: String = "Cancel",
    )

    /** What the UI actor decided after the dialog closed. */
    enum class SettingsGateDecision { OPEN, CANCEL }

    private val _pendingSettingsGate = MutableStateFlow<SettingsGateRequest?>(null)
    val pendingSettingsGate: StateFlow<SettingsGateRequest?> = _pendingSettingsGate.asStateFlow()

    private var settingsGateContinuation: kotlin.coroutines.Continuation<SettingsGateDecision>? = null

    /**
     * Show an in-app dialog explaining why a settings trip is needed, then
     * (if the user accepts) wait up to [SETTINGS_GATE_TIMEOUT_MS] polling
     * [check] for success.
     *
     * Returns:
     *  - [AndroidPermissionResult.GRANTED] if [check] succeeds within the
     *    polling window.
     *  - [AndroidPermissionResult.DENIED] if the user cancels the dialog.
     *  - [AndroidPermissionResult.TIMEOUT] if the user accepts but doesn't
     *    complete the grant within the window.
     */
    suspend fun requestSettingsGate(
        request: SettingsGateRequest,
        check: () -> Boolean,
    ): AndroidPermissionResult {
        val decision = suspendCancellableCoroutine<SettingsGateDecision> { cont ->
            settingsGateContinuation = cont
            _pendingSettingsGate.value = request
            cont.invokeOnCancellation {
                _pendingSettingsGate.value = null
                settingsGateContinuation = null
            }
        }
        if (decision == SettingsGateDecision.CANCEL) return AndroidPermissionResult.DENIED

        val granted = withTimeoutOrNull(SETTINGS_GATE_TIMEOUT_MS) {
            while (true) {
                if (check()) return@withTimeoutOrNull true
                delay(500L)
            }
            @Suppress("UNREACHABLE_CODE") false
        }
        return when (granted) {
            true -> AndroidPermissionResult.GRANTED
            else -> AndroidPermissionResult.TIMEOUT
        }
    }

    /**
     * Poll [check] every [intervalMs] for up to [timeoutMs] after a DENIED
     * result from [requestAndroidPermission]. Catches the "grant propagation
     * race" — the system dialog returned before the PackageManager fully
     * committed the grant, or the user was still mid-tap when DENIED fired.
     */
    suspend fun pollForPermissionGrant(
        check: () -> Boolean,
        timeoutMs: Long = 5_000L,
        intervalMs: Long = 500L,
    ): Boolean {
        val granted = withTimeoutOrNull(timeoutMs) {
            while (true) {
                if (check()) return@withTimeoutOrNull true
                delay(intervalMs)
            }
            @Suppress("UNREACHABLE_CODE") false
        }
        return granted == true
    }

    /** Called from UI after the in-app "go to settings" dialog closes. */
    fun respondToSettingsGate(decision: SettingsGateDecision) {
        _pendingSettingsGate.value = null
        settingsGateContinuation?.resume(decision)
        settingsGateContinuation = null
    }

    /**
     * Android's `shouldShowRequestPermissionRationale` returns false in two
     * cases: (a) the app has never asked, and (b) the user permanently
     * denied. We track (a) ourselves so the UI can distinguish them.
     */
    fun hasAskedForPermission(context: Context, permission: String): Boolean {
        val p = context.getSharedPreferences("offload_permissions_asked", Context.MODE_PRIVATE)
        return p.getBoolean(permission, false)
    }

    fun markPermissionAsked(context: Context, permission: String) {
        context.getSharedPreferences("offload_permissions_asked", Context.MODE_PRIVATE)
            .edit().putBoolean(permission, true).apply()
    }

    fun init(context: Context) {
        prefs = context.getSharedPreferences("offload_permissions", Context.MODE_PRIVATE)
    }

    fun getLevel(toolName: String): PermissionLevel {
        val info = toolRegistry.find { it.toolName == toolName }
            ?: return PermissionLevel.BYPASS // Unknown tools are bypassed

        val stored = prefs.getString("level_$toolName", null)
        return if (stored != null) {
            try { PermissionLevel.valueOf(stored) } catch (_: Exception) { info.defaultLevel }
        } else {
            info.defaultLevel
        }
    }

    fun setLevel(toolName: String, level: PermissionLevel) {
        prefs.edit().putString("level_$toolName", level.name).apply()
    }

    fun resetAll() {
        val editor = prefs.edit()
        for (tool in toolRegistry) {
            editor.remove("level_${tool.toolName}")
        }
        editor.apply()
    }

    /**
     * T338: dialog response shape. Replaces the older
     * `(allowed: Boolean, alwaysAllow: Boolean)` pair, which encoded
     * "Always Allow" as a persistent BYPASS upgrade. The new model is
     * strictly session-scoped — the user goes to Settings → Permissions
     * to make a permanent change.
     *
     *   ALLOW_SESSION  — grant for the rest of this session, no more
     *                    prompts for this tool until session ends.
     *   ALLOW_ONCE     — grant just this call; next call re-prompts.
     *   DENY_SESSION   — deny + remember the deny so the agent can't
     *                    keep nagging. Cleared with the session.
     */
    enum class Response { ALLOW_SESSION, ALLOW_ONCE, DENY_SESSION }

    /**
     * Check permission for a tool in the given session.
     * For ASK_ONCE, suspends until user responds via the dialog.
     * Returns true if allowed.
     */
    suspend fun checkPermission(toolName: String, toolTitle: String, sessionId: String): Boolean {
        val level = getLevel(toolName)
        return when (level) {
            PermissionLevel.BYPASS -> true
            PermissionLevel.NOT_ALLOWED -> false
            PermissionLevel.ASK_ONCE -> {
                // T338: a prior "Deny in this session" short-circuits
                // before any grants check or dialog so the agent can't
                // spam the user.
                val denials = sessionDenials.getOrPut(sessionId) { mutableSetOf() }
                if (toolName in denials) return false

                val grants = sessionGrants.getOrPut(sessionId) { mutableSetOf() }
                if (toolName in grants) return true

                // Show dialog and wait for response.
                val info = toolRegistry.find { it.toolName == toolName }
                val response = suspendCancellableCoroutine<Response> { cont ->
                    pendingContinuation = cont
                    _pendingRequest.value = PermissionRequest(
                        toolName = toolName,
                        toolTitle = toolTitle,
                        description = "Allow ${info?.displayName ?: toolName} access?",
                        sessionId = sessionId,
                    )
                    cont.invokeOnCancellation {
                        _pendingRequest.value = null
                        pendingContinuation = null
                    }
                }

                when (response) {
                    Response.ALLOW_SESSION -> {
                        grants.add(toolName)
                        true
                    }
                    Response.ALLOW_ONCE -> true  // no caching; next call re-prompts
                    Response.DENY_SESSION -> {
                        denials.add(toolName)
                        false
                    }
                }
            }
        }
    }

    /** Called from UI when user responds to the permission dialog. */
    fun respondToRequest(response: Response) {
        _pendingRequest.value = null
        pendingContinuation?.resume(response)
        pendingContinuation = null
    }

    /** Clear session grants AND denials (call when a session ends). */
    fun clearSessionGrants(sessionId: String) {
        sessionGrants.remove(sessionId)
        sessionDenials.remove(sessionId)
    }
}
