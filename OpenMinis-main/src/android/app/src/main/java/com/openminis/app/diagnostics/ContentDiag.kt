package com.openminis.app.diagnostics

import java.util.concurrent.atomic.AtomicReference

/**
 * [T-android-content-perf-diag] Summary-level content-shape diagnostics for the
 * markdown render perf path. Given a message body, computes a cheap structural
 * fingerprint (length, lines, paragraphs, table / code-block / math markers)
 * that pinpoints *which content structure* is driving a render hang — without
 * ever logging the body itself (no perf overhead, no privacy leak).
 *
 * Used by:
 *  - ChatScreen cold-open summary — one line per large message.
 *  - LargeContentGuard — at streaming degrade + stream-end markdown swap.
 *  - HangDetector — attaches the currently-rendering message's fingerprint to
 *    each JankDiag stall sample (via [currentRender]) so a Matcher/Pattern
 *    stack maps straight to "this message, this structure" from the log alone.
 */
/** Below this length a message never drives a render hang, so skip the summary. */
const val CONTENT_DIAG_MIN_CHARS = 5_000

object ContentDiag {

    data class Summary(
        val chars: Int,
        val lines: Int,
        val paragraphs: Int,
        val tableCount: Int,
        val codeBlockCount: Int,
        val mathCount: Int,
    ) {
        val hasTable: Boolean get() = tableCount > 0
        val hasCodeBlock: Boolean get() = codeBlockCount > 0
        val hasMath: Boolean get() = mathCount > 0

        /** Compact, greppable key=value fragment (no session/idx prefix). */
        fun asLogFields(): String =
            "chars=$chars lines=$lines paragraphs=$paragraphs " +
                "hasTable=$hasTable tableCount=$tableCount " +
                "hasCodeBlock=$hasCodeBlock codeBlockCount=$codeBlockCount " +
                "hasMath=$hasMath mathCount=$mathCount"
    }

    // Fenced code block opener/closer (``` or ~~~), start-of-line.
    private val FENCE = Regex("""(?m)^\s{0,3}(```|~~~)""")
    // A markdown table separator row: | --- | :---: | --- | (the load-bearing
    // line that turns pipe rows into a real table).
    private val TABLE_SEP = Regex("""(?m)^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$""")
    // Display math: $$…$$ or \[…\]. Counted as blocks (pairs → count via markers/2).
    private val DISPLAY_MATH_DOLLAR = Regex("""\$\$""")
    private val DISPLAY_MATH_BRACKET = Regex("""\\\[""")
    // Inline math: \(…\) or single-$…$ (rough — single-$ is only counted when it
    // is NOT part of a $$ run, to avoid double-counting display math).
    private val INLINE_MATH_PAREN = Regex("""\\\(""")

    /**
     * Compute the structural summary. O(n) over the text with a handful of
     * regex scans — cheap enough to call on the cold-open path, but callers
     * should still gate on a size threshold to avoid summarizing tiny bodies.
     */
    fun summarize(text: String): Summary {
        if (text.isEmpty()) return Summary(0, 0, 0, 0, 0, 0)
        val lines = text.count { it == '\n' } + 1
        // Paragraphs: runs separated by one-or-more blank lines.
        val paragraphs = text.split(Regex("\\n\\s*\\n"))
            .count { it.isNotBlank() }
            .coerceAtLeast(1)
        // Fenced code blocks = fence markers / 2 (round up an unclosed trailing fence).
        val fenceMarkers = FENCE.findAll(text).count()
        val codeBlockCount = (fenceMarkers + 1) / 2
        val tableCount = TABLE_SEP.findAll(text).count()
        val displayDollar = DISPLAY_MATH_DOLLAR.findAll(text).count() / 2
        val displayBracket = DISPLAY_MATH_BRACKET.findAll(text).count()
        val inlineParen = INLINE_MATH_PAREN.findAll(text).count()
        val mathCount = displayDollar + displayBracket + inlineParen
        return Summary(
            chars = text.length,
            lines = lines,
            paragraphs = paragraphs,
            tableCount = tableCount,
            codeBlockCount = codeBlockCount,
            mathCount = mathCount,
        )
    }

    // ─── Current-render fingerprint for HangDetector correlation ───────────────

    data class RenderMarker(val sessionId: String, val messageId: String, val summary: Summary)

    private val current = AtomicReference<RenderMarker?>(null)

    /** Called by the render path when it begins rendering a large message body. */
    fun setCurrentRender(sessionId: String, messageId: String, summary: Summary) {
        current.set(RenderMarker(sessionId, messageId, summary))
    }

    /** Cleared when the large render completes / the block leaves composition. */
    fun clearCurrentRender(messageId: String) {
        val cur = current.get()
        if (cur != null && cur.messageId == messageId) current.set(null)
    }

    /** For HangDetector: a greppable fragment for the message on-screen, or "". */
    fun currentRenderLogFields(): String {
        val cur = current.get() ?: return ""
        return " renderSession=${cur.sessionId} renderMsg=${cur.messageId} ${cur.summary.asLogFields()}"
    }
}
