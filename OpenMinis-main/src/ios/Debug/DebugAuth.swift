#if DEBUG
import CryptoKit
import Foundation
import UIKit

/// Token + encrypted-envelope authentication for the debug server (protocol v1).
///
/// Wire spec, rationale, and cross-language test vectors live in
/// `.claude/skills/debug-server/SKILL.md`. Summary:
///  - `/pair` grants a 32-byte token K after on-device user approval.
///    Mode B ("plain": true) returns K in the clear and is accepted only from
///    127.0.0.1 (USB/iproxy). Mode A wraps K via ephemeral X25519 for LAN use.
///  - `/rpc` carries an encrypted envelope: HMAC-SHA256-CTR stream cipher +
///    encrypt-then-MAC, per-request random nonce, ±120s timestamp window,
///    nonce replay LRU. Responses are encrypted with a separate direction key.
///  - Token expiry is idle-based: 30 days since last successful use.
final class DebugAuthenticator: @unchecked Sendable {

    static let shared = DebugAuthenticator()

    private let logger = AppLogger(category: "DebugAuth")
    private let lock = NSLock()

    struct AuthFailure: Error {
        let code: String
        let message: String
    }

    private struct TokenRecord: Codable {
        let tokId: String       // first 4 bytes of SHA256(K), hex
        let keyHex: String      // 64 hex chars = 32-byte K
        let clientName: String
        let grantedAt: Date
        var lastUsed: Date
    }

    private var tokens: [String: TokenRecord] = [:]
    private var nonceOrder: [String] = []
    private var nonceSet: Set<String> = []
    private var lastPersistedUse: [String: Date] = [:]
    private var pairInFlight = false
    /// clientName -> last approval time; re-pair within this window skips the alert.
    private var trustWindow: [String: Date] = [:]

    private static let idleTTL: TimeInterval = 30 * 86400
    private static let tsWindow: TimeInterval = 120
    private static let trustTTL: TimeInterval = 600
    private static let nonceCapacity = 1024
    private static let persistUseInterval: TimeInterval = 3600

    private init() {
        loadTokens()
    }

    // MARK: - Config

    /// Master switch. Default ON; flip off only for legacy-client migration.
    var authRequired: Bool {
        UserDefaults.standard.object(forKey: "debug.auth.required") as? Bool ?? true
    }

    func setAuthRequired(_ required: Bool) {
        UserDefaults.standard.set(required, forKey: "debug.auth.required")
        logger.info("auth.required set to \(required)")
    }

    // MARK: - Persistence

