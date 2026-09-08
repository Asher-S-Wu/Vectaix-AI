#if DEBUG
import Foundation

/// JSON-RPC handlers for the PerfTrace main-thread span timer.
///
/// PerfTrace is opt-in: it does nothing until started here, mirroring the
/// hang detector. Once enabled, instrumented `PerfTrace.measure { }` spans
/// that exceed the threshold log a `[JANK]` line + business call stack to
/// the daily log file (pull with `debug.logs.read`).
enum DebugRPCPerfTrace {

    /// `debug.perfTrace.start { thresholdMs?: 16, throttleWindow?: 0.5 }`
    ///   -> `{ ok, isEnabled, thresholdMs, throttleWindow }`
    static func start(params: [String: Any]) -> [String: Any] {
        let thresholdMs: Double? = (params["thresholdMs"] as? Double)
            ?? (params["thresholdMs"] as? Int).map(Double.init)
        let throttleWindow: Double? = (params["throttleWindow"] as? Double)
            ?? (params["throttleWindow"] as? Int).map(Double.init)
        PerfTrace.start(thresholdMs: thresholdMs, throttleWindow: throttleWindow)
        return [
            "ok": true,
            "isEnabled": PerfTrace.isEnabled,
            "thresholdMs": PerfTrace.thresholdMs,
            "throttleWindow": PerfTrace.throttleWindow,
        ]
    }

    /// `debug.perfTrace.stop {}` -> `{ ok, isEnabled }`
    /// Disables span timing and flushes any pending worst-samples to the log.
    static func stop() -> [String: Any] {
        PerfTrace.stop()
        return [
            "ok": true,
            "isEnabled": PerfTrace.isEnabled,
        ]
    }

    /// `debug.perfTrace.status {}` -> `{ isEnabled, thresholdMs, throttleWindow }`
    static func status() -> [String: Any] {
        return [
            "isEnabled": PerfTrace.isEnabled,
            "thresholdMs": PerfTrace.thresholdMs,
            "throttleWindow": PerfTrace.throttleWindow,
        ]
    }

    /// `debug.perfTrace.flush {}` -> `{ ok }`
    /// Force-emit pending worst-samples without disabling the timer.
    static func flush() -> [String: Any] {
        PerfTrace.flushAll()
        return ["ok": true]
    }
}

#endif // DEBUG
