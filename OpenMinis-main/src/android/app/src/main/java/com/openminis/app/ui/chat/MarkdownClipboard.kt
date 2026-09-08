package com.openminis.app.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context

/**
 * Clipboard helpers that mirror the iOS chat-message context menu actions
 * (`SelectableMarkdownTextView` → `copyMarkdown` / `copyRichText`).
 *
 * iOS exports rich text as RTF via `UIPasteboard.setData(rtfData, forPasteboardType: "public.rtf")`.
 * Android's pasteboard equivalent is [ClipData.newHtmlText], which carries both
 * plain-text and HTML payloads — Notes, Gmail, Docs, etc. all consume the HTML
 * variant when pasting "with formatting." We render the markdown to a
 * lightweight HTML subset locally instead of pulling in a parser dependency.
 *
 * Three flavors:
 *   - [copyPlain]    — markdown stripped to readable plain text (default Copy)
 *   - [copyMarkdown] — raw markdown source verbatim
 *   - [copyRichText] — HTML+plain dual payload for paste-with-formatting
 */
object MarkdownClipboard {

    fun copyPlain(context: Context, markdown: String, label: String = "Message") {
        val plain = markdownToPlainText(markdown)
        clipboard(context).setPrimaryClip(ClipData.newPlainText(label, plain))
    }

    fun copyMarkdown(context: Context, markdown: String, label: String = "Markdown") {
        clipboard(context).setPrimaryClip(ClipData.newPlainText(label, markdown))
    }

    fun copyRichText(context: Context, markdown: String, label: String = "Rich Text") {
        val plain = markdownToPlainText(markdown)
        val html = markdownToHtml(markdown)
        clipboard(context).setPrimaryClip(ClipData.newHtmlText(label, plain, html))
    }

