package com.openminis.app.speech

/**
 * [T-android-tts-intranumber-guard] Streaming sentence extraction for the TTS
 * paths. Shared by [ReadAloudPlayer] and [TextToSpeechManager] so the two can
 * never drift — they previously carried byte-identical copies of this loop and
 * a fix to one would have silently missed the other.
 *
 * Port of the guards in iOS `AIChatViewModel+SSEStream.extractSentencesStatic`
 * (T-tts-decimal-split).
 */
object SpeechSentenceSplitter {

    /** Terminator set — the exact one iOS uses in `extractNewSentences`. */
    val SENTENCE_ENDERS: Set<Char> =
        charArrayOf('。', '！', '？', '.', '!', '?', '\n').toSet()

    /**
     * [T-android-tts-scope-align] Clause-pause marks — iOS `speechPauses`.
     * Not terminators on their own; they only become cut points when a run
     * exceeds [SOFT_LIMIT] without a real ender, so an ender-less clause
     * stream (long Chinese enumerations, comma-chained English) still speaks
     * in bounded units instead of accumulating into one giant utterance.
     */
    private val SPEECH_PAUSES: Set<Char> =
        charArrayOf('，', ',', '、', '：', ':').toSet()

    /** Force-cut threshold for pause-mark fallback — iOS `speechSoftLimit`. */
    private const val SOFT_LIMIT = 60

    /**
     * A `.` or `,` flanked by digits on BOTH sides is an intra-number separator
     * (decimal point "3.14" / "$1.5", European decimal comma "€28,98", or
     * thousands grouping "1,000,000"), NOT a sentence boundary. Splitting there
     * mangles the number into "3." + "14" and the TTS reads it wrong.
     *
     * BOTH neighbours must be digits, so a real sentence end after a number
     * ("He scored 5. Then…") still cuts. Uses [Char.isDigit] so ASCII and
     * full-width digits both count.
     */
    fun isIntraNumberSeparator(text: CharSequence, idx: Int): Boolean {
        val ch = text[idx]
        if (ch != '.' && ch != ',') return false
        if (idx <= 0 || idx + 1 >= text.length) return false
        return text[idx - 1].isDigit() && text[idx + 1].isDigit()
    }

    /**
     * Scan [buffer] for sentence terminators, returning each trimmed sentence
     * and removing the consumed prefix.
     *
     * Two number-aware guards, both from iOS:
     *  1. [isIntraNumberSeparator] positions are skipped outright.
     *  2. Streaming look-ahead — a `.`/`,` that trails a digit at the CURRENT
     *     END of the buffer might be a decimal point whose fractional part
     *     hasn't streamed yet ("price 28." with "98" still in flight).
     *     Committing it now would speak "28." early and split the number, so we
     *     stop scanning WITHOUT consuming it; the next delta reveals whether a
     *     digit (→ intra-number, skip) or a non-digit (→ real boundary) follows.
     *     Only applies at the very last char, so fully-arrived text is never
     *     delayed. Set [streaming] = false to disable this (e.g. a final flush,
     *     where no more text is coming and "28." IS the end).
     */
    private fun isFence(buffer: CharSequence, idx: Int): Boolean =
        idx + 2 < buffer.length && buffer[idx] == '`' &&
            buffer[idx + 1] == '`' && buffer[idx + 2] == '`'

    fun extractCompleteSentences(
        buffer: StringBuilder,
        streaming: Boolean = true,
    ): List<String> {
        val sentences = mutableListOf<String>()
        var lastBoundary = 0
        var lastPause = -1
        var i = 0
        while (i < buffer.length) {
            // [T-android-tts-scope-align] Fenced code blocks are EXCLUDED at
            // the splitter, matching iOS extractSentencesStatic. Previously
            // fences reached the per-sentence sanitizer already CHOPPED at the
            // '\n' / '.' enders inside the code, so its ```…``` regex never
            // saw a complete pair and code fragments were read aloud — iOS
            // has never spoken fenced code. A complete block is skipped in one
            // go (text before it flushes as a unit); an UNCLOSED fence stops
            // the scan without consuming it, waiting for a later delta — same
            // contract as the streaming decimal-point look-ahead below.
            if (isFence(buffer, i)) {
                var j = i + 3
                var foundClose = false
                while (j < buffer.length) {
                    if (isFence(buffer, j)) { foundClose = true; break }
                    j++
                }
                if (!foundClose) {
                    if (!streaming) {
                        // Terminal flush: nothing more is coming; drop the
                        // malformed open fence and everything after it.
                        val s = buffer.substring(lastBoundary, i).trim()
                        if (s.isNotEmpty()) sentences.add(s)
                        lastBoundary = buffer.length
                    }
                    break
                }
                val s = buffer.substring(lastBoundary, i).trim()
                if (s.isNotEmpty()) sentences.add(s)
                i = j + 3
                lastBoundary = i
                lastPause = -1
                continue
            }
            val ch = buffer[i]
            if (isIntraNumberSeparator(buffer, i)) {
                i++
                continue
            }
            if (streaming &&
                i == buffer.length - 1 &&
                (ch == '.' || ch == ',') &&
                i > 0 && buffer[i - 1].isDigit()
            ) {
                // Might be a decimal point mid-stream — wait for the next delta.
                break
            }
            if (ch in SPEECH_PAUSES) lastPause = i
            val runLen = i - lastBoundary + 1
            if (ch in SENTENCE_ENDERS) {
                val s = buffer.substring(lastBoundary, i + 1).trim()
                if (s.isNotEmpty()) sentences.add(s)
                lastBoundary = i + 1
                lastPause = -1
            } else if (runLen >= SOFT_LIMIT && lastPause >= lastBoundary) {
                // [T-android-tts-scope-align] Pause-mark force-cut (iOS
                // softLimit tier): an ender-less run past the limit cuts at
                // the last clause pause so it speaks as a bounded unit.
                val s = buffer.substring(lastBoundary, lastPause + 1).trim()
                if (s.isNotEmpty()) sentences.add(s)
                lastBoundary = lastPause + 1
                lastPause = -1
            }
            i++
        }
        if (lastBoundary > 0) buffer.delete(0, lastBoundary)
        return sentences
    }
}
