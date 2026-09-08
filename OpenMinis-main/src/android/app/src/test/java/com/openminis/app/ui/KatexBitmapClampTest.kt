package com.openminis.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [GH#206] The clamp arithmetic used by both KaTeX snapshot sites.
 *
 * The production sites allocate a real Bitmap, which needs an Android runtime,
 * so this pins the SIZING DECISION — the part that actually caused the leak.
 * Before the fix there was no upper bound at all: `pxW = cssPx * density` went
 * straight into `Bitmap.createBitmap`, so a wide display formula on a
 * density-2.75 device could ask for a bitmap approaching the 8192 px layout
 * viewport, i.e. ~5 MB of NATIVE heap for ONE formula.
 *
 * Kept as a local copy of the formula rather than exposing the production
 * constants: the point is to state the intended contract independently, so a
 * change to the production numbers has to be a deliberate edit here too.
 */
class KatexBitmapClampTest {

    private val maxEdge = 2048
    private val maxPixels = 4_000_000

    /** Mirrors the production clamp in KatexWebViewPool.snapshot / KaTeXView. */
    private fun clamp(rawW: Int, rawH: Int): Pair<Int, Int> {
        val edgeScale = minOf(
            1f,
            maxEdge.toFloat() / rawW,
            maxEdge.toFloat() / rawH,
        )
        val pixelScale = if (rawW.toLong() * rawH > maxPixels) {
            kotlin.math.sqrt(maxPixels.toDouble() / (rawW.toDouble() * rawH)).toFloat()
        } else {
            1f
        }
        val scale = minOf(edgeScale, pixelScale)
        return Pair(
            (rawW * scale).toInt().coerceAtLeast(1),
            (rawH * scale).toInt().coerceAtLeast(1),
        )
    }

    private fun bytes(wh: Pair<Int, Int>) = wh.first.toLong() * wh.second * 4

    @Test
    fun `ordinary inline formula is untouched`() {
        // The common case must not lose any sharpness: a normal inline formula
        // is far below every ceiling, so the clamp has to be a no-op.
        val raw = 550 to 165
        assertEquals(raw, clamp(raw.first, raw.second))
    }

    @Test
    fun `the reported wide display formula is clamped, not clipped`() {
        // The shape from the KatexWebViewPool comment: a formula laid out near
        // the 8192 px viewport. Pre-fix this allocated ~5 MB for one formula.
        val (w, h) = clamp(8000, 165)
        assertTrue("width must respect the edge cap, got $w", w <= maxEdge)
        // Aspect ratio preserved => the whole formula is still captured, just
        // smaller. Clipping would have kept h at 165 while cutting w.
        val ratioBefore = 8000.0 / 165.0
        val ratioAfter = w.toDouble() / h
        assertTrue(
            "aspect ratio must be preserved (before=$ratioBefore after=$ratioAfter)",
            kotlin.math.abs(ratioBefore - ratioAfter) / ratioBefore < 0.02,
        )
        assertTrue("must actually shrink: was ${8000L * 165 * 4}B, now ${bytes(w to h)}B",
            bytes(w to h) < 8000L * 165 * 4)
    }

    @Test
    fun `a large square formula is bounded by total pixels, not just edges`() {
        // Both edges under the edge cap but the AREA is 4.2M px — the edge cap
        // alone would let this through at ~16.8 MB. The pixel cap is what stops
        // it, which is why both ceilings exist.
        val raw = 2047 to 2047
        assertTrue("edge cap alone would not fire here", raw.first <= maxEdge && raw.second <= maxEdge)
        val clamped = clamp(raw.first, raw.second)
        assertTrue(
            "total pixels must respect the cap, got ${clamped.first.toLong() * clamped.second}",
            clamped.first.toLong() * clamped.second <= maxPixels,
        )
    }

    @Test
    fun `no clamped bitmap can exceed the byte ceiling`() {
        // The property that matters for GH#206: whatever KaTeX measures, a
        // single formula can never again cost an unbounded amount of native
        // heap. 4M px x 4B = 16 MB is the hard worst case.
        val pathological = listOf(
            8192 to 8192, 8192 to 100, 100 to 8192, 3000 to 3000, 5000 to 1200,
        )
        for ((w, h) in pathological) {
            val clamped = clamp(w, h)
            assertTrue("edge exceeded for ${w}x$h -> $clamped", clamped.first <= maxEdge && clamped.second <= maxEdge)
            assertTrue(
                "byte ceiling exceeded for ${w}x$h -> $clamped = ${bytes(clamped)}B",
                bytes(clamped) <= maxPixels.toLong() * 4,
            )
        }
    }

    @Test
    fun `clamping never produces a zero dimension`() {
        // An extremely thin, extremely wide formula scales the short edge
        // toward zero; createBitmap(0, ..) throws, so the floor is load-bearing.
        val (w, h) = clamp(8192, 1)
        assertTrue("width must stay positive, got $w", w >= 1)
        assertTrue("height must stay positive, got $h", h >= 1)
    }
}
