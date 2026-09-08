//
//  PerfTrace.swift
//  MinisApp (Debug only)
//
//  Threshold-tripped main-thread span timer for pinpointing scroll jank.
//
//  HangDetector tells you the main thread stalled and which *system* frame
//  it was parked in (almost always SwiftUI's flushTransactions / commit),
//  but not which of *your* closures made that commit expensive. PerfTrace
//  fills that gap: wrap a suspect synchronous closure, and if it runs
//  longer than the threshold (default = one 60fps frame, 16ms) it logs the
//  elapsed time plus the *business* call stack at that moment — the frames
//  HangDetector can't reach because it samples after the work is already
//  underway.
//
//  Usage:
//      let menu = PerfTrace.measure("sessionContextMenu") {
//          buildContextMenu(...)
//      }
//      PerfTrace.measure("SessionRow.body") { ... }
//
//  Everything is `#if DEBUG`-gated and compiles to the bare closure call in
//  Release (no timing, no symbol capture, zero overhead). Logs go through
//  AppLogger so they land in the daily log file and are pullable over
//  :8321 (`debug.logs.read`).
//

import Foundation
import QuartzCore

enum PerfTrace {

    #if DEBUG
    private static let logger = AppLogger(category: "PerfTrace")

    /// Runtime opt-in. PerfTrace does NOTHING until explicitly enabled — even
    /// in DEBUG builds `measure` is a bare passthrough so it costs nothing on
    /// normal use. Turn it on via the debug server (`debug.perfTrace.start`),
    /// mirroring how HangDetector is opt-in. Default OFF.
    nonisolated(unsafe) private static var _enabled = false

    /// Whether span timing + stack capture is currently active.
    static var isEnabled: Bool {
        lock.lock(); defer { lock.unlock() }
        return _enabled
    }

    /// Enable span timing. `thresholdMs` sets the trip point (default 16ms =
    /// one 60fps frame). Clamped to [1, 5000].
    static func start(thresholdMs: Double? = nil, throttleWindow: Double? = nil) {
        lock.lock()
        if let t = thresholdMs { PerfTrace.thresholdMs = min(max(t, 1), 5000) }
        if let w = throttleWindow { PerfTrace.throttleWindow = max(w, 0) }
        _enabled = true
        lock.unlock()
        logger.info("PerfTrace enabled (threshold=\(String(format: "%.0f", PerfTrace.thresholdMs))ms)")
    }

    /// Disable span timing and flush any pending worst-samples.
    static func stop() {
        lock.lock()
        _enabled = false
        lock.unlock()
        flushAll()
        logger.info("PerfTrace disabled")
    }

    /// Default jank threshold: one frame at 60Hz. A span longer than this
    /// dropped at least one frame, which is what scroll jank *is*.
    static var thresholdMs: Double = 16.0

    /// Per-label throttle so a single scroll gesture that trips the same
    /// closure 200× doesn't flood the log — we keep the SLOWEST sample per
    /// label inside each window and emit it once per `throttleWindow`.
    static var throttleWindow: Double = 0.5

    private struct Pending {
        var worstMs: Double
        var worstStack: [String]
        var count: Int
        var windowStart: Double
    }
    private static let lock = NSLock()
    nonisolated(unsafe) private static var pending: [String: Pending] = [:]
    #endif

    /// Time a synchronous closure. If it exceeds the threshold, log the
    /// duration + business call stack. Returns the closure's value.
    @inline(__always)
    @discardableResult
    static func measure<T>(_ label: String,
                           thresholdMs: Double? = nil,
                           _ body: () -> T) -> T {
        #if DEBUG
        // Off by default — until started via the debug server this is a bare
        // passthrough with no timing and no symbol capture.
        lock.lock()
        let on = _enabled
        lock.unlock()
        guard on else { return body() }

        let start = CACurrentMediaTime()
        let result = body()
        let elapsedMs = (CACurrentMediaTime() - start) * 1000.0
        let limit = thresholdMs ?? PerfTrace.thresholdMs
        if elapsedMs >= limit {
            // Capture the stack on the SAME (main) thread, synchronously —
            // this is the whole point: these are the business frames.
            let stack = Thread.callStackSymbols
            record(label: label, ms: elapsedMs, stack: stack)
        }
        return result
        #else
        return body()
        #endif
    }

    #if DEBUG
    /// Coalesce by label within a throttle window, keep the worst, emit once.
    private static func record(label: String, ms: Double, stack: [String]) {
        let now = CACurrentMediaTime()
        var emit: (worstMs: Double, count: Int, stack: [String])?
        lock.lock()
        if var p = pending[label] {
            if now - p.windowStart >= throttleWindow {
                emit = (p.worstMs, p.count, p.worstStack)
                p = Pending(worstMs: ms, worstStack: stack, count: 1, windowStart: now)
            } else {
                p.count += 1
                if ms > p.worstMs { p.worstMs = ms; p.worstStack = stack }
            }
            pending[label] = p
        } else {
            pending[label] = Pending(worstMs: ms, worstStack: stack, count: 1, windowStart: now)
        }
        lock.unlock()
        if let e = emit { flush(label: label, e: e) }
    }

    private static func flush(label: String, e: (worstMs: Double, count: Int, stack: [String])) {
        // Trim the stack: drop the PerfTrace/closure-thunk preamble and cap
        // depth so the log stays readable; the business frames are near top.
        let trimmed = e.stack
            .drop { $0.contains("PerfTrace") }
            .prefix(24)
        var lines = ["[JANK] \(label) worst=\(String(format: "%.1f", e.worstMs))ms hits=\(e.count) (threshold=\(String(format: "%.0f", thresholdMs))ms)"]
        for (i, f) in trimmed.enumerated() {
            lines.append("  #\(i) \(f)")
        }
        logger.warning(lines.joined(separator: "\n"))
    }

    /// Force-emit any pending worst-sample for every label. Call at the end
    /// of a scroll session if you want the tail flushed immediately rather
    /// than waiting for the next trip to roll the window.
    static func flushAll() {
        lock.lock()
        let snapshot = pending
        pending.removeAll()
        lock.unlock()
        for (label, p) in snapshot {
            flush(label: label, e: (p.worstMs, p.count, p.worstStack))
        }
    }
    #endif
}
