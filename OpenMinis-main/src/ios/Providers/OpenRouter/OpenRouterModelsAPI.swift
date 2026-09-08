import Foundation
import CryptoKit
import os.log

private let logger = AppLogger(category: "OpenRouterModelsAPI")

enum OpenRouterModelsAPI {

    private static let baseURL = "https://openrouter.ai/api/v1"

    static func fetchModels(apiKey: String, forceRefresh: Bool = false) async throws -> [LLMModel] {
        if !forceRefresh, let cached = OpenRouterModelsCache.load(credential: apiKey) {
            logger.info("Returning \(cached.count) cached OpenRouter models")
            return cached
        }

        var request = URLRequest(url: URL(string: URLBuilding.join(baseURL, "/models"))!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("https://github.com/OpenMinis/OpenMinis", forHTTPHeaderField: "HTTP-Referer")
        request.setValue("Minis App", forHTTPHeaderField: "X-Title")
        logger.info("Fetching OpenRouter models")

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = response as? HTTPURLResponse
        let statusCode = http?.statusCode ?? -1

        guard (200..<300).contains(statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            logger.error("OpenRouter models API error — status \(statusCode)")
            if statusCode == 401 || statusCode == 403 {
                throw LLMError.invalidAPIKey(detail: "OpenRouter HTTP \(statusCode): \(String(body.prefix(200)))")
            }
            throw LLMError.providerError(message: "Failed to fetch OpenRouter models (HTTP \(statusCode)): \(body.prefix(500))")
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        guard let modelsArray = json["data"] as? [[String: Any]] else {
            throw LLMError.decodingError(underlying: NSError(domain: "OpenRouterModelsAPI", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Missing data array in response"]))
        }

        let models = modelsArray.compactMap { item -> LLMModel? in
            guard let id = item["id"] as? String else { return nil }

            let displayName = (item["name"] as? String) ?? modelDisplayName(from: id)

            // Parse modalities from architecture if available. OpenRouter returns
            // suffixed forms (`image_input`, `text_output`); models.dev returns bare
            // forms. Normalize before matching so both shapes resolve to the same
            // ModelModality bits.
            var modality: ModelModality = [.textInput, .textOutput]
            if let arch = item["architecture"] as? [String: Any] {
                if let inputs = arch["input_modalities"] as? [String] {
                    let bare = Set(inputs.map(Self.normalizeModality))
                    if bare.contains("image") { modality.insert(.imageInput) }
                    if bare.contains("pdf")   { modality.insert(.pdfInput) }
                    if bare.contains("audio") { modality.insert(.audioInput) }
                    if bare.contains("video") { modality.insert(.videoInput) }
                }
                if let outputs = arch["output_modalities"] as? [String] {
                    let bare = Set(outputs.map(Self.normalizeModality))
                    if bare.contains("image") { modality.insert(.imageOutput) }
                    if bare.contains("audio") { modality.insert(.audioOutput) }
                    if bare.contains("video") { modality.insert(.videoOutput) }
                }
            }
            let modalityOverride: ModelModality? = modality == [.textInput, .textOutput] ? nil : modality

            // Context window and max output tokens
            let contextWindow = item["context_length"] as? Int
            var maxOutputTokens: Int? = nil
            if let topProvider = item["top_provider"] as? [String: Any] {
                maxOutputTokens = topProvider["max_completion_tokens"] as? Int
            }

            // Reasoning support: check if "reasoning" is in supported_parameters
            var supportsReasoning: Bool? = nil
            if let params = item["supported_parameters"] as? [String] {
                supportsReasoning = params.contains("reasoning")
            }

            return LLMModel(
                id: id, displayName: displayName, provider: "OpenRouter",
                modalityOverride: modalityOverride,
                contextWindow: contextWindow,
                maxOutputTokens: maxOutputTokens,
                supportsReasoning: supportsReasoning
            )
        }

        let enriched = ModelsDevAPI.enrichModels(models)
        logger.info("Fetched \(modelsArray.count) total OpenRouter models, \(enriched.count) returned")
        OpenRouterModelsCache.save(enriched, credential: apiKey)
        return enriched
    }

    /// Strip `_input` / `_output` suffix and lowercase. Provider APIs are inconsistent —
    /// OpenRouter returns `image_input` / `text_output` while models.dev returns bare
    /// `image` / `text`. Mirrors Android's `String.normalizeModalityName`.
    static func normalizeModality(_ raw: String) -> String {
        var s = raw.lowercased()
        if s.hasSuffix("_input") { s = String(s.dropLast("_input".count)) }
        if s.hasSuffix("_output") { s = String(s.dropLast("_output".count)) }
        return s
    }
}

// MARK: - Cache

private enum OpenRouterModelsCache {

    private struct Entry: Codable {
        let models: [LLMModel]
        let date: Date
    }

    private static let ttl: TimeInterval = 7 * 24 * 3600

    private static var cacheDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("com.openminis.app.openrouter-models-cache", isDirectory: true)
    }

    private static func cacheKey(for credential: String) -> String {
        let digest = SHA256.hash(data: Data(credential.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func cacheFile(for credential: String) -> URL {
        cacheDir.appendingPathComponent(cacheKey(for: credential) + ".json")
    }

    static func load(credential: String) -> [LLMModel]? {
        let file = cacheFile(for: credential)
        guard let data = try? Data(contentsOf: file),
              let entry = try? JSONDecoder().decode(Entry.self, from: data),
              Date().timeIntervalSince(entry.date) < ttl else {
            return nil
        }
        return entry.models
    }

    static func save(_ models: [LLMModel], credential: String) {
        let entry = Entry(models: models, date: Date())
        guard let data = try? JSONEncoder().encode(entry) else { return }
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        try? data.write(to: cacheFile(for: credential), options: .atomic)
    }
}
