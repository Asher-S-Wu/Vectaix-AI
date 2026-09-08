package com.openminis.app.shared

import android.content.Context

/**
 * [T-android-text-segmenter] Global unified word-segmentation facade.
 *
 * Routing: sample the first [SAMPLE_WINDOW] characters. Any Hiragana/Katakana in
 * the sample marks the text as Japanese and routes it away from Chinese
 * immediately; otherwise we measure the share of CJK Han ideographs
 * (U+4E00–U+9FFF) among non-whitespace characters, and at [CHINESE_THRESHOLD]
 * (50%) or above the text is treated as Chinese and routed to [JiebaEngine].
 * Everything else goes to the platform ICU [SystemSegmentEngine]
 * (BreakIterator), which handles English, Japanese, Korean, and the rest.
 *
 * If Jieba can't initialize (e.g. asset extraction fails on a broken install),
 * the Chinese path degrades gracefully to the system engine rather than
 * returning nothing.
 *
 * Usage:
 * ```
 * val tokens = TextSegmenter.getInstance(context).segment(text)
 * ```
 */
class TextSegmenter private constructor(context: Context) {

    private val jieba = JiebaEngine(context)

    /** Split [text] into word tokens using the best engine for its language. */
    fun segment(text: String): List<String> {
        if (text.isBlank()) return emptyList()
        return if (isMajorityChinese(text)) {
            val words = jieba.segment(text)
            // Fall back to the system engine if Jieba was unavailable.
            words.ifEmpty { SystemSegmentEngine.segment(text) }
        } else {
            SystemSegmentEngine.segment(text)
        }
    }

    /** Search-oriented segmentation (finer Chinese splits via Jieba's query
     *  mode). Non-Chinese text uses the same tokens as [segment]. */
    fun segmentForSearch(text: String): List<String> {
        if (text.isBlank()) return emptyList()
        return if (isMajorityChinese(text)) {
            val words = jieba.segmentForSearch(text)
            words.ifEmpty { SystemSegmentEngine.segmentForSearch(text) }
        } else {
            SystemSegmentEngine.segmentForSearch(text)
        }
    }

    /**
     * [T-android-voice-correction] Part-of-speech tagging, `(token, tag)` in
     * jieba's tag set (nr person, ns place, nz other proper noun, nt org, …).
     *
     * Chinese-only by nature — the tags come from the Chinese dictionary. For
     * non-Chinese text (or when Jieba is unavailable) this returns an EMPTY
     * list rather than falling back to the system segmenter with null tags:
     * callers ([com.openminis.app.speech.VocabularyFilter]) treat empty as
     * "no POS signal" and fall back to plain [segment] themselves, which keeps
     * the "did we get real tags?" question answerable.
     */
    fun posTag(text: String): List<Pair<String, String>> {
        if (text.isBlank() || !isMajorityChinese(text)) return emptyList()
        return jieba.posTag(text)
    }

    companion object {
        /** Sampling window: enough to classify language cheaply on long text. */
        internal const val SAMPLE_WINDOW = 200

        /** Han share (of non-whitespace chars) at/above which we pick Jieba. */
        internal const val CHINESE_THRESHOLD = 0.5

        /** Hiragana block start (U+3040) — kana means Japanese, never Chinese. */
        internal const val KANA_RANGE_START = 0x3040

        /** Katakana block end (U+30FF). */
        internal const val KANA_RANGE_END = 0x30FF

        @Volatile
        private var instance: TextSegmenter? = null

        fun getInstance(context: Context): TextSegmenter =
            instance ?: synchronized(this) {
                instance ?: TextSegmenter(context.applicationContext).also { instance = it }
            }

        /**
         * True when CJK Han ideographs make up at least [CHINESE_THRESHOLD] of
         * the non-whitespace characters in the first [SAMPLE_WINDOW] chars.
         *
         * Pure Unicode codepoint check (U+4E00–U+9FFF, CJK Unified Ideographs) —
         * no locale or dictionary lookups. Whitespace is excluded from the
         * denominator so leading indentation / spacing doesn't dilute the ratio.
         * A sample with no non-whitespace characters is not Chinese.
         *
         * Japanese exception: kanji live in the SAME Unicode block as Chinese
         * hanzi, so a pure Han-ratio test cannot tell the two apart —
         * "東京は日本の首都です" is 60% Han and would otherwise be handed to a
         * Chinese dictionary. Any Hiragana/Katakana ([KANA_RANGE_START]–
         * [KANA_RANGE_END]) is a reliable "this is Japanese, not Chinese" signal,
         * so the first kana in the sample short-circuits to false and the text
         * routes to the system engine. Kept symmetric with iOS
         * TextSegmenter.isMajorityChinese.
         *
         * `internal` so the module's unit tests can exercise it directly.
         */
        internal fun isMajorityChinese(text: String): Boolean {
            var hanCount = 0
            var nonSpaceCount = 0
            var seen = 0
            for (ch in text) {
                if (seen >= SAMPLE_WINDOW) break
                seen++
                // Hiragana (U+3040–U+309F) or Katakana (U+30A0–U+30FF) ⇒ Japanese.
                if (ch.code in KANA_RANGE_START..KANA_RANGE_END) return false
                if (ch.isWhitespace()) continue
                nonSpaceCount++
                if (ch.code in 0x4E00..0x9FFF) hanCount++
            }
            if (nonSpaceCount == 0) return false
            return hanCount.toDouble() / nonSpaceCount >= CHINESE_THRESHOLD
        }
    }
}
