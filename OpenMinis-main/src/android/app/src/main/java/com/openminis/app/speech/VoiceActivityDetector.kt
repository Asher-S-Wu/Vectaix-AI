package com.openminis.app.speech

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import io.codeconcept.realtimecutvadlibrary.VADCallback
import io.codeconcept.realtimecutvadlibrary.VADWrapper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.tanh

/** Why a speech segment ended. Mirrors iOS `SegmentEndReason`. */
enum class SegmentEndReason {
    /** VAD saw the configured silence window — the mic should STOP. */
    SILENCE_DETECTED,

    /** Segment hit the length cap — flush it but KEEP recording. */
    MAX_LENGTH_REACHED,

    /**
     * User tapped stop mid-utterance.
     *
     * NOT CURRENTLY EMITTED on Android, and the difference from iOS is
     * deliberate rather than an omission. iOS calls `vad.flush()` to cut a
     * segment on demand and then holds a sub-2 s result in `pendingSegments`
     * to merge with the next utterance (VoiceInputPanel.swift:679-689). The
     * Android library owns segmentation and exposes no flush entry point, so
     * there is nothing to hold: a manual stop tears the detector down and the
     * platform recogniser (System engine) or the user's own tap (Provider
     * engine) finalises whatever it already had. Kept in the enum so the
     * distinction stays visible if the library ever gains a flush API.
     */
    MANUAL_FLUSH,
}

/** Delegate for [VoiceActivityDetector]. All callbacks arrive off the main thread. */
interface VoiceActivityListener {
    fun onVoiceStart() {}

    /**
     * A segment closed. [wav] is a complete 16 kHz WAV (header included).
     *
     * [spokenSeconds] is the ACCUMULATED SPEECH in the segment, derived from
     * the payload, not wall-clock. Callers gate the minimum-length rule on it:
     * wall-clock between speech-start and the close necessarily includes the
     * ~5 s silence window that triggered the close, so it can never fall below
     * a 2 s threshold and the rule would silently never fire.
     */
    fun onVoiceEnd(wav: ByteArray, reason: SegmentEndReason, spokenSeconds: Float)

    /** Live level in [0,1] for the waveform, from the AGC-boosted tap. */
    fun onLevel(level: Float) {}

    /** Capture died and could not be recovered; UI should return to idle. */
    fun onCaptureError(message: String) {}

    /**
     * A session guard fired and capture has stopped. Distinct from
     * [onCaptureError]: nothing went wrong, the session simply ran out of its
     * allowance, so the UI should settle rather than show a failure.
     */
    fun onSessionLimit(limit: SessionLimit) {}
}

/** Why a capture session ended on its own. Mirrors iOS's panel timers. */
enum class SessionLimit {
    /** No speech for 30 s — a forgotten mic (iOS `idleTimeout`). */
    IDLE,

    /** Backgrounded 15 s mid-capture (iOS `backgroundTimeout`). */
    BACKGROUNDED,

    /** 300 s of continuous capture (iOS `maxTotalRecordingSeconds`). */
    MAX_DURATION,
}

/**
 * [T-android-vad] Silero-VAD speech segmentation for Android.
 *
 * ## Why this exists
 *
 * Android previously had no VAD at all. The System engine relied on the
 * platform recognizer's own endpointing — which is OEM-specific, so the same
 * app segmented differently on Pixel vs vivo vs Xiaomi — and the Provider
 * (custom-model) engine had *no* endpointing whatsoever: it recorded until the
 * user tapped stop or hit a 60 s cap. This class gives both engines one
 * deterministic, device-independent notion of "the user stopped talking".
 *
 * ## Same model as iOS, on purpose
 *
 * `RealTimeCutVADLibraryForAndroid` is the Android build of the very library
 * iOS uses through SPM (`RealTimeCutVADLibrary`) — same author, same Silero v5
 * + ONNX Runtime + WebRTC APM stack, same six-parameter threshold call. So the
 * tunables below are copied verbatim from
 * `src/ios/Providers/Voice/VoiceActivityDetector.swift` and the two platforms
 * segment identically.
 *
 * ## Do not use the library's default thresholds
 *
 * The library's README suggests `(0.7, 0.7, 0.5, 0.95, 10, 57)`. Two of those
 * are wrong for us:
 *  - end frames `57` ≈ 1.8 s, where iOS waits ~5 s ([END_FRAMES]); and
 *  - start/end probability `0.7`, which iOS tried and reverted — its comment
 *    records that at 0.7 the VAD "logged speechDetected=false across hundreds
 *    of frames while the user was actually speaking, so no segment was ever
 *    emitted."
 * [applyThresholds] therefore always calls `setVADThreshold` explicitly.
 */
