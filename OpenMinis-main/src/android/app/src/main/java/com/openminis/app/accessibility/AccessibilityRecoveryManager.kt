package com.openminis.app.accessibility

import android.content.Context
import android.provider.Settings
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.ShizukuManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume

/**
 * [T-android-a11y-force-stop-recovery] Detects a revoked accessibility grant
 * and offers to repair it.
 *
 * ## Why this exists
 *
 * `adb shell am force-stop` — and the equivalent "force stop" button in system
 * Settings, plus the aggressive "clear" action on several OEM ROMs — makes the
 * framework REMOVE our component from `Settings.Secure`
 * .ENABLED_ACCESSIBILITY_SERVICES. Verified empirically on Pixel 4a / Android
 * 13: after a force-stop the key is emptied, `accessibility_enabled` drops to
 * 0, and it never self-heals — waiting does nothing and relaunching the app
 * does nothing. The user has to walk back into Settings → Accessibility.
 *
 * This is deliberate AOSP behaviour, not a Minis defect: the same test against
 * Google's own TalkBack, Bitwarden and AutoX reproduced it identically. With
 * two services enabled and only one force-stopped, the framework surgically
 * removes just the stopped one — i.e. it is a security decision (a
 * force-stopped app must not keep the ability to read the screen).
 *
 * Note that ordinary "swipe away from recents" does NOT do this: an
 * accessibility service pins its host process at adj=100 (bound by `system`),
 * so the process survives and the grant is untouched. Only force-stop-class
 * kills matter here.
 *
 * ## Why an app normally cannot fix this
 *
 * Writing ENABLED_ACCESSIBILITY_SERVICES requires WRITE_SECURE_SETTINGS, which
 * is not grantable to a normal app. That is why none of the apps surveyed even
 * *detect* the loss. Minis is in a better position because it already ships a
 * Shizuku client: with Shizuku authorized we can run `settings put secure`
 * with shell privilege and repair the grant in place, which was verified to
 * take effect immediately (the service rebinds without a relaunch).
 *
 * So there are two tiers:
 *  - Shizuku READY  → one-tap repair, no trip to Settings.
 *  - otherwise      → explain the situation and deep-link to Settings.
 */
object AccessibilityRecoveryManager {

    private const val TAG = "A11yRecovery"

    /**
     * How long the in-chat repair prompt waits for the user before giving up.
     * Spec'd at 60s: long enough to notice a dialog, short enough that an
     * unattended agent run is not blocked indefinitely. Exposed (not private)
     * so tests can assert the contract without reaching into internals.
     */
    const val PROMPT_TIMEOUT_MS: Long = 60_000L

    /**
     * After a Shizuku write, how long to wait for the framework to actually
     * rebind the service. The write returns before `onServiceConnected` runs,
     * so a naive "did it work" check immediately after would report false.
     */
    private const val REBIND_TIMEOUT_MS: Long = 5_000L
    private const val REBIND_POLL_MS: Long = 250L

    /**
     * Debounce for [isGrantRevoked]'s Settings.Secure read. The check sits on
     * the a11y tool-invocation path, which a single agent turn can hit dozens
     * of times in a row, and each call is a ContentProvider round-trip. A
     * short TTL keeps the common case (grant intact) essentially free while
     * still noticing a revocation within a quarter second.
     *
     * Deliberately NOT a long-lived cache: a stale "grant is fine" answer
     * would suppress the very prompt this class exists to raise.
     */
    private const val CHECK_CACHE_TTL_MS: Long = 250L

    @Volatile private var cachedRevoked: Boolean? = null
    @Volatile private var cachedAtMs: Long = 0L

    /** What the user chose in the repair prompt. */
    enum class Decision { REPAIR, OPEN_SETTINGS, CANCEL }

    /**
     * A pending repair prompt. Collected by MainActivity, which renders it as
     * an AlertDialog and calls [respond].
     *
     * @param shizukuAvailable when true the dialog offers in-place repair;
     *   when false it can only offer a trip to Settings.
     */
    data class RepairPrompt(
        val shizukuAvailable: Boolean,
    )

    private val _pendingPrompt = MutableStateFlow<RepairPrompt?>(null)
    val pendingPrompt: StateFlow<RepairPrompt?> = _pendingPrompt.asStateFlow()

    private var continuation: Continuation<Decision>? = null

    /**
     * Observable "the grant is currently missing" flag for Settings UI, so the
     * repair row can appear without the screen polling Settings.Secure itself.
     * Refreshed by [refreshRevokedState], which Settings calls on entry /
     * resume.
     */
    private val _revoked = MutableStateFlow(false)
    val revoked: StateFlow<Boolean> = _revoked.asStateFlow()

