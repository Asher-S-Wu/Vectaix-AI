package com.openminis.app.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.core.graphics.drawable.toBitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import coil.ImageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.openminis.app.ui.DisplayBitmapLimits.limitDisplaySize
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * [T-android-canvas-large-bitmap-crash] On-device proof that the display cap
 * actually prevents the reported crash.
 *
 * Reproduces the exact failure from the vivo V2454DA / Android 16 report:
 * a 3000x17920 PNG, which decodes to 3000 * 17920 * 4 = 215,040,000 bytes —
 * byte-for-byte the size in the crash log — and which
 * `RecordingCanvas.throwIfCannotDraw` rejects.
 *
 * Two assertions, in order:
 *  1. WITHOUT the cap, Coil decodes the image large enough that drawing it into
 *     a hardware-backed recording canvas throws. This proves the repro is real
 *     and the test isn't vacuous.
 *  2. WITH the cap, the decoded bitmap is bounded and draws without throwing.
 */
@RunWith(AndroidJUnit4::class)
class DisplayBitmapLimitsInstrumentedTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var hugeImage: File

    /** Matches the crash report exactly: 3000 * 17920 * 4 = 215,040,000 bytes. */
    private val hugeWidth = 3000
    private val hugeHeight = 17920

    @Before
    fun setUp() {
        hugeImage = File(context.cacheDir, "canvas_limit_repro.png")
        if (hugeImage.exists()) return
        // Build the oversized PNG on-device. A flat bitmap this large would not
        // fit in memory as ARGB_8888, so draw it in horizontal bands into a
        // RGB_565 bitmap (2 bytes/px = 107MB) purely to produce the FILE; the
        // decode under test is what matters, and PNG has no config of its own.
        val src = Bitmap.createBitmap(hugeWidth, hugeHeight, Bitmap.Config.RGB_565)
        val canvas = Canvas(src)
        canvas.drawColor(android.graphics.Color.WHITE)
        val paint = android.graphics.Paint().apply {
            color = android.graphics.Color.rgb(30, 110, 220)
        }
        var y = 0
        while (y < hugeHeight) {
            canvas.drawRect(0f, y.toFloat(), hugeWidth.toFloat(), (y + 200).toFloat(), paint)
            y += 400
        }
        hugeImage.outputStream().use { src.compress(Bitmap.CompressFormat.PNG, 100, it) }
        src.recycle()
    }

    @After
    fun tearDown() {
        hugeImage.delete()
    }

    /**
     * Decode [file] through Coil, optionally applying the display cap, and
     * return the resulting bitmap.
     */
    private fun decode(file: File, capped: Boolean): Bitmap = runBlocking {
        val loader = ImageLoader.Builder(context).build()
        val request = ImageRequest.Builder(context)
            .data(file)
            // Software config so byteCount reflects the real allocation; a
            // HARDWARE bitmap reports differently and can't be inspected.
            .allowHardware(false)
            .apply {
                if (capped) {
                    limitDisplaySize()
                } else {
                    // Model the BUGGY production condition. The markdown image
                    // sits in a vertically-scrolling column, so its height
                    // constraint is Constraints.Infinity; with an unbounded
                    // dimension Coil resolves the request to the image's
                    // INTRINSIC size. `Size.ORIGINAL` is that same resolution.
                    // Without this the bare execute() would apply Coil's own
                    // view-less default (screen-sized) and silently downsample,
                    // making the "uncapped" arm vacuous.
                    size(coil.size.Size.ORIGINAL)
                }
            }
            .build()
        val result = loader.execute(request)
        assertTrue("Coil failed to decode the repro image", result is SuccessResult)
        (result as SuccessResult).drawable.toBitmap()
    }

    /**
     * Draw [bitmap] into a recording canvas, the same class of canvas that
     * threw in the crash report. Returns true if the draw succeeded.
     */
    private fun drawsWithoutThrowing(bitmap: Bitmap): Boolean = try {
        // Must be a RenderNode's hardware RecordingCanvas — that is the class
        // that threw in the report (RecordingCanvas.throwIfCannotDraw, reached
        // from View.draw → ThreadedRenderer.draw). A software canvas (Picture,
        // or a Canvas over a Bitmap) has a far higher ceiling and would draw
        // the 215MB bitmap happily, making this check vacuous.
        val node = android.graphics.RenderNode("displayCapTest")
        val canvas = node.beginRecording(1080, 2400)
        try {
            canvas.drawBitmap(bitmap, 0f, 0f, null)
        } finally {
            node.endRecording()
        }
        true
    } catch (t: Throwable) {
        false
    }

    @Test
    fun uncappedDecodeProducesABitmapTooLargeToDraw() {
        val bitmap = decode(hugeImage, capped = false)
        // The whole premise of the fix: unbounded, this image decodes far past
        // the canvas ceiling. If this ever stops being true the repro has
        // drifted and the capped assertion below would prove nothing.
        assertTrue(
            "uncapped decode was only ${bitmap.width}x${bitmap.height} " +
                "(${bitmap.byteCount} bytes) — expected it to exceed the display cap",
            maxOf(bitmap.width, bitmap.height) > DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX,
        )
        // And it is genuinely undrawable — this is the actual crash from the
        // report, reproduced.
        assertTrue(
            "uncapped bitmap (${bitmap.byteCount} bytes) unexpectedly drew fine; " +
                "the repro no longer reproduces the reported crash",
            !drawsWithoutThrowing(bitmap),
        )
    }

    @Test
    fun cappedDecodeStaysWithinTheDisplayCeilingAndDraws() {
        val bitmap = decode(hugeImage, capped = true)
        assertTrue(
            "capped decode was ${bitmap.width}x${bitmap.height}, expected longest edge " +
                "<= ${DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX}",
            maxOf(bitmap.width, bitmap.height) <= DisplayBitmapLimits.MAX_DISPLAY_EDGE_PX,
        )
        assertTrue(
            "capped bitmap (${bitmap.byteCount} bytes) still could not be drawn",
            drawsWithoutThrowing(bitmap),
        )
    }
}
