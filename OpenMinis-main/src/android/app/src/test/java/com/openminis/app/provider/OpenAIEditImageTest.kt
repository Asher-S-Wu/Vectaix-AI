package com.openminis.app.provider

import com.openminis.app.data.model.LLMError
import com.openminis.app.data.model.LLMMessage
import com.openminis.app.data.model.LLMModel
import com.openminis.app.provider.openai.OpenAIProvider
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [T-android-image-edit-endpoint] Wire-level coverage for the /images/edits
 * (image-to-image) route added to close the Android gap that made
 * minis-model-use return `image_edit_not_supported`.
 *
 * These assert the multipart body we actually put on the wire — the part most
 * likely to be subtly wrong (field names, file parts, response_format retry) —
 * plus response parsing reuse. MockWebServer means no real API spend.
 */
class OpenAIEditImageTest {
    private lateinit var server: MockWebServer
    private lateinit var provider: OpenAIProvider

    /** 1x1 PNG-ish bytes; content is irrelevant, only transport matters here. */
    private val pngBytes = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    private val jpgBytes = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())

    private fun imagePart(data: ByteArray, mime: String) =
        LLMMessage.ImagePart(data = data, mimeType = mime)

    /**
     * Minimal success envelope — same shape /images/generations returns.
     *
     * Deliberately an EMPTY `data` array rather than a `b64_json` item: these
     * are plain JVM tests with `unitTests.isReturnDefaultValues = true`, so
     * `android.util.Base64.decode` returns null and the shared
     * parseImageGenerationsResult NPEs while decoding. That limitation belongs
     * to the (already shipped, unchanged) parse path — which generateImage
     * exercises identically — not to the /images/edits transport under test
     * here. These tests therefore assert on the multipart REQUEST we emit,
     * which is the actual new code; decoding is covered on-device.
     */
    private fun imageResponseBody(): String = """{"data":[]}"""

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        provider = OpenAIProvider(
            apiKey = "test-key",
            model = LLMModel.gpt4oMini,
            basePath = server.url("/").toString().trimEnd('/'),
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    // ── Forward: single reference image ──────────────────────────────────────

    @Test
    fun `editImage posts multipart to images-edits with image and prompt`() = runBlocking {
        server.enqueue(MockResponse().setBody(imageResponseBody()))

        val response = provider.editImage(
            prompt = "make it a white studio backdrop",
            images = listOf(imagePart(pngBytes, "image/png")),
        )

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertTrue(
            "should hit /images/edits, got ${recorded.path}",
            recorded.path!!.endsWith("/images/edits"),
        )
        val contentType = recorded.getHeader("Content-Type") ?: ""
        assertTrue("expected multipart, got $contentType", contentType.startsWith("multipart/form-data"))

        val body = recorded.body.readUtf8()
        // The reference image must be a FILE part named exactly `image`.
        assertTrue(
            "missing `image` file part: $body",
            body.contains("""name="image"""") && body.contains("filename="),
        )
        assertTrue("prompt not forwarded", body.contains("make it a white studio backdrop"))
        assertTrue("model not forwarded", body.contains(LLMModel.gpt4oMini.id))
        assertTrue("n not forwarded", body.contains("""name="n""""))

        // Parsing is the shared /images/generations path (unchanged); just
        // confirm we got a well-formed response object back through it.
        assertEquals(0, response.mediaAttachments.size)
    }

    @Test
    fun `editImage sends b64_json response_format by default`() = runBlocking {
        server.enqueue(MockResponse().setBody(imageResponseBody()))
        provider.editImage("p", listOf(imagePart(pngBytes, "image/png")))
        val body = server.takeRequest().body.readUtf8()
        assertTrue("expected b64_json response_format", body.contains("b64_json"))
    }

    // ── Forward: multiple reference images ───────────────────────────────────

    @Test
    fun `editImage sends extra images as image array parts, dropping none`() = runBlocking {
        server.enqueue(MockResponse().setBody(imageResponseBody()))

        provider.editImage(
            prompt = "blend these",
            images = listOf(
                imagePart(pngBytes, "image/png"),
                imagePart(jpgBytes, "image/jpeg"),
                imagePart(pngBytes, "image/png"),
            ),
        )

        val body = server.takeRequest().body.readUtf8()
        // First → `image`, extras → `image[]` (iOS field naming).
        assertTrue("first image should use name=\"image\"", body.contains("""name="image""""))
        val extraParts = Regex("""name="image\[\]"""").findAll(body).count()
        assertEquals("both extra images must be sent, none dropped", 2, extraParts)
        // Per-image mime must survive so the server can decode each part.
        assertTrue("jpeg mime lost", body.contains("image/jpeg"))
        assertTrue("png mime lost", body.contains("image/png"))
        // Filenames carry the extension derived from the mime type.
        assertTrue("expected image0.png filename", body.contains("image0.png"))
        assertTrue("expected image1.jpeg filename", body.contains("image1.jpeg"))
    }

    // ── Reverse / robustness ─────────────────────────────────────────────────

    @Test
    fun `editImage retries without response_format when provider rejects b64_json`() = runBlocking {
        // First attempt 400s complaining about response_format; retry must drop it.
        server.enqueue(
            MockResponse().setResponseCode(400)
                .setBody("""{"error":{"message":"response_format is not supported"}}"""),
        )
        server.enqueue(MockResponse().setBody(imageResponseBody()))

        val response = provider.editImage("p", listOf(imagePart(pngBytes, "image/png")))

        assertEquals(2, server.requestCount)
        val first = server.takeRequest().body.readUtf8()
        val second = server.takeRequest().body.readUtf8()
        assertTrue("first attempt should carry b64_json", first.contains("b64_json"))
        assertFalse("retry must NOT carry response_format", second.contains("response_format"))
        assertEquals(0, response.mediaAttachments.size)
    }

    @Test
    fun `editImage rejects an empty image list instead of posting`() = runBlocking {
        val error = runCatching {
            provider.editImage("p", emptyList())
        }.exceptionOrNull()

        assertTrue(
            "expected a ProviderError, got $error",
            error is LLMError.ProviderError,
        )
        // Must fail before any network call — no wasted request/credits.
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `editImage surfaces HTTP errors rather than returning empty media`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(401)
                .setBody("""{"error":{"message":"Missing scopes"}}"""),
        )

        val error = runCatching {
            provider.editImage("p", listOf(imagePart(pngBytes, "image/png")))
        }.exceptionOrNull()

        assertTrue("expected an error to propagate, got $error", error != null)
    }

    @Test
    fun `editImage does not hit the generations endpoint`() = runBlocking {
        server.enqueue(MockResponse().setBody(imageResponseBody()))
        provider.editImage("p", listOf(imagePart(pngBytes, "image/png")))
        val path = server.takeRequest().path ?: ""
        assertFalse("must not route to /images/generations", path.contains("generations"))
    }
}
