package com.openminis.app.speech.correction

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-voice-correction] Phase 2 engine + strategy tests. The strategy and
 * signal sources are faked, so these run on the JVM with no model, DB or device.
 */
class CorrectionEngineTest {

    /** Character-level tokenizer, enough to exercise key extraction. */
    private val charTokens: (String) -> List<String> = { text ->
        // Crude bigram split so tokens clear the length >= 2 filter.
        text.chunked(2)
    }

    private class FakeStrategy(
        private val reply: (String) -> String,
        var calls: Int = 0,
    ) : CorrectionStrategy {
        override val strategyIdentifier = "fake"
        override suspend fun correct(
            transcript: String,
            candidates: List<CorrectionCandidate>,
            context: ConversationContext,
            locale: String,
        ): CorrectionOutcome {
            calls++
            return CorrectionOutcome(reply(transcript), "sub", 1)
        }
    }

    private class ThrowingStrategy : CorrectionStrategy {
        override val strategyIdentifier = "throwing"
        override suspend fun correct(
            transcript: String,
            candidates: List<CorrectionCandidate>,
            context: ConversationContext,
            locale: String,
        ): CorrectionOutcome = throw IllegalStateException("boom")
    }

    private class FakeSource(
        override val sourceIdentifier: String,
        override val defaultWeight: Double,
        private val byKey: Map<String, List<CorrectionCandidate>> = emptyMap(),
        var lookups: Int = 0,
    ) : CorrectionSignalSource {
        override fun lookupCandidates(
            phoneticKeys: List<String>,
            locale: String,
            limit: Int,
        ): List<CorrectionCandidate> {
            lookups++
            return phoneticKeys.flatMap { byKey[it].orEmpty() }
        }
    }

    private fun engine(
        strategy: CorrectionStrategy,
        sources: List<CorrectionSignalSource> = emptyList(),
        consent: () -> Boolean = { false },
    ) = VoiceCorrectionEngine(sources, strategy, null, charTokens, consent)

    // -- bail-outs --

    @Test
    fun `empty input is rejected without calling the model`() = runBlocking {
        val strategy = FakeStrategy({ "unused" })
        val s = engine(strategy).correct("   ")
        assertEquals("empty_input", s.rejectedReason)
        assertFalse(s.hasChange)
        assertEquals(0, strategy.calls)
    }

    @Test
    fun `unchanged output is not a failure`() = runBlocking {
        val s = engine(FakeStrategy({ it })).correct("今天天气不错")
        assertFalse(s.hasChange)
        // Explicitly NOT a rejection — the model looked and found nothing.
        assertNull(s.rejectedReason)
        assertEquals("sub", s.modelGroupUsed)
    }

    @Test
    fun `a wholesale rewrite is rejected as diff_too_large`() = runBlocking {
        val s = engine(FakeStrategy({ "完全不同的另外一段话内容在这里" })).correct("张山说今天有空")
        assertEquals("diff_too_large", s.rejectedReason)
        assertFalse(s.hasChange)
        // The user's original text must be preserved.
        assertEquals("张山说今天有空", s.corrected)
    }

    @Test
    fun `a strategy exception preserves the original text`() = runBlocking {
        val s = engine(ThrowingStrategy()).correct("张山说今天有空")
        assertTrue("got ${s.rejectedReason}", s.rejectedReason!!.startsWith("llm_error:"))
        assertEquals("张山说今天有空", s.corrected)
        assertFalse(s.hasChange)
    }

    @Test
    fun `a targeted fix is accepted and summarised`() = runBlocking {
        val s = engine(FakeStrategy({ it.replace("张山", "张三") })).correct("张山说今天有空")
        assertTrue(s.hasChange)
        assertNull(s.rejectedReason)
        assertEquals("张三说今天有空", s.corrected)
        assertTrue("summary was '${s.diffSummary}'", s.diffSummary.contains("→"))
    }

    // -- retrieval / fusion --

    @Test
    fun `unsupported locale yields no candidates`() = runBlocking {
        val src = FakeSource("confusion_dictionary", 1.0)
        val e = engine(FakeStrategy({ it }), listOf(src))
        assertEquals(emptyList<CorrectionCandidate>(), e.retrieveCandidates("hello there", "en"))
        assertEquals("source must not be queried for an unsupported locale", 0, src.lookups)
    }

    // NOTE: retrieveCandidates() cannot be exercised end-to-end on the JVM —
    // it normalizes through android.icu, which is not available here. Fusion is
    // therefore tested directly via the exposed helper, and the full retrieval
    // path is covered by the instrumented tests.

