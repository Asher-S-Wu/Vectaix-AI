import Foundation

/// Pure RFC 8628 Device Authorization Grant request/response modeling for Kimi
/// Code OAuth. UIKit-free and network-free so the parsing + poll-decision logic
/// is unit-testable in isolation; `KimiOAuthManager` owns the actual HTTP.
///
/// Endpoints (from CLIProxyAPI's public Kimi implementation; to be re-confirmed
/// against the live upstream once a client ID is configured):
///   auth host:            https://auth.kimi.com
///   device authorization: POST /api/oauth/device_authorization
///   token:                POST /api/oauth/token
enum KimiDeviceFlow {

    static let authHost = "https://auth.kimi.com"
    static let deviceAuthorizationPath = "/api/oauth/device_authorization"
    static let tokenPath = "/api/oauth/token"

    // MARK: - Device authorization response (RFC 8628 §3.2)

    struct DeviceAuthorization: Equatable {
        let deviceCode: String
        let userCode: String
        let verificationURI: String
        /// Optional pre-filled URL (RFC 8628 §3.3.1). Prefer this for opening.
        let verificationURIComplete: String?
        /// Overall deadline in seconds.
        let expiresIn: TimeInterval
        /// Minimum poll interval in seconds (defaults to 5 per spec when absent).
        let interval: TimeInterval

        /// The URL to present/open — complete form when available.
        var openURL: String { verificationURIComplete ?? verificationURI }
    }

    /// Parse the device-authorization JSON. Throws `LLMError.providerError` when
    /// required fields are missing.
    static func parseDeviceAuthorization(_ json: [String: Any]) throws -> DeviceAuthorization {
        guard let deviceCode = json["device_code"] as? String,
              let userCode = json["user_code"] as? String,
              let verificationURI = (json["verification_uri"] as? String)
                ?? (json["verification_url"] as? String)
        else {
            throw LLMError.providerError(message: "Kimi device authorization response missing required fields")
        }
        let complete = (json["verification_uri_complete"] as? String)
            ?? (json["verification_url_complete"] as? String)
        let expiresIn = (json["expires_in"] as? Double) ?? 900
        let interval = (json["interval"] as? Double) ?? 5
        return DeviceAuthorization(
            deviceCode: deviceCode,
            userCode: userCode,
            verificationURI: verificationURI,
            verificationURIComplete: complete,
            expiresIn: expiresIn,
            interval: interval
        )
    }

    // MARK: - Token poll outcome (RFC 8628 §3.5)

    enum PollOutcome: Equatable {
        /// 200 with tokens — flow complete.
        case success(accessToken: String, refreshToken: String?, expiresIn: TimeInterval?)
        /// `authorization_pending` — keep polling at the current interval.
        case pending
        /// `slow_down` — increase interval by 5s (spec) and keep polling.
        case slowDown
        /// Terminal errors: user denied, code expired, or any other fatal error.
        case denied(String)
        case expired(String)
        case fatal(String)
    }

    /// Classify a token-endpoint poll response body (already JSON-decoded).
    /// `httpOK` is true for a 2xx status. RFC 8628 returns pending/slow_down as
    /// OAuth *errors* (non-2xx) with an `error` field, and success as 2xx.
    static func classifyPoll(json: [String: Any], httpOK: Bool) -> PollOutcome {
        if httpOK, let accessToken = json["access_token"] as? String {
            return .success(
                accessToken: accessToken,
                refreshToken: json["refresh_token"] as? String,
                expiresIn: json["expires_in"] as? Double
            )
        }
        let error = (json["error"] as? String)?.lowercased() ?? "unknown_error"
        let desc = (json["error_description"] as? String) ?? error
        switch error {
        case "authorization_pending": return .pending
        case "slow_down": return .slowDown
        case "access_denied": return .denied(desc)
        case "expired_token": return .expired(desc)
        default: return .fatal(desc)
        }
    }

    /// Next poll interval after a `slow_down` (spec: +5 seconds).
    static func bumpedInterval(_ current: TimeInterval) -> TimeInterval { current + 5 }
}
