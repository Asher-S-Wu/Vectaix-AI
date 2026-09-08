package com.openminis.app.share

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import com.openminis.app.logging.AppLogger
import java.io.File
import java.util.UUID

/**
 * Activity that handles ACTION_SEND / ACTION_SEND_MULTIPLE / ACTION_VIEW
 * intents. Mirrors iOS ShareExtension/ShareViewModel.swift wire format
 * (`{items: [{kind, value}], timestamp}`) so a future cross-platform
 * sync (if it ever lands) reads the same `PendingShare` JSON.
 *
 * Producer-side behavior:
 *   - inline text under [INLINE_TEXT_LIMIT] chars → Item(INLINE_TEXT, text)
 *   - longer text or any binary URI → Item(ATTACHMENT, "shared-…<ext>")
 *     with the bytes copied to filesDir/share_extension/<filename>
 *
 * Re-launches MainActivity with extra `shared_content=true` so
 * MainActivity.onCreate / onNewIntent can ask [ShareCoordinator] to
 * process the prefs entry into the in-memory buffer.
 *
 * ACTION_VIEW vs ACTION_SEND: VIEW carries its content in `intent.data`
 * (a Uri), not `EXTRA_STREAM`. Triggered by the system "Open with"
 * chooser (long-press image in gallery, file manager Open as…, Telegram
 * tap-to-open). The downstream PendingShare → MainActivity → composer
 * prefill path is identical, so handleView funnels into the same
 * `copyUriToStaging` helper SEND uses.
 */
class ShareReceiverActivity : ComponentActivity() {

    companion object {
        private const val TAG = "ShareReceiver"
        private const val INLINE_TEXT_LIMIT = 1000
    }

