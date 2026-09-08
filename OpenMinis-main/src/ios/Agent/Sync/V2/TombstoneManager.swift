import Foundation

private let logger = AppLogger(category: "SyncConflict")

/// Inbound-deletion gateway for SessionV2 records.
///
/// History: an earlier draft (§3.3 of the v2 design) implemented soft-
/// tombstones — incoming SessionV2 deletes set
/// `sessions.remote_tombstoned_at` and kept the row + children visible,
/// with a "resurrect cascade" if the user ever wrote into a tombstoned
/// session again. That ended up creating phantom empty rows in peers'
/// session lists (children get hard-deleted by the originating device's
/// markSessionForCloudDeletion), so the policy was simplified to:
///
///   • Inbound SessionV2 op=delete → hard-delete locally (row + child
///     messages + compact markers + session-files folder), and DO NOT
///     re-queue the delete back into our v2 dirty table — the cloud
///     already has it. Re-queueing risks a delete-amplification loop
///     with peers that haven't yet observed the same tombstone.
///   • Inbound MessageV2 / CompactMarkerV2 op=delete → still pass through
///     as plain hard deletes via ChatStoreSyncHydrators (handled there,
///     not here).
///
/// The `tombstone` name persists on the type for git blame continuity
/// and because `sessions.remote_tombstoned_at` still exists on disk for
/// any rows that were tombstoned under the old policy. Those legacy rows
/// are left alone; no migration step removes them. The column simply
/// goes unread.
@MainActor
final class TombstoneManager {
    static let shared = TombstoneManager()
    private init() {}

    /// Apply a remote SessionV2 deletion: hard-delete this device's copy.
    /// Returns true if a row was removed (false = already gone, idempotent).
    @discardableResult
    func applyRemoteSessionDeletion(sessionId: String) async -> Bool {
        // Probe before we act so the log line accurately reports whether
        // anything happened — also lets idempotent re-applies stay quiet.
        let exists = await ChatStore.shared.sessionExists(id: sessionId)
        guard exists else { return false }
        await ChatStore.shared.deleteSessionLocalOnly(sessionId)
        logger.info("[SyncConflict] hard delete applied: type=SessionV2 id=\(sessionId.prefix(8)) source=remoteDeletion")
        return true
    }

    /// Compatibility shim — old callers asked "is this session
    /// tombstoned?" Answer is now always false (we don't tombstone
    /// anymore) but legacy DB rows might still have a value, which we
    /// ignore.
    func isTombstoned(sessionId: String) async -> Bool {
        return false
    }

    /// Diagnostic for debug RPC: list any rows that still carry a legacy
    /// tombstone timestamp on disk. Should always return [] on a clean
    /// install but will surface old data if migrations didn't sweep.
    func allTombstonedSessionIds() async -> [String] {
        await ChatStore.shared.tombstonedSessionIds()
    }

    /// Reconciliation after a full fetch: sessions present locally but
    /// absent from the cloud are stale local copies → hard-delete them.
    /// Same policy as inbound: don't re-queue any cloud delete (the
    /// cloud authoritative state is "absent", we're catching up to it).
    func reconcileAfterFullFetch(localSessionIds: Set<String>, cloudSessionIds: Set<String>) async {
        let localOnly = localSessionIds.subtracting(cloudSessionIds)
        guard !localOnly.isEmpty else { return }
        logger.info("[SyncConflict] reconcileAfterFullFetch: \(localOnly.count) local-only session(s), hard-deleting")
        for sid in localOnly {
            _ = await applyRemoteSessionDeletion(sessionId: sid)
        }
    }
}
