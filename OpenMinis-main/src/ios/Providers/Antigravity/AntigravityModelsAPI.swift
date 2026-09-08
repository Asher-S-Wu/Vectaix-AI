import Foundation
import CryptoKit
import os.log

private let logger = AppLogger(category: "AntigravityModelsAPI")

enum AntigravityModelsAPI {

    /// Fetch available models from the Antigravity Cloud Code endpoint.
    /// Tries each base URL in fallback order.
    static func fetchModels(oauthToken: String, projectID: String, forceRefresh: Bool = false) async throws -> [LLMModel] {
        if !forceRefresh, let cached = AntigravityModelsCache.load(credential: oauthToken) {
            logger.info("Returning \(cached.count) cached Antigravity models")
            return cached
        }

        for baseURL in AntigravityOAuthManager.cloudCodeBaseURLs {
            do {
                let models = try await fetchFromEndpoint(baseURL: baseURL, token: oauthToken)
                if !models.isEmpty {
                    AntigravityModelsCache.save(models, credential: oauthToken)
                    return models
                }
            } catch {
                logger.warning("fetchAvailableModels failed for \(baseURL): \(error.localizedDescription)")
            }
        }

        // Empty response: return last-known-good or built-in list
        if let cached = AntigravityModelsCache.load(credential: oauthToken) {
            logger.info("All endpoints failed — returning last-known-good cache (\(cached.count) models)")
            return cached
        }
        logger.info("All endpoints failed — returning built-in Antigravity model list")
        return LLMModel.allAntigravity
    }

    /// Fetch models using built-in list (when no OAuth token or project is available yet).
    static func fetchModelsBuiltIn() -> [LLMModel] {
        LLMModel.allAntigravity
    }

    private static func fetchFromEndpoint(baseURL: String, token: String) async throws -> [LLMModel] {
        let urlString = URLBuilding.join(baseURL, "v1internal:fetchAvailableModels")
        var request = URLRequest(url: URL(string: urlString)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("antigravity/1.107.0 darwin/arm64", forHTTPHeaderField: "User-Agent")
        request.setValue("antigravity", forHTTPHeaderField: "X-Client-Name")
        request.setValue("1.107.0", forHTTPHeaderField: "X-Client-Version")
        request.setValue("gl-node/18.18.2 fire/0.8.6 grpc/1.10.x", forHTTPHeaderField: "x-goog-api-client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = "{}".data(using: .utf8)

        logger.info("POST \(urlString)")

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = response as? HTTPURLResponse
        let statusCode = http?.statusCode ?? -1
        let responseBody = String(data: data, encoding: .utf8) ?? "<binary>"

        logger.info("Response status: \(statusCode)")

        guard (200..<300).contains(statusCode) else {
            #if DEBUG
            logger.error("Antigravity models API error — status \(statusCode): \(responseBody.prefix(500))")
            #else
            logger.error("Antigravity models API error — status \(statusCode)")
            #endif
            if statusCode == 401 || statusCode == 403 {
                throw LLMError.invalidAPIKey(detail: "Antigravity HTTP \(statusCode): \(String(responseBody.prefix(200)))")
            }
            throw LLMError.providerError(message: "Failed to fetch Antigravity models (HTTP \(statusCode))")
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]

        // Response format: { "models": { "model-id": { "displayName": "...", "quotaInfo": {...} }, ... } }
        // Also handle array format as fallback: { "models": [ { "name": "model-id", ... } ] }
        let models: [LLMModel]
        if let modelsDict = json["models"] as? [String: Any] {
            models = modelsDict.compactMap { (modelId, value) -> LLMModel? in
                let info = value as? [String: Any]
                let displayName = info?["displayName"] as? String ?? modelId
                return LLMModel(id: modelId, displayName: displayName, provider: "Antigravity")
            }.sorted { $0.id < $1.id }
            logger.info("Fetched \(modelsDict.count) Antigravity models (dict format)")
        } else if let modelsArray = json["models"] as? [[String: Any]] {
            models = modelsArray.compactMap { item -> LLMModel? in
                guard let modelId = item["name"] as? String ?? item["modelId"] as? String else { return nil }
                let id = modelId.replacingOccurrences(of: "models/", with: "")
                let displayName = item["displayName"] as? String ?? id
                return LLMModel(id: id, displayName: displayName, provider: "Antigravity")
            }
            logger.info("Fetched \(modelsArray.count) Antigravity models (array format)")
        } else {
            logger.warning("No 'models' in response — keys: \(Array(json.keys).joined(separator: ", "))")
            return []
        }

        return ModelsDevAPI.enrichModels(models)
    }
}

// MARK: - Cache

private enum AntigravityModelsCache {

    private struct Entry: Codable {
        let models: [LLMModel]
        let date: Date
    }

    private static let ttl: TimeInterval = 7 * 24 * 3600

    private static var cacheDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("com.openminis.app.antigravity-models-cache", isDirectory: true)
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
