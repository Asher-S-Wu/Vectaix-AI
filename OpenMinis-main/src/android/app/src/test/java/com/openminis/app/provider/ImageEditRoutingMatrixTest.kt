package com.openminis.app.provider

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [T-android-image-edit-endpoint] Decision-table coverage for which
 * minis-model-use calls reach /images/edits after image editing was wired up.
 *
 * `ModelUseOffloadHandler.tryImageGenerationRoute` is private and needs a live
 * handler (ProviderRepository, PRootKernel, real HTTP) to invoke, so this
 * mirrors its gate conditions in [route] — transcribed line-for-line from the
 * function — and pins the full forward/reverse matrix. It guards the routing
 * CONTRACT: if someone reorders or relaxes a guard in the handler without
 * updating this table, the intent captured here is the thing to check against.
 * Transport itself is covered for real (MockWebServer) in OpenAIEditImageTest.
 */
class ImageEditRoutingMatrixTest {

    private enum class Route {
        /** Images API, text-to-image. */
        GENERATE,

        /** Images API, image-to-image (the newly added path). */
        EDIT,

        /** Declines the images route → caller falls through to chat completions. */
        CHAT_FALLTHROUGH,
    }

    /**
     * Transcription of the handler's gate, in the same order:
     *   1. image output modality + OpenAI-compatible provider object
     *   2. providerType ∈ {openAI, openRouter, xAI}
     *   3. credential != oauth
     *   4. input images on a NON-pure generator → decline to chat
     *   5. otherwise: images route, edits when input images are present
     */
    private fun route(
        outputs: Set<String>,
        isOpenAICompatibleProvider: Boolean,
        providerType: String,
        isOAuth: Boolean,
        inputImageCount: Int,
    ): Route {
        val wantsImageOutput = "image" in outputs
        if (!wantsImageOutput || !isOpenAICompatibleProvider) return Route.CHAT_FALLTHROUGH
        if (providerType !in setOf("openAI", "openRouter", "xAI")) return Route.CHAT_FALLTHROUGH
        if (isOAuth) return Route.CHAT_FALLTHROUGH

        val isPureImageGenerator = "image" in outputs && "text" !in outputs
        if (inputImageCount > 0 && !isPureImageGenerator) return Route.CHAT_FALLTHROUGH

        return if (inputImageCount > 0) Route.EDIT else Route.GENERATE
    }

    private fun route(
        outputs: Set<String>,
        inputImageCount: Int,
        isOpenAICompatibleProvider: Boolean = true,
        providerType: String = "openAI",
        isOAuth: Boolean = false,
    ) = route(outputs, isOpenAICompatibleProvider, providerType, isOAuth, inputImageCount)

    // ── Forward: the bug being fixed ─────────────────────────────────────────

    @Test
    fun `pure image generator with one reference image routes to edits`() {
        // This exact combination previously returned image_edit_not_supported.
        assertEquals(Route.EDIT, route(outputs = setOf("image"), inputImageCount = 1))
    }

    @Test
    fun `pure image generator with multiple reference images routes to edits`() {
        assertEquals(Route.EDIT, route(outputs = setOf("image"), inputImageCount = 3))
    }

    @Test
    fun `openRouter and xAI image instances also reach edits`() {
        for (pt in listOf("openRouter", "xAI")) {
            assertEquals(
                "providerType=$pt should reach edits",
                Route.EDIT,
                route(outputs = setOf("image"), inputImageCount = 1, providerType = pt),
            )
        }
    }

    // ── Reverse: previously-working behavior must be untouched ───────────────

    @Test
    fun `pure image generator without reference images still routes to generations`() {
        assertEquals(Route.GENERATE, route(outputs = setOf("image"), inputImageCount = 0))
    }

    @Test
    fun `mixed text and image model with reference image falls through to chat`() {
        // Must NOT be taken over by the new edit path — chat forwards the image
        // to the model, which is the right channel for a model that talks back.
        assertEquals(
            Route.CHAT_FALLTHROUGH,
            route(outputs = setOf("text", "image"), inputImageCount = 1),
        )
    }

    @Test
    fun `mixed text and image model without reference image still uses images route`() {
        assertEquals(
            Route.GENERATE,
            route(outputs = setOf("text", "image"), inputImageCount = 0),
        )
    }

    @Test
    fun `text-only model with reference image is untouched by the image route`() {
        // e.g. GPT-5.5 as the catalog actually declares it: output = [text].
        assertEquals(Route.CHAT_FALLTHROUGH, route(outputs = setOf("text"), inputImageCount = 1))
    }

    @Test
    fun `oauth instance with reference image never reaches edits`() {
        // Codex OAuth tokens lack the images scope — routing them at /images/edits
        // would 401. The OAuth guard must still short-circuit first.
        assertEquals(
            Route.CHAT_FALLTHROUGH,
            route(outputs = setOf("image"), inputImageCount = 1, isOAuth = true),
        )
    }

    @Test
    fun `non openai-compatible provider with reference image is unaffected`() {
        assertEquals(
            Route.CHAT_FALLTHROUGH,
            route(
                outputs = setOf("image"),
                inputImageCount = 1,
                isOpenAICompatibleProvider = false,
            ),
        )
        // Also covers an OpenAI-shaped provider object on a non-allowlisted type.
        assertEquals(
            Route.CHAT_FALLTHROUGH,
            route(outputs = setOf("image"), inputImageCount = 1, providerType = "anthropic"),
        )
    }
}
