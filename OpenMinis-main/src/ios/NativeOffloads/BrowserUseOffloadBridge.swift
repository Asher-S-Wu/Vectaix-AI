//
//  BrowserUseOffloadBridge.swift
//  MinisApp
//
//  Swift bridge for BrowserTabPool, called from BrowserUseOffload.m.
//  BrowserTabPool is Swift-only and @MainActor; this class exposes
//  per-session tab pools and a synchronous-facing execute method for
//  the ObjC handler to consume via a completion block.
//

import Foundation

@objc public class BrowserUseOffloadBridge: NSObject {

    private static let logger = AppLogger(category: "BrowserUseOffloadBridge")

    /// Fallback pools keyed by session id — used only when the corresponding
    /// `AIChatViewModel` is not currently cached (e.g. Terminal opened for a
    /// session whose chat UI hasn't been instantiated yet in this process).
    /// When the agent-side vm is cached we reuse its `browserTabPool` directly
    /// so the shell and the agent share one browser state.
    ///
    /// Sentinel key `"__unmounted__"` collects the rare invocations with no
    /// resolvable session (kernel not booted / mount missing).
    @MainActor
    private static var fallbackPools: [String: BrowserTabPool] = [:]

    /// Sentinel session id for invocations with no active mount.
    private static let unmountedSentinel = "__unmounted__"

    /// Resolve the tab pool for the given session id.
    ///
    /// Resolution order:
    ///   1. Live `AIChatViewModel.browserTabPool` from `ViewModelCache` —
    ///      unifies UI-visible tabs with shell CLI usage.
    ///   2. Fallback pool bound to this sid, reused across subsequent CLI
    ///      invocations so successive shell commands see consistent tabs.
    ///      Allocated on demand iff the session still exists in ChatStore.
    ///
    /// Returns `nil` when the session has been deleted — caller must surface
    /// an error to the shell.
    @MainActor
    private static func pool(for sid: String) async -> BrowserTabPool? {
        if sid == Self.unmountedSentinel {
            return sentinelPool()
        }
        if let vm = ViewModelCache.shared.get(for: sid) {
            return vm.browserTabPool
        }
        if let existing = fallbackPools[sid] {
            return existing
        }
        // No live vm and no prior fallback — confirm the session still exists
        // before allocating. A deleted session should surface as an error in
        // the shell rather than silently spinning up a zombie pool.
        let exists = await ChatStore.shared.getSession(sid) != nil
        guard exists else {
            logger.warning("minis-browser-use invoked for deleted session \(sid.prefix(8))")
            return nil
        }
        let p = BrowserTabPool()
        p.sessionId = sid
        fallbackPools[sid] = p
        logger.info("Allocated fallback browser pool for session \(sid.prefix(8)) (no cached vm)")
        return p
    }

    @MainActor
    private static func sentinelPool() -> BrowserTabPool {
        if let p = fallbackPools[Self.unmountedSentinel] { return p }
        let p = BrowserTabPool()
        p.sessionId = Self.unmountedSentinel
        fallbackPools[Self.unmountedSentinel] = p
        logger.info("Allocated sentinel browser pool (no mounted session)")
        return p
    }

    /// Release the fallback pool for a session. Live vm-owned pools are
    /// managed by the vm lifecycle; this only touches bridge-owned fallbacks.
    /// Called from `AIChatViewModel.clearChat` / session deletion paths.
    @objc public static func releasePool(forSession sessionId: String) {
        Task { @MainActor in
            if fallbackPools.removeValue(forKey: sessionId) != nil {
                logger.info("Released fallback browser pool for session \(sessionId.prefix(8))")
            }
        }
    }

    /// Execute a browser action given a JSON payload matching the
    /// `browser_use` tool schema. The completion block receives a
    /// dictionary describing the result; the ObjC caller is responsible
    /// for serializing it to the guest's stdout.
    ///
    /// Session resolution: reads `ISHExecutionCoordinator.mountedSessionId`
    /// at the moment the handler fires. Because shell execution is
    /// serialized by the coordinator actor and the mount-swap happens
    /// synchronously before the guest command runs, this value is
    /// guaranteed to be the session that owns the current `/var/minis/`
    /// bind mount for the lifetime of this CLI invocation.
    ///
    /// When `withBase64` is false (default), any captured screenshot is
    /// persisted to that session's `/var/minis/browser/` directory and
    /// surfaced via `image_path` + `minis_url` instead of `image_base64`.
    /// Set `withBase64` to true only when the caller explicitly wants the
    /// raw base64 blob inline (e.g. piping to another tool).
    ///
    /// Keys on success: text, success, page_url?, image_path?,
    /// minis_url?, image_base64?, fetched_file?, fetched_bytes?,
    /// fetched_path?, fetched_minis_url?.
    /// Keys on failure: text, success=false.
    @objc public static func execute(
        withJson json: String,
        withBase64: Bool,
        completion: @escaping (NSDictionary) -> Void
    ) {
        let bridgeStart = CFAbsoluteTimeGetCurrent()

        guard let input = BrowserActionInput.parse(from: json) else {
            completion([
                "text": "Error: Invalid browser_use input. Required: 'action' parameter.",
                "success": false,
            ] as NSDictionary)
            return
        }

        logger.info("[BridgeTiming] enter action=\(input.action.rawValue) tab_id=\(input.tabId.map(String.init) ?? "nil") url=\(input.url?.prefix(80) ?? "nil")")

        // Resolve the owning session via the lock-protected snapshot BEFORE
        // hopping to MainActor. Awaiting the coordinator actor here used to
        // deadlock under shell pressure: the guest task thread sits on
        // `dispatch_semaphore_wait`, and this task's MainActor hop has to
        // beat every `dispatch_async(main_queue, ^{ ctx.lineCallback(line) })`
        // coming out of ISHShellExecutor to get picked up. Reading the
        // nonisolated snapshot synchronously avoids both the coordinator
        // actor suspension and one MainActor ordering hop.
        let sid = ISHExecutionCoordinator.mountedSessionIdSnapshot
                  ?? Self.unmountedSentinel

        Task { @MainActor in
            guard let pool = await Self.pool(for: sid) else {
                let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - bridgeStart) * 1000)
                logger.info("[BridgeTiming] pool_not_found elapsed=\(elapsedMs)ms sid=\(sid.prefix(8))")
                completion([
                    "text": "Error: session \(sid) no longer exists — cannot run browser_use.",
                    "success": false,
                ] as NSDictionary)
                return
            }

