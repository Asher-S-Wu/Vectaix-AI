import Foundation

struct AppLogger {
    let category: String

    init(subsystem: String = "com.openminis.app", category: String) {
        self.category = category
    }

    // [T-ios-log-noise-reduction] DEBUG is suppressed in Release builds so
    // diagnostic chatter (agentHistory dumps, per-record sync traces, etc.)
    // downgraded to `.debug()` adds zero cost / zero noise to shipped logs,
    // while staying available to developers running a Debug build. Use
    // `@autoclosure` so the message string isn't even built in Release —
    // the interpolation cost is skipped entirely, not just the NSLog.
    func debug(_ message: @autoclosure () -> String) {
        #if DEBUG
        log("DEBUG", message())
        #endif
    }
    func info(_ message: String)     { log("INFO", message) }
    func notice(_ message: String)   { log("NOTICE", message) }
    func warning(_ message: String)  { log("WARN", message) }
    func error(_ message: String)    { log("ERROR", message) }
    func critical(_ message: String) { log("CRIT", message) }
    func fault(_ message: String)    { log("FAULT", message) }

    private func log(_ level: String, _ message: String) {
        NSLog("[%@] [%@] %@", category, level, message)
        if level == "INFO" || level == "WARN" || level == "ERROR" {
            let ts = Date().formatted(.dateTime.hour().minute().second())
            let line = "[\(ts)] [\(category)] \(message)"
            CrashReporter.shared.appendLog(line)
        }
    }
}
