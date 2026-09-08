#if DEBUG
import Foundation

/// In-process bridge for the `minis-debug` CLI offload.
///
/// The CLI handler (`DebugOffload.m`) used to open a TCP connection to
/// 127.0.0.1:8321 to talk to `DebugServer`. That server is Debug-only AND can
/// fail to start (port already bound, network entitlement quirks, etc.), so
/// every subcommand would surface as `not_available`. Since the iSH shell is
/// embedded in the same app process as `DebugJSONRPC`, the CLI can dispatch
/// directly without any socket at all.
///
/// This class exposes a single `@objc` entry point that takes a JSON-RPC
/// envelope string and synchronously returns the response string. It owns
/// a lazily-initialized `DebugJSONRPC` instance so the inspector / RPC state
/// is shared across invocations (same lifetime as the app).
///
/// Release builds compile this file out via `#if DEBUG`.
@objc public final class DebugLocalDispatch: NSObject {

    @objc(sharedInstance)
    public static let shared = DebugLocalDispatch()

    private let lock = NSLock()
    private var _rpc: DebugJSONRPC?

    private override init() {
        super.init()
    }

    /// Lazily build a shared `DebugJSONRPC` on the main actor. Subsequent
    /// calls reuse the same instance so state (inspector caches, overlay
    /// modes, etc.) survives between CLI invocations the same way it does
    /// for the TCP server path. `DebugViewInspector` is `@MainActor`, so
    /// construction must hop to the main queue when called off-main.
    private func rpc() -> DebugJSONRPC {
        lock.lock()
        defer { lock.unlock() }
        if let existing = _rpc { return existing }
        let r: DebugJSONRPC
        if Thread.isMainThread {
            r = MainActor.assumeIsolated {
                DebugJSONRPC(inspector: DebugViewInspector())
            }
        } else {
            r = DispatchQueue.main.sync {
                MainActor.assumeIsolated {
                    DebugJSONRPC(inspector: DebugViewInspector())
                }
            }
        }
        _rpc = r
        return r
    }

    /// Synchronously dispatch a JSON-RPC envelope and return the response.
    ///
    /// Safe to call from any thread (the CLI offload handler runs on an iSH
    /// shell worker, not the main thread). Bridges the async `handle(json:)`
    /// via a `DispatchSemaphore` — must never be called from the main thread
    /// or it will deadlock against any `@MainActor` work `handle(json:)`
    /// dispatches.
    @objc public func dispatch(envelopeJSON: String) -> String {
        if Thread.isMainThread {
            // Should never happen for the CLI path. Fail loud rather than
            // hang the UI: return a synthetic JSON-RPC error instead of
            // deadlocking on the semaphore wait below.
            return Self.mainThreadErrorJSON()
        }
        let rpc = self.rpc()
        let sem = DispatchSemaphore(value: 0)
        var out: String = ""
        Task.detached {
            let resp = await rpc.handle(json: envelopeJSON)
            out = resp
            sem.signal()
        }
        sem.wait()
        return out
    }

    private static func mainThreadErrorJSON() -> String {
        return #"{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"DebugLocalDispatch invoked on main thread (would deadlock); call from a background queue."}}"#
    }
}
#endif
