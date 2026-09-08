package com.openminis.app.sandbox.offload

import android.app.ActivityManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.util.Log
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * android-clipboard — get, set, clear, or query the device clipboard.
 *
 * T65: re-aligned with iOS apple-clipboard (NativeOffloads/ClipboardOffload.m).
 * Adds:
 *   - `status` subcommand mirroring iOS — returns `has_content`, `types`,
 *     `item_count` so the model can probe before reading.
 *   - `--text <value>` named flag on `set` — preferred over the legacy
 *     positional form (`android-clipboard set Hello world`) so multi-word
 *     text without explicit quoting works without surprising tokenisation.
 *     The legacy positional form still works for back-compat.
 *
 * Android 10+ restricts clipboard reads from background — `primaryClip`
 * returns null unless the app has window focus or is the default IME. We
 * detect that case and return a specific error so the caller knows the
 * failure is recoverable by foregrounding the app rather than a permission
 * problem.
 *
 * Usage:
 *   android-clipboard get
 *   android-clipboard set --text "Hello world"
 *   android-clipboard set Hello world         # legacy positional, still works
 *   android-clipboard clear
 *   android-clipboard status
 */
class ClipboardOffloadHandler(private val context: Context) : NativeOffloadHandler {
    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1))
        // [T-offload-defaults-batch-android] Help only on explicit
        // --help/-h; no subcommand defaults to `get`.
        if (args.hasFlag("h", "help")) {
            return NativeOffloadResult(0, HELP)
        }
        // T330: tri-state agent gate before any work.
        OffloadGate.enforce("clipboard", "android-clipboard", args, request)?.let { return it }

        val cm = try {
            context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        } catch (_: Throwable) { null }
            ?: run {
                val body = JSONObject().put("error", "service_unavailable")
                    .put("message", "ClipboardManager not available on this device.")
                    .toString()
                return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
            }

        return try {
            when (val sub = args.positional.firstOrNull() ?: "get") {
                "get" -> doGet(cm, args)
                "set" -> doSet(cm, args)
                "clear" -> doClear(cm, args)
                "status" -> doStatus(cm, args)
                else -> NativeOffloadResult(2, "android-clipboard: unknown subcommand '$sub'\n$HELP")
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "SecurityException: ${e.message}")
            val body = JSONObject().put("error", "clipboard_denied")
                .put("message", "Clipboard access was denied by the system. On MIUI/HyperOS the user may have revoked clipboard permission in the privacy panel.")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: Throwable) {
            Log.w(TAG, "uncaught: ${e.message}", e)
            val body = JSONObject().put("error", "internal").put("message", e.message ?: "unknown").toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── Subcommands ──────────────────────────────────────────────────────────

    private fun doGet(cm: ClipboardManager, args: OffloadArgs): NativeOffloadResult {
        if (!isAppForeground() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return backgroundError(args)
        }
        val clip = cm.primaryClip
        if (clip == null || clip.itemCount == 0) {
            return NativeOffloadResult(0, "")
        }
        // Backwards-compat: get's primary output is still the raw clipboard
        // text (lots of pipe consumers depend on it). The iOS version emits
        // structured JSON; we only switch to JSON when --json is requested
        // so existing prompts (`text=$(android-clipboard get)`) keep working.
        val text = try { clip.getItemAt(0).coerceToText(context).toString() } catch (_: Throwable) { "" }
        val body = OffloadOutput.formatBody(text.trimEnd('\n'), args)
        return NativeOffloadResult(0, "$body\n")
    }

    private fun doSet(cm: ClipboardManager, args: OffloadArgs): NativeOffloadResult {
        // T65: --text is the preferred form; falls back to the legacy
        // positional form for back-compat. Whichever path delivers
        // non-blank text wins.
        val text = args.get("text") ?: args.positional.drop(1).joinToString(" ")
        if (text.isBlank()) {
            return NativeOffloadResult(
                2,
                "android-clipboard set: missing <text> (use --text \"...\" or pass positional args)\n",
            )
        }
        if (!isAppForeground() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return backgroundError(args)
        }
        val label = args.get("label") ?: "Minis"
        cm.setPrimaryClip(ClipData.newPlainText(label, text))
        return NativeOffloadResult(
            0,
            OffloadOutput.formatBody("Copied ${text.length} characters to clipboard.", args) + "\n",
        )
    }

    private fun doClear(cm: ClipboardManager, args: OffloadArgs): NativeOffloadResult {
        if (!isAppForeground()) return backgroundError(args)
        cm.setPrimaryClip(ClipData.newPlainText("", ""))
        return NativeOffloadResult(0, OffloadOutput.formatBody("Clipboard cleared.", args) + "\n")
    }

    /**
     * iOS apple-clipboard `status` returns:
     *   {has_content, types, item_count, change_count}
     *
     * Android port:
     *   - `has_content` — true iff there's a primary clip with at least 1 item
     *   - `types` — list of MIME types from the first item's clip description
     *     (Android exposes MIME types directly, more precise than iOS's
     *     coarse "strings/urls/images" buckets — we still bucket the
     *     iOS-style values into a parallel `categories` array so prompts
     *     learned for iOS keep working without modification)
     *   - `item_count` — `primaryClip.itemCount`
     *   - `change_count` — Android doesn't expose a clipboard change counter,
     *     omitted (the field is simply not in the JSON body, not zero,
     *     so prompts can detect platform difference)
     */
    private fun doStatus(cm: ClipboardManager, args: OffloadArgs): NativeOffloadResult {
        if (!isAppForeground() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return backgroundError(args)
        }
        val clip = cm.primaryClip
        val description = cm.primaryClipDescription
        val itemCount = clip?.itemCount ?: 0
        val mimeTypes = JSONArray()
        val categories = JSONArray()
        var hasStrings = false
        var hasUrls = false
        var hasImages = false
        if (description != null) {
            for (i in 0 until description.mimeTypeCount) {
                val mime = description.getMimeType(i)
                mimeTypes.put(mime)
                when {
                    mime.startsWith("text/") || mime == ClipDescription_MIMETYPE_TEXT_PLAIN -> hasStrings = true
                    mime == ClipDescription_MIMETYPE_TEXT_URILIST -> hasUrls = true
                    mime.startsWith("image/") -> hasImages = true
                }
            }
        }
        if (hasStrings) categories.put("strings")
        if (hasUrls) categories.put("urls")
        if (hasImages) categories.put("images")
        val hasContent = itemCount > 0 && (hasStrings || hasUrls || hasImages || mimeTypes.length() > 0)
        val body = JSONObject()
            .put("has_content", hasContent)
            .put("has_strings", hasStrings)
            .put("has_urls", hasUrls)
            .put("has_images", hasImages)
            .put("types", categories)
            .put("mime_types", mimeTypes)
            .put("item_count", itemCount)
            .toString()
        return NativeOffloadResult(0, OffloadOutput.formatBody(body, args) + "\n")
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun isAppForeground(): Boolean {
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                ?: return true  // can't tell — assume OK, let the actual call surface errors
            val procs = am.runningAppProcesses.orEmpty()
            val pid = android.os.Process.myPid()
            procs.any { it.pid == pid && it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND }
        } catch (_: Throwable) {
            true
        }
    }

    private fun backgroundError(args: OffloadArgs) = NativeOffloadResult(
        1,
        OffloadOutput.formatBody(
            JSONObject().put("error", "clipboard_requires_foreground")
                .put("message", "Android 10+ blocks clipboard access when the app is not in the foreground. Ask the user to bring Minis to the foreground and retry.")
                .toString(),
            args,
        ) + "\n",
    )

    companion object {
        private const val TAG = "ClipboardOffload"
        // Local copies of android.content.ClipDescription constants so the
        // status switch reads cleanly without an extra import.
        private const val ClipDescription_MIMETYPE_TEXT_PLAIN = "text/plain"
        private const val ClipDescription_MIMETYPE_TEXT_URILIST = "text/uri-list"
        private const val HELP = """android-clipboard — access the device clipboard

Usage:
  android-clipboard <command> [options]

Running without a subcommand is the same as `get` (default subcommand).

COMMANDS:
  get                  Print current clipboard text
  set --text "<text>"  Copy text to clipboard (preferred form)
  set <text...>        Copy text to clipboard (legacy positional form)
  clear                Empty the clipboard
  status               Print clipboard content types + item count

OPTIONS:
  --text <value>       Text to write (for `set`)
  --label <name>       Optional ClipData label (default: Minis)
  --help, -h           Show this help message
  --compact            Minimize JSON output
  -q, --quiet          Output only data field

EXAMPLES:
  android-clipboard get
  android-clipboard set --text "Hello world"
  android-clipboard set Hello world
  android-clipboard clear
  android-clipboard status

Android 10+ blocks clipboard access in the background — errors include
{"error":"clipboard_requires_foreground"} when the app is not focused.
"""
    }
}
