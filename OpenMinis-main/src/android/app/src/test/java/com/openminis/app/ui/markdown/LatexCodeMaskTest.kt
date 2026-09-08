package com.openminis.app.ui.markdown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-latex-code-mask] Regression coverage for issue #117 defect 3
 * (ported from iOS bce7e2ed).
 *
 * Before the fix, `findDoubleDollar` / `findSingleDollar` were blind forward
 * scans. A single unclosed `$$` in prose paired with a `$$` inside a LATER
 * fenced code block and swallowed every paragraph in between — including the
 * fence's own opening line — which then left an orphaned closing ``` that
 * turned the rest of the message into a code block. Symptom: "a whole
 * section suddenly disappeared".
 */
class LatexCodeMaskTest {

    private fun latexOf(md: String): List<String> =
        MarkdownParser.parseWithMath(md).mathSpans.map { it.latex }

    private fun renderedText(md: String): String =
        MarkdownParser.parseWithMath(md).blocks.joinToString("\n") { it.toString() }

    @Test
    fun `unclosed dollar-dollar does not pair with one inside a later code fence`() {
        val md = """
            Here is an unclosed display delimiter: ${'$'}${'$'}

            This paragraph must survive.

            And so must this one.

            ```python
            print("${'$'}${'$'} inside a fence is not a closer")
            ```

            Tail paragraph.
        """.trimIndent()

        // The `$$` inside the fence must NOT be treated as the closer, so no
        // display-math span is produced at all here.
        assertEquals(emptyList<String>(), latexOf(md))

        // And every paragraph between them must still be present.
        val text = renderedText(md)
        assertTrue("middle paragraph was swallowed", text.contains("This paragraph must survive"))
        assertTrue("second paragraph was swallowed", text.contains("And so must this one"))
        assertTrue("tail paragraph was swallowed", text.contains("Tail paragraph"))
    }

    @Test
    fun `ordinary single-line display math still renders`() {
        val md = "Mass energy: ${'$'}${'$'}E = mc^2${'$'}${'$'} done."
        assertEquals(listOf("E = mc^2"), latexOf(md))
    }

    @Test
    fun `ordinary multi-line display math still renders`() {
        val md = """
            ${'$'}${'$'}
            \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
            ${'$'}${'$'}
        """.trimIndent()
        assertEquals(1, latexOf(md).size)
        assertTrue(latexOf(md).first().contains("\\sum"))
    }

    @Test
    fun `glyph-free multi-line display math still renders`() {
        // Regression guard found during self-review: an "always require a LaTeX
        // glyph in a multi-line body" rule wrongly demoted perfectly valid
        // glyph-free math to plain text. The closer alone on its own line is
        // the conventional block shape and must be accepted on that basis.
        val md = """
            ${'$'}${'$'}
            1 + 2 = 3
            ${'$'}${'$'}
        """.trimIndent()
        // The extractor keeps the body's surrounding newlines verbatim (same as
        // the \sum case above); what matters is that ONE span was captured
        // rather than the block being demoted to plain text.
        val spans = latexOf(md)
        assertEquals(1, spans.size)
        assertEquals("1 + 2 = 3", spans.first().trim())
    }

    @Test
    fun `multi-line body containing a blank line is rejected as prose`() {
        // A genuinely unclosed `$$` whose "closer" is far away in prose:
        // the body spans a paragraph break, so it cannot be one formula.
        val md = """
            Opening ${'$'}${'$'} here

            some prose in between

            and a stray ${'$'}${'$'} much later
        """.trimIndent()
        assertEquals(emptyList<String>(), latexOf(md))
        assertTrue(renderedText(md).contains("some prose in between"))
    }

    @Test
    fun `inline math closer inside an inline code span is not used`() {
        // The `$` inside `code` must not close the inline formula.
        val md = "value ${'$'}x and then `a ${'$'} b` tail"
        // No span should be produced by pairing across the code span.
        assertEquals(emptyList<String>(), latexOf(md))
        assertTrue(renderedText(md).contains("tail"))
    }

    @Test
    fun `normal inline math is unaffected`() {
        assertEquals(listOf("x^2"), latexOf("The square ${'$'}x^2${'$'} is here."))
    }
}
