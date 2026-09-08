package com.openminis.app.speech.correction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-voice-correction] Mirrors iOS MinisTests/VoiceCorrectionTests
 * (L166-220). The rank provider is injected so no asset is needed.
 */
class VocabularyFilterTest {

    /** Only these count as "ordinary"; everything else is rare. */
    private val fakeRank: (String) -> Int? = { term ->
        if (term in setOf("今天", "可以", "我们", "hello")) 1 else null
    }

    private fun evaluate(term: String, posTag: String? = null) =
        VocabularyFilter.evaluate(term, posTag, fakeRank)

    private fun assertRejected(term: String, posTag: String? = null) {
        val d = evaluate(term, posTag)
        assertTrue("expected '$term' rejected, got $d", d is VocabularyFilter.Decision.Rejected)
    }

    private fun accepted(term: String, posTag: String? = null): VocabularyFilter.Decision.Accepted {
        val d = evaluate(term, posTag)
        assertTrue("expected '$term' accepted, got $d", d is VocabularyFilter.Decision.Accepted)
        return d as VocabularyFilter.Decision.Accepted
    }

    // -- absolute rejects --

    @Test
    fun `chinese stopwords are rejected`() {
        assertRejected("的")
        assertRejected("我们")
        assertRejected("可以")
    }

    @Test
    fun `english function words are rejected regardless of case`() {
        assertRejected("the")
        assertRejected("THE")
        assertRejected("The")
        assertRejected("and")
    }

    @Test
    fun `too short and too long are rejected`() {
        assertRejected("字")
        assertRejected("这是一个特别长的词语超过十二个字上限")
    }

    @Test
    fun `bare digits have no lexical content`() {
        assertRejected("12345")
    }

    // -- ⚠️ the CJK-numeral traps (real on-device bugs on iOS) --

    @Test
    fun `chinese term does not falsely score as containing latin`() {
        // Character.isLetter() is true for Han — without the ASCII guard every
        // Chinese term would collect the hasLatinOrDigit point.
        val a = accepted("张三", posTag = "nr")
        assertEquals(0, a.breakdown.hasLatinOrDigit)
    }

    @Test
    fun `cjk numerals are not treated as digits`() {
        // Character.isDigit() is true for 一二三 — unguarded, "三星" would be
        // rejected as no_lexical_content and 张三 would get a phantom point.
        val a = accepted("三星")
        assertEquals(0, a.breakdown.hasLatinOrDigit)
    }

    // -- positive scoring --

    @Test
    fun `proper noun tags earn the pos point`() {
        val a = accepted("杭州", posTag = "ns")
        assertEquals(2, a.breakdown.posTag)
    }

    @Test
    fun `non proper noun tags earn nothing`() {
        val a = accepted("创办", posTag = "v")
        assertEquals(0, a.breakdown.posTag)
    }

    @Test
    fun `latin jargon earns the ascii point`() {
        val a = accepted("CppJieba")
        assertEquals(1, a.breakdown.hasLatinOrDigit)
    }

    @Test
    fun `a term in the background list loses the rare bonus`() {
        // "今天" is ranked, and is also a stopword — use a ranked non-stopword.
        val ranked: (String) -> Int? = { if (it == "阿里巴巴") 1 else null }
        val d = VocabularyFilter.evaluate("阿里巴巴", null, ranked)
        // rank suppresses +2; length 4 gives +1 -> total 1 < 2 -> rejected.
        assertTrue("expected rejection, got $d", d is VocabularyFilter.Decision.Rejected)
    }

    @Test
    fun `an unranked term of good length is accepted`() {
        val a = accepted("闪退")
        assertEquals(2, a.breakdown.backgroundRank)
        assertEquals(1, a.breakdown.lengthOk)
        assertTrue(a.score >= VoiceCorrectionConfig.VOCAB_MIN_SCORE)
    }

    @Test
    fun `length bonus applies only within 2 to 6`() {
        assertEquals(1, accepted("闪退").breakdown.lengthOk)
        // 7 chars: rare +2 only, still accepted, but no length point.
        val long = accepted("超长词语测试用")
        assertEquals(0, long.breakdown.lengthOk)
    }

    // -- candidates() --

    @Test
    fun `candidates uses pos tags when available`() {
        val tagged = listOf("杭州" to "ns", "创办" to "v", "杭州" to "ns")
        val out = VocabularyFilter.candidates("x", { tagged }, { emptyList() })
        val hangzhou = out.first { it.first == "杭州" }
        assertEquals(2, hangzhou.second)      // counted twice
        assertEquals("ns", hangzhou.third)
    }

    @Test
    fun `candidates falls back to plain segmentation with null tags`() {
        val out = VocabularyFilter.candidates("x", { emptyList() }, { listOf("alpha", "beta", "alpha") })
        assertEquals(2, out.size)
        assertTrue(out.all { it.third == null })
        assertEquals(2, out.first { it.first == "alpha" }.second)
    }

    // -- background list parsing --

    @Test
    fun `word frequency parser skips comments and malformed lines`() {
        val parsed = BackgroundWordFrequency.parse(
            sequenceOf(
                "# a comment",
                "# version: 1",
                "",
                "今天 1",
                "可以 2",
                "malformed_no_rank",
                "bad rank_not_a_number",
                "  我们   3  ",
            ),
        )
        assertEquals(3, parsed.size)
        assertEquals(1, parsed["今天"])
        assertEquals(3, parsed["我们"])
        assertEquals(null, parsed["malformed_no_rank"])
    }
}