            let poolResolvedMs = Int((CFAbsoluteTimeGetCurrent() - bridgeStart) * 1000)
            logger.info("[BridgeTiming] pool_resolved elapsed=\(poolResolvedMs)ms sid=\(sid.prefix(8))")

            do {
                // CLI is a serial human/script driver — run in single-tab mode
                // so navigate → execute_js / get_page_info / get_text etc. all
                // hit the page just navigated to, instead of being fanned out
                // across grace-busy tabs. Explicit --tab-id still routes
                // normally. Agent tool path keeps the default (fan-out).
                // [T-browser-executejs-stale-context-ios]
                let result = try await pool.execute(action: input, singleTab: true)
                let poolDoneMs = Int((CFAbsoluteTimeGetCurrent() - bridgeStart) * 1000)
                logger.info("[BridgeTiming] pool_execute_done elapsed=\(poolDoneMs)ms action=\(input.action.rawValue)")

                let encoded = Self.encode(result, withBase64: withBase64, sid: sid)
                let totalMs = Int((CFAbsoluteTimeGetCurrent() - bridgeStart) * 1000)
                logger.info("[BridgeTiming] completion elapsed=\(totalMs)ms action=\(input.action.rawValue) success=\(result.success)")
                completion(encoded)
            } catch {
                let totalMs = Int((CFAbsoluteTimeGetCurrent() - bridgeStart) * 1000)
                logger.info("[BridgeTiming] error elapsed=\(totalMs)ms action=\(input.action.rawValue) error=\(error.localizedDescription.prefix(120))")
                completion([
                    "text": "Error: \(error.localizedDescription)",
                    "success": false,
                ] as NSDictionary)
            }
        }
    }

    private static func encode(_ r: BrowserActionResult, withBase64: Bool, sid: String) -> NSDictionary {
        let out = NSMutableDictionary()
        out["text"] = r.text
        out["success"] = r.success
        if let url = r.pageURL, !url.isEmpty { out["page_url"] = url }

        // Persist screenshot + fetched bytes under the invoking session's
        // browser directory. We resolve the host path directly from the sid
        // captured at execute() entry instead of querying the coordinator's
        // live mount table — a concurrent UI session-switch could null that
        // out mid-flight. `minisBrowserPersistentDir` is a pure path join
        // against Library/MinisChat/minis/<sid>/browser/, which is exactly
        // what /var/minis/browser/ bind-mounts to for that session.
        let browserHostDir: URL? = (sid == Self.unmountedSentinel)
            ? nil
            : AIChatViewModel.minisBrowserPersistentDir(for: sid)

        // ── Screenshot / snapshot ──
        var persistedImagePath: String? = nil
        if let b64 = r.base64Image, !b64.isEmpty, let data = Data(base64Encoded: b64) {
            let filename = "screenshot_\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
            if let hostDir = browserHostDir {
                try? FileManager.default.createDirectory(at: hostDir, withIntermediateDirectories: true)
                let dest = hostDir.appendingPathComponent(filename)
                do {
                    try data.write(to: dest)
                    let linuxPath = "\(AIChatViewModel.minisBrowserLinuxDir)/\(filename)"
                    persistedImagePath = linuxPath
                    out["image_path"] = linuxPath
                    out["minis_url"] = "minis://browser/\(filename)"
                } catch {
                    logger.warning("Failed to persist screenshot to \(dest.path): \(error.localizedDescription)")
                }
            } else {
                logger.warning("No /var/minis/browser mount — falling back to base64-only output")
            }
        }

        // Fall back to the in-memory host path only when we couldn't persist.
        if persistedImagePath == nil, let p = r.imageFilePath, !p.isEmpty {
            out["image_path"] = p
        }

        if withBase64, let b = r.base64Image, !b.isEmpty {
            out["image_base64"] = b
        }

        // ── Fetched file (fetch action) ──
        if let name = r.fetchedFileName, !name.isEmpty {
            out["fetched_file"] = name
            if let data = r.fetchedFileData {
                out["fetched_bytes"] = data.count
                if let hostDir = browserHostDir {
                    try? FileManager.default.createDirectory(at: hostDir, withIntermediateDirectories: true)
                    let dest = hostDir.appendingPathComponent(name)
                    do {
                        try data.write(to: dest)
                        let linuxPath = "\(AIChatViewModel.minisBrowserLinuxDir)/\(name)"
                        out["fetched_path"] = linuxPath
                        out["fetched_minis_url"] = "minis://browser/\(name)"
                    } catch {
                        logger.warning("Failed to persist fetched file to \(dest.path): \(error.localizedDescription)")
                    }
                }
            }
        }

        return out
    }
}
