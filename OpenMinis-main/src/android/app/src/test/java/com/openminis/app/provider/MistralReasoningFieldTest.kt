package com.openminis.app.provider

import com.openminis.app.data.model.LLMMessage
import com.openminis.app.data.model.LLMModel
import com.openminis.app.data.model.ThinkingLevel
import com.openminis.app.provider.openai.OpenAIProvider
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [T-android-mistral-reasoning-422] GH OpenMinis#87 / iOS 29065ca0.
 *
 * Mistral's AssistantMessage is a CLOSED schema (additionalProperties:false),
 * so any prior assistant turn carrying `reasoning_content` is rejected with
 * HTTP 422 `extra_forbidden` — every turn of a conversation whose history
 * holds reasoning from an earlier model fails outright.
 *
 * The gate cannot be capability-driven: MiMo/DeepSeek REQUIRE the field's
 * presence on multi-turn history while Mistral FORBIDS it, and neither
 * advertises supportsReasoning. Hence the base-URL vendor flag under test.
 *
 * `isMistral` is `basePath.contains("mistral.ai")`, so pointing MockWebServer
 * at a path containing that literal exercises the real production predicate
 * without needing a Mistral key or network access.
 */
class MistralReasoningFieldTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    /** A reasoning-capable model, so the echo gate would otherwise be ON. */
    private val reasoningModel = LLMModel(
        id = "mistral-large-latest",
        displayName = "Mistral Large",
        provider = "CPA",
        supportsReasoning = true,
    )

    /** History with a prior assistant turn that captured reasoning — the 422 trigger. */
    private fun historyWithReasoning(): List<LLMMessage> = listOf(
        LLMMessage(LLMMessage.Role.USER, "first question"),
        LLMMessage(
            LLMMessage.Role.ASSISTANT,
            "first answer",
        ).copy(reasoningContent = "some captured chain of thought"),
        LLMMessage(LLMMessage.Role.USER, "second question"),
    )

    private fun capture(basePath: String): JSONObject {
        // Enqueue several identical responses: the provider may retry, and a
        // drained queue surfaces as a confusing "empty response" TransientError
        // rather than the assertion we actually care about. We only ever read
        // the FIRST recorded request below.
        val ok = """{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}"""
        repeat(4) {
            server.enqueue(
                MockResponse()
                    .setHeader("Content-Type", "application/json")
                    .setBody(ok),
            )
        }
        val provider = OpenAIProvider(
            apiKey = "test-key",
            model = reasoningModel,
            basePath = basePath,
        )
        runCatching { runBlocking {
            provider.sendMessageClamped(
                messages = historyWithReasoning(),
                systemPrompt = null,
                maxTokens = 1024,
                temperature = null,
                imageParts = emptyList(),
                tools = emptyList(),
                thinkingLevel = ThinkingLevel.MEDIUM,
            )
        } }
        return JSONObject(server.takeRequest().body.readUtf8())
    }

    private fun anyMessageHasReasoning(body: JSONObject): Boolean {
        val msgs = body.getJSONArray("messages")
        for (i in 0 until msgs.length()) {
            if (msgs.getJSONObject(i).has("reasoning_content")) return true
        }
        return false
    }

    @Test
    fun `mistral endpoint never sends reasoning_content`() {
        val body = capture(server.url("/mistral.ai/v1").toString().trimEnd('/'))
        assertFalse(
            "reasoning_content must not be sent to Mistral (422 extra_forbidden): $body",
            anyMessageHasReasoning(body),
        )
    }

    @Test
    fun `mistral detection is case-insensitive`() {
        // Hosts are case-insensitive and iOS lowercases before the same
        // contains() test; an uppercased URL must not slip past the guard.
        val body = capture(server.url("/API.MISTRAL.AI/v1").toString().trimEnd('/'))
        assertFalse(
            "uppercase mistral.ai must still suppress reasoning_content: $body",
            anyMessageHasReasoning(body),
        )
    }

    @Test
    fun `non-mistral endpoint still echoes reasoning_content`() {
        // Negative control: the suppression must be scoped to Mistral only.
        // MiMo / DeepSeek return 400 when multi-turn history LACKS this field,
        // so over-broad suppression would break them.
        val body = capture(server.url("/v1").toString().trimEnd('/'))
        assertTrue(
            "reasoning_content should still be echoed for non-Mistral vendors: $body",
            anyMessageHasReasoning(body),
        )
    }
}
