import Foundation
import WebKit

private let logger = AppLogger(category: "CookieAudit")

/// Audits every mutation of the browser's shared cookie store
/// (`WKWebsiteDataStore.default()`), so we can attribute cookie loss —
/// page writes, agent `set_cookies`, and WebKit-initiated deletions (ITP)
/// all fire the observer while the app is running.
///
/// Two layers:
///   1. Live diff — `WKHTTPCookieStoreObserver.cookiesDidChange` fires on any
///      store change; we diff against the last snapshot and log added /
///      removed / modified cookies (name, domain, expiry, HttpOnly — never
///      raw values).
///   2. Offline diff — ITP cleanup usually runs while the app is NOT
///      observing (or not running). The snapshot is persisted to disk after
///      every diff; on launch we diff the persisted snapshot against the
///      current store and log what changed since the previous run.
@MainActor
final class CookieAuditLogger: NSObject {
    static let shared = CookieAuditLogger()

    /// One audited cookie. Only metadata — the value itself is never stored
    /// or logged, just its length (a length change reveals a rewrite).
    private struct CookieMeta: Codable, Equatable {
        var valueLength: Int
        /// Unix seconds; nil = session cookie (lives only in the network
        /// process's memory — lost on process teardown).
        var expires: Double?
        var httpOnly: Bool
    }

    private var lastSnapshot: [String: CookieMeta] = [:]
    private var started = false
    /// Coalesces the observer bursts a single page load produces.
    private var pendingDiff: Task<Void, Never>?

    private var snapshotFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("cookie_audit_snapshot.json")
    }

    /// Call once at app launch. Registers the observer and runs the offline
    /// diff against the snapshot persisted by the previous run.
    func start() {
        guard !started else { return }
        started = true
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.add(self)
        Task { @MainActor in
            let current = await Self.snapshot(of: store)
            if let previous = self.loadPersistedSnapshot() {
                self.logDiff(from: previous, to: current, label: "OFFLINE (since previous run)")
            } else {
                logger.info("start: no persisted snapshot — first run, auditing \(current.count) cookie(s)")
            }
            self.lastSnapshot = current
            self.persistSnapshot(current)
        }
    }

    // MARK: - Diffing

    private static func snapshot(of store: WKHTTPCookieStore) async -> [String: CookieMeta] {
        let cookies = await store.allCookies()
        var result: [String: CookieMeta] = [:]
        for c in cookies {
            let key = "\(c.domain)|\(c.path)|\(c.name)"
            result[key] = CookieMeta(valueLength: c.value.count,
                                     expires: c.expiresDate?.timeIntervalSince1970,
                                     httpOnly: c.isHTTPOnly)
        }
        return result
    }

    private func scheduleDiff(store: WKHTTPCookieStore) {
        pendingDiff?.cancel()
        pendingDiff = Task { @MainActor in
            // Page loads fire cookiesDidChange in bursts; coalesce briefly so
            // one navigation logs one diff instead of a dozen.
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            let current = await Self.snapshot(of: store)
            self.logDiff(from: self.lastSnapshot, to: current, label: "LIVE")
            self.lastSnapshot = current
            self.persistSnapshot(current)
        }
    }

    private func logDiff(from old: [String: CookieMeta],
                         to new: [String: CookieMeta],
                         label: String) {
        let removed = old.keys.filter { new[$0] == nil }.sorted()
        let added = new.keys.filter { old[$0] == nil }.sorted()
        let modified = new.keys.filter { key in
            guard let o = old[key] else { return false }
            return o != new[key]
        }.sorted()

        guard !removed.isEmpty || !added.isEmpty || !modified.isEmpty else { return }

        logger.info("[\(label)] cookie store changed: +\(added.count) added, -\(removed.count) removed, ~\(modified.count) modified (total \(new.count))")

        // Removals are what we're hunting (ITP wipes, expiries) — log every
        // one. Adds/modifies are page-load noise; cap them per event.
        for key in removed {
            logger.info("[\(label)]   REMOVED \(Self.describe(key, old[key]))")
        }
        let detailCap = 20
        for key in added.prefix(detailCap) {
            logger.info("[\(label)]   added   \(Self.describe(key, new[key]))")
        }
        if added.count > detailCap {
            logger.info("[\(label)]   … and \(added.count - detailCap) more added")
        }
        for key in modified.prefix(detailCap) {
            logger.info("[\(label)]   modified \(Self.describe(key, new[key]))")
        }
        if modified.count > detailCap {
            logger.info("[\(label)]   … and \(modified.count - detailCap) more modified")
        }
    }

    private static func describe(_ key: String, _ meta: CookieMeta?) -> String {
        guard let meta else { return key }
        let expiry: String
        if let e = meta.expires {
            expiry = "expires=\(ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: e)))"
        } else {
            expiry = "SESSION"
        }
        return "\(key) [len=\(meta.valueLength) \(expiry)\(meta.httpOnly ? " HttpOnly" : "")]"
    }

    // MARK: - Snapshot persistence

    private func loadPersistedSnapshot() -> [String: CookieMeta]? {
        guard let data = try? Data(contentsOf: snapshotFileURL) else { return nil }
        return try? JSONDecoder().decode([String: CookieMeta].self, from: data)
    }

    private func persistSnapshot(_ snapshot: [String: CookieMeta]) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: snapshotFileURL, options: .atomic)
    }
}

extension CookieAuditLogger: WKHTTPCookieStoreObserver {
    nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        Task { @MainActor in
            self.scheduleDiff(store: cookieStore)
        }
    }
}
