package com.openminis.app.ui.terminal

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration

/**
 * Parses ANSI SGR escape sequences into Compose AnnotatedString with color/style spans.
 * Supports: standard 8 colors, bright colors, bold, italic, underline, strikethrough, reset.
 */
object AnsiParser {

    private val standardColors = arrayOf(
        Color(0xFF000000), // 0 black
        Color(0xFFCC0000), // 1 red
        Color(0xFF00CC00), // 2 green
        Color(0xFFCCCC00), // 3 yellow
        Color(0xFF5555FF), // 4 blue
        Color(0xFFCC00CC), // 5 magenta
        Color(0xFF00CCCC), // 6 cyan
        Color(0xFFCCCCCC), // 7 white
    )

    private val brightColors = arrayOf(
        Color(0xFF555555), // 8  bright black
        Color(0xFFFF5555), // 9  bright red
        Color(0xFF55FF55), // 10 bright green
        Color(0xFFFFFF55), // 11 bright yellow
        Color(0xFF5555FF), // 12 bright blue
        Color(0xFFFF55FF), // 13 bright magenta
        Color(0xFF55FFFF), // 14 bright cyan
        Color(0xFFFFFFFF), // 15 bright white
    )

    // Matches CSI SGR sequences: ESC [ <params> m
    private val CSI_REGEX = Regex("""\x1B\[([0-9;]*)m""")

    // Matches all other escape sequences (non-SGR) to strip them
    private val OTHER_ESC_REGEX = Regex(
        """\x1B(?:\[[0-9;]*[A-Za-ln-z]|\][^\x07]*(?:\x07|\x1B\\)|[()][0-2AB]|[A-Za-z])"""
    )

    fun parse(text: String, defaultColor: Color = Color(0xFFD4D4D4)): AnnotatedString {
        // First strip non-SGR escape sequences
        val cleaned = OTHER_ESC_REGEX.replace(text, "")

        return buildAnnotatedString {
            var fg = defaultColor
            var bold = false
            var italic = false
            var underline = false
            var strikethrough = false

            var pos = 0
            for (match in CSI_REGEX.findAll(cleaned)) {
                // Append text before this escape
                if (match.range.first > pos) {
                    val style = buildStyle(fg, bold, italic, underline, strikethrough)
                    pushStyle(style)
                    append(cleaned.substring(pos, match.range.first))
                    pop()
                }
                pos = match.range.last + 1

                // Parse SGR params
                val params = match.groupValues[1]
                    .split(';')
                    .mapNotNull { it.toIntOrNull() }
                    .ifEmpty { listOf(0) }

                var i = 0
                while (i < params.size) {
                    when (params[i]) {
                        0 -> { fg = defaultColor; bold = false; italic = false; underline = false; strikethrough = false }
                        1 -> bold = true
                        3 -> italic = true
                        4 -> underline = true
                        9 -> strikethrough = true
                        22 -> bold = false
                        23 -> italic = false
                        24 -> underline = false
                        29 -> strikethrough = false
                        in 30..37 -> fg = if (bold) brightColors[params[i] - 30] else standardColors[params[i] - 30]
                        39 -> fg = defaultColor
                        in 90..97 -> fg = brightColors[params[i] - 90]
                    }
                    i++
                }
            }

            // Append remaining text
            if (pos < cleaned.length) {
                val style = buildStyle(fg, bold, italic, underline, strikethrough)
                pushStyle(style)
                append(cleaned.substring(pos))
                pop()
            }
        }
    }

    private fun buildStyle(
        fg: Color,
        bold: Boolean,
        italic: Boolean,
        underline: Boolean,
        strikethrough: Boolean,
    ): SpanStyle {
        var decoration = TextDecoration.None
        if (underline) decoration = TextDecoration.combine(listOf(decoration, TextDecoration.Underline))
        if (strikethrough) decoration = TextDecoration.combine(listOf(decoration, TextDecoration.LineThrough))
        return SpanStyle(
            color = fg,
            fontWeight = if (bold) FontWeight.Bold else null,
            fontStyle = if (italic) androidx.compose.ui.text.font.FontStyle.Italic else null,
            textDecoration = decoration,
        )
    }
}
