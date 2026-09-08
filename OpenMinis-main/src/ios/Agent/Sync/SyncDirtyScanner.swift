import Foundation
import os.log

private let logger = AppLogger(category: "SyncDirtyScanner")

/// Periodically scans Skill files for changes that weren't caught by
/// event-driven markDirty calls (e.g. disk-discovered skills).
/// Runs every 60 seconds when iCloud sync is enabled.
///
/// [T-ios-sync-dirty-scanner-skills-race] `scan()` reads and writes the shared
/// `knownModDates: [String: Date]` across several `await` suspension points
/// (MainActor.run hops, ChatStore.markDirty). Nothing prevented two `scan()`
/// runs from overlapping — start()'s immediate Task racing the first timer
/// tick, or a slow scan overrun by the next 180s tick — and two scans
/// interleaving their dict mutations across those suspensions corrupted the
/// Dictionary's CoW buffer. The corruption surfaced as
/// `-[NSIndirectTaggedPointerString objectForKey:]` on a garbage tagged pointer
/// inside `Dictionary._Variant.lookup` (a crash that looks like "a String was
/// used as a Dictionary"). Fix: a lock-guarded `isScanning` reentrancy flag
/// admits exactly one in-flight scan, so `knownModDates` always has a single
/// accessor and is never mutated concurrently. The flag lock brackets the
/// scan's start/end, publishing one scan's dict writes to the next. The heavy
/// FS enumeration deliberately stays OFF the main thread (the scan still runs
/// on a background Task) — only the flag transition is serialized.
@available(iOS 17.0, *)
final class SyncDirtyScanner {
    static let shared = SyncDirtyScanner()

    private let fm = FileManager.default
    private let interval: TimeInterval = 180
    private var timer: Timer?

    /// Guards against overlapping scans: a scan that runs longer than the timer
    /// interval (slow disk / many skills) would otherwise be re-entered by the
    /// next tick while still suspended at an `await`. Mutated only under
    /// `scanLock`, so the check-and-set is atomic across concurrent Tasks.
    private var isScanning = false
    private let scanLock = NSLock()

    /// Last-known modification dates keyed by relative identifier (e.g. "skill:mySkill").
    /// Only ever touched by the single in-flight scan (enforced by `isScanning`),
    /// so no per-access lock is needed.
    private var knownModDates: [String: Date] = [:]

    private var skillsDir: URL {
        AIChatViewModel.minisSkillsPersistentDir
    }

    private init() {}

