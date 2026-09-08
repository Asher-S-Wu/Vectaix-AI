package com.openminis.app.browser

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.openminis.app.logging.AppLogger
import java.net.URI

/**
 * Routes navigation to Google login / OAuth domains out of our in-app
 * WebView and into a Chrome Custom Tab. Google permanently disallows
 * WebView-based sign-in (multi-signal detection: UA, X-Requested-With,
 * Sec-CH-UA, JS surface, TLS ClientHello), so any in-app WebView attempt
 * to reach these domains hits 403 disallowed_useragent. Custom Tabs run
 * in the user's real Chrome process — they share Chrome's cookie jar
 * and Google policy explicitly permits them.
 *
 * After the user finishes auth in the Custom Tab, cookies stay in
 * Chrome (not in our WebView). For the user's own browsing this is a
 * one-time flow; for `browser_use` agent calls the LLM should be told
 * the page can't be agentically traversed and to ask the user to copy
 * results back into chat — see ChatViewModel.buildSystemPrompt.
 */
object GoogleAuthRouter {
    private const val TAG = "GoogleAuthRouter"

    /**
     * Domains that, when navigated to from any in-app WebView, must be
     * handed off to Chrome Custom Tab. Subdomains match (suffix check).
     */
    private val GOOGLE_AUTH_HOSTS = listOf(
        "accounts.google.com",
        "signin.google.com",
        "myaccount.google.com",
        "oauth2.googleapis.com",
        "accounts.youtube.com",
    )

    /** Returns true if [url] should be opened externally (Custom Tab). */
    fun shouldRouteExternally(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val host = runCatching { URI(url).host?.lowercase() }.getOrNull() ?: return false
        return GOOGLE_AUTH_HOSTS.any { host == it || host.endsWith(".$it") }
    }

    /**
     * Launch [url] in a Chrome Custom Tab. Falls back to a plain
     * ACTION_VIEW Intent if Custom Tabs is unavailable on the device
     * (e.g. no Chrome / WebView-only ROM).
     */
    fun openInCustomTab(context: Context, url: String) {
        try {
            CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setUrlBarHidingEnabled(false)
                .build()
                .launchUrl(context, Uri.parse(url))
            AppLogger.info(TAG, "opened in Custom Tab: $url")
        } catch (t: Throwable) {
            AppLogger.warning(TAG, "Custom Tab launch failed, falling back to ACTION_VIEW: ${t.message}")
            runCatching {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
        }
    }
}
