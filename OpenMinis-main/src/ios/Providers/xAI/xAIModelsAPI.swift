import Foundation

/// Built-in xAI Grok model catalog. The xAI API is OpenAI-compatible, so these
/// models flow through `OpenAIProvider` with a custom base URL + OAuth bearer.
enum XAIModelsAPI {
    // Catalog ordering = default-pick order. `grok-4.3` is xAI's current
    // flagship and stays on top.
    static let allModels: [LLMModel] = [
        // Official xAI catalog (docs.x.ai/docs/models) — synced from CLIProxyAPI models.json
        LLMModel(id: "grok-4.5", displayName: "Grok 4.5", provider: "xAI"),
        LLMModel(id: "grok-4.3", displayName: "Grok 4.3", provider: "xAI"),
        LLMModel(id: "grok-4.20-0309-reasoning", displayName: "Grok 4.20 Reasoning", provider: "xAI"),
        LLMModel(id: "grok-4.20-0309-non-reasoning", displayName: "Grok 4.20", provider: "xAI"),
        LLMModel(id: "grok-4.20-multi-agent-0309", displayName: "Grok 4.20 Multi-Agent", provider: "xAI"),
        LLMModel(id: "grok-build-0.1", displayName: "Grok Build 0.1", provider: "xAI"),
        LLMModel(id: "grok-3-mini", displayName: "Grok 3 Mini", provider: "xAI"),
        LLMModel(id: "grok-3-mini-fast", displayName: "Grok 3 Mini Fast", provider: "xAI"),
        LLMModel(id: "grok-composer-2.5-fast", displayName: "Grok Composer 2.5 Fast", provider: "xAI"),
        // High-frequency fast / code variants surfaced by OpenClaw's catalog.
        LLMModel(id: "grok-4-fast", displayName: "Grok 4 Fast", provider: "xAI"),
        LLMModel(id: "grok-4-fast-non-reasoning", displayName: "Grok 4 Fast (Non-Reasoning)", provider: "xAI"),
        LLMModel(id: "grok-code-fast-1", displayName: "Grok Code Fast 1", provider: "xAI"),
    ]
}
