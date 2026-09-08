package com.openminis.app.speech.correction

/**
 * [T-android-voice-correction] One source of correction candidates.
 * Port of iOS `Providers/Voice/CorrectionSignalSource.swift`.
 *
 * Lookup is BATCHED by contract — a 30-token transcript must not become 30
 * round-trips — and never throws: a failing source degrades to no candidates
 * rather than failing the whole correction.
 */
interface CorrectionSignalSource {
    val sourceIdentifier: String

    /** Weight applied to every candidate's confidence during fusion. */
    val defaultWeight: Double

    fun lookupCandidates(phoneticKeys: List<String>, locale: String, limit: Int): List<CorrectionCandidate>
}

/**
 * @property evidence human-readable provenance, rendered VERBATIM into the
 *   prompt's confusion block (e.g. "张山→张三（出现3次）"). Keeping the wording
 *   with the source that produced it stops the prompt builder from having to
 *   know each source's shape.
 */
data class CorrectionCandidate(
    val phoneticKey: String,
    val term: String,
    val confidence: Double,
    val sourceIdentifier: String,
    val evidence: String,
)

/**
 * Learned ASR corrections. Weight 1.0 — a pair the user actually fixed is the
 * strongest evidence available.
 */
class ConfusionDictionarySource(
    private val db: VoiceCorrectionDb,
    private val minConfidence: Double = VoiceCorrectionConfig.MIN_CONFUSION_CONFIDENCE,
) : CorrectionSignalSource {

    override val sourceIdentifier = "confusion_dictionary"
    override val defaultWeight = 1.0

    override fun lookupCandidates(
        phoneticKeys: List<String>,
        locale: String,
        limit: Int,
    ): List<CorrectionCandidate> =
        db.lookupConfusion(phoneticKeys, locale, minConfidence, limit).map { row ->
            CorrectionCandidate(
                phoneticKey = row.phoneticKey,
                term = row.correctedTerm,
                confidence = row.confidence,
                sourceIdentifier = sourceIdentifier,
                evidence = "${row.variants.firstOrNull() ?: row.phoneticKey}→${row.correctedTerm}" +
                    "（出现${row.frequency}次）",
            )
        }
}

/**
 * Terms the user types often. Weight 0.6, and confidence saturates at
 * `min(1, frequency/10)`, so a term typed 50 times cannot outrank a confirmed
 * correction on volume alone — a confusion row at confidence ≥ 0.6 always wins.
 */
class TypedVocabularySource(
    private val db: VoiceCorrectionDb,
) : CorrectionSignalSource {

    override val sourceIdentifier = "typed_vocabulary"
    override val defaultWeight = 0.6

    override fun lookupCandidates(
        phoneticKeys: List<String>,
        locale: String,
        limit: Int,
    ): List<CorrectionCandidate> =
        db.lookupVocabulary(phoneticKeys, locale, limit).map { row ->
            CorrectionCandidate(
                phoneticKey = row.phoneticKey,
                term = row.term,
                confidence = minOf(1.0, row.frequency / 10.0),
                sourceIdentifier = sourceIdentifier,
                evidence = "${row.term}（常用词，出现${row.frequency}次）",
            )
        }
}
