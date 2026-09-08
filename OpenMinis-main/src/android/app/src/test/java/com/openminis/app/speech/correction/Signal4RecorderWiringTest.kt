package com.openminis.app.speech.correction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-correction-latin-phonetic] Integration-level guard: proves Signal 4
 * is reachable through the SAME judge() entry point VoiceCorrectionRecorder
 * calls (recorder line ~94), with the recorder's real argument shape — the
 * production PhoneticNormalizer passes Latin through lowercased, and
 * sentenceLength is the context sentence's length.
 *
 * The recorder itself needs a Context + SQLite, so it can't run on the JVM;
 * this pins the contract at the boundary it actually uses.
 */
class Signal4RecorderWiringTest {

    /** Latin passthrough + whitespace collapse — the real normalizer's behaviour. */
    private val latin = object : PhoneticNormalizer {
        override val locale: String = "en"
        override fun normalize(text: String): String =
            text.lowercase().split(' ', '\t', '\n').filter { it.isNotEmpty() }.joinToString("")
    }

    @Test
    fun `linux to minis inside a realistic sentence is admitted as latin_phonetic`() {
        // "run linux in the sandbox" — the span is a small part of the sentence,
        // so the locality guard passes, exactly as in production.
        val sentence = "run linux in the sandbox"
        val verdict = CorrectionAdmission.judge(
            from = "linux",
            to = "minis",
            normalizer = latin,
            sentenceLength = sentence.length,
        )
        assertTrue("should be admitted, got $verdict", verdict.isAdmitted)
        assertEquals(CorrectionAdmission.Verdict.LatinPhonetic, verdict)
        // The privacy-safe reason tag is what the recorder logs as admit=[...].
        assertEquals("latin_phonetic", verdict.reason)
    }

    @Test
    fun `the locality guard still outranks signal 4`() {
        // Same pair, but now the span IS the whole sentence — a rewrite, not a
        // mis-hear. Signal ordering must keep this rejected.
        val verdict = CorrectionAdmission.judge(
            from = "linux",
            to = "minis",
            normalizer = latin,
            sentenceLength = 5,
        )
        assertTrue(verdict is CorrectionAdmission.Verdict.RejectedTooGlobal)
    }
}
