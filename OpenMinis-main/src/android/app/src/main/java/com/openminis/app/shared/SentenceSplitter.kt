package com.openminis.app.shared

/**
 * [T-android-voice-correction] Lightweight punctuation-based sentence
 * splitting. Pure rules, no third-party dependency. Port of iOS
 * `Shared/SentenceSplitter.swift`.
 *
 * The terminator set is defined ONCE here and reused by everything that reasons
 * about sentence boundaries — the edit-diff pass that aligns a before/after
 * edit, and the correction context builder's excerpt selection. Keeping a
 * single definition is deliberate: a second, slightly different set elsewhere
 * would silently misalign sentences between the two.
 *
 * NOTE this is a different set from [com.openminis.app.speech.ReadAloudPlayer]'s
 * TTS chunking terminators, which deliberately includes `\n` (a line break is a
 * natural place to breathe) and excludes `；`/`…`. These two are not
 * interchangeable; do not merge them.
 */
object SentenceSplitter {

    /**
     * Sentence-terminating punctuation, CJK + ASCII. Semicolons count — a
     * semicolon-joined clause is independently correctable.
     */
    val TERMINATORS: Set<Char> = setOf(
        '。', '！', '？', '；', '…',
        '.', '!', '?', ';',
    )

    fun isTerminator(c: Char): Boolean = TERMINATORS.contains(c)

    /**
     * Split [text] into sentences, KEEPING each sentence's trailing
     * punctuation. Whitespace-only fragments are dropped.
     *
     * Text with no terminator at all comes back as a SINGLE sentence, never an
     * empty list — callers always need something to diff, and returning empty
     * here would silently drop a user's whole edit.
     */
    fun split(text: String): List<String> {
        val sentences = mutableListOf<String>()
        val current = StringBuilder()
        for (ch in text) {
            current.append(ch)
            if (isTerminator(ch)) {
                val trimmed = current.toString().trim()
                if (trimmed.isNotEmpty()) sentences.add(trimmed)
                current.setLength(0)
            }
        }
        val tail = current.toString().trim()
        if (tail.isNotEmpty()) sentences.add(tail)
        return sentences
    }
}
