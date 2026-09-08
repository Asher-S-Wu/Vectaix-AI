package com.openminis.app.data.model

import org.json.JSONObject

sealed class LLMStreamChunk {
    data object Started : LLMStreamChunk()
    data class Text(val text: String) : LLMStreamChunk()
    data class Usage(val usage: LLMUsage) : LLMStreamChunk()
    data class Finished(val stopReason: String?) : LLMStreamChunk()

    /** Thinking/reasoning streaming event */
    data class ThinkingDelta(val text: String) : LLMStreamChunk()

    /** Opaque accumulated reasoning content (DeepSeek/Kimi/QwQ `reasoning_content` field).
     *  Unlike ThinkingDelta (real-time increments), this is the full accumulated blob
     *  echoed back on subsequent turns to preserve the model's chain of thought. */
    data class ReasoningContent(val content: String) : LLMStreamChunk()

    /** Tool use streaming events */
    data class ToolUseStart(val id: String, val name: String) : LLMStreamChunk()
    data class ToolInputDelta(val id: String, val accumulated: String) : LLMStreamChunk()
    data class ToolCallComplete(
        val id: String,
        val name: String,
        val args: JSONObject,
        // [T-android-gemini3-thoughtsig / #179] Gemini 3.x returns a
        // `thoughtSignature` on each functionCall part; it MUST be replayed on
        // the historical functionCall or the next request 400s. Null for every
        // other provider (only Gemini populates it).
        val thoughtSignature: String? = null,
    ) : LLMStreamChunk()

    /**
     * [T-codex-gpt-image2-oauth-android] A model-generated media attachment
     * (e.g. an image from the Codex image_generation tool). Carried through the
     * stream so non-streaming callers (sendMessage → minis-model-use) can
     * collect it into LLMResponse.mediaAttachments. Image-output models are
     * one-shot, so this typically arrives once near the end of the stream.
     */
    data class MediaAttachment(val attachment: LLMMediaAttachment) : LLMStreamChunk()
}
