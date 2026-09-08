package com.openminis.app.speech

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * [T-android-vad-merge-segments] Byte-level guards for the WAV concatenation
 * that lets two short utterances add up to a transcribable segment.
 */
class WavSegmentMergerTest {

    private val header = 44

    /** A WAV whose 44-byte header is recognizable and whose payload is [fill]. */
    private fun wav(payload: Int, fill: Byte): ByteArray {
        val b = ByteArray(header + payload)
        // Minimal RIFF marker so the test data looks like the real thing.
        "RIFF".toByteArray().copyInto(b, 0)
        "WAVE".toByteArray().copyInto(b, 8)
        for (i in header until b.size) b[i] = fill
        return b
    }

    private fun leU32(b: ByteArray, off: Int): Long =
        (b[off].toLong() and 0xFF) or
            ((b[off + 1].toLong() and 0xFF) shl 8) or
            ((b[off + 2].toLong() and 0xFF) shl 16) or
            ((b[off + 3].toLong() and 0xFF) shl 24)

    @Test
    fun `payloads are concatenated in order and the header is kept once`() {
        val out = WavSegmentMerger.merge(listOf(wav(100, 1), wav(60, 2)))!!
        assertEquals("one header + both payloads", header + 160, out.size)
        assertEquals('R'.code.toByte(), out[0])
        // First segment's audio, then the second's — order matters or the
        // words come out reversed.
        assertEquals(1.toByte(), out[header])
        assertEquals(1.toByte(), out[header + 99])
        assertEquals(2.toByte(), out[header + 100])
        assertEquals(2.toByte(), out[out.size - 1])
    }

    @Test
    fun `RIFF and data sizes are patched to the merged length`() {
        val out = WavSegmentMerger.merge(listOf(wav(100, 1), wav(60, 2)))!!
        // A player that trusts these fields (every player does) would otherwise
        // stop after the first segment's worth of audio.
        assertEquals("data size", 160L, leU32(out, 40))
        assertEquals("RIFF size", (out.size - 8).toLong(), leU32(out, 4))
    }

    @Test
    fun `a single segment is returned untouched`() {
        val one = wav(80, 7)
        assertSame("no needless copy", one, WavSegmentMerger.merge(listOf(one)))
    }

    @Test
    fun `header-only and empty segments are skipped, not concatenated as garbage`() {
        val headerOnly = ByteArray(header)
        val real = wav(50, 9)
        val out = WavSegmentMerger.merge(listOf(headerOnly, real, ByteArray(0)))!!
        assertArrayEquals("only the real segment survives", real, out)
    }

    @Test
    fun `no usable input yields null rather than a zero-length wav`() {
        assertNull(WavSegmentMerger.merge(emptyList()))
        assertNull(WavSegmentMerger.merge(listOf(ByteArray(header), ByteArray(3))))
    }

    @Test
    fun `totalSeconds sums payloads across segments at 16k mono PCM16`() {
        // 16000 frames * 2 bytes = 1 s of audio.
        val oneSecond = wav(32_000, 0)
        assertEquals(1.0f, WavSegmentMerger.totalSeconds(listOf(oneSecond)), 0.001f)
        // The whole point of the accumulator: two sub-2s clips clear the bar.
        val short = wav(16_000, 0) // 0.5 s
        assertEquals(1.5f, WavSegmentMerger.totalSeconds(listOf(oneSecond, short)), 0.001f)
        assertEquals(0f, WavSegmentMerger.totalSeconds(emptyList()), 0.001f)
    }

    @Test
    fun `merged duration equals the sum of its parts`() {
        val a = wav(32_000, 1)
        val b = wav(16_000, 2)
        val merged = WavSegmentMerger.merge(listOf(a, b))!!
        assertEquals(
            WavSegmentMerger.totalSeconds(listOf(a, b)),
            WavSegmentMerger.totalSeconds(listOf(merged)),
            0.001f,
        )
    }
}
