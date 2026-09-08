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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [T-android-silent-stream-drop] Proves the precondition the ChatViewModel fix
 * relies on: when an SSE stream delivers content and then ends WITHOUT a
 * `[DONE]` sentinel — a server-side truncation / dropped connection — the
 * provider emits NO Finished chunk, so the turn's stopReason stays null.
 *
 * That null is what runAgentLoop now treats as an interrupted reply. Before the
 * fix it was folded into `finishedCleanly`, so a partial reply was persisted as
 * if complete: the "断流" reports.
 */
class StreamDropNoFinishTest {

    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer(); server.start() }
    @After fun tearDown() { server.shutdown() }

    private fun streamChunks(body: String): List<LLMStreamChunk> {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody(body),
        )
        val provider = OpenAIProvider(
            apiKey = "test-key",
            model = LLMModel.gpt4oMini,
            basePath = server.url("/v1").toString().trimEnd('/'),
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

    @Test
    fun `stream truncated before DONE yields content but no Finished chunk`() {
        // Content arrives, then the stream just ends — no finish_reason, no [DONE].
        val body = """
            data: {"choices":[{"delta":{"content":"partial reply "},"index":0}]}

            data: {"choices":[{"delta":{"content":"that got cut"},"index":0}]}

        """.trimIndent() + "\n"

        val chunks = streamChunks(body)
        val text = chunks.filterIsInstance<LLMStreamChunk.Text>().joinToString("") { it.text }
        assertTrue("content should have arrived, got '$text'", text.isNotEmpty())

        val finished = chunks.filterIsInstance<LLMStreamChunk.Finished>().firstOrNull()
        assertNull(
            "a truncated stream must NOT report a finish reason — that null is the signal",
            finished?.stopReason,
        )
    }

    @Test
    fun `a normally terminated stream does report a finish reason`() {
        // Control: the same content, properly terminated.
        val body = """
            data: {"choices":[{"delta":{"content":"complete reply"},"index":0}]}

            data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}

            data: [DONE]

        """.trimIndent() + "\n"

        val chunks = streamChunks(body)
        val finished = chunks.filterIsInstance<LLMStreamChunk.Finished>().firstOrNull()
        assertTrue(
            "a clean stream must carry a concrete stopReason, got ${finished?.stopReason}",
            finished?.stopReason == "stop",
        )
    }
}