    // T-n01-andmenu-l10n: pre-Tiramisu locale override (see MainActivity).
    override fun attachBaseContext(newBase: android.content.Context) {
        super.attachBaseContext(com.openminis.app.i18n.LocaleWrap.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val items = mutableListOf<PendingShare.Item>()
        try {
            when (intent?.action) {
                Intent.ACTION_SEND -> handleSingleSend(intent, items)
                Intent.ACTION_SEND_MULTIPLE -> handleMultipleSend(intent, items)
                Intent.ACTION_VIEW -> handleView(intent, items)
                else -> AppLogger.warning(TAG, "unhandled action: ${intent?.action}")
            }
        } catch (e: Throwable) {
            AppLogger.error(TAG, "extraction failed: ${e.message}")
        }

        // [T-android-json-open-provider-import-prompt] If exactly one item was
        // staged and it parses as a Provider-export JSON, offer a two-way
        // choice: import it as a provider, or fall through to the normal
        // chat-attachment flow. Mirrors iOS #678. Only the single-item case is
        // eligible — a multi-file share is unambiguously an attachment batch.
        //
        // [T-android-share-launch-crash] Guarded: anything thrown out of
        // onCreate becomes "Unable to start activity …ShareReceiverActivity",
        // i.e. a hard crash of the app the user was merely sharing into. The
        // provider-JSON prompt is an optional nicety, so a failure here must
        // degrade to the normal attachment flow rather than take the app down.
        val providerJson = try {
            items.singleOrNull()?.let { providerExportJsonOrNull(it) }
        } catch (t: Throwable) {
            AppLogger.warning(TAG, "provider-JSON detection failed: ${t.message}")
            null
        }
        if (providerJson != null) {
            // showDialog reports whether the dialog actually reached the
            // screen; if the window manager refused it, fall through so the
            // share is not silently dropped.
            if (promptProviderImportOrAttach(providerJson, items)) return
        }

        finishWithAttachmentFlow(items)
    }

    /**
     * Persist the staged items as a [PendingShare] (so the chat composer picks
     * them up) and hand off to MainActivity. The default path for every share
     * that isn't a provider-import candidate.
     */
    private fun finishWithAttachmentFlow(items: List<PendingShare.Item>) {
        try {
            if (items.isNotEmpty()) {
                SharedShareStore.savePendingShare(
                    this,
                    PendingShare(items, System.currentTimeMillis()),
                )
            } else {
                AppLogger.info(TAG, "no shareable items extracted")
            }
        } catch (e: Throwable) {
            AppLogger.error(TAG, "savePendingShare failed: ${e.message}")
        }
        // [T-android-share-launch-crash] launchMainActivity never throws; finish()
        // is guarded for the same reason the rest of this path is — this runs
        // from onCreate, where any escaping throwable is reported as "Unable to
        // start activity" and kills the app.
        launchMainActivity()
        try {
            finish()
        } catch (t: Throwable) {
            AppLogger.warning(TAG, "finish() failed: ${t.message}")
        }
    }

    /**
     * Read the staged file for [item] and return its content when the top-level
     * JSON carries the Provider-export shape (providerType + credentialType +
     * models[]) — the same required fields [ProviderRepository.importInstanceJSON]
     * needs. Returns null for non-JSON, unreadable, or non-provider payloads so
     * the caller falls through to the attachment flow.
     */
    private fun providerExportJsonOrNull(item: PendingShare.Item): String? {
        if (item.kind != PendingShare.Item.Kind.ATTACHMENT) return null
        val name = item.value
        if (!name.endsWith(".json", ignoreCase = true)) return null
        val file = File(SharedShareStore.sharedFileDirectory(this), name)
        // Guard against pathologically large "JSON" files — a provider export
        // is a few KB; anything past 1 MB is certainly something else.
        if (!file.isFile || file.length() > 1_000_000L) return null
        val text = try {
            file.readText(Charsets.UTF_8)
        } catch (e: Exception) {
            AppLogger.warning(TAG, "providerExportJsonOrNull read failed: ${e.message}")
            return null
        }
        val obj = try {
            org.json.JSONObject(text)
        } catch (_: Exception) {
            return null
        }
        val looksLikeProvider = obj.optString("providerType").isNotEmpty() &&
            obj.optString("credentialType").isNotEmpty() &&
            obj.optJSONArray("models") != null
        return if (looksLikeProvider) text else null
    }

    /**
     * Two-choice dialog: import the JSON as a provider, or add it to the chat as
     * an attachment. Dismiss / back == attachment (the pre-existing behaviour),
     * so the user can't lose the file by dismissing.
     *
     * @return true when the dialog was shown and now owns the flow; false when
     *   it could not be shown, so the caller must run the attachment flow
     *   itself. [T-android-share-launch-crash] `show()` can throw on an
     *   Activity the system is tearing down (BadTokenException) — swallowing
     *   that without reporting it would strand the share with no dialog and no
     *   hand-off.
     */
    private fun promptProviderImportOrAttach(
        json: String,
        items: List<PendingShare.Item>,
    ): Boolean {
        return try {
            android.app.AlertDialog.Builder(this)
                .setTitle(getString(com.openminis.app.R.string.share_provider_json_title))
                .setMessage(getString(com.openminis.app.R.string.share_provider_json_message))
                .setPositiveButton(getString(com.openminis.app.R.string.share_provider_json_import)) { _, _ ->
                    // Guarded for the same reason as the rest of this flow: a
                    // failed import must not crash the share.
                    try {
                        importProviderJson(json)
                    } catch (t: Throwable) {
                        AppLogger.error(TAG, "provider import failed: ${t.message}")
                    }
                    finish()
                }
                .setNegativeButton(getString(com.openminis.app.R.string.share_provider_json_attach)) { _, _ ->
                    finishWithAttachmentFlow(items)
                }
                .setOnCancelListener {
                    // Back / tap-outside falls through to the attachment flow so
                    // the dropped file still lands somewhere useful.
                    finishWithAttachmentFlow(items)
                }
                .show()
            true
        } catch (t: Throwable) {
            AppLogger.warning(TAG, "provider-import dialog could not be shown: ${t.message}")
            false
        }
    }

    /** Run the existing provider-import logic and toast the outcome. */
    private fun importProviderJson(json: String) {
        // [T-android-share-launch-crash] `providerRepositoryOrNull`, not the raw
        // lateinit: a share can arrive in a safe-mode process where the
        // repositories were never assigned, and reading the lateinit there
        // throws UninitializedPropertyAccessException — crashing the app and
        // re-feeding the crash-burst detector. Null takes the existing
        // "import failed" path instead.
        val repo = (applicationContext as? com.openminis.app.MinisApp)?.providerRepositoryOrNull
        if (repo == null) {
            AppLogger.warning(TAG, "providerRepository unavailable; cannot import")
            toast(getString(com.openminis.app.R.string.share_provider_json_import_failed))
            return
        }
        val label = repo.importInstanceJSON(json)
        if (label != null) {
            AppLogger.info(TAG, "imported provider \"$label\" from shared JSON")
            toast(getString(com.openminis.app.R.string.share_provider_json_imported, label))
        } else {
            AppLogger.warning(TAG, "importInstanceJSON returned null")
            toast(getString(com.openminis.app.R.string.share_provider_json_import_failed))
        }
    }

    private fun toast(msg: String) {
        android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
    }

    private fun handleSingleSend(intent: Intent, out: MutableList<PendingShare.Item>) {
        val type = intent.type ?: ""
        when {
            type == "text/plain" -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
                    ?: return
                if (text.length <= INLINE_TEXT_LIMIT) {
                    out += PendingShare.Item(PendingShare.Item.Kind.INLINE_TEXT, text)
                } else {
                    val name = "shared-text-${shortId()}.txt"
                    File(SharedShareStore.sharedFileDirectory(this), name)
                        .writeText(text, Charsets.UTF_8)
                    out += PendingShare.Item(PendingShare.Item.Kind.ATTACHMENT, name)
                }
            }
            else -> {
                val uri = getParcelableExtra<Uri>(intent, Intent.EXTRA_STREAM) ?: return
                copyUriToStaging(uri, type)?.let {
                    out += PendingShare.Item(PendingShare.Item.Kind.ATTACHMENT, it)
                }
            }
        }
    }

