import Foundation

/// [T-oauth-refresh-race] Instance-level single-flight coordinator for OAuth
/// token refreshes, shared by every provider manager. At most one in-flight
/// refresh `Task` per provider instance: concurrent callers await/reuse the same
/// task instead of each firing their own network refresh with the same (about-
/// to-be-rotated) refresh token.
///
/// `@MainActor` so the check-and-insert of `inFlight[instanceId]` is atomic
/// (there is no `await` between the lookup and the store), matching how each
/// provider manager is already isolated. Generic over the provider's token type;
/// combine with `OAuthRefreshCoordinator.resolveAfterRefreshFailure` for the
/// compare-before-delete backstop when the shared refresh fails.
@MainActor
final class OAuthRefreshSingleFlight<Token: Sendable> {
    private var inFlight: [String: Task<Token, Error>] = [:]

    init() {}

    /// Whether a refresh is currently running for `instanceId` (test/introspection).
    func hasInFlight(_ instanceId: String) -> Bool { inFlight[instanceId] != nil }

    /// Run `perform` under single-flight for `instanceId`.
    ///
    /// - If a refresh is already running for this instance, await it and return
    ///   its result (join — no second network call). If that shared task throws,
    ///   the error is rethrown so the caller can apply its compare-before-delete
    ///   resolution against the now-current persisted state.
    /// - Otherwise start a new task, register it, run it, and clear the slot when
    ///   it settles (success or failure).
    ///
    /// `perform` is responsible for the actual token-endpoint round trip AND for
    /// persisting the rotated token on success (so a joiner reading persisted
    /// state after success sees the new token).
    func run(instanceId: String, perform: @escaping () async throws -> Token) async throws -> Token {
        if let existing = inFlight[instanceId] {
            return try await existing.value
        }
        let task = Task<Token, Error> { try await perform() }
        inFlight[instanceId] = task
        defer { inFlight[instanceId] = nil }
        return try await task.value
    }
}
