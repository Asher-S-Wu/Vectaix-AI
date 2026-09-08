import Foundation

// Test-target-only stand-in for the app's AppLogger (Shared/AppLogger.swift).
//
// The MinisTests target compiles a few production sources directly (ContextPolicy,
// ToolLoopDetector, GeminiWireFormat, TextSegmenter, JiebaWrapper). ToolLoopDetector
// declares `private let logger = AppLogger(category:)`, but the real AppLogger calls
// `CrashReporter.shared.appendLog(...)`, and CrashReporter in turn pulls in
// SessionActivityTracker / BackgroundKeepAliveManager / BrowserTabPoolRegistry /
// MetricKit — i.e. half the app — which is far more than a unit-test bundle should
// link. Without this, the test target simply does not compile ("Cannot find
// 'AppLogger' in scope"), which is why these tests had never been run.
//
// This shim keeps the same call surface and just writes to NSLog, so the tests can
// build and run without the crash-reporting dependency chain. It lives in the
// MinisTests synchronized folder, so it is compiled ONLY into the test bundle and
// never ships in the app.
struct AppLogger {
    let category: String

    init(category: String) {
        self.category = category
    }

    func debug(_ message: String) { log("DEBUG", message) }
    func info(_ message: String) { log("INFO", message) }
    func warning(_ message: String) { log("WARN", message) }
    func error(_ message: String) { log("ERROR", message) }
    func critical(_ message: String) { log("CRIT", message) }
    func fault(_ message: String) { log("FAULT", message) }

    private func log(_ level: String, _ message: String) {
        NSLog("[%@] [%@] %@", category, level, message)
    }
}