class VoiceActivityDetector(
    private val context: Context,
    private val listener: VoiceActivityListener,
) {

    companion object {
        private const val TAG = "VAD"

        /** Capture rate. 48 kHz matches iOS and the APM resamples to 16 kHz for Silero. */
        const val SAMPLE_RATE = 48_000

        // ── Silero thresholds (iOS VoiceActivityDetector.swift:128-146) ──
        private const val START_PROBABILITY = 0.5f
        private const val END_PROBABILITY = 0.5f
        private const val START_TRUE_RATIO = 0.5f

        /** Deliberately conservative so we don't clip the tail of a word. */
        private const val END_FALSE_RATIO = 0.95f

        /** 10 frames ≈ 0.32 s to confirm speech onset. */
        private const val START_FRAMES = 10

        /**
         * 156 frames ≈ 5.0 s of trailing silence before a segment closes.
         * The single most user-visible knob: on silence the mic STOPS (see
         * [SegmentEndReason.SILENCE_DETECTED]), matching iOS.
         */
        private const val END_FRAMES = 156

        // ── Noise-aware AGC (iOS :62-71, :617-655) ──
        private const val GATE_RATIO = 2.5f
        private const val AGC_TARGET_RMS = 0.12f
        private const val MAX_GAIN = 6.0f
        private const val GAIN_SMOOTHING = 0.3f
        private const val INITIAL_NOISE_FLOOR = 0.003f
        private const val NOISE_FLOOR_MIN = 0.0005f
        private const val NOISE_FLOOR_MAX = 0.02f
        private const val NOISE_ADAPT_DOWN = 0.05f
        private const val NOISE_ADAPT_UP = 0.005f

        /** VAD frame size. 512 @ 48 kHz ≈ 10 ms, matching the library's frame. */
        private const val FRAME_SAMPLES = 512

        /** Level mapping for the waveform (iOS computeWaveformLevels :1158-1180). */
        private const val LEVEL_GAIN = 14f
        private const val LEVEL_SCALE = 0.95f
        private const val LEVEL_FLOOR = 0.04f

        /** The library always emits 16 kHz mono PCM16 WAV. */
        // internal, not private: WavSegmentMerger needs the same two constants
        // to concatenate segments, and a second copy would be free to drift.
        internal const val WAV_SAMPLE_RATE = 16_000
        internal const val WAV_HEADER_BYTES = 44

        /**
         * Pre-roll replayed into the VAD when capture starts, matching iOS
         * `startBackfillSeconds` (VoiceActivityDetector.swift:97).
         *
         * Speech-start confirmation is inherently late — [START_FRAMES] alone
         * is 0.32 s, and longer for quiet speech whose per-frame probability
         * hovers at the threshold. Without a pre-roll the segment begins
         * mid-syllable; iOS's comment records device forensics showing "every
         * capture starting mid-syllable with 0 ms of leading silence" back
         * when this was a fixed 0.3 s.
         */
        private const val START_BACKFILL_SECONDS = 1.5f

        // ── Session-level timers (iOS VoiceInputPanel.swift:180, 227, 229) ──
        /** No speech at all for this long → stop, so a forgotten mic can't run on. */
        const val IDLE_TIMEOUT_MS = 30_000L

        /** Backgrounded this long mid-capture → stop. */
        const val BACKGROUND_TIMEOUT_MS = 15_000L

        /** Hard ceiling on one continuous capture session. */
        const val MAX_TOTAL_RECORDING_MS = 300_000L
    }

    private val running = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)

    @Volatile
    var isSpeaking: Boolean = false
        private set

    val isRunning: Boolean get() = running.get()

    /**
     * Segment length cap in seconds. Apple's ASR rejects >60 s, so iOS uses 59
     * for system recognition and the full session cap for cloud providers; the
     * caller sets the same way.
     */
    @Volatile
    var maxSegmentSeconds: Int = 59

    /**
     * Guards every use of [vad]'s native side. Held across `processAudio` on
     * the capture thread and across `release()` on whichever thread stops us,
     * so the native object can never be freed mid-call. See the call site in
     * [captureLoop] for the crash this prevents.
     */
    private val vadLock = Any()

    /**
     * [T-android-vad] Optional tap on the RAW captured PCM16, before AGC.
     *
     * This exists so ONE AudioRecord can serve both the VAD and a consumer
     * that needs the same audio — specifically `SpeechRecognizer` fed through
     * `RecognizerIntent.EXTRA_AUDIO_SOURCE`. Opening a second AudioRecord
     * instead does not work: Android hands the real stream to one client and
     * the other is starved, which on a Pixel 6 left the recogniser reporting
     * `onStartOfSpeech` and then `withSpeech: false` — it had been given
     * nothing to transcribe.
     *
     * Deliberately the pre-AGC bytes: the AGC exists to make the VAD's job
     * easier on quiet input, and its soft-clipping is not something a
     * recogniser's own front-end should have to undo.
     *
     * Called on the capture thread; must not block.
     */
    @Volatile
    var rawAudioSink: ((ByteArray, Int) -> Unit)? = null

    @Volatile
    private var vad: VADWrapper? = null
    private var recorder: AudioRecord? = null
    private var captureJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    // AGC state, carried frame to frame.
    private var smoothedGain = 1.0f
    private var noiseFloorRms = INITIAL_NOISE_FLOOR

    /** Samples fed to the VAD since the current segment opened; drives the length cap. */
    private var segmentSamples = 0L

    /**
     * Rolling pre-roll of AGC-processed frames, [START_BACKFILL_SECONDS] deep.
     *
     * The library owns segmentation and gives us no way to inject audio behind
     * a segment boundary, so — unlike iOS, which splices the back-fill into its
     * own capture buffer — we keep the VAD permanently primed: every frame goes
     * in, so by the time the model confirms speech it has already consumed the
     * run-up. This ring exists to bound what we replay after a stop/start cycle
     * so a new capture doesn't open on a cold model.
     */
    private val backfill = ArrayDeque<FloatArray>()
    private var backfillSamples = 0
    private val backfillCapacity = (SAMPLE_RATE * START_BACKFILL_SECONDS).toInt()

    /** Wall clock of capture start and of the last confirmed speech, for the timers. */
    @Volatile private var captureStartedAtMs = 0L
    @Volatile private var lastSpeechAtMs = 0L

    /** Set while the app is backgrounded, so the shorter timeout applies. */
    @Volatile
    var isBackgrounded: Boolean = false
        set(value) {
            field = value
            backgroundedAtMs = if (value) System.currentTimeMillis() else 0L
        }
    @Volatile private var backgroundedAtMs = 0L

    /**
     * Start capture. Returns an error string on failure, null on success.
     * Caller must already hold RECORD_AUDIO.
     */
    @Suppress("MissingPermission")
    fun start(): String? {
        if (running.getAndSet(true)) return null
        cancelled.set(false)
        smoothedGain = 1.0f
        noiseFloorRms = INITIAL_NOISE_FLOOR
        segmentSamples = 0
        isSpeaking = false

        val wrapper = try {
            VADWrapper(context).also {
                it.setVADModel(VADWrapper.SileroModelVersion.V5)
                it.setVADSampleRate(VADWrapper.SampleRate.SAMPLERATE_48)
                applyThresholds(it)
                it.setVADCallback(vadCallback)
            }
        } catch (t: Throwable) {
            // Missing native lib / unsupported ABI must degrade, not crash.
            running.set(false)
            Log.e(TAG, "VAD init failed", t)
            return "Voice detection unavailable: ${t.javaClass.simpleName}"
        }
        vad = wrapper

        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuf <= 0) {
            stopInternal()
            return "AudioRecord unsupported buffer size."
        }

        val rec = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                max(minBuf * 4, FRAME_SAMPLES * 2 * 8),
            )
        } catch (t: Throwable) {
            stopInternal()
            return "AudioRecord init failed: ${t.message}"
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            stopInternal()
            return "AudioRecord not initialized."
        }
        recorder = rec

        captureJob = scope.launch { captureLoop(rec) }
        return null
    }

    private fun applyThresholds(w: VADWrapper) {
        w.setVADThreshold(
            START_PROBABILITY,
            END_PROBABILITY,
            START_TRUE_RATIO,
            END_FALSE_RATIO,
            START_FRAMES,
            END_FRAMES,
        )
    }

    private fun captureLoop(rec: AudioRecord) {
        val shorts = ShortArray(FRAME_SAMPLES)
        val floats = FloatArray(FRAME_SAMPLES)
        // Little-endian PCM16 staging for rawAudioSink; reused per frame.
        val sinkBytes = ByteArray(FRAME_SAMPLES * 2)
        try {
            rec.startRecording()
        } catch (t: Throwable) {
            Log.e(TAG, "startRecording failed", t)
            listener.onCaptureError("Microphone unavailable: ${t.message}")
            stopInternal()
            return
        }

        val maxSamples = SAMPLE_RATE.toLong() * maxSegmentSeconds
        captureStartedAtMs = System.currentTimeMillis()
        lastSpeechAtMs = captureStartedAtMs
        while (running.get() && !cancelled.get()) {
            // Session guards, checked before each read so they fire even while
            // the user is silent. iOS keeps these as Timers on the panel; a
            // poll on the capture thread is equivalent and cannot leak.
            val now = System.currentTimeMillis()
            if (now - captureStartedAtMs >= MAX_TOTAL_RECORDING_MS) {
                Log.i(TAG, "session hit ${MAX_TOTAL_RECORDING_MS / 1000}s cap — stopping")
                listener.onSessionLimit(SessionLimit.MAX_DURATION)
                break
            }
            if (!isSpeaking && now - lastSpeechAtMs >= IDLE_TIMEOUT_MS) {
                Log.i(TAG, "no speech for ${IDLE_TIMEOUT_MS / 1000}s — stopping")
                listener.onSessionLimit(SessionLimit.IDLE)
                break
            }
            if (isBackgrounded && backgroundedAtMs > 0 &&
                now - backgroundedAtMs >= BACKGROUND_TIMEOUT_MS
            ) {
                Log.i(TAG, "backgrounded ${BACKGROUND_TIMEOUT_MS / 1000}s — stopping")
                listener.onSessionLimit(SessionLimit.BACKGROUNDED)
                break
            }

            val n = try {
                rec.read(shorts, 0, FRAME_SAMPLES)
            } catch (t: Throwable) {
                Log.e(TAG, "read failed", t)
                listener.onCaptureError("Microphone read failed")
                break
            }
            if (n <= 0) continue

            // Hand the RAW frame to any consumer sharing this capture (the
            // recogniser pipe) before AGC touches the samples.
            rawAudioSink?.let { sink ->
                var b = 0
                for (i in 0 until n) {
                    val s = shorts[i].toInt()
                    sinkBytes[b++] = (s and 0xFF).toByte()
                    sinkBytes[b++] = ((s shr 8) and 0xFF).toByte()
                }
                runCatching { sink(sinkBytes, b) }
            }

            // PCM16 -> float [-1,1], then noise-aware AGC.
            var sumSq = 0.0f
            for (i in 0 until n) {
                val f = shorts[i] / 32768.0f
                floats[i] = f
                sumSq += f * f
            }
            val rms = if (n > 0) sqrt(sumSq / n) else 0f
            applyAgc(floats, n, rms)

            // Waveform is driven from the boosted TAP, not the library's
            // onVoiceDidContinue: that only fires DURING a detected segment, so
            // relying on it leaves the bars flat until VAD trips (iOS :657-664).
            listener.onLevel(levelFor(floats, n))

            val frame = if (n == FRAME_SAMPLES) floats else floats.copyOf(n)

            // Keep a bounded pre-roll of processed frames. The VAD is fed every
            // frame from the moment the mic opens, so the run-up before
            // speech-start confirmation is already inside the model; this ring
            // caps how much we would replay on a restart and keeps the memory
            // constant rather than growing with session length.
            backfill.addLast(frame)
            backfillSamples += n
            while (backfillSamples > backfillCapacity && backfill.isNotEmpty()) {
                backfillSamples -= backfill.removeFirst().size
            }

            // [T-android-vad] processAudio and release() MUST be mutually
            // exclusive.
            //
            // `vad?.processAudio()` alone is not safe: the null check and the
            // call are separate steps, and stop() runs on another thread. A
            // release() landing in between frees the native RealTimeCutVAD
            // while the JNI call is already inside it, and the next frame
            // dereferences freed memory — SIGSEGV in
            // RealTimeCutVAD::process(std::vector<float>&), which is exactly
            // what a Pixel 6 produced when the recognizer reported error 7 and
            // tore the session down 12 ms before the fault.
            //
            // Holding the lock across the whole call makes release() wait for
            // the in-flight frame instead of pulling the object out from under
            // it. Frames are ~10 ms of audio and inference is well under that,
            // so the wait is bounded and stop() stays responsive.
            var failure: Throwable? = null
            val alive = synchronized(vadLock) {
                val w = vad
                when {
                    w == null -> false // torn down; the stopper owns the state
                    else -> {
                        try { w.processAudio(frame) } catch (t: Throwable) { failure = t }
                        true
                    }
                }
            }
            if (!alive) break
            val err = failure
            if (err != null) {
                Log.e(TAG, "processAudio failed", err)
                listener.onCaptureError("Voice detection failed")
                break
            }
            if (isSpeaking) lastSpeechAtMs = System.currentTimeMillis()

            // Length cap. The library owns segment cutting and exposes no
            // "flush now" call, so we cannot split a segment mid-utterance the
            // way iOS does. What we CAN do is refuse to let a runaway segment
            // grow past what the provider will accept: mark the reason so the
            // eventual onVoiceEnd is attributed as a cap hit rather than a
            // silence stop (the two mean different things to the caller — a
            // silence stop turns the mic off, a cap hit must not), and warn
            // once so an over-long take is visible in a field log.
            if (isSpeaking) {
                segmentSamples += n
                if (segmentSamples >= maxSamples && pendingReason == null) {
                    Log.w(TAG, "segment exceeded ${maxSegmentSeconds}s — will report MAX_LENGTH_REACHED")
                    pendingReason = SegmentEndReason.MAX_LENGTH_REACHED
                }
            }
        }

        try { rec.stop() } catch (_: Throwable) {}
        rec.release()
    }

    /** iOS's noise-aware AGC, ported verbatim (`VoiceActivityDetector.swift:617-655`). */
    private fun applyAgc(buf: FloatArray, n: Int, rms: Float) {
        val gate = noiseFloorRms * GATE_RATIO
        val targetGain: Float
        if (rms < gate) {
            targetGain = 1.0f
            // Adapt ASYMMETRICALLY and never mid-segment. A symmetric rate let
            // quiet speech drag the floor up, raising the gate, so each further
            // frame was even less likely to be amplified — a runaway that
            // starved the VAD of exactly the low-volume speech users report as
            // "it doesn't hear me".
            if (!isSpeaking) {
                val rate = if (rms < noiseFloorRms) NOISE_ADAPT_DOWN else NOISE_ADAPT_UP
                noiseFloorRms += (rms - noiseFloorRms) * rate
                noiseFloorRms = max(NOISE_FLOOR_MIN, min(NOISE_FLOOR_MAX, noiseFloorRms))
            }
        } else {
            targetGain = min(MAX_GAIN, max(1.0f, AGC_TARGET_RMS / max(rms, 0.0001f)))
        }
        smoothedGain += (targetGain - smoothedGain) * GAIN_SMOOTHING
        if (smoothedGain > 1.01f) {
            for (i in 0 until n) buf[i] = tanh(buf[i] * smoothedGain) // soft-clip
        }
    }

    /** Perceptual level for the waveform (iOS `computeWaveformLevels`). */
    private fun levelFor(buf: FloatArray, n: Int): Float {
        var sumSq = 0.0f
        for (i in 0 until n) sumSq += buf[i] * buf[i]
        val rms = if (n > 0) sqrt(sumSq / n) else 0f
        val level = sqrt(min(1.0f, rms * LEVEL_GAIN)) * LEVEL_SCALE
        return min(1.0f, max(LEVEL_FLOOR, level))
    }

    /** Set when the length cap trips so the next onVoiceEnd is attributed correctly. */
    @Volatile
    private var pendingReason: SegmentEndReason? = null

    private val vadCallback = object : VADCallback {
        override fun onVoiceStart() {
            isSpeaking = true
            segmentSamples = 0
            listener.onVoiceStart()
        }

        override fun onVoiceEnd(wav: ByteArray?) {
            isSpeaking = false
            segmentSamples = 0
            lastSpeechAtMs = System.currentTimeMillis()
            val reason = pendingReason ?: SegmentEndReason.SILENCE_DETECTED
            pendingReason = null
            if (wav == null || wav.isEmpty()) return
            // Duration from the payload, NOT wall-clock: the interval between
            // speech-start and this callback necessarily contains the ~5 s
            // silence that closed the segment, so a wall-clock figure can never
            // drop below a 2 s minimum and the caller's rule would never fire.
            val spoken = max(0, wav.size - WAV_HEADER_BYTES) /
                (WAV_SAMPLE_RATE * 2).toFloat()
            listener.onVoiceEnd(wav, reason, spoken)
        }

        override fun onVoiceDidContinue(pcm: ByteArray?) {
            // Unused: the waveform is driven from the raw tap so it stays live
            // before VAD confirms speech. See captureLoop.
        }
    }

    /** Stop capture. Any segment already delivered stands; nothing new is emitted. */
    fun stop() {
        stopInternal()
    }

    /** Stop and suppress any in-flight segment delivery. */
    fun cancel() {
        cancelled.set(true)
        stopInternal()
    }

    private fun stopInternal() {
        running.set(false)
        isSpeaking = false
        backfill.clear()
        backfillSamples = 0
        captureStartedAtMs = 0
        lastSpeechAtMs = 0
        backgroundedAtMs = 0
        captureJob?.let { runCatching { it.cancel() } }
        captureJob = null
        recorder = null
        // Null the reference and free the native object under the same lock the
        // capture thread holds while inside processAudio, so release() waits for
        // any in-flight frame instead of freeing underneath it.
        synchronized(vadLock) {
            val w = vad
            vad = null
            w?.let { runCatching { it.release() } }
        }
    }
}
