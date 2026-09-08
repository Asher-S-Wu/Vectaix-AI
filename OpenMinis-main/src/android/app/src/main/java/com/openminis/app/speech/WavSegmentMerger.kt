package com.openminis.app.speech

/**
 * [T-android-vad-merge-segments] Concatenate consecutive 16 kHz mono PCM16 WAV
 * segments into one WAV. Port of iOS `VoiceInputPanel.mergeWavSegments`
 * (VoiceInputPanel.swift:1202).
 *
 * ## Why this exists
 * The VAD closes a segment on every silence gap, and a segment shorter than
 * [ProviderSpeechRecognitionEngine.MIN_SEGMENT_SECONDS] used to be DISCARDED
 * outright — a cough filter. That is right for one isolated blip and wrong for
 * natural speech: "yes" (0.8 s), pause, "send it" (0.9 s) is two sub-threshold
 * segments in a row, so dictation could never complete. iOS accumulates
 * segments and tests the 2 s minimum against the RUNNING TOTAL; this is the
 * byte-level half of that.
 *
 * ## Format assumption
 * Every segment is a complete WAV with a canonical 44-byte header
 * ([VoiceActivityDetector.WAV_HEADER_BYTES]), mono PCM16 at one sample rate —
 * which is exactly what the VAD emits, and the same assumption iOS makes. The
 * merge keeps the first header, appends only the PCM payloads, then rewrites
 * the two length fields. No resampling, no format negotiation: segments from a
 * single capture session are homogeneous by construction.
 */
object WavSegmentMerger {

    private const val HEADER = VoiceActivityDetector.WAV_HEADER_BYTES

    /** RIFF chunk size lives at byte 4, data chunk size at byte 40. */
    private const val OFFSET_RIFF_SIZE = 4
    private const val OFFSET_DATA_SIZE = 40

    /**
     * @return one WAV containing every segment's audio in order, or null when
     *   nothing usable was supplied. A single valid segment is returned as-is.
     */
    fun merge(segments: List<ByteArray>): ByteArray? {
        val valid = segments.filter { it.size > HEADER }
        if (valid.isEmpty()) return null
        if (valid.size == 1) return valid[0]

        val payloadBytes = valid.sumOf { it.size - HEADER }
        val out = ByteArray(HEADER + payloadBytes)

        // Header of the first segment verbatim — sample rate, channel count and
        // bit depth are shared across a session, so the first one describes all.
        System.arraycopy(valid[0], 0, out, 0, HEADER)
        var pos = HEADER
        for (seg in valid) {
            val n = seg.size - HEADER
            System.arraycopy(seg, HEADER, out, pos, n)
            pos += n
        }

        putLeUInt32(out, OFFSET_RIFF_SIZE, (out.size - 8).toLong())
        putLeUInt32(out, OFFSET_DATA_SIZE, payloadBytes.toLong())
        return out
    }

    /** Total PCM duration of [segments] at [sampleRate], header bytes excluded. */
    fun totalSeconds(segments: List<ByteArray>, sampleRate: Int = 16_000): Float {
        if (sampleRate <= 0) return 0f
        val payload = segments.sumOf { maxOf(0, it.size - HEADER) }
        // PCM16 mono → 2 bytes per frame.
        return payload / 2f / sampleRate
    }

    private fun putLeUInt32(buf: ByteArray, offset: Int, value: Long) {
        buf[offset] = (value and 0xFF).toByte()
        buf[offset + 1] = ((value shr 8) and 0xFF).toByte()
        buf[offset + 2] = ((value shr 16) and 0xFF).toByte()
        buf[offset + 3] = ((value shr 24) and 0xFF).toByte()
    }
}
