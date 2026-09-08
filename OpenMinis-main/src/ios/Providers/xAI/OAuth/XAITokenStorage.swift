import Foundation

struct XAITokenStorage: Codable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let expireDate: Date?
    let lastRefresh: Date?
    /// Cached from OIDC discovery so refresh doesn't have to re-fetch each time.
    let tokenEndpoint: String?
    let email: String?
    let displayName: String?
    let accountId: String?

    var isExpired: Bool {
        guard let expire = expireDate else { return false }
        return expire < Date()
    }
}

extension XAITokenStorage: RefreshableOAuthToken {}