    /// Start the periodic scanner on the main run loop.
    func start() {
        guard timer == nil else { return }
        logger.info("[SyncDirtyScanner] Starting (interval: \(self.interval)s)")
        // Run an initial scan immediately
        Task { await scan() }
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.scan() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Scan

    private func scan() async {
        // [T-ios-sync-dirty-scanner-skills-race] Atomic check-and-set of the
        // reentrancy flag: if another scan is already in flight, skip this tick.
        // This admits exactly one in-flight scan, so the (non-overlapping) scan
        // is the sole accessor of `knownModDates` — no concurrent mutation, no
        // CoW-buffer corruption. The lock guards ONLY the flag (held for
        // microseconds), never the scan body, so the FS work stays off-main.
        scanLock.lock()
        if isScanning {
            scanLock.unlock()
            logger.info("[SyncDirtyScanner] scan already in flight — skipping this tick")
            return
        }
        isScanning = true
        scanLock.unlock()

        defer {
            scanLock.lock()
            isScanning = false
            scanLock.unlock()
        }

        await scanSkills()
        await scanConfigFiles()
        await scanMemoryFiles()
    }

    // MARK: - Skills

    /// Return the max file modification date for a given skill ID.
    /// Used by CloudSyncEngine to detect filesystem changes not reflected in the DB.
    static func maxModDate(inSkill skillId: String) -> Date {
        let dir = AIChatViewModel.minisSkillsPersistentDir.appendingPathComponent(skillId)
        return SyncDirtyScanner.shared.maxModDate(in: dir)
    }

    /// Compute the max modification date across all files in a skill directory,
    /// excluding build artifacts, caches, and VCS directories.
    private func maxModDate(in dir: URL) -> Date {
        var maxDate = Date.distantPast
        guard let enumerator = fm.enumerator(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return maxDate }
        for case let fileURL as URL in enumerator {
            if SkillStore.isExcludedDir(fileURL.lastPathComponent) {
                enumerator.skipDescendants()
                continue
            }
            let values = try? fileURL.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
            guard values?.isRegularFile == true,
                  let fDate = values?.contentModificationDate, fDate > maxDate else { continue }
            maxDate = fDate
        }
        return maxDate
    }

    private func scanSkills() async {
        guard let entries = try? fm.contentsOfDirectory(
            at: skillsDir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        var currentSkillIds = Set<String>()

        for entry in entries {
            guard (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true else { continue }
            let skillId = entry.lastPathComponent
            currentSkillIds.insert(skillId)

            let skillFile = entry.appendingPathComponent("SKILL.md")
            guard fm.fileExists(atPath: skillFile.path) else { continue }

            // [T-ios-shell-created-skill-not-syncing] Backstop for skills that
            // appear on disk after launch (e.g. shell-created mid-session): if
            // this dir has no matching in-memory skill, ingest it via the shared
            // reconcile (registers DB row + markDirty for upload) BEFORE the
            // baseline logic below. Without this, the first-scan branch would
            // record a mod-date baseline and never markDirty, so the orphan
            // would stay silent until an unrelated edit. No-op once it's a
            // known skill, so existing DB-row skills keep their baseline-only
            // first-scan behavior (no re-upload-all-on-restart regression).
            let alreadyKnown = await MainActor.run { SkillStore.shared.skills.contains { $0.id == skillId } }
            if !alreadyKnown {
                await MainActor.run { _ = SkillStore.shared.reconcileOrphanSkill(id: skillId) }
            }

            let key = "skill:\(skillId)"
            // Check max mod date across ALL files (not just SKILL.md) so bundled
            // script/reference changes are detected.
            let modDate = maxModDate(in: entry)
            guard modDate > .distantPast else { continue }

            if let known = knownModDates[key] {
                if modDate > known {
                    logger.info("[SyncDirtyScanner] Skill changed: \(skillId)")
                    await ChatStore.shared.markDirty(recordType: "Skill", recordId: skillId)
                    knownModDates[key] = modDate
                }
            } else {
                // First scan: record baseline only, do NOT markDirty.
                // SkillStore already calls markDirty when files are written.
                // Marking dirty here would cause all skills to re-upload on every app restart.
                knownModDates[key] = modDate
            }
        }

        // Clean up tracking for deleted skills (no sync — deletions are local-only)
        let trackedKeys = knownModDates.keys.filter { $0.hasPrefix("skill:") }
        for key in trackedKeys {
            let skillId = String(key.dropFirst("skill:".count))
            if !currentSkillIds.contains(skillId) {
                knownModDates.removeValue(forKey: key)
            }
        }
    }

    // MARK: - Config Files

    /// Scan provider-config.json and env-vars.json for changes not caught by event-driven markDirty
    /// (e.g. file modified by backup restore or share extension).
    private func scanConfigFiles() async {
        let library = fm.urls(for: .libraryDirectory, in: .userDomainMask).first!
        let files: [(path: String, recordType: String, recordId: String)] = [
            ("MinisChat/provider-config.json", "ProviderConfig", "provider-config"),
            ("MinisChat/env-vars.json", "EnvVar", "env-vars"),
        ]
        for file in files {
            let url = library.appendingPathComponent(file.path)
            guard fm.fileExists(atPath: url.path) else { continue }
            let key = "config:\(file.recordId)"
            guard let attrs = try? url.resourceValues(forKeys: [.contentModificationDateKey]),
                  let modDate = attrs.contentModificationDate else { continue }
            if let known = knownModDates[key] {
                if modDate > known {
                    logger.info("[SyncDirtyScanner] Config changed: \(file.recordId)")
                    await ChatStore.shared.markDirty(recordType: file.recordType, recordId: file.recordId)
                    knownModDates[key] = modDate
                }
            } else {
                // First scan: record baseline only
                knownModDates[key] = modDate
            }
        }

        // [T-mcp-per-server-sync] mcp-servers/servers.json lives in the
        // MinisConfig persistent dir (bind-mounted at /var/minis/mcp-servers),
        // and is also written by the in-guest minis-mcp-cli — so an mtime scan
        // is the only way to catch CLI edits. The mtime is only the cheap
        // trigger: the actual dirty marking is per-server, done by
        // MCPStore.scanExternalChanges() against its persisted semantic
        // fingerprints (so an inbound sync apply — which also moves the
        // mtime — never echoes back, and CLI edits made while the app was
        // closed are still caught on the first scan after launch).
        let mcpURL = MCPStore.syncFileURL
        if fm.fileExists(atPath: mcpURL.path),
           let attrs = try? mcpURL.resourceValues(forKeys: [.contentModificationDateKey]),
           let modDate = attrs.contentModificationDate {
            let key = "config:mcp-servers"
            if knownModDates[key] == nil || modDate > knownModDates[key]! {
                let isFirstScan = knownModDates[key] == nil
                knownModDates[key] = modDate
                if !isFirstScan {
                    logger.info("[SyncDirtyScanner] servers.json mtime moved — running per-server fingerprint scan")
                }
                // First scan also runs the fingerprint scan: fingerprints are
                // persisted, so this is a no-op unless the file changed while
                // the app was closed.
                await MainActor.run { MCPStore.shared.scanExternalChanges() }
            }
        }
    }

    // MARK: - Memory Files

    private func scanMemoryFiles() async {
        let memDir = AIChatViewModel.minisMemoryPersistentDir
        guard fm.fileExists(atPath: memDir.path),
              let files = try? fm.contentsOfDirectory(at: memDir,
                                                       includingPropertiesForKeys: [.contentModificationDateKey],
                                                       options: [.skipsHiddenFiles])
        else { return }

        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        let cutoff = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()

        for fileURL in files {
            let name = fileURL.lastPathComponent
            guard fileURL.pathExtension == "md" else { continue }

            let modDate = (try? fileURL.resourceValues(forKeys: [.contentModificationDateKey])
                                .contentModificationDate) ?? Date.distantPast
            let cacheKey = "memory:\(name)"

            // [T-icloud-local-edit-clobber] Mirror the skills/config scans:
            // first scan records a baseline WITHOUT marking dirty (in-app
            // memory writes already markDirty event-driven; re-marking every
            // file on each launch re-pushed the whole memory set every time).
            // Only a mtime moving FORWARD marks dirty — an inbound apply
            // backdates its mtime to the record's updatedAt, which must not
            // count as a fresh local edit.
            if name == "GLOBAL.md" {
                if let known = knownModDates[cacheKey] {
                    if modDate > known {
                        knownModDates[cacheKey] = modDate
                        await ChatStore.shared.markDirty(recordType: "MemoryGlobalV2",
                                                         recordId: "memory-global")
                        logger.info("[SyncDirtyScanner] GLOBAL.md changed, marked dirty")
                    } else if modDate != known {
                        // Backdated by an inbound apply — track, don't push.
                        knownModDates[cacheKey] = modDate
                    }
                } else {
                    knownModDates[cacheKey] = modDate
                }
            } else {
                // Daily log: check 30-day cutoff
                let stem = (name as NSString).deletingPathExtension
                if let fileDate = fmt.date(from: stem), fileDate >= cutoff {
                    if let known = knownModDates[cacheKey] {
                        if modDate > known {
                            knownModDates[cacheKey] = modDate
                            await ChatStore.shared.markDirty(recordType: "MemoryDailyV2",
                                                             recordId: stem)
                            logger.info("[SyncDirtyScanner] \(name) changed, marked dirty")
                        } else if modDate != known {
                            knownModDates[cacheKey] = modDate
                        }
                    } else {
                        knownModDates[cacheKey] = modDate
                    }
                }
            }
        }
    }
}
