package com.openminis.app.ui

import coil.request.ImageRequest
import coil.size.Precision

/**
 * [T-android-canvas-large-bitmap-crash] Decode-size ceiling for images we hand
 * to Compose / Canvas for DISPLAY.
 *
 * Background: a markdown attachment (`telecom_whole_market.png`, a very tall
 * chart) crashed on a vivo V2454DA / Android 16 with
 *
 *     java.lang.RuntimeException: Canvas: trying to draw too large(215040000bytes) bitmap
 *       at android.graphics.RecordingCanvas.throwIfCannotDraw
 *
 * 215,040,000 bytes / 4 (ARGB_8888) = 53.76 Mpx — e.g. a ~3000x17920 chart.
 * `RecordingCanvas` refuses any bitmap above roughly 100MB (the exact ceiling
 * tracks the GPU's max texture dimension), so the draw throws and takes the
 * process down from `ThreadedRenderer.draw`.
 *
 * Why it got that big: the markdown image renderer used
 * `SubcomposeAsyncImage(model = file, contentScale = ContentScale.FillWidth)`
 * with NO `ImageRequest` size. Coil sizes a request from the layout
 * constraints, but the markdown column is vertically scrollable, so the height
 * constraint is `Constraints.Infinity`. With an unbounded dimension Coil falls
 * back to the image's INTRINSIC size and decodes the PNG at full resolution.
 * A wide-but-short image survives that (width is bounded); a very tall one does
 * not.
 *
 * The fix caps the decode instead of scaling after the fact: capping at the
 * `ImageRequest` level means the giant bitmap is never allocated, which also
 * removes the OOM risk that a decode-then-downscale approach would keep.
 *
 * This is a DISPLAY-side guard only. It is unrelated to
 * [com.openminis.app.provider.ImageBudget], which caps bytes sent to LLM
 * providers on the network path.
 */
object DisplayBitmapLimits {

    /**
     * Longest-edge ceiling, in pixels, for a bitmap decoded for on-screen
     * display.
     *
     * 4096 is the max texture dimension essentially every GPU in our install
     * base supports, so a bitmap within this bound is always drawable. The
     * worst case it admits is 4096x4096 ARGB_8888 = 64MB, comfortably under
     * the ~100MB `RecordingCanvas` ceiling. It is also far above any phone or
     * tablet viewport, so a fullscreen/zoomed viewer still has ample detail to
     * pan around in.
     */
    const val MAX_DISPLAY_EDGE_PX = 4096

    /**
     * Apply the display decode ceiling to an [ImageRequest.Builder].
     *
     * Uses `Precision.INEXACT` so Coil is free to honour the ceiling by
     * downsampling to the nearest power-of-two sample size rather than
     * producing an exactly-sized bitmap — cheaper, and we only care about the
     * upper bound, not an exact pixel count.
     *
     * Coil scales DOWN to fit this bound and never scales up, so normal-sized
     * images (the overwhelming majority) decode exactly as they did before and
     * their rendering is unchanged. Only images that would otherwise exceed the
     * ceiling are affected.
     */
    fun ImageRequest.Builder.limitDisplaySize(): ImageRequest.Builder =
        size(MAX_DISPLAY_EDGE_PX, MAX_DISPLAY_EDGE_PX)
            .precision(Precision.INEXACT)
}
