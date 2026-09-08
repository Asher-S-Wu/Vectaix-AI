package com.openminis.app.provider

import com.openminis.app.data.model.LLMMessage
import com.openminis.app.data.model.LLMModel
import com.openminis.app.provider.openai.OpenAIProvider
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [T-android-responses-toplevel-images] Regression tests for images passed as
 * the TOP-LEVEL `imageParts` argument on the Responses API path.
 *
 * The bug: `buildResponsesAPIBody` had no `imageParts` parameter at all, so
 * every caller that supplies images that way — `minis-model-use` (`image_url`
 * blocks) and `VisionGroupResolver.describeOnce` — had the pixels dropped with
 * no error the moment the provider used `useResponsesAPI`. The reported symptom
 * was a vision model replying "no image was provided" while the UI happily
 * showed the thumbnail.
 *
 * These assert the WIRE BODY, because the wire body is what was wrong. A test
 * that only checked "the call succeeded" would have passed against the bug.
 */
class ResponsesTopLevelImageTest {

    private lateinit var server: MockWebServer

    /** 1x1 PNG-ish bytes; content is irrelevant, presence on the wire is not. */
    private val pixels = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        // Minimal well-formed Responses SSE so the call completes.
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody(
                    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n" +
                        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",
                ),
        )
    }

    @After
    fun tearDown() = server.shutdown()

    private fun visionModel() = LLMModel(
        id = "gpt-5.6-luna",
        displayName = "Vision Model",
        provider = "OpenAI",
        inputModalities = listOf("text", "image"),
    )

    private fun textOnlyModel() = LLMModel(
        id = "text-only-model",
        displayName = "Text Only",
        provider = "OpenAI",
        inputModalities = listOf("text"),
    )

    private fun responsesProvider(model: LLMModel) = OpenAIProvider(
        apiKey = "test-key",
        model = model,
        basePath = server.url("/").toString().trimEnd('/'),
        useResponsesAPI = true,
    )

    /** Run one request and return the JSON body that actually went out. */
    private fun capturedBody(
        model: LLMModel,
        images: List<LLMMessage.ImagePart>,
        text: String = "describe this image",
    ): JSONObject {
        val provider = responsesProvider(model)
        runBlocking {
            provider.sendMessage(
                messages = listOf(LLMMessage(LLMMessage.Role.USER, text)),
                systemPrompt = null,
                maxTokens = 256,
                imageParts = images,
            )
        }
        return JSONObject(server.takeRequest().body.readUtf8())
    }

    /** All content blocks of the last `input` item, flattened. */
    private fun lastInputContent(body: JSONObject): JSONArray {
        val input = body.optJSONArray("input")
        assertNotNull("request has no `input` array: $body", input)
        val last = input!!.getJSONObject(input.length() - 1)
        val content = last.opt("content")
        assertTrue(
            "expected the user turn's content to be a structured array, was: $content",
            content is JSONArray,
        )
        return content as JSONArray
    }

    private fun blocksOfType(content: JSONArray, type: String): List<JSONObject> =
        (0 until content.length())
            .map { content.getJSONObject(it) }
            .filter { it.optString("type") == type }

    // ---- the reported bug -------------------------------------------------

    @Test
    fun `top-level image reaches the wire as input_image`() {
        val body = capturedBody(
            visionModel(),
            listOf(LLMMessage.ImagePart(data = pixels, mimeType = "image/png")),
        )
        val images = blocksOfType(lastInputContent(body), "input_image")
        assertEquals("exactly one input_image block expected. body=$body", 1, images.size)
        val url = images[0].optString("image_url")
        assertTrue(
            "Responses API wants image_url as a bare data: STRING, got: $url",
            url.startsWith("data:image/"),
        )
        assertTrue("image payload is missing its base64 body", url.contains(";base64,"))
    }

    @Test
    fun `the prompt text still rides along with the image`() {
        // The original bug shipped text-only; asserting the image alone would
        // not catch a fix that dropped the instruction instead.
        val content = lastInputContent(
            capturedBody(
                visionModel(),
                listOf(LLMMessage.ImagePart(data = pixels, mimeType = "image/png")),
                text = "transcribe the table",
            ),
        )
        val texts = blocksOfType(content, "input_text")
        assertEquals(1, texts.size)
        assertEquals("transcribe the table", texts[0].optString("text"))
    }

    @Test
    fun `multiple top-level images all survive`() {
        val body = capturedBody(
            visionModel(),
            listOf(
                LLMMessage.ImagePart(data = pixels, mimeType = "image/png"),
                LLMMessage.ImagePart(data = pixels, mimeType = "image/jpeg"),
            ),
        )
        assertEquals(2, blocksOfType(lastInputContent(body), "input_image").size)
    }

    // ---- controls ---------------------------------------------------------

    @Test
    fun `a non-vision model gets the placeholder, never raw pixels`() {
        val body = capturedBody(
            textOnlyModel(),
            listOf(
                LLMMessage.ImagePart(
                    data = pixels,
                    mimeType = "image/png",
                    noVisionPlaceholder = "[Image attached: /tmp/x.png — call read_image]",
                ),
            ),
        )
        val content = lastInputContent(body)
        assertEquals(
            "a text-only model must not receive input_image blocks",
            0,
            blocksOfType(content, "input_image").size,
        )
        val texts = blocksOfType(content, "input_text").map { it.optString("text") }
        assertTrue(
            "the Vision-Group placeholder should be forwarded verbatim, got: $texts",
            texts.any { it.contains("call read_image") },
        )
    }

    @Test
    fun `no images means the body shape is unchanged`() {
        // Guards the common path: adding image support must not restructure
        // ordinary text-only requests.
        val body = capturedBody(visionModel(), emptyList(), text = "plain question")
        val input = body.optJSONArray("input")!!
        val last = input.getJSONObject(input.length() - 1)
        assertEquals(
            "a text-only turn should stay a plain string content",
            "plain question",
            last.optString("content"),
        )
    }
}
