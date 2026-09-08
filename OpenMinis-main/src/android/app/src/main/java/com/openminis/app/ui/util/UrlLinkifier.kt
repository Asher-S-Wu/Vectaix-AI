package com.openminis.app.ui.util

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink

/**
 * Convert a plain-text string into an [AnnotatedString] where any http(s) URL
 * is wrapped in a [LinkAnnotation.Url] span — clicking it routes through
 * [onClick] (so the chat screen's in-app web-preview handler can intercept,
 * matching iOS MinisOpenURLBroker behaviour).
 *
 * Used by tool-result renderers (`shell_execute` output, generic text-mode
 * tool outputs, etc.) where the upstream content is not Markdown so the
 * existing `MarkdownText` link path doesn't apply. Mirrors iOS
 * `TerminalCanvasView.addURLLinks` — http/https only, no other schemes.
 *
 * Detection uses [android.util.Patterns.WEB_URL] which is the
 * platform-blessed regex (mirrors what TextView's Linkify uses), but
 * filtered to entries that actually start with a scheme so we don't
 * surface bare hostnames as clickable. We don't reconstruct soft-wrapped
 * URLs the way iOS does for the terminal canvas — Compose `Text` lays
 * out logical strings, not grid cells, so URLs aren't broken across grid
 * rows the way they are in a fixed-cell terminal view.
 *
 * @param text     the plain text to linkify
 * @param onClick  called with the matched URL string when the user taps a
 *                 link; typically delegates to the chat's `urlClickHandler`
 *                 (in-app `UrlPreviewSheet`).
 * @param linkColor accent color for the link span (default iOS systemBlue).
 */
fun linkifyUrls(
    text: String,
    onClick: (String) -> Unit,
    linkColor: Color = Color(0xFF0A84FF),
): AnnotatedString {
    if (text.isEmpty()) return AnnotatedString(text)
    val matcher = android.util.Patterns.WEB_URL.matcher(text)

    return buildAnnotatedString {
        var cursor = 0
        while (matcher.find()) {
            val start = matcher.start()
            val end = matcher.end()
            val candidate = text.substring(start, end)
            // Patterns.WEB_URL matches bare hostnames too (e.g. "example.com");
            // skip those to keep the heuristic close to iOS — only schemes
            // we know in-app preview can render get the underline.
            val lower = candidate.lowercase()
            if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
                continue
            }
            // Append non-link gap before this match.
            if (start > cursor) append(text, cursor, start)
            withLink(
                LinkAnnotation.Url(
                    url = candidate,
                    styles = TextLinkStyles(
                        style = SpanStyle(
                            color = linkColor,
                            textDecoration = TextDecoration.Underline,
                        ),
                    ),
                    linkInteractionListener = { onClick(candidate) },
                ),
            ) {
                append(candidate)
            }
            cursor = end
        }
        if (cursor < text.length) append(text, cursor, text.length)
    }
}
