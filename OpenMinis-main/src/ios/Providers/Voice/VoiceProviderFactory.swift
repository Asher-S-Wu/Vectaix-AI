import Foundation

// MARK: - VoiceProviderFactory
//
// Maps a configured ProviderInstance to a concrete VoiceProvider. Because
// Minis has no dedicated "voice provider type", vendors that ride on top of an
// OpenAI/Anthropic-compatible instance (Groq, MiniMax, Doubao, Xunfei, Alibaba)
// are detected from the instance's custom base URL.
//
// Returns nil when the instance cannot serve voice (e.g. native Gemini).
//
// Doubao / iFlytek need more than one credential (appId, and apiSecret for
// iFlytek). Rather than extend the Keychain schema, the user enters them as a
// ";"-joined compound string in the single API-key field ("appId;accessKey" /
// "appId;apiKey;apiSecret"); `splitCompound` unpacks it here. The Add-Provider
// Voice templates prefill the base URL and document the expected format.

enum VoiceProviderFactory {

    private static let logger = AppLogger(category: "VoiceFactory")

    /// Build a VoiceProvider from a configured instance, loading the API key
    /// from the Keychain. `MainActor` because it reads ProviderConfigStore.
    @MainActor
    static func make(for instance: ProviderInstance) -> (any VoiceProviderCapable)? {
        // Built-in System engine: a single factory entry point for both cloud
        // providers and the offline System provider (Phase B). Recognised by the
        // synthetic instance's sentinel id, so it works whether callers pass the
        // synthetic instance or one resolved via ProviderConfigStore.instance(for:).
        if instance.id == SystemVoiceProvider.builtinProviderId {
            return SystemVoiceProvider.shared
        }

        let apiKey = ProviderKeychainHelper.loadAPIKey(instanceId: instance.id, caller: "VoiceFactory")
        let custom = instance.effectiveCustomBaseURL
        let normalizedBase = (custom ?? "").lowercased()

        switch instance.providerType {

        // OpenAI-compatible families ---------------------------------------
        case .openAI, .openAIResponses:
            if normalizedBase.contains("groq.com") {
                return GroqVoiceProvider(providerId: instance.id,
                                         baseURL: custom ?? "https://api.groq.com/openai",
                                         apiKey: apiKey)
            }
            if normalizedBase.contains("dashscope") {
                return AlibabaVoiceProvider(providerId: instance.id,
                                            baseURL: custom ?? "https://dashscope.aliyuncs.com/compatible-mode",
                                            apiKey: apiKey)
            }
            if normalizedBase.contains("minimax") {
                return MiniMaxVoiceProvider(providerId: instance.id,
                                            baseURL: custom ?? "https://api.minimax.io",
                                            apiKey: apiKey)
            }
            // Doubao / Volcano v3: single API Key (new console).
            if normalizedBase.contains("openspeech.bytedance") || normalizedBase.contains("volcano") {
                logger.info("Doubao voice provider: base=\(normalizedBase) keyLen=\(apiKey?.count ?? -1)")
                return DoubaoVoiceProvider(providerId: instance.id, apiKey: apiKey)
            }
            // iFlytek / Xunfei: the API-key field carries "appId;apiKey;apiSecret".
            if normalizedBase.contains("xfyun") {
                let p = Self.splitCompound(apiKey)
                guard p.count >= 3 else { return nil }
                return XunfeiVoiceProvider(providerId: instance.id, appId: p[0], apiKey: p[1], apiSecret: p[2])
            }
            if normalizedBase.contains("xiaomimimo") {
                return MimoVoiceProvider(providerId: instance.id,
                                         baseURL: custom ?? "https://api.xiaomimimo.com",
                                         apiKey: apiKey)
            }
            if normalizedBase.contains("elevenlabs") {
                return ElevenLabsVoiceProvider(providerId: instance.id,
                                               baseURL: custom ?? "https://api.elevenlabs.io",
                                               apiKey: apiKey)
            }
            if normalizedBase.contains("tts.speech.microsoft.com") {
                // Strip /cognitiveservices if the user included it — the provider
                // appends it in the endpoint path (/cognitiveservices/v1).
                var azureBase = custom ?? "https://eastasia.tts.speech.microsoft.com"
                if azureBase.hasSuffix("/cognitiveservices") {
                    azureBase = String(azureBase.dropLast("/cognitiveservices".count))
                }
                return AzureTTSVoiceProvider(providerId: instance.id,
                                              baseURL: azureBase,
                                              apiKey: apiKey)
            }
            if normalizedBase.contains("deepgram") {
                return DeepgramVoiceProvider(providerId: instance.id,
                                             baseURL: custom ?? "https://api.deepgram.com",
                                             apiKey: apiKey)
            }
            return VoiceProvider(providerId: instance.id,
                                 baseURL: custom ?? "https://api.openai.com",
                                 apiKey: apiKey)

        // xAI Grok ---------------------------------------------------------
        case .xAI:
            return XAIVoiceProvider(providerId: instance.id,
                                    baseURL: custom ?? "https://api.x.ai",
                                    apiKey: apiKey)

        // OpenRouter. TTS goes through chat.completions + audio modality, NOT
        // /v1/audio/speech — that endpoint does not exist there and 400s for
        // every model id. ASR still uses the inherited OpenAI-compatible path.
        case .openRouter:
            return OpenRouterVoiceProvider(providerId: instance.id,
                                           baseURL: custom ?? "https://openrouter.ai/api",
                                           apiKey: apiKey)

        // Anthropic — only MiniMax-behind-Anthropic-base serves voice ------
        case .anthropic:
            if normalizedBase.contains("minimax") {
                return MiniMaxVoiceProvider(providerId: instance.id,
                                            baseURL: custom ?? "https://api.minimax.io",
                                            apiKey: apiKey)
            }
            return nil

        // Native Gemini TTS (generateContent + AUDIO modality, ?key= auth).
        case .gemini:
            return GeminiVoiceProvider(
                providerId: instance.id,
                baseURL: custom ?? "https://generativelanguage.googleapis.com/v1beta",
                apiKey: apiKey)

        // Antigravity has no OpenAI-compatible voice path; unsupported = synced
        // from a newer build this version can't service.
        case .antigravity, .kimiCode, .unsupported:
            return nil
        }
    }

    /// The always-available offline provider.
    static func systemProvider() -> SystemVoiceProvider { .shared }

    /// Split a compound credential ("appId;key" / "appId;key;secret") that some
    /// voice vendors require but the single-field Keychain stores as one string.
    /// Tolerates surrounding whitespace and drops empty segments.
    private static func splitCompound(_ value: String?) -> [String] {
        guard let value, !value.isEmpty else { return [] }
        return value
            .split(separator: ";", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
