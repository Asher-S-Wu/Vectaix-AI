import Foundation
import WebKit

private let logger = AppLogger(category: "CookieBackup")

/// Lossless cookie backup + re-inject for the browser's shared cookie store.
///
/// WebKit ITP classifies high-traffic domains (x.com, google.com, …) as
/// prevalent and wipes ALL their site data — including HttpOnly login
/// cookies — after 30 days without a real user gesture. Agent-driven
/// (headless) browsing never counts as a gesture, so login cookies the user
/// established in the takeover sheet kept vanishing (observations.db showed
/// 5 wipes for x.com on the reporting device).
///
/// Mitigation: before every browser_use / minis-browser-use action (throttled
/// to once per 60s) we
///   1. snapshot every cookie in `WKWebsiteDataStore.default()` with its FULL
///      metadata (domain / path / expires / secure / HttpOnly), rendered as a
///      per-domain Netscape cookies.txt file (`<registrable-domain>.txt`), and
///   2. re-inject any backed-up cookie that is no longer present in the live
///      store (the ITP-wipe recovery path). Live cookies always win over the
///      backup; expired entries are pruned.
///
/// Storage is a **local file per domain**, deliberately not the Keychain: this
/// is a purely local anti-ITP cache, and we do NOT want the login state synced
/// across devices or uploaded to iCloud. Files live under Application Support
/// (unreachable from the guest rootfs so shell code can't read raw auth
/// cookies), get `completeUntilFirstUserAuthentication` file protection (system
/// at-rest encryption, unreadable before first unlock), and are marked
/// excluded-from-backup so they never migrate off this device. The Netscape
/// text is the file's content so the format stays the line-based industry
/// standard our own `set_cookies` already parses.
///
/// Bounded growth: a per-domain `lastVisit` map (a sibling file) is refreshed
/// on every navigate via `noteVisit`. A domain not visited for
/// `domainRetention` (30 days) has its backup dropped and stops being
/// restored — so the backup set tracks "domains actually used recently"
/// instead of growing without bound. Visits (real navigations), not the
/// re-injected cookies themselves, drive aging, so recovery can't keep a dead
/// domain alive forever.
@MainActor
final class CookieBackupStore {
    static let shared = CookieBackupStore()

    /// Minimum spacing between two syncs. The first action after launch
    /// always syncs (recovers from wipes that happened while not running).
    static let syncInterval: TimeInterval = 60

    /// A domain unvisited for this long is dropped from the backup and no
    /// longer restored. Mirrors ITP's own 30-day window, but keyed on any
    /// real navigation (including agent-driven) rather than a user gesture.
    static let domainRetention: TimeInterval = 30 * 24 * 3600

    /// Hard cap on the number of backed-up domains. Beyond this, the
    /// oldest-visited domains are evicted regardless of the retention window.
    static let maxDomains = 1000

    private var lastSyncAt: Date?
    private var syncing = false
    /// Keys persisted by the previous sync — used to only log the full
    /// backup listing when the set actually changed, so the 60s cadence
    /// doesn't flood the log with identical listings.
    private var lastLoggedKeys: Set<String> = []

    private struct BackupCookie: Codable {
        var name: String
        var value: String
        var domain: String
        var path: String
        /// Unix seconds; nil = session cookie.
        var expires: Double?
        var secure: Bool
        var httpOnly: Bool

        var key: String { "\(domain)|\(path)|\(name)" }

        /// Log-safe description: metadata only, never the value itself.
        var logLabel: String {
            var attrs: [String] = ["len=\(value.count)"]
            if let expires {
                attrs.append("exp=\(ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: expires)))")
            } else {
                attrs.append("SESSION")
            }
            if httpOnly { attrs.append("HttpOnly") }
            return "\(name)[\(attrs.joined(separator: " "))]"
        }

        init(name: String, value: String, domain: String, path: String,
             expires: Double?, secure: Bool, httpOnly: Bool) {
            self.name = name
            self.value = value
            self.domain = domain
            self.path = path
            self.expires = expires
            self.secure = secure
            self.httpOnly = httpOnly
        }

        init(from cookie: HTTPCookie) {
            name = cookie.name
            value = cookie.value
            domain = cookie.domain
            path = cookie.path
            expires = cookie.expiresDate?.timeIntervalSince1970
            secure = cookie.isSecure
            httpOnly = cookie.isHTTPOnly
        }

