package com.openminis.app.speech.correction

import android.content.Context
import android.util.Log
import com.openminis.app.shared.SentenceSplitter

/**
 * [T-android-voice-correction] Captures the user's own fixes as training
 * signal. Port of iOS `Agent/Speech/VoiceCorrectionRecorder.swift`.
 *
 * Two entry points share ONE admission rule, differing only in `source`:
 *  - [recordTranscriptEdit] — the user edited an ASR transcript.
 *  - [recordTextInputEdit]  — the user selected text in a plain input field and
 *    replaced it.
 *
 * ## The admission rule
 * An edit is learned only when the before/after are PHONETICALLY CLOSE
 * (similarity ≥ 0.6) and comparable in length (ratio ≤ 2.0). That is what
 * separates "the recognizer misheard me" from "I changed my mind" — and it is
 * why the plain-text path can reuse this untouched: a select-and-replace that
 * swaps in something that sounds nothing like the original is a rewrite, and
 * rewrites teach the dictionary nothing but noise.
 *
 * ## Privacy
 * Every entry point is consent-gated, and NOTHING here logs verbatim user text
 * — only lengths and scores. The database row keeps the truth; the log does
 * not need it.
 *
 * Callers must invoke these off the main thread; they do blocking SQLite work.
 */
class VoiceCorrectionRecorder(
    private val context: Context,
    private val db: VoiceCorrectionDb?,
    private val segment: (String) -> List<String>,
) {

    /** A fix made to a speech-recognition transcript. */
    fun recordTranscriptEdit(
        before: String,
        after: String,
        locale: String = "zh",
        asrProvider: String = "",
    ) = recordEdit(before, after, locale, asrProvider, VoiceCorrectionDb.SOURCE_VOICE)

    /**
     * A select-and-replace edit in an ordinary text field.
     *
     * The trigger is the edit ACTION itself; whether it counts as a correction
     * is decided here by the same phonetic test used for transcripts. Silent
     * background capture — there is no UI and the user feels nothing.
     */
    fun recordTextInputEdit(
        before: String,
        after: String,
        locale: String = "zh",
    ) = recordEdit(before, after, locale, "", VoiceCorrectionDb.SOURCE_TEXT)

    private fun recordEdit(
        before: String,
        after: String,
        locale: String,
        asrProvider: String,
        source: String,
    ) {
        if (!VoiceCorrectionConsent.isEnabled(context)) return
        val b = before.trim()
        val a = after.trim()
        if (b.isEmpty() || a.isEmpty() || b == a) return

        val normalizer = PhoneticNormalizerRegistry.normalizer(locale) ?: return
        val database = db ?: return

        var accepted = 0
        var droppedRewrite = 0
        // [T-android-correction-admission-multisignal] Signal names only — the
        // Verdict.reason strings never contain user text, so logging which
        // signal fired stays privacy-safe while making admission debuggable.
        val admitReasons = mutableListOf<String>()
        val rejectReasons = mutableListOf<String>()

        for ((fromText, toText, contextSample) in alignedCandidates(b, a)) {
            val fromKey = normalizer.normalize(fromText)
            if (fromKey.isEmpty()) continue

            // [T-android-correction-admission-multisignal] Multi-signal
            // admission (homophone / acronym / digit-norm, guarded by edit
            // locality and a reorder check) replaces the old single-axis
            // `phoneticSim >= 0.6 AND lengthRatio <= 2`, which dropped most
            // real ASR mistakes (Chinese-English mixing, acronym expansion,
            // digit normalization). `contextSample` is the sentence the span
            // was diffed within, so its length is the locality denominator;
            // fall back to the whole edited text when a sentence isn't known.
            val sentenceLength = contextSample?.length ?: maxOf(b.length, a.length)
            val verdict = CorrectionAdmission.judge(
                from = fromText,
                to = toText,
                normalizer = normalizer,
                sentenceLength = sentenceLength,
            )
            if (!verdict.isAdmitted) {
                droppedRewrite++
                rejectReasons.add(verdict.reason)
                continue
            }
            admitReasons.add(verdict.reason)
            database.upsertConfusion(
                phoneticKey = fromKey,
                originalVariant = fromText,
                correctedTerm = toText,
                locale = locale,
                contextSample = contextSample?.take(VoiceCorrectionConfig.CONTEXT_SAMPLE_CHARS),
                asrProvider = asrProvider,
                source = source,
            )
            accepted++
        }
        // Lengths, counts and signal names only — never the text itself.
        Log.i(
            TAG,
            "[Record] source=$source beforeLen=${b.length} afterLen=${a.length} " +
                "accepted=$accepted droppedRewrite=$droppedRewrite " +
                "admit=$admitReasons reject=$rejectReasons",
        )
    }

    /**
     * Pair up what changed, sentence by sentence when possible.
     *
     * When both sides split into the same number of sentences we diff only the
     * ones that differ, using the original sentence as context. When the counts
     * differ the user split or merged sentences, and a positional alignment
     * would emit garbage pairs — so fall back to diffing the whole text, which
     * is coarser but never wrong.
     *
     * @return triples of (was, became, contextSample)
     */
    private fun alignedCandidates(
        before: String,
        after: String,
    ): List<Triple<String, String, String?>> {
        val beforeSentences = SentenceSplitter.split(before)
        val afterSentences = SentenceSplitter.split(after)

        val out = mutableListOf<Triple<String, String, String?>>()
        if (beforeSentences.size == afterSentences.size && beforeSentences.isNotEmpty()) {
            for (i in beforeSentences.indices) {
                val bs = beforeSentences[i]
                val `as` = afterSentences[i]
                if (bs == `as`) continue
                for (p in VoiceCorrectionDiff.tokenPairs(bs, `as`, segment)) {
                    out.add(Triple(p.from, p.to, bs))
                }
            }
        } else {
            for (p in VoiceCorrectionDiff.tokenPairs(before, after, segment)) {
                out.add(Triple(p.from, p.to, before))
            }
        }
        return out
    }

    /**
     * The user applied an AI correction. Records the OUTCOME for metrics and
     * nothing else.
     *
     * Deliberately does NOT write a confusion row: the suggestion was derived
     * from that very table, so writing it back would feed the model's own
     * output in as fresh evidence and the system would learn from an echo of
     * itself.
     */
    fun recordSuggestionAccepted(original: String, corrected: String, summary: String) {
        if (!VoiceCorrectionConsent.isEnabled(context)) return
        db?.recordCorrectionEvent(original, corrected, "accepted", summary.ifEmpty { null })
    }

    /**
     * The user rejected a proposed correction — negative feedback only, which
     * lowers the pair's confidence toward the retrieval floor.
     */
    fun recordSuggestionRejected(
        pairs: List<VoiceCorrectionDiff.Pair>,
        locale: String = "zh",
    ) {
        if (!VoiceCorrectionConsent.isEnabled(context)) return
        val database = db ?: return
        val normalizer = PhoneticNormalizerRegistry.normalizer(locale) ?: return
        for (p in pairs) {
            val key = normalizer.normalize(p.from)
            if (key.isEmpty()) continue
            database.recordNegativeFeedback(key, p.to, locale)
        }
        database.recordCorrectionEvent(
            pairs.joinToString("，") { it.from },
            pairs.joinToString("，") { it.to },
            "reverted",
            null,
        )
    }

    companion object {
        private const val TAG = "VoiceCorrectionRec"
    }
}
