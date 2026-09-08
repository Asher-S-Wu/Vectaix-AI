import Foundation
import os.log

/// Small, capped trace log written from the FileProvider extension into the
/// App Group container so the main app and the user can read FP-side traces
/// via `debug.readFile path:"AppGroup/MinisConfig/fp-sync-trace.log"`.
///
/// Why this exists: NSLog/AppLogger output from the extension does NOT reach
/// the main app's LoggingManager (separate process, separate stderr pipe).
/// `os_log` is only retrievable via Mac Console / sysdiagnose. To make the
/// FP extension's view of the world inspectable from the debug RPC, we
/// append one line per significant enumerator/item event into a small file
/// the main app can read.
///
/// Rotation: when the file exceeds `maxBytes`, drop the oldest half. No
/// background timer — checks happen lazily on append.
enum FPSyncTraceLog {
    private static let logFileName = "fp-sync-trace.log"
    private static let maxBytes: Int = 256 * 1024
    private static let queue = DispatchQueue(label: "com.openminis.app.FileProvider.fpSyncTrace")
    private static let osLog = OSLog(subsystem: "com.openminis.app.FileProvider", category: "FPSyncTrace")

    private static var fileURL: URL? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.openminis.app"
        ) else { return nil }
        let dir = container.appendingPathComponent("MinisConfig", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(logFileName)
    }

    private static let timestampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// Append one line to the trace file. Cheap to call from any thread.
    /// Also mirrors to `os_log` so Mac Console / sysdiagnose users see it
    /// without having to read the file.
    static func log(_ message: String) {
        os_log("[FPSyncTrace] %{public}@", log: osLog, type: .info, message)
        queue.async { writeLine(message) }
    }

    private static func writeLine(_ message: String) {
        guard let url = fileURL else { return }
        let ts = timestampFormatter.string(from: Date())
        let line = "[\(ts)] [FPSyncTrace] \(message)\n"
        guard let data = line.data(using: .utf8) else { return }

        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) {
            try? data.write(to: url)
            return
        }

        // Rotate if oversized — keep the second half so context survives.
        if let attrs = try? fm.attributesOfItem(atPath: url.path),
           let size = attrs[.size] as? UInt64,
           size > maxBytes {
            if let existing = try? Data(contentsOf: url) {
                let keep = existing.suffix(maxBytes / 2)
                try? keep.write(to: url)
            } else {
                try? fm.removeItem(at: url)
            }
        }

        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            // Fallback if open-for-writing fails: rewrite from scratch.
            let prev = (try? Data(contentsOf: url)) ?? Data()
            try? (prev + data).write(to: url)
        }
    }
}
