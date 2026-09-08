package com.openminis.app.provider

import com.openminis.app.data.model.LLMMessage
import com.openminis.app.data.model.LLMModel
import com.openminis.app.data.model.LLMStreamChunk
import com.openminis.app.data.model.ThinkingLevel
import com.openminis.app.provider.openai.OpenAIProvider
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [T-android-responses-missing-finished] The Responses API terminates a stream
 * with `response.completed` and, on many relays, no `data: [DONE]` sentinel
 * afterwards — the socket just closes.
 *
 * Finished used to be emitted ONLY from the [DONE] branch, so those streams
 * produced no terminal chunk at all. ChatViewModel.runAgentLoop assigns
 * turnFinishReason exclusively from Finished, so it stayed null and a complete
 * reply was surfaced as "连接中断，此回复可能不完整".
 *
 * The distinction these tests pin down is the whole fix: a stream that SAW a
 * finish reason must report one even without [DONE], while a stream that never
 * saw one must still report nothing — that null is how a real truncation is
 * detected ([T-android-silent-stream-drop], see StreamDropNoFinishTest).
 */
class ResponsesApiFinishedTest {

    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer(); server.start() }
    @After fun tearDown() { server.shutdown() }

    /** Streams against a provider configured for /v1/responses. */
    private fun responsesChunks(body: String): List<LLMStreamChunk> {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody(body),
        )
        val provider = OpenAIProvider(
            apiKey = "test-key",
            model = LLMModel.gpt4oMini,
            basePath = server.url("/v1").toString().trimEnd('/'),
            useResponsesAPI = true,
        )
        return runBlocking {
            provider.streamMessageClamped(
                messages = listOf(LLMMessage(LLMMessage.Role.USER, "hi")),
                systemPrompt = null,
                maxTokens = 256,
                temperature = null,
                imageParts = emptyList(),
                tools = emptyList(),
                thinkingLevel = ThinkingLevel.OFF,
            ).toList()
        }
    }

    // ── The regression ───────────────────────────────────────────────────

    @Test
    fun `response completed without DONE still emits Finished`() {
        // Exactly what the failing relays send: deltas, response.completed,
        // then the socket closes. No [DONE] ever arrives.
        val body = """
            data: {"type":"response.output_text.delta","delta":"complete reply"}

            data: {"type":"response.completed","response":{"status":"completed"}}

        """.trimIndent() + "\n"

        val chunks = responsesChunks(body)

        val text = chunks.filterIsInstance<LLMStreamChunk.Text>().joinToString("") { it.text }
        assertEquals("complete reply", text)

        val finished = chunks.filterIsInstance<LLMStreamChunk.Finished>().firstOrNull()
        assertEquals(
            "response.completed must yield stopReason=stop even without a [DONE] sentinel — " +
                "a null here is what produced the bogus 'interrupted reply' banner",
            "stop",
            finished?.stopReason,
        )
    }

    @Test
    fun `response completed with DONE emits exactly one Finished`() {
        // Relays that DO append [DONE] must not now get two terminal chunks:
        // a duplicate would make the agent loop see a second, spurious turn end.
        val body = """
            data: {"type":"response.output_text.delta","delta":"complete reply"}

            data: {"type":"response.completed","response":{"status":"completed"}}

            data: [DONE]

        """.trimIndent() + "\n"

        val chunks = responsesChunks(body)
        val finished = chunks.filterIsInstance<LLMStreamChunk.Finished>()
        assertEquals("expected exactly one Finished chunk, got ${finished.size}", 1, finished.size)
        assertEquals("stop", finished.first().stopReason)
    }

    @Test
    fun `tool calls yield tool_use rather than stop`() {
        // A turn that emitted function calls completes with status=completed but
        // must surface tool_use, or the agent loop would end the turn instead of
        // dispatching the calls.
        val body = """
            data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"shell_execute","arguments":"{}"}}

            data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call"}]}}

        """.trimIndent() + "\n"

        val chunks = responsesChunks(body)
        val finished = chunks.filterIsInstance<LLMStreamChunk.Finished>().firstOrNull()
        assertEquals("tool_use", finished?.stopReason)
    }

    // ── The behaviour that must NOT regress ──────────────────────────────

    @Test
    fun `truncated responses stream still reports no finish reason`() {
        // Deltas then silence — a genuine drop, with no response.completed.
        // This must keep producing a null stopReason, because that null is the
        // only signal the interrupted-reply UI has.
        val body = """
            data: {"type":"response.output_text.delta","delta":"partial reply "}

            data: {"type":"response.output_text.delta","delta":"that got cut"}

        """.trimIndent() + "\n"

        val chunks = responsesChunks(body)

        val text = chunks.filterIsInstance<LLMStreamChunk.Text>().joinToString("") { it.text }
        assertTrue("content should have arrived, got '$text'", text.isNotEmpty())

        val finished = chunks.filterIsInstance<LLMStreamChunk.Finished>().firstOrNull()
        assertNull(
            "a truncated stream must still NOT report a finish reason",
            finished?.stopReason,
        )
    }
}
