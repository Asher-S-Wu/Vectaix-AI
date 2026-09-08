package com.openminis.app.terminal

import android.net.Uri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Process-wide broker for URLs captured from shell stdout via the OSC
 * `MinisOpenURL` marker (emitted by `/usr/local/bin/minis-open`). The active
 * chat screen collects [pendingUrl] and routes the captured URL into its
 * existing link-tap handler, which in turn dispatches:
 *
 *   * `http(s)://` / `about:`  → `UrlPreviewSheet` via `LocalInAppBrowserLauncher`
 *   * `minis://<deep-link>`    → `DeepLinkHandler`
 *   * `minis://<host>/<path>`  → in-app file preview by extension
 *
 * Whichever observer handles the URL calls [consume] so sibling observers
 * skip it. This mirrors iOS `MinisOpenURLBroker`.
 *
 * The broker also tracks which top-most host ([toolSheetVisible] /
 * [terminalVisible]) is currently presented so the chat screen can defer web
 * previews when a nested sheet or the fullscreen terminal should take
 * priority. On Android today only the chat screen consumes URLs, but the
 * flags are kept for parity so future callers can opt into the same
 * coordination pattern without reshuffling the API.
 */
object MinisOpenUrlBroker {
    private val _pendingUrl = MutableStateFlow<Uri?>(null)
    val pendingUrl: StateFlow<Uri?> = _pendingUrl.asStateFlow()

    private val _toolSheetVisible = MutableStateFlow(false)
    val toolSheetVisible: StateFlow<Boolean> = _toolSheetVisible.asStateFlow()

    private val _terminalVisible = MutableStateFlow(false)
    val terminalVisible: StateFlow<Boolean> = _terminalVisible.asStateFlow()

    fun offer(uri: Uri) { _pendingUrl.value = uri }

    fun offer(uriString: String) {
        val parsed = runCatching { Uri.parse(uriString) }.getOrNull() ?: return
        if (!isSupportedScheme(parsed.scheme)) return
        _pendingUrl.value = parsed
    }

    fun consume() { _pendingUrl.value = null }

    fun setToolSheetVisible(visible: Boolean) { _toolSheetVisible.value = visible }
    fun setTerminalVisible(visible: Boolean) { _terminalVisible.value = visible }

    /**
     * Schemes `minis-open` may emit and that the host knows how to route.
     *   * `http` / `https` / `about` → in-app WebView preview
     *   * `minis`                    → deep link or in-app file preview
     */
    fun isSupportedScheme(scheme: String?): Boolean {
        val s = scheme?.lowercase() ?: return false
        return s == "http" || s == "https" || s == "about" || s == "minis"
    }

    /**
     * True for schemes that render as a WebView preview. Callers use this to
     * suppress presentation while a top-most host (tool sheet, fullscreen
     * terminal) is visible and wants to handle it itself.
     */
    fun isWebScheme(scheme: String?): Boolean {
        val s = scheme?.lowercase() ?: return false
        return s == "http" || s == "https" || s == "about"
    }
}