        func toHTTPCookie() -> HTTPCookie? {
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: name,
                .value: value,
                .domain: domain,
                .path: path,
            ]
            if secure { properties[.secure] = "TRUE" }
            if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
            if let expires {
                properties[.expires] = Date(timeIntervalSince1970: expires)
            }
            return HTTPCookie(properties: properties)
        }
    }

    /// Local backup directory: one `<registrable-domain>.txt` per domain plus
    /// a `.lastVisit.json` sibling. Created on demand; excluded from backup so
    /// the login state never leaves this device.
    private var backupDirURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
            .appendingPathComponent("BrowserCookieBackup", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var mutable = dir
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? mutable.setResourceValues(values)
        }
        return dir
    }

    /// Backup file for a registrable domain. `.lastVisit.json` is reserved for
    /// the visit map, so a real domain literally named that (impossible — it
    /// has no dot-separated TLD form here) can't collide.
    private func cookieFileURL(domain: String) -> URL {
        backupDirURL.appendingPathComponent("\(domain).txt")
    }

    private var visitMapURL: URL {
        backupDirURL.appendingPathComponent(".lastVisit.json")
    }

    /// Group key for the per-domain backup file: the registrable domain
    /// (last two labels, leading dot stripped) so ".x.com", "x.com" and
    /// "api.x.com" cookies all land in `x.com.txt`.
    private static func registrableDomain(_ domain: String) -> String {
        let bare = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
        let parts = bare.split(separator: ".")
        guard parts.count > 2 else { return bare }
        return parts.suffix(2).joined(separator: ".")
    }

    /// Record a real navigation to `url`'s registrable domain so its backup
    /// stays alive. Called from the navigate action; the visit — not the
    /// re-injected cookies — is what resets the retention clock.
    func noteVisit(url: URL?) {
        guard let host = url?.host else { return }
        let domain = Self.registrableDomain(host)
        var map = loadVisitMap()
        map[domain] = Date().timeIntervalSince1970
        persistVisitMap(map)
    }

    /// Reconcile the backup for one registrable domain against the current
    /// live store, after the user deleted some/all of its cookies in Browser
    /// Settings. Rewrites (or removes) that domain's backup file to exactly
    /// match what's left live, so a deletion is NOT resurrected on the next
    /// sync — while cookies the user kept (e.g. a sibling subdomain under the
    /// same registrable domain) are preserved. `rawDomain` is a cookie domain
    /// (possibly with a leading dot / subdomain).
    func reconcileDomainAfterUserEdit(_ rawDomain: String) async {
        let key = Self.registrableDomain(rawDomain)
        let live = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        let remaining = live
            .filter { Self.registrableDomain($0.domain) == key }
            .map { BackupCookie(from: $0) }
        if remaining.isEmpty {
            deleteCookieItem(domain: key)
            var visits = loadVisitMap()
            if visits.removeValue(forKey: key) != nil { persistVisitMap(visits) }
            logger.info("forgot backup for \(key) (user cleared it in Browser Settings)")
        } else {
            writeProtected(Self.renderNetscape(remaining), to: cookieFileURL(domain: key), label: "\(key).txt")
            logger.info("reconciled backup for \(key) to \(remaining.count) remaining cookie(s) after user edit")
        }
    }

    /// Wipe the entire backup — mirrors the user's "clear all website data"
    /// action so nothing is restored afterwards.
    func forgetAll() {
        try? FileManager.default.removeItem(at: backupDirURL)
        logger.info("cleared entire cookie backup (user cleared all website data)")
    }

    /// Sync the live cookie store with the backup. Cheap no-op when called
    /// within `syncInterval` of the previous sync, so callers can invoke it
    /// unconditionally on every browser action.
    func syncIfNeeded() async {
        if let last = lastSyncAt, Date().timeIntervalSince(last) < Self.syncInterval { return }
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }
        lastSyncAt = Date()

        let store = WKWebsiteDataStore.default().httpCookieStore
        let live = await store.allCookies()
        let now = Date().timeIntervalSince1970

        // Domains whose last real visit is older than the retention window are
        // aged out entirely: their backup is dropped and they are not
        // restored. A live cookie counts as an implicit visit (the store still
        // holds it because the page was just loaded), so an actively-used
        // domain never ages out even if navigate wasn't the triggering action.
        var visits = loadVisitMap()
        for cookie in live {
            visits[Self.registrableDomain(cookie.domain)] = now
        }
        var droppedDomains = Set(visits.filter { now - $0.value > Self.domainRetention }.keys)

        // Hard cap on the number of backed-up domains. If more than
        // `maxDomains` survive the time-based sweep, evict the oldest-visited
        // ones (never a domain that has a live cookie right now, which is
        // implicitly the freshest). Bounds the backup even if 1000+ distinct
        // domains are visited within the retention window.
        let liveDomains = Set(live.map { Self.registrableDomain($0.domain) })
        let survivors = visits.keys.filter { !droppedDomains.contains($0) }
        if survivors.count > Self.maxDomains {
            let evictable = survivors
                .filter { !liveDomains.contains($0) }
                .sorted { (visits[$0] ?? 0) < (visits[$1] ?? 0) }  // oldest first
            let overflow = survivors.count - Self.maxDomains
            for domain in evictable.prefix(overflow) {
                droppedDomains.insert(domain)
            }
        }
        let expiredDomains = droppedDomains

        // Merge: start from the backup (pruning expired-by-time entries and
        // aged-out domains), then let every live cookie overwrite its backup
        // entry — the live store is authoritative for anything it still holds.
        var merged: [String: BackupCookie] = [:]
        for entry in loadBackup() {
            if let e = entry.expires, e <= now { continue }
            if expiredDomains.contains(Self.registrableDomain(entry.domain)) { continue }
            merged[entry.key] = entry
        }
        var liveKeys = Set<String>()
        for cookie in live {
            let entry = BackupCookie(from: cookie)
            liveKeys.insert(entry.key)
            merged[entry.key] = entry
        }

        // Prune dropped domains (time-aged or evicted by the cap) from the
        // visit map and delete their backup files, then persist the merge.
        for domain in expiredDomains {
            let ageDays = Int((now - (visits[domain] ?? now)) / 86400)
            let reason = ageDays > Int(Self.domainRetention / 86400)
                ? "unvisited \(ageDays)d"
                : "over \(Self.maxDomains)-domain cap"
            visits.removeValue(forKey: domain)
            deleteCookieItem(domain: domain)
            logger.info("dropped domain \(domain) (\(reason))")
        }
        persistVisitMap(visits)
        persistBackup(Array(merged.values))

        logBackupSummary(merged)

        // Recovery: anything in the merged set but absent from the live store
        // was wiped (ITP) or lost (session-cookie process teardown) — put it
        // back with full metadata.
        var restoredCount = 0
        for (key, entry) in merged.sorted(by: { $0.key < $1.key }) where !liveKeys.contains(key) {
            guard let cookie = entry.toHTTPCookie() else {
                logger.error("failed to rebuild cookie \(key) from backup — skipping")
                continue
            }
            await store.setCookie(cookie)
            restoredCount += 1
            logger.info("RESTORED \(entry.domain) \(entry.logLabel)")
        }

        if restoredCount == 0 {
            logger.info("sync: \(live.count) live cookie(s) backed up, nothing to restore")
        } else {
            logger.info("sync: \(live.count) live cookie(s) backed up, restored \(restoredCount) missing cookie(s) from backup")
        }
    }

    /// Log what the backup now contains, grouped per domain. The full listing
    /// is emitted only when the key set changed since the last sync; steady
    /// state logs a single concise line.
    private func logBackupSummary(_ merged: [String: BackupCookie]) {
        let keys = Set(merged.keys)
        let domains = Set(merged.values.map(\.domain))
        guard keys != lastLoggedKeys else {
            logger.info("backup unchanged: \(merged.count) cookie(s) across \(domains.count) domain(s)")
            return
        }
        lastLoggedKeys = keys

        logger.info("backup updated: \(merged.count) cookie(s) across \(domains.count) domain(s)")
        let byDomain = Dictionary(grouping: merged.values, by: \.domain)
        for (domain, entries) in byDomain.sorted(by: { $0.key < $1.key }) {
            let labels = entries.sorted { $0.name < $1.name }.map(\.logLabel)
            logger.info("  backup \(domain): \(labels.joined(separator: ", "))")
        }
    }

    // MARK: - Persistence (local per-domain Netscape cookies.txt files)

    private func loadBackup() -> [BackupCookie] {
        var entries: [BackupCookie] = []
        for (_, text) in allCookieFiles() {
            entries.append(contentsOf: Self.parseNetscape(text))
        }
        migrateLegacyJSONIfNeeded(into: &entries)
        return entries
    }

    private func persistBackup(_ entries: [BackupCookie]) {
        let byDomain = Dictionary(grouping: entries) { Self.registrableDomain($0.domain) }
        for (domain, cookies) in byDomain {
            let text = Self.renderNetscape(cookies)
            let url = cookieFileURL(domain: domain)
            // Skip rewriting a file whose content is unchanged — the 60s
            // cadence would otherwise re-encrypt every domain each tick.
            if let existing = try? String(contentsOf: url, encoding: .utf8), existing == text { continue }
            writeProtected(text, to: url, label: "\(domain).txt")
        }
        // Drop files for domains that no longer have any cookie (all expired),
        // so stale files don't resurrect on the next load.
        let liveNames = Set(byDomain.keys.map { "\($0).txt" })
        for (domain, _) in allCookieFiles() where !liveNames.contains("\(domain).txt") {
            try? FileManager.default.removeItem(at: cookieFileURL(domain: domain))
        }
    }

    /// Every `<domain>.txt` in the backup dir, keyed by registrable domain →
    /// Netscape text. The visit map (`.lastVisit.json`) is skipped by extension.
    private func allCookieFiles() -> [String: String] {
        let files = (try? FileManager.default.contentsOfDirectory(at: backupDirURL,
                                                                  includingPropertiesForKeys: nil)) ?? []
        var result: [String: String] = [:]
        for file in files where file.pathExtension == "txt" {
            guard let text = try? String(contentsOf: file, encoding: .utf8) else {
                logger.error("backup file unreadable: \(file.lastPathComponent) — skipping")
                continue
            }
            result[file.deletingPathExtension().lastPathComponent] = text
        }
        return result
    }

    private func deleteCookieItem(domain: String) {
        try? FileManager.default.removeItem(at: cookieFileURL(domain: domain))
    }

    /// Fold the pre-directory single-JSON backup in once, then delete it so no
    /// stale plaintext copy lingers. (The per-domain .txt files are the
    /// current format and are read directly by `allCookieFiles`.)
    private func migrateLegacyJSONIfNeeded(into entries: inout [BackupCookie]) {
        let legacyJSON = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BrowserCookieBackup.json")
        guard let data = try? Data(contentsOf: legacyJSON),
              let legacy = try? JSONDecoder().decode([BackupCookie].self, from: data) else { return }
        entries.append(contentsOf: legacy)
        try? FileManager.default.removeItem(at: legacyJSON)
        logger.info("migrated \(legacy.count) cookie(s) from legacy JSON backup")
    }

    private func loadVisitMap() -> [String: Double] {
        guard let data = try? Data(contentsOf: visitMapURL),
              let map = try? JSONDecoder().decode([String: Double].self, from: data) else { return [:] }
        return map
    }

    private func persistVisitMap(_ map: [String: Double]) {
        guard let data = try? JSONEncoder().encode(map),
              let text = String(data: data, encoding: .utf8) else { return }
        writeProtected(text, to: visitMapURL, label: ".lastVisit.json")
    }

    /// Atomic write with at-rest file protection (unreadable before first
    /// unlock). The directory is already excluded from backup.
    private func writeProtected(_ text: String, to url: URL, label: String) {
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path)
        } catch {
            logger.error("failed to persist \(label): \(error.localizedDescription)")
        }
    }

    // MARK: - Netscape cookies.txt format

    /// Render cookies in Netscape cookies.txt format — the line-based
    /// industry standard consumed by curl/wget/yt-dlp and already accepted
    /// by our own `set_cookies` import. Fields are TAB-separated:
    ///   domain, includeSubdomains(TRUE/FALSE), path, secure(TRUE/FALSE),
    ///   expiry(unix seconds; 0 = session cookie), name, value
    /// HttpOnly uses curl's convention: the domain field is prefixed with
    /// `#HttpOnly_`.
    private static func renderNetscape(_ cookies: [BackupCookie]) -> String {
        var lines = ["# Netscape HTTP Cookie File", "# Written by Minis CookieBackupStore — do not edit while the app runs", ""]
        for c in cookies.sorted(by: { ($0.domain, $0.path, $0.name) < ($1.domain, $1.path, $1.name) }) {
            let domainField = (c.httpOnly ? "#HttpOnly_" : "") + c.domain
            let includeSubdomains = c.domain.hasPrefix(".") ? "TRUE" : "FALSE"
            let secure = c.secure ? "TRUE" : "FALSE"
            let expiry = c.expires.map { String(Int($0)) } ?? "0"
            lines.append([domainField, includeSubdomains, c.path, secure, expiry, c.name, c.value]
                .joined(separator: "\t"))
        }
        return lines.joined(separator: "\n") + "\n"
    }

    private static func parseNetscape(_ text: String) -> [BackupCookie] {
        var result: [BackupCookie] = []
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: true) {
            var line = String(rawLine)
            var httpOnly = false
            if line.hasPrefix("#HttpOnly_") {
                httpOnly = true
                line = String(line.dropFirst("#HttpOnly_".count))
            } else if line.hasPrefix("#") {
                continue  // comment
            }
            let fields = line.components(separatedBy: "\t")
            guard fields.count == 7 else { continue }
            let expiry = Double(fields[4]) ?? 0
            var entry = BackupCookie(name: fields[5], value: fields[6],
                                     domain: fields[0], path: fields[2],
                                     expires: expiry > 0 ? expiry : nil,
                                     secure: fields[3] == "TRUE",
                                     httpOnly: httpOnly)
            // The includeSubdomains flag is redundant with the leading dot in
            // our writes, but honor it for hand-imported files: TRUE with a
            // bare domain means a domain cookie.
            if fields[1] == "TRUE" && !entry.domain.hasPrefix(".") {
                entry.domain = "." + entry.domain
            }
            result.append(entry)
        }
        return result
    }
}
