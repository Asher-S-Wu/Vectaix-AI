package com.openminis.app.speech.correction

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-correction-admission-multisignal] The admission rule that
 * separates a CORRECTION from a REWRITE, shared by the transcript and
 * text-input capture paths.
 *
 * Previously these assertions re-implemented the old single-axis rule
 * (`phoneticSim >= 0.6 AND lengthRatio <= 2`) inline, which meant they kept
 * passing while testing logic that no longer shipped. They now drive the real
 * [CorrectionAdmission.judge]. The normalizer is injected because the
 * production PinyinNormalizer needs `android.icu`, unavailable on the JVM —
 * the wired-up path is covered by the instrumented suite.
 */
class RecorderAdmissionTest {

    /** Maps the exact texts these tests use to their pinyin keys. */
    private val fakeNormalizer = object : PhoneticNormalizer {
        private val table = mapOf(
            "张山" to "zhangshan", "张三" to "zhangsan",
            "石塘" to "shitang", "食堂" to "shitang",
            "吃饭" to "chifan", "看电影" to "kandianying",
            "张" to "zhang", "张张张张张" to "zhangzhangzhangzhangzhang",
        )
        override val locale: String = "zh"
        override fun normalize(text: String): String = table[text] ?: text.lowercase()
    }

    /** Generous sentence length so a bare span isn't rejected as "too global" —
     *  in production a span is one word inside a full transcript. */
    private fun admits(fromText: String, toText: String, sentence: Int = 40): Boolean =
        CorrectionAdmission.judge(fromText, toText, fakeNormalizer, sentence).isAdmitted

    @Test
    fun `a homophone fix is admitted`() {
        // 张山 -> 张三
        assertTrue(admits("张山", "张三"))
    }

    @Test
    fun `a near-homophone fix is admitted`() {
        // 石塘 -> 食堂 (identical keys)
        assertTrue(admits("石塘", "食堂"))
    }

    @Test
    fun `an unrelated rewrite is rejected`() {
        // 吃饭 -> 看电影: the user changed their mind, not a mishearing.
        assertFalse(admits("吃饭", "看电影"))
    }

    @Test
    fun `a much longer replacement is rejected`() {
        // 张 -> 张张张张张. The OLD rule rejected this on lengthRatio 5.0 > 2.0.
        // The new rule rejects it too, but via a different (and more honest)
        // route: it is not a reorder, the keys are far apart phonetically, has
        // no digits, and although "zhang" IS an ordered subsequence of the
        // repeated key, 5/25 = 0.2 clears the length-fraction bar — so it lands
        // on the acronym signal. Guard against that by giving it a realistic
        // sentence: a 5-char span in a 6-char sentence is 0.83 locality, well
        // over the 0.6 rewrite guard.
        assertFalse(admits("张", "张张张张张", sentence = 6))
    }

    @Test
    fun `the same rule governs both capture sources`() {
        // Capability #3 reuses this untouched — a select-and-replace that swaps
        // in something unrelated must be discarded exactly as in the voice path.
        assertTrue(admits("石塘", "食堂"))
        assertFalse(admits("吃饭", "看电影"))
    }
}

/**
 * Attachment-markup stripping and text extraction for vocabulary mining.
 */
class TypedVocabularyBuilderTest {

    @Test
    fun `attachment markup is removed`() {
        val text = "看看这个<user-attached-files>photo.png</user-attached-files>怎么样"
        assertTrue(
            TypedVocabularyBuilder.stripAttachmentMarkup(text) == "看看这个怎么样",
        )
    }

    @Test
    fun `text without markup is returned trimmed`() {
        assertTrue(TypedVocabularyBuilder.stripAttachmentMarkup("  普通消息  ") == "普通消息")
    }

    @Test
    fun `an unterminated markup opener is left alone`() {
        // Better to keep the text than to truncate it on a malformed envelope.
        val text = "开头<user-attached-files>没有结束"
        assertTrue(TypedVocabularyBuilder.stripAttachmentMarkup(text) == text)
    }
}
