package com.openminis.app.data.model

/**
 * [T-android-provider-voice] Voice-modality helpers — the Android port of the
 * iOS ModelModality voice-shape conventions (LLMTypes.swift).
 *
 * iOS models modality as one OptionSet; Android as two String lists
 * (inputModalities / outputModalities, bare names — see normalizeModalities()).
 * The cross-platform shape conventions are:
 *
 *   - Dedicated ASR model  = audio in → text out   (iOS [.audioInput, .textOutput])
 *   - Dedicated TTS model  = text in → audio out   (iOS [.textInput, .audioOutput])
 *   - TEMPLATE SEED        = exactly ONE audio flag and nothing else:
 *       ASR seed → inputs == ["audio"], outputs == null
 *       TTS seed → inputs == null,      outputs == ["audio"]
 *
 * The single-flag seed shape is the [T-voice-seed-shape-exact] discriminator:
 * no API-derived model is ever a single audio flag (inference and the models
 * APIs always attach the paired text side), so launch cleanup can safely
 * remove retired seeds by this exact shape without ever touching API models.
 */
/**
 * Sentinel ids for the on-device System speech engines (SpeechRecognizer /
 * TextToSpeech), used as virtual provider/model ids in voice groups. MUST stay
 * byte-identical to iOS (SystemVoiceProvider.builtinProviderId +
 * UnifiedModelPicker system entries) so voice-group member ids survive a
 * cross-platform config move.
 */
object SystemVoiceIds {
    const val BUILTIN_PROVIDER_ID = "__builtin_system_speech__"
    const val SYSTEM_ASR_ONLINE = "system-asr-online"
    const val SYSTEM_ASR_OFFLINE = "system-asr-offline"
    const val SYSTEM_TTS = "system-tts"
}

object VoiceModality {

    /** Substrings marking a DEDICATED speech-to-text (ASR) model. Mirrors iOS
     *  LLMTypes.asrInferencePatterns. */
    private val asrInferencePatterns = listOf(
        "-asr", "asr-", "_asr", "asr_", "whisper", "transcrib", "speech-to-text",
        "speech2text", "stt-", "-stt", "_stt", "stt_", "voice-input", "voice_input",
    )

    /** Substrings marking a DEDICATED text-to-speech (TTS) model. Mirrors iOS
     *  LLMTypes.ttsInferencePatterns. */
    private val ttsInferencePatterns = listOf(
        "tts", "-tts", "_tts", "text-to-speech", "text2speech", "audio-gen",
        "audio-generation", "seed-tts", "voice-output", "voice_output",
    )

    /**
     * Infer a DEDICATED voice model's EXACT modality from its id/name, or null
     * when it isn't a dedicated ASR/TTS model. The returned pair is
     * (inputModalities, outputModalities) with BOTH sides populated — the
     * paired text side is mandatory so an inferred model never collides with
     * the single-flag template-seed shape. Mirrors iOS
     * LLMTypes.inferDedicatedVoiceModality.
     */
    fun inferDedicatedVoiceModality(id: String, displayName: String): Pair<List<String>, List<String>>? {
        val hay = "$id $displayName".lowercase()
        if (asrInferencePatterns.any { hay.contains(it) }) {
            return listOf("audio") to listOf("text")   // ASR: audio in → text out
        }
        if (ttsInferencePatterns.any { hay.contains(it) }) {
            return listOf("text") to listOf("audio")   // TTS: text in → audio out
        }
        return null
    }
}

/** Effective normalized input modalities (bare names), null when unspecified. */
private val LLMModel.normalizedInputs: List<String>? get() = inputModalities.normalizeModalities()
private val LLMModel.normalizedOutputs: List<String>? get() = outputModalities.normalizeModalities()

/** True when this model consumes audio (ASR or audio-capable chat model). */
val LLMModel.hasAudioInput: Boolean
    get() = normalizedInputs?.contains("audio") == true

/** True when this model produces audio (TTS or omni model). */
val LLMModel.hasAudioOutput: Boolean
    get() = normalizedOutputs?.contains("audio") == true

/**
 * True when this model natively consumes images (a vision-capable model).
 * [T-android-vision-group] The Vision Group resolver filters group members by
 * this predicate. Normalizes so "image_input" (OpenAI/OpenRouter suffix form)
 * and bare "image" (models.dev) both match.
 */
val LLMModel.hasImageInput: Boolean
    get() = normalizedInputs?.contains("image") == true

/** True when this model has ANY audio modality — the "voice model" predicate
 *  behind Voice Services shadow visibility (iOS hasVoiceModels). */
val LLMModel.hasVoiceModality: Boolean
    get() = hasAudioInput || hasAudioOutput

/**
 * [T-voice-seed-shape-exact] True when this model carries the exact single-flag
 * VOICE-TEMPLATE SEED shape (see VoiceModality doc). Template mockModels are
 * authored this way on purpose; API models always carry the paired text side.
 */
val LLMModel.isVoiceTemplateSeedShape: Boolean
    get() {
        val ins = normalizedInputs
        val outs = normalizedOutputs
        val asrSeed = ins == listOf("audio") && outs == null
        val ttsSeed = ins == null && outs == listOf("audio")
        return asrSeed || ttsSeed
    }

/**
 * Apply dedicated-voice modality inference when the model has no explicit
 * modality info. Mirrors the dedicated-voice step of iOS
 * LLMModel.withInferredModality (models.dev enrichment stays where it is —
 * this only fills the exact ASR/TTS shape from id/name patterns).
 */
fun LLMModel.withInferredVoiceModality(): LLMModel {
    if (inputModalities != null || outputModalities != null) return this
    val (ins, outs) = VoiceModality.inferDedicatedVoiceModality(id, displayName) ?: return this
    return copy(inputModalities = ins, outputModalities = outs)
}