    private static var storeURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("DebugAuth/tokens.json")
    }

    private func loadTokens() {
        guard let data = try? Data(contentsOf: Self.storeURL),
              let records = try? JSONDecoder().decode([TokenRecord].self, from: data) else { return }
        lock.lock()
        for r in records { tokens[r.tokId] = r }
        lock.unlock()
        logger.info("loaded \(records.count) debug token(s)")
    }

    /// Callers must NOT hold `lock`.
    private func persistTokens() {
        lock.lock()
        let records = Array(tokens.values)
        lock.unlock()
        do {
            let dir = Self.storeURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(records)
            try data.write(to: Self.storeURL, options: .atomic)
        } catch {
            logger.error("failed to persist tokens: \(error.localizedDescription)")
        }
    }

    // MARK: - Crypto primitives (protocol v1)

    private static func hmac(_ key: Data, _ data: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key)))
    }

    private static func tagMatches(_ tag: Data, message: Data, key: Data) -> Bool {
        HMAC<SHA256>.isValidAuthenticationCode(tag, authenticating: message, using: SymmetricKey(data: key))
    }

    /// PRF-CTR stream cipher: keystream_i = HMAC-SHA256(key, nonce || be32(i)).
    private static func keystreamXOR(key: Data, nonce: Data, data: Data) -> Data {
        var stream = Data(capacity: data.count + 32)
        var counter: UInt32 = 0
        while stream.count < data.count {
            var be = counter.bigEndian
            stream.append(hmac(key, nonce + Data(bytes: &be, count: 4)))
            counter += 1
        }
        return Data(zip(data, stream).map { $0 ^ $1 })
    }

    private static func be64(_ value: UInt64) -> Data {
        var be = value.bigEndian
        return Data(bytes: &be, count: 8)
    }

    // MARK: - Envelope

    static func looksLikeEnvelope(_ obj: [String: Any]) -> Bool {
        (obj["v"] as? Int) == 1 && obj["tok"] is String && obj["ct"] is String
    }

    /// Verifies + decrypts a request envelope. Returns the plaintext JSON-RPC
    /// body and a sealer that encrypts the response under the same nonce.
    func openEnvelope(_ obj: [String: Any]) throws -> (plaintext: String, sealResponse: (String) -> String) {
        guard let tokId = obj["tok"] as? String,
              let ts = obj["ts"] as? Int, ts >= 0,   // negative would trap in UInt64(ts)
              let nonceHex = obj["nonce"] as? String,
              let ctB64 = obj["ct"] as? String,
              let tagHex = obj["tag"] as? String,
              let nonce = Data(hex: nonceHex), nonce.count == 16,
              let ct = Data(base64Encoded: ctB64),
              let tag = Data(hex: tagHex), tag.count == 32,
              let tok4 = Data(hex: tokId), tok4.count == 4 else {
            throw AuthFailure(code: "bad_envelope", message: "Malformed envelope fields")
        }

        lock.lock()
        let record = tokens[tokId]
        lock.unlock()

        guard var rec = record else {
            throw AuthFailure(code: "token_unknown", message: "Unknown token id")
        }
        let now = Date()
        if now.timeIntervalSince(rec.lastUsed) > Self.idleTTL {
            lock.lock()
            tokens.removeValue(forKey: tokId)
            lock.unlock()
            persistTokens()
            throw AuthFailure(code: "token_expired", message: "Token idle for over 30 days")
        }
        guard abs(now.timeIntervalSince1970 - Double(ts)) <= Self.tsWindow else {
            throw AuthFailure(code: "ts_skew", message: "Timestamp outside ±120s window")
        }

        guard let key = Data(hex: rec.keyHex) else {
            throw AuthFailure(code: "token_unknown", message: "Corrupt token record")
        }
        let kMac = Self.hmac(key, Data("minis-dbg-v1|mac".utf8) + nonce)
        let signed = Data("v1".utf8) + tok4 + Self.be64(UInt64(ts)) + nonce + ct
        guard Self.tagMatches(tag, message: signed, key: kMac) else {
            throw AuthFailure(code: "bad_tag", message: "MAC verification failed")
        }

        // Replay check AFTER the MAC: only authentic requests consume LRU slots.
        lock.lock()
        if nonceSet.contains(nonceHex) {
            lock.unlock()
            throw AuthFailure(code: "nonce_replayed", message: "Duplicate nonce")
        }
        nonceSet.insert(nonceHex)
        nonceOrder.append(nonceHex)
        if nonceOrder.count > Self.nonceCapacity {
            nonceSet.remove(nonceOrder.removeFirst())
        }
        rec.lastUsed = now
        tokens[tokId] = rec
        let needsPersist = (lastPersistedUse[tokId].map { now.timeIntervalSince($0) > Self.persistUseInterval } ?? true)
        if needsPersist { lastPersistedUse[tokId] = now }
        lock.unlock()
        if needsPersist { persistTokens() }

        let kEncReq = Self.hmac(key, Data("minis-dbg-v1|enc-req".utf8) + nonce)
        let plaintextData = Self.keystreamXOR(key: kEncReq, nonce: nonce, data: ct)
        guard let plaintext = String(data: plaintextData, encoding: .utf8) else {
            throw AuthFailure(code: "bad_tag", message: "Decrypted payload is not UTF-8")
        }

        let sealResponse: (String) -> String = { responseJSON in
            let kEncResp = Self.hmac(key, Data("minis-dbg-v1|enc-resp".utf8) + nonce)
            let respCt = Self.keystreamXOR(key: kEncResp, nonce: nonce, data: Data(responseJSON.utf8))
            let respTag = Self.hmac(kMac, Data("resp".utf8) + nonce + respCt)
            let envelope: [String: Any] = [
                "v": 1,
                "nonce": nonceHex,
                "ct": respCt.base64EncodedString(),
                "tag": respTag.hexString,
            ]
            let data = (try? JSONSerialization.data(withJSONObject: envelope, options: .withoutEscapingSlashes)) ?? Data("{}".utf8)
            return String(data: data, encoding: .utf8) ?? "{}"
        }
        return (plaintext, sealResponse)
    }

    // MARK: - Pairing

    /// Handles POST /pair. Blocks (async) on the on-device approval alert.
    func handlePair(body: [String: Any], isLoopback: Bool) async -> (status: String, json: String) {
        guard let clientName = body["client_name"] as? String, !clientName.isEmpty else {
            return ("400 Bad Request", Self.authErrorJSON("bad_request", "client_name is required"))
        }

        let isPlain = body["plain"] as? Bool ?? false
        var clientPub: Data?
        if !isPlain {
            guard let pubB64 = body["pub"] as? String,
                  let pub = Data(base64Encoded: pubB64), pub.count == 32 else {
                return ("400 Bad Request", Self.authErrorJSON("bad_request", "Provide plain:true or pub (base64 raw 32B X25519)"))
            }
            clientPub = pub
        }
        if isPlain && !isLoopback {
            return ("403 Forbidden", Self.authErrorJSON("plain_forbidden", "Plain grant is localhost/USB only; use X25519 mode"))
        }

        lock.lock()
        if pairInFlight {
            lock.unlock()
            return ("429 Too Many Requests", Self.authErrorJSON("pair_busy", "Another pairing request is pending"))
        }
        pairInFlight = true
        lock.unlock()
        defer {
            lock.lock()
            pairInFlight = false
            lock.unlock()
        }

        let fingerprint = clientPub.map { pub in
            Data(SHA256.hash(data: pub)).hexString.prefix(8).lowercased()
        }
        let approved = await requestApproval(clientName: clientName, fingerprint: fingerprint)
        guard approved else {
            logger.info("pair denied for client=\(clientName)")
            return ("403 Forbidden", Self.authErrorJSON("pair_denied", "User rejected or approval timed out"))
        }

        var keyBytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, keyBytes.count, &keyBytes) == errSecSuccess else {
            return ("500 Internal Server Error", Self.authErrorJSON("internal", "Random generation failed"))
        }
        let key = Data(keyBytes)
        let tokId = Data(SHA256.hash(data: key)).prefix(4).hexString
        let now = Date()
        let record = TokenRecord(tokId: tokId, keyHex: key.hexString, clientName: clientName,
                                 grantedAt: now, lastUsed: now)
        lock.lock()
        tokens[tokId] = record
        trustWindow[clientName] = now
        lock.unlock()
        persistTokens()
        logger.info("paired client=\(clientName) tok=\(tokId) mode=\(isPlain ? "plain" : "x25519")")

        // `expires` is informational only: "expiry if never used". Actual
        // expiry slides forward on every authenticated request (idle-based).
        let expires = Int(now.timeIntervalSince1970 + Self.idleTTL)

        if let clientPub {
            do {
                let devicePriv = Curve25519.KeyAgreement.PrivateKey()
                let devicePub = devicePriv.publicKey.rawRepresentation
                let peerKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: clientPub)
                let shared = try devicePriv.sharedSecretFromKeyAgreement(with: peerKey)
                let sharedData = shared.withUnsafeBytes { Data($0) }
                let kWrap = Self.hmac(sharedData, Data("minis-dbg-pair".utf8) + clientPub + devicePub)
                let pad = Self.hmac(kWrap, Data("minis-dbg-wrap".utf8))
                let tokenCt = Data(zip(key, pad).map { $0 ^ $1 })
                let resp: [String: Any] = [
                    "pub": devicePub.base64EncodedString(),
                    "token_ct": tokenCt.hexString,
                    "expires": expires,
                ]
                return ("200 OK", Self.json(resp))
            } catch {
                lock.lock()
                tokens.removeValue(forKey: tokId)
                lock.unlock()
                persistTokens()
                return ("400 Bad Request", Self.authErrorJSON("bad_request", "X25519 key agreement failed"))
            }
        }
        return ("200 OK", Self.json(["token": key.hexString, "expires": expires]))
    }

    private func requestApproval(clientName: String, fingerprint: String?) async -> Bool {
        lock.lock()
        let trusted = trustWindow[clientName].map { Date().timeIntervalSince($0) < Self.trustTTL } ?? false
        lock.unlock()
        if trusted {
            logger.info("pair auto-approved (trust window) client=\(clientName)")
            return true
        }
        #if targetEnvironment(simulator)
        // Simulator builds auto-approve so automated tests can pair headlessly.
        logger.info("pair auto-approved (simulator) client=\(clientName)")
        return true
        #else
        return await Self.presentApprovalAlert(clientName: clientName, fingerprint: fingerprint)
        #endif
    }

    @MainActor
    private static func presentApprovalAlert(clientName: String, fingerprint: String?) async -> Bool {
        guard let root = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow })?.rootViewController else {
            return false
        }
        var top = root
        while let presented = top.presentedViewController { top = presented }

        return await withCheckedContinuation { continuation in
            let resumed = ResumeGuard()
            var detail = "Debug client \"\(clientName)\" requests access to the debug server."
            if let fingerprint {
                detail += "\n\nKey fingerprint: \(fingerprint)\nVerify it matches the client's printout."
            }
            // Approval dialog is developer-facing (DEBUG builds only) — not localized.
            let alert = UIAlertController(title: "Debug Pairing Request", message: detail, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Deny", style: .cancel) { _ in
                if resumed.tryResume() { continuation.resume(returning: false) }
            })
            alert.addAction(UIAlertAction(title: "Allow", style: .default) { _ in
                if resumed.tryResume() { continuation.resume(returning: true) }
            })
            top.present(alert, animated: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak alert] in
                if resumed.tryResume() {
                    alert?.dismiss(animated: true)
                    continuation.resume(returning: false)
                }
            }
        }
    }

    private final class ResumeGuard {
        private let lock = NSLock()
        private var done = false
        func tryResume() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if done { return false }
            done = true
            return true
        }
    }

    // MARK: - Management RPCs

    func listTokens() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        let fmt = ISO8601DateFormatter()
        return tokens.values
            .sorted { $0.grantedAt < $1.grantedAt }
            .map {
                [
                    "tok": $0.tokId,
                    "clientName": $0.clientName,
                    "grantedAt": fmt.string(from: $0.grantedAt),
                    "lastUsed": fmt.string(from: $0.lastUsed),
                ]
            }
    }

    func revoke(tokId: String) -> Bool {
        lock.lock()
        let removed = tokens.removeValue(forKey: tokId) != nil
        lock.unlock()
        if removed { persistTokens() }
        return removed
    }

    func revokeAll() -> Int {
        lock.lock()
        let count = tokens.count
        tokens.removeAll()
        trustWindow.removeAll()
        lock.unlock()
        persistTokens()
        return count
    }

    // MARK: - JSON helpers

    static func authErrorJSON(_ code: String, _ message: String) -> String {
        json(["error": ["code": code, "message": message, "server_ts": Int(Date().timeIntervalSince1970)]])
    }

    private static func json(_ obj: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}

// MARK: - Hex helpers

private extension Data {
    init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }

    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
#endif
