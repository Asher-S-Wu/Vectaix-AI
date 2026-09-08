package com.openminis.app.ui.chat

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.geometry.Rect

/**
 * Per-conversation registry of currently-laid-out message bounds. Lets the
 * outer [androidx.compose.foundation.text.selection.SelectionContainer]'s
 * custom [androidx.compose.ui.platform.TextToolbar] look up which message
 * a selection rect belongs to so it can offer "Copy Markdown" / "Copy Rich
 * Text" of the originating message's full markdown.
 *
 * The registry is keyed by message id and stores the message's bounds in
 * window coordinates plus a snapshot of its joined markdown source. Each
 * `AssistantMessageView` writes into the registry via `onGloballyPositioned`
 * and clears its entry on dispose.
 *
 * Lookup picks the message whose bounds vertically contain the y-center of
 * the query rect — selection rects are typically short horizontal ranges,
 * but they cleanly belong to a single message in the y axis. When no entry
 * matches (cross-message selection or a rect that misses everything) the
 * lookup returns null and the caller falls back to the system Copy bar
 * behavior.
 */
class MessageBoundsRegistry {
    /**
     * One slot per (messageId, slotKey) so a message that flattens into
     * multiple LazyColumn items (text block + tool pills + ...) can register
     * each piece independently. The markdown is the message-wide markdown,
     * shared across all of that message's slots.
     */
    private data class Entry(val bounds: Rect, val markdown: String)
    private val entries = mutableMapOf<Pair<String, String>, Entry>()

    fun put(messageId: String, slotKey: String, bounds: Rect, markdown: String) {
        entries[messageId to slotKey] = Entry(bounds, markdown)
    }

    fun remove(messageId: String, slotKey: String) {
        entries.remove(messageId to slotKey)
    }

    /**
     * Find the markdown for the message whose bounds vertically contain
     * [rect]'s y-center. Returns null if no slot matches.
     */
    fun markdownAt(rect: Rect): String? {
        val y = (rect.top + rect.bottom) / 2f
        return entries.values.firstOrNull { y in it.bounds.top..it.bounds.bottom }?.markdown
    }

    /**
     * Direct messageId → markdown lookup, used by the MinisTextKit selection
     * toolbar so it can resolve the parent message's source even when both
     * selection endpoints' shards have scrolled out of the viewport. Falls
     * back to any registered slot for that message (any slot's markdown ==
     * the message-wide joined markdown by construction in buildFlatChatItems).
     */
    fun markdownFor(messageId: String): String? {
        return entries.entries.firstOrNull { it.key.first == messageId }?.value?.markdown
    }
}

val LocalMessageBoundsRegistry = compositionLocalOf<MessageBoundsRegistry?> { null }
