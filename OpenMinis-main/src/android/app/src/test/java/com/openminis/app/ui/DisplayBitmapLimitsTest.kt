package com.openminis.app.ui

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-canvas-large-bitmap-crash] Guards the arithmetic behind
 * [DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX].
 *
 * These are pure-JVM assertions about the ceiling itself. Whether Coil honours
 * the request size needs a real decode, so the end-to-end proof is the manual
 * repro described in the commit message — but the invariant that MUST hold for
 * the fix to work at all (a bitmap at the ceiling is still drawable by
 * RecordingCanvas) is checkable here, and would catch someone later raising the
 * constant past the safe bound.
 */
class DisplayBitmapLimitsTest {

    /** Bytes per pixel for ARGB_8888, the config Coil decodes to by default. */
    private val bytesPerPixel = 4L

    /**
     * RecordingCanvas.throwIfCannotDraw rejects bitmaps above ~100MB. Stay
     * meaningfully under it so the guard holds even on a device whose ceiling
     * is a little tighter than the common case.
     */
    private val canvasCeilingBytes = 100L * 1024 * 1024

    @Test
    fun `a square bitmap at the ceiling stays under the canvas limit`() {
        val edge = DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX.toLong()
        val worstCaseBytes = edge * edge * bytesPerPixel
        assertTrue(
            "worst-case bitmap is $worstCaseBytes bytes, canvas ceiling is $canvasCeilingBytes",
            worstCaseBytes < canvasCeilingBytes,
        )
    }

    @Test
    fun `the ceiling is within the universally supported max texture dimension`() {
        // 4096 is the max texture dimension effectively every GPU in the
        // install base supports. Above it, a bitmap can be under the byte
        // ceiling yet still be undrawable on some devices.
        assertTrue(DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX <= 4096)
    }

    @Test
    fun `the crashing bitmap from the report would be rejected by the ceiling`() {
        // The vivo V2454DA crash: 215,040,000 bytes = 53.76 Mpx, e.g. 3000x17920.
        val crashWidth = 3000
        val crashHeight = 17920
        assertTrue(
            "the reported image must exceed the ceiling, else the guard is a no-op for it",
            maxOf(crashWidth, crashHeight) > DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX,
        )

        // After the cap, the longest edge is clamped to the ceiling and the
        // short edge scales proportionally — verify the result is drawable.
        val scale = DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX.toDouble() / crashHeight
        val cappedW = (crashWidth * scale).toLong().coerceAtLeast(1)
        val cappedH = DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX.toLong()
        val cappedBytes = cappedW * cappedH * bytesPerPixel
        assertTrue(
            "capped bitmap is $cappedBytes bytes (${cappedW}x$cappedH)",
            cappedBytes < canvasCeilingBytes,
        )
    }

    @Test
    fun `an image already under the ceiling is unaffected`() {
        // A typical matplotlib chart — well under the bound, so the cap must
        // not change how it renders.
        val w = 1600
        val h = 1200
        assertTrue(maxOf(w, h) <= DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX)
    }
}