    @Test
    fun `fusion prefers the higher weighted source for the same term`() {
        // confusion: 1.0 x 0.9 = 0.90   vocabulary: 0.6 x 1.0 = 0.60
        val confusion = CorrectionCandidate("k", "食堂", 0.9, "confusion_dictionary", "e1")
        val vocab = CorrectionCandidate("k", "食堂", 1.0, "typed_vocabulary", "e2")
        val sources = listOf(
            FakeSource("confusion_dictionary", 1.0),
            FakeSource("typed_vocabulary", 0.6),
        )
        val e = VoiceCorrectionEngine(sources, FakeStrategy({ it }), null, charTokens) { false }
        val out = e.fuseForTest(listOf(vocab, confusion))
        // Deduped to ONE entry for the same phoneticKey|term…
        assertEquals(1, out.count { it.term == "食堂" })
        // …and the winner is the higher-scoring confusion row.
        assertEquals("confusion_dictionary", out.first { it.term == "食堂" }.sourceIdentifier)
    }

    @Test
    fun `fusion caps the candidate list`() {
        val sources = listOf(FakeSource("confusion_dictionary", 1.0))
        val e = VoiceCorrectionEngine(sources, FakeStrategy({ it }), null, charTokens) { false }
        val many = (1..100).map {
            CorrectionCandidate("k$it", "term$it", 0.9, "confusion_dictionary", "e")
        }
        assertEquals(VoiceCorrectionConfig.MAX_CANDIDATES, e.fuseForTest(many).size)
    }

    @Test
    fun `a failing source degrades to no candidates instead of failing the pass`() = runBlocking {
        val bad = object : CorrectionSignalSource {
            override val sourceIdentifier = "confusion_dictionary"
            override val defaultWeight = 1.0
            override fun lookupCandidates(
                phoneticKeys: List<String>,
                locale: String,
                limit: Int,
            ): List<CorrectionCandidate> = throw IllegalStateException("db down")
        }
        val e = VoiceCorrectionEngine(listOf(bad), FakeStrategy({ it }), null, charTokens) { false }
        // Must not throw.
        assertEquals(emptyList<CorrectionCandidate>(), e.retrieveCandidates("食堂在哪", "zh"))
    }
}

/** Prompt assembly and response cleaning — pure functions, no model. */
class CorrectionStrategyTest {

    private fun candidate(source: String, term: String, evidence: String) =
        CorrectionCandidate("k", term, 1.0, source, evidence)

    @Test
    fun `max tokens floors high enough for reasoning models and respects the cap`() {
        val floor = LlmCorrectionStrategy.MIN_OUTPUT_TOKENS
        assertEquals(floor, LlmCorrectionStrategy.correctionMaxTokens(10, null))
        // Long transcripts scale past the floor.
        assertEquals(12000, LlmCorrectionStrategy.correctionMaxTokens(10000, null))
        // The model's own cap always wins.
        assertEquals(800, LlmCorrectionStrategy.correctionMaxTokens(10000, 800))
        // A zero/absent cap must not clamp to zero.
        assertEquals(floor, LlmCorrectionStrategy.correctionMaxTokens(10, 0))
    }

    @Test
    fun `the floor leaves room for a reasoning model's hidden tokens`() {
        // Regression guard: at 512 a MiMo correction spent every output token
        // on reasoning and returned empty content. Do not lower this.
        assertTrue(
            "floor is ${LlmCorrectionStrategy.MIN_OUTPUT_TOKENS}",
            LlmCorrectionStrategy.MIN_OUTPUT_TOKENS >= 2048,
        )
    }

    @Test
    fun `prompt contains only the blocks that have content`() {
        val p = LlmCorrectionStrategy.buildPrompt("张山说今天有空", emptyList(), ConversationContext.EMPTY)
        assertFalse(p.contains("常用词汇"))
        assertFalse(p.contains("纠错记录"))
        assertFalse(p.contains("最近上下文"))
        assertTrue(p.contains("原文：张山说今天有空"))
    }

    @Test
    fun `prompt renders every evidence block when present`() {
        val p = LlmCorrectionStrategy.buildPrompt(
            "张山说今天有空",
            listOf(
                candidate("typed_vocabulary", "闪退", "闪退（常用词，出现5次）"),
                candidate("confusion_dictionary", "张三", "张山→张三（出现3次）"),
            ),
            ConversationContext(rareTermsDigest = "挂载、鉴权", recentExcerpts = listOf("【用户·最新】你好。")),
        )
        assertTrue(p.contains("以下是该用户的常用词汇"))
        assertTrue(p.contains("闪退"))
        assertTrue(p.contains("以下是该用户过去的语音识别纠错记录"))
        assertTrue(p.contains("张山→张三"))
        assertTrue(p.contains("以下是近期对话中出现的少见词"))
        assertTrue(p.contains("挂载、鉴权"))
        assertTrue(p.contains("不是需要处理的内容"))
        assertTrue(p.contains("【用户·最新】你好。"))
    }

    @Test
    fun `vocabulary block respects its character budget`() {
        val many = (1..500).map { candidate("typed_vocabulary", "词汇$it", "e") }
        val p = LlmCorrectionStrategy.buildPrompt("测试", many, ConversationContext.EMPTY)
        val block = p.substringAfter("仅供参考）：\n").substringBefore("\n\n")
        assertTrue(
            "vocab block was ${block.length} chars, budget is ${CorrectionContextBudget.VOCAB_BLOCK}",
            block.length <= CorrectionContextBudget.VOCAB_BLOCK,
        )
    }