    private fun clipboard(context: Context): ClipboardManager =
        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    /**
     * Strip markdown syntax, leaving the visible reading order intact. Goals:
     *   - emphasis/strong/strike markers removed, content kept
     *   - inline code / fenced code unwrapped (content preserved verbatim)
     *   - link `[text](url)` → `text` (drop URL, matches iOS Copy behavior)
     *   - images `![alt](url)` → `alt`
     *   - heading `#`, blockquote `>`, list bullets `- * +` and ordered `1.` stripped
     *   - tables flattened to ` | ` separated lines (good enough for paste targets that don't render markdown)
     */
    fun markdownToPlainText(markdown: String): String {
        val out = StringBuilder()
        val lines = markdown.lines()
        var i = 0
        var inFence = false
        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trimStart()
            if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                inFence = !inFence
                i++; continue
            }
            if (inFence) {
                out.append(line).append('\n')
                i++; continue
            }
            // Heading
            val heading = Regex("^(#{1,6})\\s+(.*)$").find(trimmed)
            if (heading != null) {
                out.append(stripInline(heading.groupValues[2])).append('\n')
                i++; continue
            }
            // Blockquote
            if (trimmed.startsWith(">")) {
                out.append(stripInline(trimmed.removePrefix(">").trimStart())).append('\n')
                i++; continue
            }
            // Unordered list
            val ul = Regex("^([-*+])\\s+(.*)$").find(trimmed)
            if (ul != null) {
                out.append("• ").append(stripInline(ul.groupValues[2])).append('\n')
                i++; continue
            }
            // Ordered list
            val ol = Regex("^(\\d+)\\.\\s+(.*)$").find(trimmed)
            if (ol != null) {
                out.append(ol.groupValues[1]).append(". ")
                    .append(stripInline(ol.groupValues[2])).append('\n')
                i++; continue
            }
            // Horizontal rule
            if (Regex("^(-{3,}|\\*{3,}|_{3,})$").matches(trimmed)) {
                out.append('\n'); i++; continue
            }
            // Table separator row (|---|---|): drop entirely.
            if (Regex("^\\|?\\s*:?-{3,}.*$").matches(trimmed) && trimmed.contains('-')) {
                i++; continue
            }
            // Generic line — strip inline markers
            out.append(stripInline(line)).append('\n')
            i++
        }
        return out.toString().trimEnd('\n')
    }

    /**
     * Minimal markdown → HTML for paste-with-formatting. Covers the syntax
     * the chat actually produces. Not a full CommonMark renderer; we lean on
     * reader-side leniency (Gmail/Notes/Docs all tolerate sparse HTML).
     */
    fun markdownToHtml(markdown: String): String {
        val sb = StringBuilder()
        sb.append("<html><body>")
        val lines = markdown.lines()
        var i = 0
        var inFence = false
        var fenceLang: String? = null
        val fenceBuf = StringBuilder()
        var listType: String? = null  // "ul" | "ol"
        fun closeList() {
            if (listType != null) {
                sb.append("</$listType>")
                listType = null
            }
        }
        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trimStart()
            // Fenced code
            val fenceMatch = Regex("^(```|~~~)(.*)$").find(trimmed)
            if (fenceMatch != null) {
                if (!inFence) {
                    closeList()
                    inFence = true
                    fenceLang = fenceMatch.groupValues[2].trim().ifEmpty { null }
                    fenceBuf.clear()
                } else {
                    inFence = false
                    sb.append("<pre><code")
                    fenceLang?.let { sb.append(" class=\"language-").append(escapeHtml(it)).append("\"") }
                    sb.append(">").append(escapeHtml(fenceBuf.toString().trimEnd('\n'))).append("</code></pre>")
                    fenceBuf.clear()
                }
                i++; continue
            }
            if (inFence) {
                fenceBuf.append(line).append('\n')
                i++; continue
            }
            // Blank line: close paragraph context
            if (trimmed.isEmpty()) {
                closeList()
                i++; continue
            }
            // Heading
            val heading = Regex("^(#{1,6})\\s+(.*)$").find(trimmed)
            if (heading != null) {
                closeList()
                val level = heading.groupValues[1].length
                sb.append("<h").append(level).append(">")
                    .append(inlineToHtml(heading.groupValues[2]))
                    .append("</h").append(level).append(">")
                i++; continue
            }
            // Blockquote
            if (trimmed.startsWith(">")) {
                closeList()
                sb.append("<blockquote>")
                    .append(inlineToHtml(trimmed.removePrefix(">").trimStart()))
                    .append("</blockquote>")
                i++; continue
            }
            // Horizontal rule
            if (Regex("^(-{3,}|\\*{3,}|_{3,})$").matches(trimmed)) {
                closeList(); sb.append("<hr/>"); i++; continue
            }
            // Unordered list
            val ul = Regex("^([-*+])\\s+(.*)$").find(trimmed)
            if (ul != null) {
                if (listType != "ul") { closeList(); sb.append("<ul>"); listType = "ul" }
                sb.append("<li>").append(inlineToHtml(ul.groupValues[2])).append("</li>")
                i++; continue
            }
            // Ordered list
            val ol = Regex("^(\\d+)\\.\\s+(.*)$").find(trimmed)
            if (ol != null) {
                if (listType != "ol") { closeList(); sb.append("<ol>"); listType = "ol" }
                sb.append("<li>").append(inlineToHtml(ol.groupValues[2])).append("</li>")
                i++; continue
            }
            // Plain paragraph line
            closeList()
            sb.append("<p>").append(inlineToHtml(line)).append("</p>")
            i++
        }
        closeList()
        if (inFence && fenceBuf.isNotEmpty()) {
            sb.append("<pre><code>").append(escapeHtml(fenceBuf.toString().trimEnd('\n'))).append("</code></pre>")
        }
        sb.append("</body></html>")
        return sb.toString()
    }

    /** Strip inline markdown markers, return readable text. */
    private fun stripInline(s: String): String {
        var t = s
        // Images: ![alt](url) → alt
        t = Regex("!\\[([^\\]]*)\\]\\([^)]*\\)").replace(t, "$1")
        // Links: [text](url) → text
        t = Regex("\\[([^\\]]+)\\]\\(([^)]+)\\)").replace(t, "$1")
        // Inline code: `code` → code
        t = Regex("`([^`]+)`").replace(t, "$1")
        // Bold/italic/strike — order matters: longest delimiter first.
        t = Regex("\\*\\*\\*(.+?)\\*\\*\\*").replace(t, "$1")
        t = Regex("___(.+?)___").replace(t, "$1")
        t = Regex("\\*\\*(.+?)\\*\\*").replace(t, "$1")
        t = Regex("__(.+?)__").replace(t, "$1")
        t = Regex("(?<!\\*)\\*(?!\\*)([^*\\n]+)\\*").replace(t, "$1")
        t = Regex("(?<!_)_(?!_)([^_\\n]+)_").replace(t, "$1")
        t = Regex("~~(.+?)~~").replace(t, "$1")
        return t
    }

    /** Inline markdown → HTML, escaping non-markdown characters. */
    private fun inlineToHtml(s: String): String {
        // Pull code spans out first so their contents aren't re-escaped/processed.
        val codePlaceholder = " CODE "
        val codes = mutableListOf<String>()
        var work = Regex("`([^`]+)`").replace(s) { m ->
            codes.add(m.groupValues[1])
            "$codePlaceholder${codes.size - 1}$codePlaceholder"
        }
        work = escapeHtml(work)
        // Images: ![alt](url)
        work = Regex("!\\[([^\\]]*)\\]\\(([^)]+)\\)").replace(work) { m ->
            "<img alt=\"${m.groupValues[1]}\" src=\"${m.groupValues[2]}\"/>"
        }
        // Links: [text](url)
        work = Regex("\\[([^\\]]+)\\]\\(([^)]+)\\)").replace(work) { m ->
            "<a href=\"${m.groupValues[2]}\">${m.groupValues[1]}</a>"
        }
        // Bold ***x*** / ___x___
        work = Regex("\\*\\*\\*(.+?)\\*\\*\\*").replace(work, "<strong><em>$1</em></strong>")
        work = Regex("___(.+?)___").replace(work, "<strong><em>$1</em></strong>")
        // Bold **x**
        work = Regex("\\*\\*(.+?)\\*\\*").replace(work, "<strong>$1</strong>")
        work = Regex("__(.+?)__").replace(work, "<strong>$1</strong>")
        // Italic *x* / _x_
        work = Regex("(?<!\\*)\\*(?!\\*)([^*\\n]+)\\*").replace(work, "<em>$1</em>")
        work = Regex("(?<!_)_(?!_)([^_\\n]+)_").replace(work, "<em>$1</em>")
        // Strikethrough ~~x~~
        work = Regex("~~(.+?)~~").replace(work, "<del>$1</del>")
        // Restore code spans (and HTML-escape their inside)
        work = Regex("$codePlaceholder(\\d+)$codePlaceholder").replace(work) { m ->
            "<code>${escapeHtml(codes[m.groupValues[1].toInt()])}</code>"
        }
        return work
    }

    private fun escapeHtml(s: String): String =
        s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
}
