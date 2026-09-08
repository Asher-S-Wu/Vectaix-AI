import Foundation
import CryptoKit
import os.log

private let logger = AppLogger(category: "AnthropicModelsAPI")

private func stripV1Suffix(_ base: String) -> String {
    var s = base
    while s.hasSuffix("/") { s = String(s.dropLast()) }
    if s.hasSuffix("/v1") { s = String(s.dropLast(3)) }
    return s
}

enum AnthropicModelsAPI {

    static func fetchModels(apiKey: String, baseURL: String? = nil, appendV1Suffix: Bool = true, forceRefresh: Bool = false, userAgent: String? = nil) async throws -> [LLMModel] {
        try await fetchWithFallback(credential: apiKey, baseURL: baseURL, appendV1Suffix: appendV1Suffix, forceRefresh: forceRefresh) { request in
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            if let ua = userAgent { request.setValue(ua, forHTTPHeaderField: "User-Agent") }
        }
    }

    /// Fetch models using a plain Bearer token (no Anthropic OAuth beta header).
    /// Used for manual OAuth tokens on proxy/third-party endpoints.
    /// Sends both `Authorization: Bearer` and `x-api-key` for maximum compatibility.
    static func fetchModels(bearerToken: String, baseURL: String? = nil, appendV1Suffix: Bool = true, forceRefresh: Bool = false, userAgent: String? = nil) async throws -> [LLMModel] {
        try await fetchWithFallback(credential: bearerToken, baseURL: baseURL, appendV1Suffix: appendV1Suffix, forceRefresh: forceRefresh) { request in
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
            request.setValue(bearerToken, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            if let ua = userAgent { request.setValue(ua, forHTTPHeaderField: "User-Agent") }
        }
    }

    static func fetchModels(oauthToken: String, baseURL: String? = nil, appendV1Suffix: Bool = true, forceRefresh: Bool = false) async throws -> [LLMModel] {
        try await fetchWithFallback(credential: oauthToken, baseURL: baseURL, appendV1Suffix: appendV1Suffix, forceRefresh: forceRefresh) { request in
            request.setValue("Bearer \(oauthToken)", forHTTPHeaderField: "Authorization")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        }
    }

    /// Try `{base}/v1/models`; on failure, climb the URL path one segment at a
    /// time (up to 3 levels) and retry. Lets users enter vendor-specific bases
    /// like `https://api.deepseek.com/anthropic` and still discover the
    /// `/v1/models` endpoint at `https://api.deepseek.com`.
    private static func fetchWithFallback(
        credential: String,
        baseURL: String?,
        appendV1Suffix: Bool,
        forceRefresh: Bool,
        applyAuth: (inout URLRequest) -> Void
    ) async throws -> [LLMModel] {
        if !forceRefresh, let cached = ModelsCache.load(credential: credential) { return cached }

        let initialBase = appendV1Suffix
            ? stripV1Suffix(baseURL ?? "https://api.anthropic.com")
            : (baseURL ?? "https://api.anthropic.com")
        let v1Path = appendV1Suffix ? "/v1" : ""

        var bases = [initialBase]
        var current = initialBase
        for _ in 0..<3 {
            guard let parent = parentPath(of: current), parent != current else { break }
            bases.append(parent)
            current = parent
        }

        var lastError: Error?
        for (idx, base) in bases.enumerated() {
            guard let url = URL(string: URLBuilding.join(base, v1Path, "/models?limit=512")) else { continue }
            var request = URLRequest(url: url)
            applyAuth(&request)
            do {
                let models = try await performFetch(request)
                ModelsCache.save(models, credential: credential)
                if idx > 0 {
                    logger.info("Models fetched via fallback base: \(base)")
                }
                return models
            } catch {
                lastError = error
                logger.info("Models fetch failed at base \(base): \(error.localizedDescription)")
            }
        }
        throw lastError ?? LLMError.providerError(message: "Failed to fetch models")
    }

    /// Returns the parent of `base` by stripping the last non-host path
    /// segment. Returns nil once only the scheme+host remains (no further
    /// climbing possible).
    private static func parentPath(of base: String) -> String? {
        guard var components = URLComponents(string: base) else { return nil }
        var path = components.path
        while path.hasSuffix("/") { path = String(path.dropLast()) }
        guard let slash = path.lastIndex(of: "/") else { return nil }
        let trimmed = String(path[..<slash])
        if trimmed.isEmpty, components.path.isEmpty { return nil }
        components.path = trimmed
        return components.string
    }

    private static func performFetch(_ request: URLRequest) async throws -> [LLMModel] {
        let (data, response) = try await URLSession.shared.data(for: request)

        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            let truncated = body.count <= 50 ? body : "\(body.prefix(20))...\(body.suffix(20))"
            throw LLMError.providerError(message: "Failed to fetch models (\(statusCode)): \(truncated)")
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        guard let dataArray = json["data"] as? [[String: Any]] else {
            throw LLMError.decodingError(underlying: NSError(domain: "ModelsAPI", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Missing data array"]))
        }

        if let first = dataArray.first,
           let debugData = try? JSONSerialization.data(withJSONObject: first, options: [.prettyPrinted, .sortedKeys]),
           let debugStr = String(data: debugData, encoding: .utf8) {
            logger.info("First model raw JSON:\n\(debugStr)")
        }

        let raw = dataArray.compactMap { item -> LLMModel? in
            guard let id = item["id"] as? String else { return nil }
            // Anthropic format uses "display_name"; OpenAI-compatible proxies use "id" only
            let displayName = (item["display_name"] as? String) ?? modelDisplayName(from: id)
            return LLMModel(id: id, displayName: displayName, provider: "Anthropic")
        }
        return ModelsDevAPI.enrichModels(raw)
    }
}

// MARK: - Models Cache

private enum ModelsCache {

    private struct Entry: Codable {
        let models: [LLMModel]
        let date: Date
    }

    /// Cache validity: 7 days.
    private static let ttl: TimeInterval = 7 * 24 * 3600

    private static var cacheDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("com.openminis.app.models-cache", isDirectory: true)
    }

    /// SHA-256 hash of the credential — irreversible.
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
