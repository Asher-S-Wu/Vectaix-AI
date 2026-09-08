package com.openminis.app.speech

import java.util.Locale

/**
 * Adapter for a single speech-to-text backend.
 *
 * Implementations exist for:
 *  - [SystemSpeechRecognitionEngine]: wraps android.speech.SpeechRecognizer,
 *    smooths over OEM fragmentation (Pixel/Samsung/Xiaomi … AOSP / HarmonyOS).
 *  - [ProviderSpeechRecognitionEngine]: captures PCM via AudioRecord and
 *    dispatches it to the resolved cloud provider's transcription endpoint
 *    through the VoiceProvider stack. One-shot on stop — it reports
 *    `supportsPartialResults = false`, so the System engine remains the
 *    streaming/live-transcript option.
 *
 * Engines are stateless w.r.t. other engines: the [SpeechRecognitionManager]
 * owns selection and state aggregation.
 */
interface SpeechRecognitionEngine {

    /** Stable identifier persisted to preferences (e.g. "system", "provider:openai-whisper"). */
    val id: String

    /** Human-readable name shown in a picker (localized externally). */
    val displayName: String

    /**
     * Best-effort availability. Implementations should perform *cheap* checks
     * only (package visibility, service presence). A `true` result does not
     * guarantee that [start] will succeed — handle errors via [Listener.onError]
     * and downgrade through [markDegraded] if necessary.
     */
    val isAvailable: Boolean

    /**
     * Whether this engine streams interim ("partial") results. Used by the UI
     * to decide if it should show a live transcription caret.
     */
    val supportsPartialResults: Boolean

    /**
     * Locales the engine can transcribe. Can be expensive to compute (involves
     * a broadcast on Android) — implementations should cache.
     */
    val supportedLocales: List<Locale>

    /**
     * Begin recognition. The engine is responsible for audio capture and will
     * invoke [listener] callbacks until [stop] or a terminal error fires.
     * Callers must ensure RECORD_AUDIO permission is granted before calling.
     */
    fun start(locale: Locale, listener: Listener)

    /** Stop capture; a final result (or error) is still delivered via [Listener]. */
    fun stop()

    /** Abort capture; no further callbacks will fire. */
    fun cancel()

    /**
     * Optional: called by [SpeechRecognitionManager] when a prior [start] ended
     * in an unrecoverable error so the engine can remember it and report
     * `isAvailable = false`.
     *
     * Degradation is PER-ENGINE by design: `refreshAvailability()` is
     * `engines.any { it.isAvailable }`, so a poisoned system engine must not
     * mask a working provider engine.
     */
    fun markDegraded() {}

    /**
     * [T-android-voice-entry-always-available] Undo [markDegraded].
     *
     * Degradation used to be permanent for the process lifetime with no reset
     * path, so a single transient failure (mic held by another app, permission
     * not yet granted, a provider that was misconfigured and has since been
     * fixed) disabled the engine until the app was restarted. The user
     * explicitly re-entering voice mode or picking this engine is the signal
     * that conditions may have changed — give it another chance.
     */
    fun clearDegraded() {}

    interface Listener {
        /** Incremental interim result. Only fires if [supportsPartialResults]. */
        fun onPartial(text: String)

        /** Terminal — capture has finished cleanly. */
        fun onFinal(text: String)

        /** Terminal — capture failed. */
        fun onError(error: RecognitionError, message: String? = null)

        /** Audio level in dB for UI animation; safe to ignore. */
        fun onRmsDb(rms: Float) {}

        /** Fires when the engine starts actually listening (after warmup). */
        fun onReadyForSpeech() {}
    }
}

enum class RecognitionError {
    /** No speech detected / silence. Recoverable — the user can try again. */
    NO_MATCH,

    /**
     * [T-android-asr-silent-failure] Speech WAS detected (our VAD saw a
     * voiced segment) but the recognizer produced no text. Distinct from
     * [NO_MATCH] because the UI deliberately swallows NO_MATCH — it means
     * "you didn't say anything", which is exactly the wrong message when the
     * user spoke for 30 s and got nothing. This one must be shown.
     */
    TRANSCRIPTION_FAILED,

    /** Engine reported network failure (cloud recognizers). */
    NETWORK,

    /** RECORD_AUDIO denied at runtime. */
    PERMISSION_DENIED,

    /**
     * The host OS / ROM ships no recognition service. Permanent for the
     * current process; the UI should hide the mic button.
     */
    OEM_NO_SERVICE,

    /** System recognizer is busy (multi-process contention). Retry later. */
    RECOGNIZER_BUSY,

    /** Requested locale not supported by this engine. */
    LANGUAGE_UNSUPPORTED,

    /** Audio capture failed (mic hardware / HAL). */
    AUDIO_ERROR,

    /** Any other failure. */
    UNKNOWN,
}

/** What the manager is currently doing. Mirrors iOS SpeechRecognitionManager.State. */
enum class RecognitionState {
    /** Not listening. Default. */
    IDLE,

    /** Permission request / engine warmup in flight. */
    STARTING,

    /** Capturing audio and delivering partial/final results. */
    RECORDING,

    /**
     * Capture stopped locally; waiting for the engine to flush the final
     * result. Brief; transitions to [IDLE].
     */
    FINISHING,
}
