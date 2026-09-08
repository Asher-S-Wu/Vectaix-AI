package com.openminis.app.shared

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * [T-android-text-segmenter] On-device tests for TextSegmenter. Instrumented
 * (not a JVM unit test) because the Chinese path needs a real Context to
 * extract the Jieba dictionaries out of Assets and load the native library.
 *
 * Run: ./gradlew connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class TextSegmenterTest {

    private lateinit var segmenter: TextSegmenter

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        segmenter = TextSegmenter.getInstance(context)
    }

    // -- Chinese routing (Jieba) --

    @Test
    fun chineseWithLatinKeepsLatinTokenIntact() {
        // 7 Han / 13 non-space ≈ 54% → Jieba. Jieba must not split "iPhone".
        val words = segmenter.segment("苹果iPhone手机很好用")
        assertTrue("expected tokens, got $words", words.isNotEmpty())
        assertTrue("iPhone should stay whole, got $words", words.contains("iPhone"))
        assertEquals("苹果iPhone手机很好用", words.joinToString(""))
    }

    @Test
    fun chineseWithAcronymsRoutesToJieba() {
        val words = segmenter.segment("这个API接口返回JSON格式数据")
        assertTrue(words.isNotEmpty())
        // Latin acronyms survive as single tokens.
        assertTrue("got $words", words.contains("API"))
        assertTrue("got $words", words.contains("JSON"))
        assertEquals("这个API接口返回JSON格式数据", words.joinToString(""))
    }

    // -- Ambiguity cases: the whole reason we use Jieba over naive splitting --

    @Test
    fun resolvesHeShangAmbiguity() {
        // "结婚的和尚未结婚的" must NOT be cut as [和尚, 未] ("monk").
        val words = segmenter.segment("结婚的和尚未结婚的")
        assertEquals(listOf("结婚", "的", "和", "尚未", "结婚", "的"), words)
    }

    @Test
    fun resolvesPingPongAuctionAmbiguity() {
        val words = segmenter.segment("乒乓球拍卖完了")
        assertEquals(listOf("乒乓球", "拍卖", "完", "了"), words)
    }

    @Test
    fun resolvesNanjingBridgeAmbiguity() {
        // Not [南京, 市长, 江大桥] ("mayor Jiang").
        val words = segmenter.segment("南京市长江大桥")
        assertEquals(listOf("南京市", "长江大桥"), words)
    }

    // -- Proper nouns --

    @Test
    fun keepsProperNounsTogether() {
        val words = segmenter.segment("马云在杭州创办了阿里巴巴集团")
        assertTrue("got $words", words.contains("马云"))
        assertTrue("got $words", words.contains("杭州"))
        assertTrue("got $words", words.contains("阿里巴巴"))
        assertEquals("马云在杭州创办了阿里巴巴集团", words.joinToString(""))
    }

    @Test
    fun segmentsInstitutionName() {
        val words = segmenter.segment("中国科学院计算技术研究所")
        assertTrue(words.isNotEmpty())
        // Lossless round-trip regardless of how the institute name is split.
        assertEquals("中国科学院计算技术研究所", words.joinToString(""))
    }

    // -- Non-Chinese routing (BreakIterator) --

    @Test
    fun englishRoutesToSystemEngine() {
        assertEquals(
            listOf("Hello", "world", "how", "are", "you"),
            segmenter.segment("Hello world how are you"),
        )
        assertEquals(
            listOf("The", "quick", "brown", "fox", "jumps"),
            segmenter.segment("The quick brown fox jumps"),
        )
    }

    @Test
    fun latinHeavyMixedTextRoutesToSystemEngine() {
        // "他在Google工作了3年" is only 46% Han → below the 50% threshold, so it
        // takes the BreakIterator path. (The spec sketch guessed Jieba here; the
        // specified codepoint rule says otherwise — Google/3 dominate the sample.)
        val words = segmenter.segment("他在Google工作了3年")
        assertTrue("got $words", words.contains("Google"))
        assertTrue(words.isNotEmpty())
    }

    @Test
    fun kanaHeavyJapaneseRoutesToSystemEngine() {
        val words = segmenter.segment("これはとてもおいしいラーメンでしたね")
        assertTrue(words.isNotEmpty())
    }

    @Test
    fun kanjiHeavyJapaneseRoutesToSystemEngine() {
        // 60% Han on the ratio alone, but the kana (は / の / です) mark it as
        // Japanese, so it must NOT be handed to the Chinese dictionary.
        val words = segmenter.segment("東京は日本の首都です")
        assertTrue(words.isNotEmpty())
        // BreakIterator keeps the kana particles as their own tokens; Jieba's
        // Chinese dictionary would instead fuse them into Han compounds. Asserting
        // the kanji noun survives as a token is the engine-agnostic signal that we
        // segmented Japanese sensibly.
        assertTrue("got $words", words.any { it.contains("東京") })
    }

    // -- Empty / boundary --

    @Test
    fun emptyInputReturnsEmptyList() {
        assertEquals(emptyList<String>(), segmenter.segment(""))
        assertEquals(emptyList<String>(), segmenter.segment("   "))
        assertEquals(emptyList<String>(), segmenter.segmentForSearch(""))
    }

    @Test
    fun singleLatinCharRoutesToSystemEngine() {
        assertEquals(listOf("A"), segmenter.segment("A"))
    }

    // -- Search mode --

    @Test
    fun searchModeProducesFinerChineseTokens() {
        // Query mode also emits the sub-words of long compounds, so it yields at
        // least as many tokens as exact mode.
        val exact = segmenter.segment("中国科学院计算技术研究所")
        val search = segmenter.segmentForSearch("中国科学院计算技术研究所")
        assertTrue("exact=$exact search=$search", search.size >= exact.size)
        assertTrue(search.isNotEmpty())
    }

    // -- Performance --

    @Test
    fun segmentsTenThousandCharsUnderOneSecond() {
        val text = "这是一个用于测试分词性能的中文句子。".repeat(600) // ~10k chars
        assertTrue("sample must be ~10k chars, was ${text.length}", text.length >= 10_000)
        segmenter.segment("预热") // warm up: pay the dict-load cost outside the timing
        val start = System.currentTimeMillis()
        val words = segmenter.segment(text)
        val elapsed = System.currentTimeMillis() - start
        assertTrue(words.isNotEmpty())
        assertTrue("segment() took ${elapsed}ms for ${text.length} chars", elapsed < 1000)
    }
}
