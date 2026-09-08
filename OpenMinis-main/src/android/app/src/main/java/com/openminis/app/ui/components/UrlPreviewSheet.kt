package com.openminis.app.ui.components

import androidx.compose.runtime.Composable
import com.openminis.app.ui.preview.WebPreviewBottomSheet
import com.openminis.app.ui.preview.rememberWebViewHolder

/**
 * Bottom-sheet web preview for a URL tapped inside chat markdown.
 *
 * Thin wrapper around [WebPreviewBottomSheet]: callers that don't manage
 * their own [com.openminis.app.ui.preview.WebViewHolder] (most chat-side
 * link taps) get the same toolbar / sheet UX as the in-chat HTML preview
 * by going through this helper.
 *
 * Fullscreen expand is intentionally not exposed here — chat URL preview
 * was a single-sheet flow on iOS too.
 */
@Composable
fun UrlPreviewSheet(
    url: String,
    onDismiss: () -> Unit,
) {
    val holder = rememberWebViewHolder(url)
    WebPreviewBottomSheet(
        holder = holder,
        onDismiss = {
            holder.destroy()
            onDismiss()
        },
    )
}
