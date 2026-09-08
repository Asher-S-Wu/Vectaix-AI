package com.openminis.app.shared

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-text-segmenter] Pure-JVM unit tests for the language-routing
 * heuristic. `TextSegmenter.isMajorityChinese` is `internal`, so a same-module
 * test can call it without a device / Context.
 */
class TextSegmenterLanguageDetectionTest {

    private fun isChinese(text: String) = TextSegmenter.isMajorityChinese(text)

    @Test
    fun `pure Chinese is majority Chinese`() {
        assertTrue(isChinese("苹果手机很好用"))
        assertTrue(isChinese("马云在杭州创办了阿里巴巴集团"))
        assertTrue(isChinese("中国科学院计算技术研究所"))
    }

    @Test
    fun `Chinese with embedded latin still routes Chinese when Han dominates`() {
        // "苹果iPhone手机很好用": 8 Han of 14 non-space chars ≈ 57% ≥ 50%.
        assertTrue(isChinese("苹果iPhone手机很好用"))
        // "这个API接口返回JSON格式数据": Han dominates.
        assertTrue(isChinese("这个API接口返回JSON格式数据"))
    }

    @Test
    fun `pure english is not Chinese`() {
        assertFalse(isChinese("Hello world how are you"))
        assertFalse(isChinese("The quick brown fox jumps"))
    }

    @Test
    fun `kana presence routes kanji-heavy japanese away from Chinese`() {
        // Japanese kanji live in the SAME Unicode block as Chinese Han
        // (U+4E00–U+9FFF), so on the Han ratio alone this sentence is 6/10 = 60%
        // and would be handed to Jieba. The kana (は / の / です) are the reliable
        // "this is Japanese" signal and short-circuit the check to false.
        assertFalse(isChinese("東京は日本の首都です"))
    }

    @Test
    fun `kana-heavy japanese is not Chinese`() {
        assertFalse(isChinese("これはとてもおいしいラーメンでしたね"))
    }

    @Test
    fun `a single kana anywhere in the sample is enough`() {
        // Even one kana among otherwise all-Han text means Japanese, not Chinese.
        assertFalse(isChinese("東京都の人口"))
        // Katakana too (U+30A0–U+30FF), not just hiragana.
        assertFalse(isChinese("東京タワー"))
    }

    @Test
    fun `kana beyond the sample window does not affect routing`() {
        // The short-circuit only sees the first SAMPLE_WINDOW chars, so kana in a
        // long Chinese document's tail must not flip it away from Jieba.
        assertTrue(isChinese("中".repeat(200) + "これはひらがな"))
    }

    @Test
    fun `latin-heavy mixed text is not Chinese`() {
        // One Han char among many latin → below threshold.
        assertFalse(isChinese("Meeting at 3pm in 会议室 with the whole team today"))
    }

    @Test
    fun `blank and empty are not Chinese`() {
        assertFalse(isChinese(""))
        assertFalse(isChinese("   "))
        assertFalse(isChinese("\n\t  "))
    }

    @Test
    fun `single latin char is not Chinese`() {
        assertFalse(isChinese("A"))
    }

    @Test
    fun `single Han char is Chinese`() {
        assertTrue(isChinese("好"))
    }

    @Test
    fun `whitespace is excluded from the ratio denominator`() {
        // Lots of spaces around Chinese must not dilute the Han ratio.
        assertTrue(isChinese("   苹  果   手  机   "))
    }

    @Test
    fun `exactly half Han meets the threshold`() {
        // 2 Han + 2 latin = 50% → Chinese (>= threshold).
        assertTrue(isChinese("中文ab"))
    }

    @Test
    fun `only the first 200 chars are sampled`() {
        // 200 latin chars then a Han tail: the tail is past the window, so the
        // sample is all-latin → not Chinese.
        val text = "a".repeat(200) + "中文中文中文"
        assertFalse(isChinese(text))
        // Conversely, 200 Han then a latin tail stays Chinese.
        val text2 = "中".repeat(200) + "abcabc"
        assertTrue(isChinese(text2))
    }
}
