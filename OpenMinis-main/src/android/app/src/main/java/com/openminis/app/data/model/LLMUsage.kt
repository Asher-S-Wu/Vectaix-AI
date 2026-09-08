package com.openminis.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class LLMUsage(
    val inputTokens: Int,
    val outputTokens: Int,
    val cacheCreationInputTokens: Int? = null,
    val cacheReadInputTokens: Int? = null,
    /**
     * The total input token count reported by the API for this call.
     * Represents how much of the context window has been consumed.
     * Used by dynamicMaxTokens() to compute remaining space.
     * Mirrors iOS's latestContextTokens.
     */
    val latestContextTokens: Int = 0,
)
