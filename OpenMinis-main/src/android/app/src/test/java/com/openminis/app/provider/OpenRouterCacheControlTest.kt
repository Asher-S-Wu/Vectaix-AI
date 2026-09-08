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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [OpenMinis#191] OpenRouter does not enable Anthropic prompt caching on its
 * own — Claude requests must carry an explicit `cache_control` breakpoint or
 * nothing is cached at all (reporter measured a 3-6x cost overrun with
 * cache_read/cache_write pinned at 0). Parity with iOS 2304af4a.
 *
 * The production gate is `isOpenRouter && model.id.startsWith("anthropic/")`,
 * and `isOpenRouter` is `basePath.contains("openrouter.ai")` — so pointing
 * MockWebServer at a path containing that literal exercises the REAL predicate
 * without a key or network, the same idiom MistralReasoningFieldTest uses.
 *
 * Both halves of the gate are tested from both sides, because the failure mode
 * of a too-broad gate is silent: sending `cache_control` to a non-Anthropic
 * model changes a request body that is supposed to stay byte-identical.
 */
class OpenRouterCacheControlTest {

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

    private fun model(id: String) =
        LLMModel(id = id, displayName = id, provider = "OpenRouter")

    private fun capture(basePath: String, model: LLMModel): JSONObject {
        // Enqueue several identical responses: the provider may retry, and a
        // drained queue surfaces as a confusing "empty response" TransientError
        // instead of the assertion we care about. Only the FIRST request is read.
        val ok =
            """{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}"""
        repeat(4) {
            server.enqueue(
                MockResponse().setHeader("Content-Type", "application/json").setBody(ok),
            )
        }
        val provider = OpenAIProvider(apiKey = "test-key", model = model, basePath = basePath)
        runCatching {
            runBlocking {
                provider.sendMessageClamped(
                    messages = listOf(LLMMessage(LLMMessage.Role.USER, "hi")),
                    systemPrompt = null,
                    maxTokens = 1024,
                    temperature = null,
                    imageParts = emptyList(),
                    tools = emptyList(),
                    thinkingLevel = ThinkingLevel.OFF,
                )
            }
        }
        return JSONObject(server.takeRequest().body.readUtf8())
    }

    private fun openRouter() = server.url("/openrouter.ai/api/v1").toString().trimEnd('/')

    // -- The fix ---------------------------------------------------------------

    @Test
    fun `claude on openrouter carries the ephemeral cache_control breakpoint`() {
        val body = capture(openRouter(), model("anthropic/claude-sonnet-4.5"))
        assertTrue(
            "Claude on OpenRouter must opt into prompt caching (GH#191): $body",
            body.has("cache_control"),
        )
        // The TOP-LEVEL automatic form: the breakpoint advances to the last
        // cacheable block by itself as the conversation grows. The per-block
        // form would require hand-managing a 4-breakpoint budget.
        assertEquals("ephemeral", body.getJSONObject("cache_control").getString("type"))
    }

    // -- Gate half 1: the model must be Anthropic ------------------------------

    @Test
    fun `non-anthropic models on openrouter keep a byte-identical body`() {
        // The control from the iOS verification: gpt-4o-mini on the SAME
        // OpenRouter instance must not grow the field. OpenAI/Grok/Moonshot/Groq
        // models on OpenRouter already cache with no opt-in.
        val body = capture(openRouter(), model("openai/gpt-4o-mini"))
        assertFalse(
            "cache_control must not leak onto non-Anthropic OpenRouter models: $body",
            body.has("cache_control"),
        )
    }

    // -- Gate half 2: the host must be OpenRouter ------------------------------

    @Test
    fun `anthropic-prefixed model off openrouter does not get the field`() {
        // Anthropic's own Messages API is a different provider class entirely,
        // and an OpenAI-compatible relay that is not OpenRouter has not been
        // verified to pass the field through. Fails safe: unchanged request.
        val body = capture(
            server.url("/api.example-relay.com/v1").toString().trimEnd('/'),
            model("anthropic/claude-sonnet-4.5"),
        )
        assertFalse(
            "cache_control is scoped to the OpenRouter host: $body",
            body.has("cache_control"),
        )
    }

    @Test
    fun `mistral does not receive cache_control`() {
        // Regression guard for the specific trap iOS called out: on iOS the
        // natural-looking gate (`useOpenRouterCompat`) is NOT "this is
        // OpenRouter" — Mistral sets it too, so keying on it would have leaked
        // the field into Mistral requests. Android's gate is host-matched, and
        // this pins that it stays that way.
        val body = capture(
            server.url("/mistral.ai/v1").toString().trimEnd('/'),
            model("mistral-large-latest"),
        )
        assertFalse("Mistral must never receive cache_control: $body", body.has("cache_control"))
    }

    // -- Case-insensitivity ----------------------------------------------------

    @Test
    fun `an uppercase anthropic prefix still opts in`() {
        // Model ids arrive from user config and catalogs; the prefix check is
        // lowercased in production, so a differently-cased id must not silently
        // lose caching.
        val body = capture(openRouter(), model("Anthropic/Claude-Sonnet-4.5"))
        assertTrue(
            "prefix match must be case-insensitive: $body",
            body.has("cache_control"),
        )
    }
}
