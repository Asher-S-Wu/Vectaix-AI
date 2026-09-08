package com.openminis.app.ui.browser

import android.annotation.SuppressLint
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Composable wrapper around Android WebView, mirroring iOS BrowserWebView.
 *
 * [T-android-browser-blank] Hosts the WebView inside a FrameLayout container
 * and swaps it in `update` instead of returning the WebView from `factory`.
 * AndroidView's factory runs ONCE per node — with the old direct-return
 * approach, switching tabs (or the pool recreating a WebView after idle
 * eviction) recomposed with a NEW WebView instance but the screen kept
 * showing the stale one: the sheet header/URL bar (StateFlows from the
 * current tab manager) looked correct while the content area rendered a
 * dead/blank WebView — the reported black/white screen. iOS avoids this via
 * `.id(pool.selectedTabId)` remounting; the container+update pattern is the
 * Android equivalent.
 *
 * Ask all ancestor views (including the host ModalBottomSheet) to stop
 * intercepting touches as soon as the user puts a finger down on the
 * WebView, so page scroll gestures never drag the sheet.
 */
@SuppressLint("ClickableViewAccessibility")
@Composable
fun BrowserWebView(
    webView: WebView,
    modifier: Modifier = Modifier,
) {
    AndroidView(
        factory = { context -> FrameLayout(context) },
        update = { container ->
            val mounted = container.getChildAt(0)
            if (mounted !== webView) {
                container.removeAllViews()
                // The WebView may still be parented to a previous container
                // (sheet re-open racing the old node's disposal) — detach
                // first or addView throws "child already has a parent".
                (webView.parent as? ViewGroup)?.removeView(webView)
                webView.setOnTouchListener { v, event ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN,
                        MotionEvent.ACTION_MOVE,
                        MotionEvent.ACTION_POINTER_DOWN ->
                            v.parent?.requestDisallowInterceptTouchEvent(true)
                        MotionEvent.ACTION_UP,
                        MotionEvent.ACTION_CANCEL ->
                            v.parent?.requestDisallowInterceptTouchEvent(false)
                    }
                    false
                }
                container.addView(
                    webView,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT,
                    ),
                )
            }
        },
        onRelease = { container ->
            // Free the WebView so a later mount (same or different sheet)
            // can re-parent it without hitting the has-a-parent guard.
            container.removeAllViews()
        },
        modifier = modifier,
    )
}
