package com.openminis.app.ui.markdown

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString

/**
 * Lightweight syntax highlighter for code blocks.
 * Applies keyword/string/comment/number coloring for common languages.
 */
object SyntaxHighlighter {

    private val keywordColor = Color(0xFF569CD6)     // blue
    private val stringColor = Color(0xFFCE9178)       // orange
    private val commentColor = Color(0xFF6A9955)      // green
    private val numberColor = Color(0xFFB5CEA8)       // light green
    private val typeColor = Color(0xFF4EC9B0)         // teal
    private val defaultColor = Color(0xFFD4D4D4)      // light gray

    private val commonKeywords = setOf(
        "if", "else", "for", "while", "return", "break", "continue", "switch", "case",
        "default", "try", "catch", "finally", "throw", "new", "delete", "typeof", "instanceof",
        "class", "interface", "enum", "struct", "func", "fun", "fn", "def", "async", "await",
        "import", "export", "from", "package", "module", "use", "pub", "private", "public",
        "protected", "static", "final", "const", "let", "var", "val", "mut",
        "true", "false", "null", "nil", "None", "self", "this", "super",
        "in", "is", "as", "not", "and", "or", "with", "yield", "lambda",
        "override", "abstract", "sealed", "data", "object", "companion",
        "suspend", "inline", "when", "where", "guard", "defer", "do",
    )

    private val typeKeywords = setOf(
        "int", "float", "double", "string", "bool", "boolean", "void", "char", "byte",
        "long", "short", "String", "Int", "Float", "Double", "Bool", "Boolean",
        "List", "Map", "Set", "Array", "HashMap", "ArrayList", "Optional",
    )

    // Token regex: strings, comments, numbers, words
    private val TOKEN_REGEX = Regex(
        """(//[^\n]*|#[^\n]*|/\*[\s\S]*?\*/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+\.?\d*\b)|(\b[a-zA-Z_]\w*\b)|([^\s\w]+|\s+)"""
    )

    fun highlight(code: String, language: String): AnnotatedString = buildAnnotatedString {
        if (language.isEmpty()) {
            pushStyle(SpanStyle(color = defaultColor))
            append(code)
            pop()
            return@buildAnnotatedString
        }

        for (match in TOKEN_REGEX.findAll(code)) {
            val comment = match.groups[1]?.value
            val string = match.groups[2]?.value
            val number = match.groups[3]?.value
            val word = match.groups[4]?.value
            val other = match.groups[5]?.value

            when {
                comment != null -> {
                    pushStyle(SpanStyle(color = commentColor))
                    append(comment)
                    pop()
                }
                string != null -> {
                    pushStyle(SpanStyle(color = stringColor))
                    append(string)
                    pop()
                }
                number != null -> {
                    pushStyle(SpanStyle(color = numberColor))
                    append(number)
                    pop()
                }
                word != null -> {
                    val color = when {
                        word in commonKeywords -> keywordColor
                        word in typeKeywords -> typeColor
                        word.first().isUpperCase() -> typeColor
                        else -> defaultColor
                    }
                    pushStyle(SpanStyle(color = color))
                    append(word)
                    pop()
                }
                other != null -> {
                    pushStyle(SpanStyle(color = defaultColor))
                    append(other)
                    pop()
                }
            }
        }
    }
}
