#if DEBUG
import Foundation

/// [T-debug-mcp-rpc] Debug JSON-RPC surface for MCP server configuration.
///
/// Motivation: MCPStore loads `servers.json` into memory once (init / MCP
/// screen onAppear). Writing the file directly via debug.writeFile does NOT
/// refresh the in-memory list, so a staged config never takes effect until the
/// user opens the MCP screen or relaunches. These methods go through
/// MCPStore's own import/delete API, which updates the @Published list AND
/// persists servers.json — so a test harness can stage MCP config and have it
/// live immediately (used for the iSH mm-leak MCP stress test).
///
/// All methods are @MainActor (MCPStore is @MainActor); the dispatcher hops
/// via `await MainActor.run { ... }`.
@MainActor
enum DebugRPCMCP {

    /// `debug.mcp.list` → the current in-memory server list (what's actually
    /// active), each with transport + enabled state.
    static func list() -> [String: Any] {
        let servers = MCPStore.shared.servers.map { s -> [String: Any] in
            var d: [String: Any] = [
                "id": s.id,
                "enabled": s.enabled,
            ]
            if let note = s.note { d["note"] = note }
            if let url = s.url { d["url"] = url }
            if let command = s.command { d["command"] = command }
            if let args = s.args { d["args"] = args }
            if let env = s.env { d["env"] = env }
            if let headers = s.headers { d["headers"] = headers }
            if let createdAt = s.createdAt { d["createdAt"] = createdAt }
            d["transport"] = s.isHTTP ? "http" : (s.isSTDIO ? "stdio" : "unknown")
            return d
        }
        return ["count": servers.count, "servers": servers]
    }

    /// `debug.mcp.import` → import server(s) from a Claude-style JSON blob
    /// (`{"mcpServers": {...}}` or a bare `{...}` map). Upserts by name into the
    /// live list and persists servers.json. Returns the imported ids.
    /// Params: { json: string }  (the raw config text)
    static func importJSON(params: [String: Any]) throws -> [String: Any] {
        guard let json = params["json"] as? String, !json.isEmpty else {
            throw DebugRPCErr(-32602, "Missing required 'json' (string): the MCP config text, e.g. {\"mcpServers\": {...}}.")
        }
        let imported = try MCPStore.shared.importJSON(json)
        return [
            "ok": true,
            "importedCount": imported.count,
            "importedIds": imported.map { $0.id },
            "allServerIds": MCPStore.shared.servers.map { $0.id },
        ]
    }

    /// `debug.mcp.delete` → remove a server by id from the live list + file.
    /// Params: { id: string }
    static func delete(params: [String: Any]) throws -> [String: Any] {
        guard let id = params["id"] as? String, !id.isEmpty else {
            throw DebugRPCErr(-32602, "Missing required 'id' (string): the server name to delete.")
        }
        let existed = MCPStore.shared.servers.contains { $0.id == id }
        MCPStore.shared.delete(id: id)
        return [
            "ok": true,
            "deleted": existed,
            "id": id,
            "allServerIds": MCPStore.shared.servers.map { $0.id },
        ]
    }
}
#endif