    // -- response cleaning --

    @Test
    fun `clean strips code fences`() {
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("```\n食堂在哪\n```"))
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("```text\n食堂在哪\n```"))
    }

    @Test
    fun `clean strips known prefixes`() {
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("修正后的文本：食堂在哪"))
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("Corrected: 食堂在哪"))
    }

    @Test
    fun `clean unwraps symmetric quotes`() {
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("\"食堂在哪\""))
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("“食堂在哪”"))
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("「食堂在哪」"))
    }

    @Test
    fun `clean leaves a plain answer untouched`() {
        assertEquals("食堂在哪", LlmCorrectionStrategy.cleanResponse("  食堂在哪  "))
    }

    @Test
    fun `clean does not strip an asymmetric quote`() {
        // Only symmetric pairs unwrap, so a legitimate leading quote survives.
        assertEquals("\"食堂在哪", LlmCorrectionStrategy.cleanResponse("\"食堂在哪"))
    }
}

/** Rare-content scoring and the budgeted context builder. */
class CorrectionContextBuilderTest {

    private val fakeRank: (String) -> Int? = { term ->
        if (term in setOf("今天", "可以", "我们", "hello")) 1 else null
    }
    private val charTokens: (String) -> List<String> = { it.chunked(2) }

    @Test
    fun `known common words score zero`() {
        assertEquals(0, RareContentScorer.score("今天", fakeRank))
        assertEquals(0, RareContentScorer.score("hello", fakeRank))
    }

    @Test
    fun `technical shapes score 90`() {
        assertEquals(90, RareContentScorer.score("CppJieba", fakeRank))   // interior caps
        assertEquals(90, RareContentScorer.score("HTTP", fakeRank))       // all caps
        assertEquals(90, RareContentScorer.score("read_image", fakeRank)) // joiner
        assertEquals(90, RareContentScorer.score("gpt5", fakeRank))       // latin+digit
        assertEquals(90, RareContentScorer.score("用iPhone", fakeRank))   // cjk+latin
    }

    @Test
    fun `a plain lowercase latin word stays below the digest threshold`() {
        val s = RareContentScorer.score("something", fakeRank)
        assertEquals(20, s)
        assertTrue(s < RareContentScorer.DIGEST_THRESHOLD)
    }

    @Test
    fun `multi-char cjk scores by rare ratio`() {
        // All-common hanzi -> the 40 floor.
        assertEquals(40, RareContentScorer.score("电话", fakeRank))
        // Contains rare chars -> above the floor.
        assertTrue(RareContentScorer.score("鉴权", fakeRank) > 40)
    }

    @Test
    fun `over-long terms and non-lexical input score zero`() {
        assertEquals(0, RareContentScorer.score("字".repeat(25), fakeRank))
        assertEquals(0, RareContentScorer.score("12345", fakeRank))
        assertEquals(0, RareContentScorer.score("", fakeRank))
    }

    @Test
    fun `empty message list yields empty context`() {
        val ctx = CorrectionContextBuilder.build(emptyList(), charTokens, fakeRank)
        assertTrue(ctx.isEmpty)
    }

    @Test
    fun `the two newest turns always contribute grounding excerpts`() {
        val msgs = listOf(
            CorrectionSourceMessage(CorrectionSourceMessage.Role.USER, "很普通的一句话。"),
            CorrectionSourceMessage(CorrectionSourceMessage.Role.ASSISTANT, "也很普通的回复。"),
        )
        val ctx = CorrectionContextBuilder.build(msgs, charTokens, fakeRank)
        assertEquals(2, ctx.recentExcerpts.size)
        // Re-sorted oldest -> newest so the model reads chronologically.
        assertTrue(ctx.recentExcerpts[0].contains("用户"))
        assertTrue(ctx.recentExcerpts[1].contains("最新"))
    }

    @Test
    fun `excerpts stay within the total budget`() {
        val long = "这是一段很长的内容。".repeat(200)
        val msgs = (1..12).map {
            CorrectionSourceMessage(CorrectionSourceMessage.Role.USER, long)
        }
        val ctx = CorrectionContextBuilder.build(msgs, charTokens, fakeRank)
        val total = ctx.recentExcerpts.sumOf { it.length }
        assertTrue(
            "excerpts were $total chars, budget ${CorrectionContextBudget.MESSAGE_EXCERPTS}",
            total <= CorrectionContextBudget.MESSAGE_EXCERPTS,
        )
    }

    @Test
    fun `digest stays within its budget`() {
        val msgs = listOf(
            CorrectionSourceMessage(
                CorrectionSourceMessage.Role.USER,
                (1..300).joinToString("。") { "鉴权挂载$it" },
            ),
        )
        val ctx = CorrectionContextBuilder.build(msgs, charTokens, fakeRank)
        val digest = ctx.rareTermsDigest ?: ""
        assertTrue(
            "digest was ${digest.length} chars, budget ${CorrectionContextBudget.RARE_DIGEST}",
            digest.length <= CorrectionContextBudget.RARE_DIGEST,
        )
    }
}
