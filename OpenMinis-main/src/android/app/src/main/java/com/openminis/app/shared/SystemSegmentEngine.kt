package com.openminis.app.shared

import android.icu.text.BreakIterator
import java.util.Locale

/**
 * [T-android-text-segmenter] Non-Chinese segmentation path for [TextSegmenter],
 * backed by the platform ICU word [BreakIterator] (API 24+; project minSdk is
 * 26). Handles English, Japanese, Korean, and every other locale ICU knows
 * about — its dictionary-based word iterator already word-splits CJK-adjacent
 * scripts like Japanese, so it's the right fallback whenever the input isn't
 * majority-Chinese enough to warrant Jieba.
 *
 * BreakIterator is NOT thread-safe (it carries mutable cursor state), so each
 * call gets its own instance rather than sharing one.
 */
internal object SystemSegmentEngine {

    /**
     * Split [text] into word tokens, dropping whitespace-only and empty spans.
     * Punctuation-only spans are dropped too so callers get real words, not
     * separators — matching the intent of Jieba's word output.
     */
    fun segment(text: String): List<String> {
        if (text.isBlank()) return emptyList()

        val iterator = BreakIterator.getWordInstance(Locale.getDefault())
        iterator.setText(text)

        val result = ArrayList<String>()
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            val token = text.substring(start, end)
            if (isMeaningfulToken(token)) {
                result.add(token)
            }
            start = end
            end = iterator.next()
        }
        return result
    }

    /**
     * BreakIterator has no separate "search" mode; the word iterator already
     * yields the finest reasonable tokens, so search reuses [segment].
     */
    fun segmentForSearch(text: String): List<String> = segment(text)

    /** Keep a span only if it contains at least one letter or digit — i.e.
     *  drop pure-whitespace and pure-punctuation separators. */
    private fun isMeaningfulToken(token: String): Boolean {
        if (token.isBlank()) return false
        return token.any { it.isLetterOrDigit() }
    }
}