    private fun handleMultipleSend(intent: Intent, out: MutableList<PendingShare.Item>) {
        val type = intent.type ?: ""
        val uris = getParcelableArrayListExtra<Uri>(intent, Intent.EXTRA_STREAM) ?: return
        for (uri in uris) {
            copyUriToStaging(uri, type)?.let {
                out += PendingShare.Item(PendingShare.Item.Kind.ATTACHMENT, it)
            }
        }
    }

    /**
     * Handle the system "Open with" chooser path. The Uri lives in
     * `intent.data` (vs `EXTRA_STREAM` for SEND). `intent.type` is what the
     * caller declared, but Telegram and a few file managers leave it null,
     * so we fall back to ContentResolver's resolved type before staging.
     */
    private fun handleView(intent: Intent, out: MutableList<PendingShare.Item>) {
        val uri = intent.data
        if (uri == null) {
            AppLogger.warning(TAG, "ACTION_VIEW with no data uri")
            return
        }
        val type = intent.type ?: contentResolver.getType(uri) ?: ""
        AppLogger.info(TAG, "ACTION_VIEW uri=$uri type=$type")
        copyUriToStaging(uri, type)?.let {
            out += PendingShare.Item(PendingShare.Item.Kind.ATTACHMENT, it)
        }
    }

    /** Copy a ContentResolver-backed URI to the staging dir. Returns
     *  the staged filename (relative to sharedFileDirectory) or null on
     *  failure. */
    private fun copyUriToStaging(uri: Uri, mimeType: String): String? {
        val ext = guessExtension(mimeType, uri)
        val prefix = when {
            mimeType.startsWith("image/") -> "shared-image"
            mimeType.startsWith("video/") -> "shared-video"
            else -> "shared"
        }
        val name = "$prefix-${shortId()}${if (ext.isNotEmpty()) ".$ext" else ""}"
        val dest = File(SharedShareStore.sharedFileDirectory(this), name)
        return try {
            contentResolver.openInputStream(uri)?.use { input ->
                dest.outputStream().use { input.copyTo(it) }
            }
            name
        } catch (e: Exception) {
            AppLogger.warning(TAG, "copyUriToStaging($uri): ${e.message}")
            null
        }
    }

    private fun guessExtension(mimeType: String, uri: Uri): String {
        val mm = android.webkit.MimeTypeMap.getSingleton()
        val fromMime = mm.getExtensionFromMimeType(mimeType.substringBefore(';'))
        if (!fromMime.isNullOrBlank()) return fromMime
        return uri.lastPathSegment?.substringAfterLast('.', "")?.takeIf { it.length in 1..6 } ?: ""
    }

