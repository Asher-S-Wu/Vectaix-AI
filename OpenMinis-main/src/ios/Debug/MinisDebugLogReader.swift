import Foundation
import OSLog

/// In-process log reader for the `minis-debug logs` CLI subcommand.
///
/// Unlike the rest of the minis-debug CLI (which routes JSON-RPC through
/// `DebugLocalDispatch` / `DebugJSONRPC` and is therefore Debug-build-only),
/// this reader is intentionally **available in Release builds**. It lets a user
/// reproducing a bug on their own Release device read the app's own runtime log
/// output (StopDiag / RetryDiag etc.) without attaching Xcode.
///
/// Two sources, tried in order:
///   1. `OSLogStore(scope: .currentProcessIdentifier)` (iOS 15+) — the unified
///      log buffer for this process. `AppLogger` writes via `NSLog`, which the
///      system bridges into the unified log, so `logger.info/.warning/.error`
///      lines land here with the full "[Category] [LEVEL] message" text as the
///      composed message. This works regardless of whether the user has the
///      in-app "Save logs to file" toggle on, which is why it's preferred.
///   2. `LoggingManager`'s daily file (`minis-YYYY-MM-DD.log`) — the same NSLog
///      output captured to disk. Used as a fallback when OSLogStore returns
///      nothing or is unavailable (e.g. entitlement quirk). Only populated when
///      the user enabled file logging.
///
/// NOTE: not `#if DEBUG`-gated — Release availability is the whole point
/// (T-ios-minis-debug-logs-oslogstore).
@objc public final class MinisDebugLogReader: NSObject {

    @objc(sharedInstance)
    public static let shared = MinisDebugLogReader()

    private override init() { super.init() }

    /// Read recent log lines and return a JSON string:
    ///   { "source": "oslog"|"file"|"none", "count": N, "lines": [String],
    ///     "note": String? }
    /// All filters are optional:
    ///   - lastN:    keep only the most recent N matching lines (<= 0 = no cap)
    ///   - minutes:  only entries from the last N minutes (<= 0 = no time bound)
    ///   - grep:     case-insensitive substring filter (nil/empty = no filter)
    ///
    /// Synchronous and side-effect free; safe to call from the offload thread.
    @objc public func readLogsJSON(lastN: Int, minutes: Int, grep: String?) -> String {
        let keyword = (grep?.isEmpty == false) ? grep : nil
        let sinceDate: Date? = minutes > 0 ? Date(timeIntervalSinceNow: -Double(minutes) * 60) : nil

        // 1. Primary: unified log store for this process.
        if let osResult = readFromOSLogStore(lastN: lastN, since: sinceDate, keyword: keyword),
           !osResult.isEmpty {
            return Self.encode(source: "oslog", lines: osResult, note: nil)
        }

        // 2. Fallback: today's LoggingManager file.
        if let fileResult = readFromLogFile(lastN: lastN, since: sinceDate, keyword: keyword) {
            let note = LoggingManager.shared.isEnabled
                ? nil
                : "File logging is disabled; enable it in Settings for the on-disk fallback. (OSLogStore returned no matching entries.)"
            return Self.encode(source: "file", lines: fileResult, note: note)
        }

        return Self.encode(
            source: "none",
            lines: [],
            note: "No matching log entries. OSLogStore returned nothing and no daily log file was readable."
        )
    }

    // MARK: - OSLogStore

    private func readFromOSLogStore(lastN: Int, since: Date?, keyword: String?) -> [String]? {
        guard #available(iOS 15.0, *) else { return nil }
        do {
            let store = try OSLogStore(scope: .currentProcessIdentifier)
            // Bound the scan: prefer the explicit time window; otherwise look
            // back a generous default so `--last N` has enough to choose from
            // without walking the entire process lifetime.
            let position: OSLogPosition
            if let since {
                position = store.position(date: since)
            } else {
                position = store.position(date: Date(timeIntervalSinceNow: -3600)) // last hour
            }
            let entries = try store.getEntries(at: position)

            var lines: [String] = []
            for entry in entries {
                guard let logEntry = entry as? OSLogEntryLog else { continue }
                if let since, logEntry.date < since { continue }
                // AppLogger's NSLog output is the composed message; it already
                // contains "[Category] [LEVEL] message". Prefix with a short
                // timestamp for readability.
                let msg = logEntry.composedMessage
                if let keyword, msg.range(of: keyword, options: .caseInsensitive) == nil { continue }
                let ts = Self.timeFormatter.string(from: logEntry.date)
                lines.append("[\(ts)] \(msg)")
            }
            if lastN > 0, lines.count > lastN {
                lines = Array(lines.suffix(lastN))
            }
            return lines
        } catch {
            return nil
        }
    }

    // MARK: - File fallback

    private func readFromLogFile(lastN: Int, since: Date?, keyword: String?) -> [String]? {
        let mgr = LoggingManager.shared
        // Newest file first; pick today's (or the most recent) log.
        guard let newest = mgr.logFiles().first else { return nil }
        let raw = mgr.readLog(at: newest.url, maxBytes: 1_048_576) // 1MB tail
        guard !raw.isEmpty else { return nil }

        var lines = raw.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

        // File lines are "[HH:mm:ss] [Category] [LEVEL] message". The --minutes
        // filter can only be applied coarsely here (time-of-day, no date), so
        // when a time bound is requested but we're reading a same-day file we
        // keep lines whose leading HH:mm:ss is >= the cutoff's time-of-day.
        if let since {
            let cutoff = Self.timeFormatter.string(from: since)
            lines = lines.filter { line in
                guard line.hasPrefix("["), let close = line.firstIndex(of: "]") else { return true }
                let stamp = String(line[line.index(after: line.startIndex)..<close])
                // Only compare when it looks like HH:mm:ss; otherwise keep.
                guard stamp.count == 8, stamp[stamp.index(stamp.startIndex, offsetBy: 2)] == ":" else { return true }
                return stamp >= cutoff
            }
        }

        if let keyword {
            lines = lines.filter { $0.range(of: keyword, options: .caseInsensitive) != nil }
        }
        lines = lines.filter { !$0.isEmpty }

        if lastN > 0, lines.count > lastN {
            lines = Array(lines.suffix(lastN))
        }
        return lines
    }

    // MARK: - Helpers

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static func encode(source: String, lines: [String], note: String?) -> String {
        var dict: [String: Any] = [
            "source": source,
            "count": lines.count,
            "lines": lines,
        ]
        if let note { dict["note"] = note }
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return "{\"source\":\"none\",\"count\":0,\"lines\":[],\"note\":\"JSON encode failed\"}"
        }
        return str
    }
}
