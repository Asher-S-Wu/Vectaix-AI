#if DEBUG
import Foundation

/// JSON-RPC handlers for the main-thread hang detector.
///
/// All methods are static and free of UI-thread requirements; the detector
/// itself coordinates with the main runloop internally.
enum DebugRPCHangDetector {

    /// `debug.hangDetector.start { thresholdMs?: 100 }` -> `{ ok, isRunning, thresholdMs }`
    static func start(params: [String: Any]) -> [String: Any] {
        let thresholdMs: Double = (params["thresholdMs"] as? Double)
            ?? Double((params["thresholdMs"] as? Int) ?? 100)
        let started = HangDetector.start(withThresholdMs: thresholdMs)
        return [
            "ok": started,
            "isRunning": HangDetector.isRunning,
            "thresholdMs": HangDetector.thresholdMs,
        ]
    }

    /// `debug.hangDetector.stop {}` -> `{ ok, isRunning }`
    static func stop() -> [String: Any] {
        HangDetector.stop()
        return [
            "ok": true,
            "isRunning": HangDetector.isRunning,
        ]
    }

    /// `debug.hangDetector.dump { last?: 20, clear?: false }` ->
    ///   `{ count, isRunning, thresholdMs, events: [{timestamp, durationMs, runLoopActivity, frames:[{address, image, offset, symbol?}]}] }`
    static func dump(params: [String: Any]) -> [String: Any] {
        let last = UInt(((params["last"] as? Int) ?? 20).clamped(to: 0...10000))
        let clear = (params["clear"] as? Bool) ?? false
        let events = HangDetector.dumpLast(last, clear: clear)

        let serializedEvents: [[String: Any]] = events.map { event in
            let frames: [[String: Any]] = event.frames.map { frame -> [String: Any] in
                var out: [String: Any] = [
                    "address": String(format: "0x%lx", frame.address),
                    "offset": String(format: "0x%lx", frame.imageOffset),
                ]
                if let img = frame.imageName { out["image"] = img }
                if let sym = frame.symbol { out["symbol"] = sym }
                return out
            }
            return [
                "timestamp": event.timestamp,
                "durationMs": event.durationMs,
                "runLoopActivity": event.runLoopActivity,
                "frames": frames,
            ]
        }

        return [
            "count": serializedEvents.count,
            "isRunning": HangDetector.isRunning,
            "thresholdMs": HangDetector.thresholdMs,
            "events": serializedEvents,
        ]
    }

    /// `debug.hangDetector.clear {}` -> `{ ok }`
    static func clear() -> [String: Any] {
        HangDetector.clearEvents()
        return ["ok": true]
    }
}

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

#endif // DEBUG