    private fun shortId(): String = UUID.randomUUID().toString().take(8)

    /**
     * [T-android-share-launch-crash] Hand off to MainActivity, tolerating a
     * failure to start it.
     *
     * Field report (vivo V2352A / Android 14): sharing into Minis crashed the
     * app on launch, repeatedly —
     *
     *   RuntimeException: Unable to start activity …ShareReceiverActivity
     *   Caused by: NullPointerException … String.equals(Object) on null
     *     at android.os.Parcel.createExceptionOrNull(Parcel.java:3077)
     *     at IActivityTaskManager$Stub$Proxy.startActivity(…)
     *   Caused by: RemoteException: Remote stack trace:
     *     at VivoActivityStarterImpl.generateLaunchFreeFormOption(:2195)
     *
     * The fault is entirely inside the OEM's freeform-window logic in
     * system_server: it NPEs, and the exception it marshals back carries a null
     * message, so [android.os.Parcel.readException] NPEs a second time while
     * trying to rebuild it. Both throws land on OUR main thread inside
     * `startActivity`, so an unguarded call takes the whole app down before the
     * share can complete.
     *
     * Nothing about the intent is wrong and there is no version/model check that
     * would predict it, so the only available defence is to not let a failed
     * hand-off kill the process. The share itself is already durable at this
     * point — [SharedShareStore.savePendingShare] has committed the items to
     * disk — so the pending share survives and is picked up whenever the user
     * next opens the app by any route.
     *
     * Catches [Throwable], not [Exception]: the observed top-level failure is a
     * RuntimeException, but the deeper Binder unwrap can surface as other
     * Errors, and there is no failure mode here worth crashing the process over.
     *
     * The retry ladder itself lives in [ShareHandoffPolicy] so it can be
     * unit-tested — `startActivity` needs a live Context and cannot run on the
     * JVM, but the decision layer (how many attempts, in what order, what
     * happens when each throws) can.
     */
    private fun launchMainActivity() {
        // The fallback drops FLAG_ACTIVITY_CLEAR_TOP. The OEM crash is raised
        // while the system decides how to place the task, and the launch flags
        // are the only part of the request we control, so a plain NEW_TASK
        // launch is the one meaningfully different request we can make.
        val outcome = ShareHandoffPolicy.handOff(
            primary = {
                startActivity(mainActivityIntent(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            },
            fallback = {
                startActivity(mainActivityIntent(Intent.FLAG_ACTIVITY_NEW_TASK))
            },
            onError = { stage, t ->
                AppLogger.error(TAG, "$stage startActivity(MainActivity) failed: ${t.javaClass.simpleName}: ${t.message}")
            },
        )

        when (outcome) {
            ShareHandoffPolicy.Outcome.LAUNCHED -> Unit
            ShareHandoffPolicy.Outcome.LAUNCHED_VIA_FALLBACK ->
                AppLogger.info(TAG, "MainActivity launched via NEW_TASK-only fallback")
            ShareHandoffPolicy.Outcome.FAILED -> {
                // The share is already persisted, so tell the user how to
                // collect it rather than failing silently — from their side the
                // share otherwise appears to have done nothing.
                try {
                    toast(getString(com.openminis.app.R.string.share_open_app_failed))
                } catch (t: Throwable) {
                    AppLogger.warning(TAG, "failure toast failed: ${t.message}")
                }
            }
        }
    }

    private fun mainActivityIntent(flags: Int): Intent =
        Intent(this, Class.forName("com.openminis.app.MainActivity")).apply {
            addFlags(flags)
            putExtra("shared_content", true)
        }

    @Suppress("DEPRECATION")
    private inline fun <reified T : android.os.Parcelable> getParcelableExtra(
        intent: Intent, key: String,
    ): T? = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU)
        intent.getParcelableExtra(key, T::class.java)
    else intent.getParcelableExtra(key)

    @Suppress("DEPRECATION")
    private inline fun <reified T : android.os.Parcelable> getParcelableArrayListExtra(
        intent: Intent, key: String,
    ): ArrayList<T>? = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU)
        intent.getParcelableArrayListExtra(key, T::class.java)
    else intent.getParcelableArrayListExtra(key)
}
