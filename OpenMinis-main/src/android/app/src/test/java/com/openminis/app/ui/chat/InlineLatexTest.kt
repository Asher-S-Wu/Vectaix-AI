package com.openminis.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-latex-inline] Regression coverage for GH inline-LaTeX rendering: `$…$`
 * spans must be recognized as math (not leak as literal `$`), including bare
 * short variables (`$x$`), consecutive spans in one paragraph, and spans
 * inside bold / list / conclusion structures. `collectInlineMathLatex` is the
 * pre-scan that registers a KaTeX slot for every span that WILL render as
 * math, so it is the faithful proxy for "did this `$…$` get rendered".
 */
class InlineLatexTest {

    @Test
    fun `bare single-letter inline math is recognized`() {
        // Previously rejected by the strict looksLikeMath (no math glyph).
        assertEquals(listOf("x"), collectInlineMathLatex("The value \$x\$ is nice."))
        assertEquals(listOf("n"), collectInlineMathLatex("index \$n\$ here"))
    }

    @Test
    fun `bare multi-letter identifier inline math is recognized`() {
        assertEquals(listOf("pi"), collectInlineMathLatex("about \$pi\$ radians"))
        assertEquals(listOf("abc"), collectInlineMathLatex("var \$abc\$ end"))
    }

    @Test
    fun `backslash commands are recognized`() {
        assertEquals(
            listOf("\\approx", "\\rightarrow"),
            collectInlineMathLatex("symbols \$\\approx\$ and \$\\rightarrow\$ here"),
        )
        assertEquals(listOf("\\frac{a}{b}"), collectInlineMathLatex("frac \$\\frac{a}{b}\$ done"))
    }

    @Test
    fun `consecutive inline math spans in one paragraph all recognized`() {
        assertEquals(
            listOf("a", "b", "c"),
            collectInlineMathLatex("We have \$a\$ and \$b\$ and \$c\$ here."),
        )
    }

    @Test
    fun `inline math inside bold and list conclusion is recognized`() {
        val sample = "**Key:** \$\\approx\$ and \$\\rightarrow\$ symbols\n" +
            "- item with \$x^2\$ value\n" +
            "**结论**: 因为 \$\\Delta > 0\$ 所以 \$x = 1\$ 且 \$y \\approx 2\$。"
        val found = collectInlineMathLatex(sample)
        // Every `$…$` in the sample must be collected as a math span.
        assertTrue("approx", found.contains("\\approx"))
        assertTrue("rightarrow", found.contains("\\rightarrow"))
        assertTrue("x^2", found.contains("x^2"))
        assertTrue("Delta>0", found.contains("\\Delta > 0"))
        assertTrue("x=1", found.contains("x = 1"))
        assertTrue("y approx 2", found.contains("y \\approx 2"))
    }

    @Test
    fun `currency is not treated as math`() {
        // `$5`, `$10.99` must NOT pair into a math span.
        assertEquals(emptyList<String>(), collectInlineMathLatex("Price is \$5 for one."))
        assertEquals(
            listOf("x+y"),
            collectInlineMathLatex("cost \$5, and \$x+y\$ formula"),
        )
    }

    @Test
    fun `escaped dollar and dollar block are not inline math`() {
        assertEquals(emptyList<String>(), collectInlineMathLatex("literal \\\$5 and \\\$9"))
        // `$$ … $$` is display math handled at block level, not inline.
        assertEquals(emptyList<String>(), collectInlineMathLatex("\$\$x+y\$\$"))
    }

    @Test
    fun `table pipe artifact is not treated as math`() {
        // `| 月付 | $20|$ **3** |` — the `$20|` must not pair into fake math.
        val found = collectInlineMathLatex("| 月付 | \$20|\$ **3** | ")
        assertTrue("no pipe-artifact span: $found", found.none { it.contains("20|") })
    }
}
