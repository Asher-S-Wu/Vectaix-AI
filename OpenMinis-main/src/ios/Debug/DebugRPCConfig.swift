#if DEBUG
import Foundation

/// [T-config-debug-rpc] Remote driver for `minis-config`.
///
/// WHY THIS EXISTS. `minis-config` is a binary inside the iSH guest that calls into
/// `ConfigOffloadBridge` over the ObjC bridge. That makes the whole config surface —
/// every collection, the confirmation gate, the audit log — untestable from outside the
/// device: there was no shell RPC and no config RPC, so a change to a `ConfigCollection`
/// could only be verified by reading code. These methods close that gap by calling the
/// SAME `ConfigOffloadBridge` entry points the guest binary calls.
///
/// It is deliberately a thin shell. Nothing here re-implements resolution, validation,
/// confirmation or auditing: `config.get` is `readField`, `config.set` is `writeFields`.
/// If this file and the CLI ever disagree, this file is wrong.
///
/// DEBUG-only, like every other RPC in this directory.
enum DebugRPCConfig {

    private static func need<T>(_ value: T?, _ name: String) throws -> T {
        guard let v = value else { throw DebugRPCErr(-32602, "Missing required param: \(name)") }
        return v
    }

    /// `config.get` — read one registered path.
    ///
    /// Mirrors `minis-config get <path> [--filter …] [--page N] [--page-size N]`.
    /// Returns the bridge's envelope verbatim so the caller sees exactly what the CLI
    /// prints, including the `ok:false` error shapes.
    static func get(params: [String: Any]) async throws -> [String: Any] {
        let path = try need(params["path"] as? String, "path")
        let filter = params["filter"] as? String
        let page = params["page"] as? Int ?? 0
        let pageSize = params["pageSize"] as? Int ?? 0
        // readField hops to @MainActor internally and blocks on a semaphore, so it must
        // not be called from the main thread — that would deadlock.
        return await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let raw = ConfigOffloadBridge.readField(
                    path: path, filter: filter, page: page, pageSize: pageSize)
                cont.resume(returning: (raw as? [String: Any]) ?? ["ok": false, "error": "bridge_returned_non_dictionary"])
            }
        }
    }

    /// `config.set` — write one or more paths through the real write batch.
    ///
    /// Params:
    ///   - `path` + `value_json`  (single write), or `items: [{path, value_json}, …]`
    ///   - `caption`  — free text shown on the confirmation sheet
    ///   - `skipConfirmation` — default FALSE, i.e. the on-device sheet really appears
    ///     and this call blocks until it is answered (120s gate timeout). Pass true only
    ///     to exercise the apply path unattended; that is the same bypass the in-app
    ///     revert flow uses, and it is why the parameter is named after the thing it
    ///     skips rather than something neutral.
    ///
    /// `value_json` is a JSON *string*, matching the CLI's argv contract — a bare
    /// `"abc"` string value is `"\"abc\""`, an object is `{"kind":"…"}`.
    static func set(params: [String: Any]) async throws -> [String: Any] {
        var items: [NSDictionary] = []
        if let raw = params["items"] as? [[String: Any]] {
            for it in raw {
                let p = try need(it["path"] as? String, "items[].path")
                let v = (it["value_json"] as? String) ?? "null"
                items.append(["path": p, "value_json": v] as NSDictionary)
            }
        } else {
            let p = try need(params["path"] as? String, "path")
            let v = (params["value_json"] as? String) ?? "null"
            items.append(["path": p, "value_json": v] as NSDictionary)
        }
        guard !items.isEmpty else { throw DebugRPCErr(-32602, "No items to write") }

        let caption = params["caption"] as? String ?? "debug rpc config.set"
        let actor = params["actor"] as? String ?? "agent"
        let sessionId = params["sessionId"] as? String
        let skip = params["skipConfirmation"] as? Bool ?? false

        return await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let raw = ConfigOffloadBridge.writeFieldsForDebug(
                    items: items, caption: caption, actorRaw: actor,
                    sessionId: sessionId, skipConfirmation: skip)
                cont.resume(returning: (raw as? [String: Any]) ?? ["ok": false, "error": "bridge_returned_non_dictionary"])
            }
        }
    }

    /// `config.topics` — every registered topic, i.e. `minis-config --help`'s index.
    /// Useful on its own to confirm a newly registered collection is actually wired in.
    static func topics(params: [String: Any]) async throws -> [String: Any] {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                cont.resume(returning: ["topics": ConfigOffloadBridge.allTopics()])
            }
        }
    }

    /// `config.topicHelp` — the field schema for one topic, as `minis-config <topic>
    /// --help` prints it. This is how a caller discovers a collection's writable paths.
    static func topicHelp(params: [String: Any]) async throws -> [String: Any] {
        let topic = try need(params["topic"] as? String, "topic")
        return await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let fields = ConfigOffloadBridge.fieldsForTopic(topic)
                cont.resume(returning: [
                    "topic": topic,
                    "fields": fields.compactMap { $0 as? [String: Any] },
                ])
            }
        }
    }

    /// `config.audit` — the audit trail, so a test can prove a write was recorded
    /// (and with which actor/status) rather than merely that it returned ok.
    static func audit(params: [String: Any]) async throws -> [String: Any] {
        let limit = params["limit"] as? Int ?? 20
        let scope = params["scope"] as? String
        return await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let raw = ConfigOffloadBridge.auditList(limit: limit, scope: scope)
                cont.resume(returning: (raw as? [String: Any]) ?? ["ok": false, "error": "bridge_returned_non_dictionary"])
            }
        }
    }
}
#endif