    /** The `pkg/cls` string the framework expects in ENABLED_ACCESSIBILITY_SERVICES. */
    private fun componentId(context: Context): String =
        "${context.packageName}/${MinisAccessibilityService::class.java.name}"

    private const val PREFS = "a11y_recovery"
    private const val KEY_EVER_GRANTED = "ever_granted"

    /**
     * True once the user has enabled the service at least once on this install.
     *
     * Needed to tell "revoked" apart from "never set up". Both look identical
     * in Settings.Secure — our component simply isn't listed — but only the
     * first is a fault worth surfacing a repair affordance for. Without this a
     * fresh install would greet the user with a "permission was revoked" banner
     * for a permission they had never granted.
     *
     * Latched by [markGranted], which the service calls on connect.
     */
    fun hasEverBeenGranted(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_EVER_GRANTED, false)

    /**
     * Latch that the grant has existed. Called from
     * [MinisAccessibilityService.onServiceConnected] — the one moment we know
     * for certain the user granted it, whichever route they took (Settings
     * toggle, Shizuku repair, or a restore).
     */
    fun markGranted(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!p.getBoolean(KEY_EVER_GRANTED, false)) {
            p.edit().putBoolean(KEY_EVER_GRANTED, true).apply()
            AppLogger.info(TAG, "grant latched (first successful connect)")
        }
    }

    /**
     * True when our component is absent from ENABLED_ACCESSIBILITY_SERVICES,
     * i.e. the grant itself is gone and only a Settings write can restore it.
     *
     * This asks Settings.Secure rather than checking
     * `MinisAccessibilityService.getInstance() != null`, because the two mean
     * different things and only one of them is repairable:
     *  - instance == null but grant present → the service is mid-(re)bind, or
     *    the OEM killed it and the framework will bring it back. Writing the
     *    setting would be pointless.
     *  - grant absent → the framework has forgotten us entirely. This is the
     *    force-stop case, and the only one we can repair.
     *
     * Matching is case-insensitive and also accepts the abbreviated
     * `pkg/.Class` form, because the framework normalizes entries it rewrites
     * (observed: TalkBack's entry came back as `pkg/.TalkBackService` after we
     * wrote the fully-qualified form).
     */
    fun isGrantRevoked(context: Context): Boolean {
        val now = System.currentTimeMillis()
        cachedRevoked?.let { if (now - cachedAtMs < CHECK_CACHE_TTL_MS) return it }

        val revoked = try {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            )
            isRevokedIn(
                enabledValue = enabled,
                pkg = context.packageName,
                serviceClass = MinisAccessibilityService::class.java.name,
            )
        } catch (t: Throwable) {
            // A read failure is not evidence of revocation — do not prompt on it.
            AppLogger.warning(TAG, "isGrantRevoked read failed: ${t.message}")
            false
        }

        cachedRevoked = revoked
        cachedAtMs = now
        return revoked
    }

    /**
     * Pure entry-matching half of [isGrantRevoked], split out so the parsing
     * rules can be exercised on the JVM without a Context.
     *
     * Returns true when [enabledValue] — the raw colon-separated
     * ENABLED_ACCESSIBILITY_SERVICES string — does not contain our component.
     *
     * Accepts both the fully-qualified `pkg/pkg.Class` form we write and the
     * abbreviated `pkg/.Class` form the framework may normalize to. Observed on
     * Pixel 4a / Android 13: after writing TalkBack's fully-qualified name the
     * framework rewrote the value as `…talkback/.TalkBackService`. Matching only
     * the long form would then read as "revoked" while the grant was healthy,
     * producing a repair prompt in a loop.
     */
    fun isRevokedIn(enabledValue: String?, pkg: String, serviceClass: String): Boolean {
        if (enabledValue.isNullOrBlank()) return true
        val fq = "$pkg/$serviceClass"
        val short = "$pkg/.${serviceClass.removePrefix("$pkg.")}"
        return enabledValue.split(':').none { entry ->
            val e = entry.trim()
            e.equals(fq, ignoreCase = true) || e.equals(short, ignoreCase = true)
        }
    }

    /** Drop the debounce so the next [isGrantRevoked] re-reads Settings. */
    fun invalidateCache() {
        cachedRevoked = null
        cachedAtMs = 0L
    }

    /** Re-read the grant and publish it to [revoked] for Settings UI. */
    fun refreshRevokedState(context: Context) {
        invalidateCache()
        _revoked.value = isGrantRevoked(context)
    }

    /**
     * Repair the grant with Shizuku shell privilege.
     *
     * Appends our component to the existing ENABLED_ACCESSIBILITY_SERVICES
     * value rather than overwriting it — a blind overwrite would disable every
     * OTHER accessibility service the user relies on (TalkBack, a password
     * manager's autofill, an OEM gesture tool). Then sets
     * `accessibility_enabled=1`, which force-stop also clears and without
     * which the framework ignores the service list entirely.
     *
     * Runs `settings put secure` through [ShizukuManager.runProcess] — the
     * same privileged path `android-shizuku-cli settings set` uses, so there
     * is one implementation of the write.
     *
     * @return true once the service has actually rebound.
     */
    suspend fun repairWithShizuku(context: Context): Boolean {
        if (!ShizukuManager.isReady()) {
            AppLogger.info(TAG, "repair skipped: Shizuku not ready")
            return false
        }
        val target = componentId(context)

        val existing = try {
            Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            )?.split(':')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
        } catch (_: Throwable) { emptyList() }

        val merged = (existing + target).distinct().joinToString(":")

        val r1 = ShizukuManager.runProcess(
            arrayOf("settings", "put", "secure", Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, merged)
        )
        if (r1.exitCode != 0) {
            AppLogger.warning(TAG, "repair failed writing service list: exit=${r1.exitCode} ${r1.combined}")
            return false
        }
        val r2 = ShizukuManager.runProcess(
            arrayOf("settings", "put", "secure", Settings.Secure.ACCESSIBILITY_ENABLED, "1")
        )
        if (r2.exitCode != 0) {
            AppLogger.warning(TAG, "repair failed writing accessibility_enabled: exit=${r2.exitCode} ${r2.combined}")
            return false
        }

        // The write is async from the framework's perspective; wait for the
        // real signal (our service instance appearing) rather than assuming.
        val bound = withTimeoutOrNull(REBIND_TIMEOUT_MS) {
            while (MinisAccessibilityService.getInstance() == null) delay(REBIND_POLL_MS)
            true
        } == true

        invalidateCache()
        _revoked.value = isGrantRevoked(context)
        AppLogger.info(TAG, "repair via Shizuku wrote grant; rebound=$bound")
        // Report on the write succeeding: on a slow device the rebind can land
        // just after our window, and the grant itself is what we were asked to
        // restore. `bound` is logged for diagnosis.
        return true
    }

    /**
     * Show the repair prompt and wait for a decision, for at most
     * [PROMPT_TIMEOUT_MS].
     *
     * Times out to [Decision.CANCEL] so an unattended run (screen off, user
     * away, or the dialog dismissed by something else) degrades to the normal
     * "service not running" error instead of hanging the agent loop. The
     * pending prompt is always cleared, including on coroutine cancellation,
     * so a stale dialog can never outlive its caller.
     */
    private suspend fun awaitDecision(prompt: RepairPrompt): Decision {
        val decision = withTimeoutOrNull(PROMPT_TIMEOUT_MS) {
            suspendCancellableCoroutine<Decision> { cont ->
                continuation = cont
                _pendingPrompt.value = prompt
                cont.invokeOnCancellation {
                    _pendingPrompt.value = null
                    continuation = null
                }
            }
        }
        if (decision == null) {
            // Timed out: tear the dialog down so it doesn't linger on screen.
            _pendingPrompt.value = null
            continuation = null
            AppLogger.info(TAG, "repair prompt timed out after ${PROMPT_TIMEOUT_MS}ms — treating as cancel")
        }
        return decision ?: Decision.CANCEL
    }

    /** Called by the UI once the dialog closes. Safe to call spuriously. */
    fun respond(decision: Decision) {
        _pendingPrompt.value = null
        val c = continuation
        continuation = null
        c?.resume(decision)
    }

    /**
     * Entry point for the a11y tool path: if the grant is gone, offer to fix
     * it and report whether the caller may proceed.
     *
     * @return true if the service is usable (grant was intact, or repair
     *   succeeded); false if the caller should fail with its normal
     *   "service not running" error.
     */
    suspend fun ensureGrantOrPrompt(context: Context): Boolean {
        if (!isGrantRevoked(context)) return true

        val shizuku = ShizukuManager.isReady()
        AppLogger.info(TAG, "grant revoked — prompting (shizukuReady=$shizuku)")
        _revoked.value = true

        return when (awaitDecision(RepairPrompt(shizukuAvailable = shizuku))) {
            Decision.REPAIR -> repairWithShizuku(context)
            // The user was sent to Settings; they may or may not finish. Don't
            // block the turn waiting — report unusable and let them retry.
            Decision.OPEN_SETTINGS -> false
            Decision.CANCEL -> false
        }
    }
}
