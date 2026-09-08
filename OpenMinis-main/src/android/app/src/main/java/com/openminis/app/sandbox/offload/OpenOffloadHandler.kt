package com.openminis.app.sandbox.offload

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import org.json.JSONObject

/**
 * Host-side implementation of `android-open <url>` — launches any URL or
 * URI the Android system knows how to resolve (https, tel, mailto, geo,
 * market, intent, etc.).
 *
 * Includes a few OEM-aware fallbacks:
 *   • `market:` URIs on Huawei / no-GMS devices → redirect to AppGallery.
 *   • Any `ActivityNotFoundException` → structured error naming the
 *     missing handler instead of crashing.
 *
 * Usage:
 *   android-open <url>
 *   android-open --help
 */
class OpenOffloadHandler(private val context: Context) : NativeOffloadHandler {
    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1))
        if (args.hasFlag("h", "help")) return NativeOffloadResult(0, HELP)

        val url = args.positional.firstOrNull()
        if (url.isNullOrBlank()) {
            return NativeOffloadResult(2, "android-open: missing <url>\n$HELP")
        }

        return tryOpen(url, args)
    }

    private fun tryOpen(url: String, args: OffloadArgs): NativeOffloadResult {
        return try {
            // T259: intent: / android-app: URIs encode action + categories +
            // extras + flags inline (e.g. ACTION_SET_ALARM with HOUR/MINUTES
            // extras). Wrapping them in ACTION_VIEW threw all of that away,
            // so resolveActivity returned null and the call fell through to
            // the no_handler error branch. Use Intent.parseUri to honor the
            // full URI semantics; ACTION_VIEW path stays for plain http/tel
            // /mailto/geo/market URLs.
            val intent: Intent = if (url.startsWith("intent:") || url.startsWith("android-app:")) {
                Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    // Browsers inject a selector to bind the URI to a
                    // specific package; we already trust the model-supplied
                    // intent, so let the system-wide chooser apply.
                    selector = null
                }
            } else {
                Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val resolved = intent.resolveActivity(context.packageManager)
            Log.d(TAG, "startActivity url='$url' action=${intent.action} resolved=${resolved?.flattenToShortString()}")
            context.startActivity(intent)
            NativeOffloadResult(0, OffloadOutput.formatBody("Opened: $url", args) + "\n")
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "no handler for '$url'")
            maybeFallback(url, e, args)
        } catch (e: SecurityException) {
            val body = JSONObject().put("error", "open_denied")
                .put("message", "The system refused to open this URL: ${e.message}")
                .put("url", url)
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: java.net.URISyntaxException) {
            // T259: parseUri rejected a malformed intent: URI before any
            // resolveActivity call — surface as bad input, not no_handler,
            // so the model knows to fix the URI shape.
            Log.w(TAG, "parseUri failed for '$url': ${e.message}")
            val body = JSONObject().put("error", "bad_intent_uri")
                .put("message", "Malformed intent: URI: ${e.message}")
                .put("url", url)
                .toString()
            NativeOffloadResult(2, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: Throwable) {
            Log.w(TAG, "uncaught: ${e.message}", e)
            val body = JSONObject().put("error", "open_failed")
                .put("message", e.message ?: "Failed to open URL.")
                .put("url", url)
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    /**
     * Fallback rules for URLs that couldn't be resolved. Returns a friendly
     * error message with a hint the model can relay to the user.
     */
    private fun maybeFallback(url: String, original: ActivityNotFoundException, args: OffloadArgs): NativeOffloadResult {
        // market: → Huawei AppGallery on HMS-only devices
        if (url.startsWith("market://") && OsCompat.isHuawei) {
            val pkg = Uri.parse(url).getQueryParameter("id")
                ?: url.substringAfter("details?id=").substringBefore('&')
            if (pkg.isNotBlank()) {
                val ag = "https://appgallery.huawei.com/app/$pkg"
                Log.d(TAG, "market: redirect → AppGallery $ag")
                return tryOpen(ag, args)
            }
        }

        val schemeHint = when {
            url.startsWith("mailto:") -> "no email app installed"
            url.startsWith("tel:") -> "no phone/dialer app installed"
            url.startsWith("sms:") -> "no SMS app installed"
            url.startsWith("geo:") -> "no maps app installed"
            url.startsWith("market:") -> "no app store installed"
            url.startsWith("http:") || url.startsWith("https:") -> "no browser installed"
            else -> "no app can handle this URI scheme"
        }
        val body = JSONObject().put("error", "no_handler")
            .put("message", "Cannot open '$url': $schemeHint. Ask the user to install a compatible app.")
            .put("url", url)
            .put("detail", original.message ?: "ActivityNotFoundException")
            .toString()
        return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
    }

    companion object {
        private const val TAG = "OpenOffload"
        private const val HELP = """android-open — open a URL or URI with the system handler

Usage:
  android-open <url>
  android-open --help

Supports https://, tel:, mailto:, geo:, market:, intent:, and any other
scheme a device app can handle. On Huawei devices without Play Store,
market:// URLs automatically fall back to AppGallery.
Errors are returned as JSON: {"error":"no_handler","message":"...","url":"..."}.
"""
    }
}
