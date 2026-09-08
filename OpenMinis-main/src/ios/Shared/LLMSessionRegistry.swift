import Foundation

/// Central registry of the long-lived `URLSession`s that LLM providers reuse
/// across requests (the SSE-streaming sessions with a 600s request timeout).
///
/// Why this exists: those sessions keep an internal HTTP/2 connection pool.
/// When the device switches network interface (WiFi <-> cellular, airplane
/// toggle) the kernel sockets backing the pooled connections can silently die
/// — especially behind a local VPN/proxy where the TCP socket to 127.0.0.1
/// survives the flap. A retry then reuses the dead tunnel and hangs until the
/// 600s timeout fires. iOS softens this with URLSession's default 60s
/// `timeoutIntervalForRequest`, but our streaming sessions raise that to 600s,
/// so the hang window is real.
///
/// Mirrors Android #740 (T-android-stale-conn-retry-hang), which evicts the
/// shared OkHttp ConnectionPool on network transitions. Here we call
/// `URLSession.reset(completionHandler:)` — it tears down the connection pool
/// and transient caches WITHOUT invalidating the session, so the session stays
/// usable for the next (fresh-connection) request.
///
/// Eviction is driven ONLY by real interface-type changes in `NetworkMonitor`
/// (not every path tick), so steady-state requests are never disturbed.
final class LLMSessionRegistry: @unchecked Sendable {
    static let shared = LLMSessionRegistry()

    private let lock = NSLock()
    private var sessions: [URLSession] = []
    private let logger = AppLogger(category: "Network")

    private init() {}

    /// Register a long-lived session so it gets its connection pool evicted on
    /// network transitions. Call once per long-lived session at creation.
    func register(_ session: URLSession) {
        lock.lock()
        defer { lock.unlock() }
        // Identity de-dup so a re-registration (shouldn't happen for file-level
        // singletons, but cheap insurance) never double-resets.
        if !sessions.contains(where: { $0 === session }) {
            sessions.append(session)
        }
    }

    /// Drop pooled connections + transient caches on every registered session.
    /// Each session remains usable; the next request opens a fresh connection.
    func evictAllConnections(reason: String) {
        lock.lock()
        let snapshot = sessions
        lock.unlock()
        guard !snapshot.isEmpty else { return }
        logger.info("[Network] Evicting LLM connection pools (\(snapshot.count) session(s)) — reason: \(reason)")
        for session in snapshot {
            // reset() clears connections/cache/cookies but keeps the session
            // alive (unlike invalidateAndCancel). The completion handler runs
            // on an internal queue once the teardown is done; we don't need it.
            session.reset { }
        }
    }
}
