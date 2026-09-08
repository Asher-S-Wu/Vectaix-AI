package com.openminis.app.data.model

/**
 * T-ctxslider 54ab8e93: heuristic context-window inference used by the
 * model-group "Limit Context Window" slider when a member's
 * `LLMModel.contextWindow` field is missing or non-positive.
 *
 * IMPORTANT: this is intentionally NOT folded into [LLMModel.contextWindowTokens]
 * — that getter is read by the agent loop / token accounting paths and we
 * don't want to silently overwrite source-of-truth metadata. This helper is
 * used ONLY when computing the slider's "Unlimited" ceiling so that a group
 * whose members lack contextWindow metadata still gets a reasonable cap
 * instead of degrading to the 64K floor.
 */
internal fun inferContextWindowTokens(model: LLMModel): Int {
    model.contextWindow?.takeIf { it > 0 }?.let { return it }
    val idLower = model.id.lowercase()

    // 1M-class models — match before the generic claude-* / gemini-* fall-throughs.
    val millionClassPatterns = listOf(
        Regex("claude-.*-1m"),
        Regex("claude-opus-4-[5678]"),
        Regex("claude-sonnet-4-[567]"),
    )
    if (millionClassPatterns.any { it.containsMatchIn(idLower) }) return 1_000_000
    if (idLower.contains("gemini-2.5-pro") ||
        idLower.contains("gemini-2.0-pro") ||
        idLower.contains("gemini-1.5-pro") ||
        idLower.contains("gemini-2.5-flash") ||
        idLower.contains("gemini-3-pro") ||
        idLower.contains("gemini-3-flash")
    ) return 1_000_000

    if (idLower.startsWith("claude-") || idLower.contains("/claude-")) return 200_000

    if (idLower.startsWith("gpt-4o") || idLower.contains("/gpt-4o")) return 128_000
    if (idLower.startsWith("gpt-4-turbo") || idLower.contains("/gpt-4-turbo")) return 128_000
    if (idLower.startsWith("gpt-5") || idLower.contains("/gpt-5")) return 128_000

    if (idLower.startsWith("gpt-4") || idLower.contains("/gpt-4")) return 16_000
    if (idLower.startsWith("gpt-3.5") || idLower.contains("/gpt-3.5")) return 16_000

    if (idLower.startsWith("deepseek-") || idLower.contains("/deepseek-")) return 128_000

    return 128_000
}
