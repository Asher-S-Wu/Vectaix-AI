package com.openminis.app.speech.correction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-voice-correction] JVM-testable parts of the phonetic layer:
 * locale folding, Levenshtein and similarity. The pinyin transform itself needs
 * android.icu and is covered by the instrumented test.
 */
class PhoneticNormalizerTest {

    @Test
    fun `locale keys fold to the base language`() {
        assertEquals("zh", PhoneticNormalizerRegistry.normalizedLocaleKey("zh"))
        assertEquals("zh", PhoneticNormalizerRegistry.normalizedLocaleKey("zh-Hans"))
        assertEquals("zh", PhoneticNormalizerRegistry.normalizedLocaleKey("zh_CN"))
        // Traditional must fold to the SAME key so the dictionary isn't split.
        assertEquals("zh", PhoneticNormalizerRegistry.normalizedLocaleKey("zh-Hant"))
        assertEquals("en", PhoneticNormalizerRegistry.normalizedLocaleKey("en-US"))
    }

    @Test
    fun `only zh has a normalizer today`() {
        assertNotNull(PhoneticNormalizerRegistry.normalizer("zh-Hans"))
        // null means "cannot compare phonetically" — callers must degrade.
        assertNull(PhoneticNormalizerRegistry.normalizer("en-US"))
        assertNull(PhoneticNormalizerRegistry.normalizer("ja"))
    }

    @Test
    fun `levenshtein basics`() {
        assertEquals(0, PinyinNormalizer.levenshtein("abc", "abc"))
        assertEquals(3, PinyinNormalizer.levenshtein("", "abc"))
        assertEquals(3, PinyinNormalizer.levenshtein("abc", ""))
        assertEquals(1, PinyinNormalizer.levenshtein("zhangsan", "zhangshan"))
    }

    @Test
    fun `similarity is 1 for equal and 0 against empty`() {
        assertEquals(1.0, PinyinNormalizer.similarity("", ""), 0.0001)
        assertEquals(1.0, PinyinNormalizer.similarity("abc", "abc"), 0.0001)
        assertEquals(0.0, PinyinNormalizer.similarity("abc", ""), 0.0001)
    }

    @Test
    fun `near-homophone keys clear the correction threshold`() {
        // 张山 -> zhangshan vs 张三 -> zhangsan
        val s = PinyinNormalizer.similarity("zhangshan", "zhangsan")
        assertTrue(
            "similarity=$s should clear ${VoiceCorrectionConfig.PHONETIC_SIMILARITY_THRESHOLD}",
            s >= VoiceCorrectionConfig.PHONETIC_SIMILARITY_THRESHOLD,
        )
    }

    @Test
    fun `unrelated words fall below the correction threshold`() {
        // 吃饭 -> chifan vs 看电影 -> kandianying
        val s = PinyinNormalizer.similarity("chifan", "kandianying")
        assertTrue(
            "similarity=$s should fall below ${VoiceCorrectionConfig.PHONETIC_SIMILARITY_THRESHOLD}",
            s < VoiceCorrectionConfig.PHONETIC_SIMILARITY_THRESHOLD,
        )
    }

    @Test
    fun `confidence formula matches iOS`() {
        // f / (f + 2n): a rejection costs double a confirmation.
        assertEquals(1.0, VoiceCorrectionDb.confidence(3, 0), 0.0001)
        assertEquals(0.6, VoiceCorrectionDb.confidence(3, 1), 0.0001)
        assertEquals(0.5, VoiceCorrectionDb.confidence(0, 0), 0.0001)
        // Thrice-rejected drops below the 0.3 retrieval floor and stops being offered.
        assertTrue(VoiceCorrectionDb.confidence(1, 3) < VoiceCorrectionConfig.MIN_CONFUSION_CONFIDENCE)
    }

    @Test
    fun `variants json round-trips`() {
        val encoded = VoiceCorrectionDb.encodeVariants(listOf("张山", "章三"))
        assertEquals(listOf("张山", "章三"), VoiceCorrectionDb.decodeVariants(encoded))
        // Malformed JSON degrades to empty rather than throwing.
        assertEquals(emptyList<String>(), VoiceCorrectionDb.decodeVariants("not json"))
    }
}
