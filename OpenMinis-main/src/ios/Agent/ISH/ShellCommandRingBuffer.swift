import Foundation

struct ShellCommandEntry {
    let index: Int
    let startedAt: Date
    let command: String
    let sessionId: String
    var exitCode: Int?
    var duration: TimeInterval?
    var exitedAt: Date?
}

actor ShellCommandRingBuffer {
    static let shared = ShellCommandRingBuffer()
    private let capacity = 10
    private var entries: [ShellCommandEntry] = []
    private var counter = 0

    private static let _lock = NSLock()
    nonisolated(unsafe) private static var _runningCount = 0
    nonisolated(unsafe) private static var _lastSnapshot: [ShellCommandEntry] = []

    nonisolated static var hasRunningCommand: Bool {
        _lock.lock(); defer { _lock.unlock() }
        return _runningCount > 0
    }

    nonisolated static var syncSnapshot: [ShellCommandEntry] {
        _lock.lock(); defer { _lock.unlock() }
        return _lastSnapshot
    }

    func didStart(command: String, sessionId: String) -> Int {
        let idx = counter
        counter += 1
        let trimmed = command.count > 500 ? String(command.prefix(500)) : command
        let entry = ShellCommandEntry(
            index: idx,
            startedAt: Date(),
            command: trimmed,
            sessionId: sessionId
        )
        entries.append(entry)
        if entries.count > capacity {
            entries.removeFirst(entries.count - capacity)
        }
        liveStarts.insert(idx)
        Self._lock.lock()
        Self._runningCount += 1
        Self._lastSnapshot = entries
        Self._lock.unlock()
        return idx
    }

    func didExit(index: Int, exitCode: Int) {
        finish(index: index, exitCode: exitCode)
    }

    /// [T-ios-shellring-counter-leak] Terminal state for a command that never
    /// returned an exit code — it threw, was cancelled, or its process was
    /// killed. Keeps `_runningCount` balanced; without this the counter latched
    /// high forever and `hasRunningCommand` stayed true for the rest of the
    /// process lifetime. `exitCode` stays nil, and `exitedAt` marks it resolved
    /// so crash reports can distinguish "aborted" from "still running".
    func didAbort(index: Int) {
        finish(index: index, exitCode: nil)
    }

    /// Shared terminal transition. Decrements `_runningCount` even when the ring
    /// has already evicted the entry (>10 commands since it started) — the
    /// counter tracks live commands, not retained rows, so an evicted entry must
    /// still be accounted for or the counter leaks.
    private func finish(index: Int, exitCode: Int?) {
        // Resolve duplicate-suppression FIRST, then decrement exactly once.
        //
        // The index-window prune this used to rely on was unsound: it dropped
        // indices older than `counter - capacity * 4`, so once a session had run
        // enough commands, a second terminal call for an already-resolved index
        // was no longer recognized as a duplicate and decremented the counter a
        // second time — stealing the decrement from a genuinely-running command.
        // `_runningCount` could then latch LOW (hasRunningCommand == false while
        // a command runs), the exact inverse of the leak this type exists to
        // prevent. `liveStarts` replaces that heuristic with an exact set of
        // indices currently in flight: membership is the authority, so an index
        // can only ever be decremented once, no matter how many terminal calls
        // arrive or how long the command outlives the 10-slot ring.
        guard liveStarts.remove(index) != nil else { return }

        if let pos = entries.firstIndex(where: { $0.index == index }) {
            let now = Date()
            entries[pos].exitCode = exitCode
            entries[pos].exitedAt = now
            entries[pos].duration = now.timeIntervalSince(entries[pos].startedAt)
        }
        // No `else`: an entry evicted from the ring still has to be counted, and
        // `liveStarts` above already guaranteed this runs at most once.
        Self._lock.lock()
        Self._runningCount = max(0, Self._runningCount - 1)
        Self._lastSnapshot = entries
        Self._lock.unlock()
    }

    /// Indices handed out by `didStart` that have not yet reached a terminal
    /// state. Bounded by the number of genuinely concurrent commands (small),
    /// not by history, and each removal is the single authority for decrementing
    /// `_runningCount` — so duplicate/late terminal calls are exact no-ops.
    private var liveStarts: Set<Int> = []

    func snapshot() -> [ShellCommandEntry] {
        entries
    }
}
