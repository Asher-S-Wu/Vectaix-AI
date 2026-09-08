import Foundation

/// Where the user-added HTML lives in our sandbox. Encoded into the DB so we
/// can re-resolve the host path at launch time, even after iOS rotates the
/// random container UUID across reinstalls.
enum WebAppPathScope: String, Codable, Hashable, Sendable {
    /// `<sessionRoot>/attachments/...` — files dropped into a chat as
    /// attachments by the user or by the agent.
    case sessionAttachment = "session_attachment"
    /// `<sessionRoot>/workspace/...` — files inside the agent's working dir.
    case sessionWorkspace = "session_workspace"
    /// iSH `/var/minis/shared/...` — host-mapped shared space.
    case shared = "shared"
    /// User-mounted folder (Files.app picker / iCloud / external drive).
    case mount = "mount"
}

/// How the home-screen icon should be rendered when launching a WebApp.
/// Stored as a single string in the DB to keep the schema flat.
///
/// Encoding:
///   - `preset:<name>` — built-in SF Symbol or Asset (resolved at runtime).
///   - `file:<sandbox-relative-path>` — bitmap saved by the icon picker
///     into the WebApp icon cache (Library/WebAppIconCache/<id>.png).
///   - `html` — the icon was extracted from the page's
///     `<link rel="apple-touch-icon">` / `<link rel="icon">` and saved
///     into the icon cache; `iconCachePath` will be set on the row too.
enum WebAppIconRef: Codable, Hashable, Sendable {
    case preset(String)
    case file(String)
    case htmlExtracted

    var encoded: String {
        switch self {
        case .preset(let name): return "preset:\(name)"
        case .file(let path):   return "file:\(path)"
        case .htmlExtracted:    return "html"
        }
    }

    init(encoded: String) {
        if encoded == "html" {
            self = .htmlExtracted
        } else if let p = encoded.dropPrefixIfPresent("preset:") {
            self = .preset(p)
        } else if let p = encoded.dropPrefixIfPresent("file:") {
            self = .file(p)
        } else {
            // Defensive: unknown encoding falls back to a safe preset
            // so an out-of-band schema bump doesn't crash the home tile.
            self = .preset("globe")
        }
    }
}

private extension String {
    func dropPrefixIfPresent(_ prefix: String) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return String(dropFirst(prefix.count))
    }
}

/// One persisted entry per HTML the user has "Added to Home Screen".
/// The pinned home-screen tile fires `OpenWebAppIntent` with `webAppShortcutId`,
/// which loads this row and resolves the HTML's host URL via WebAppPathResolver.
struct WebAppShortcut: Identifiable, Codable, Hashable, Sendable {
    let id: String
    /// Sandbox-relative path of the HTML file (relative to whatever base
    /// `pathScope` resolves to at launch time). Stored without scheme.
    var htmlPath: String
    var pathScope: WebAppPathScope
    /// Session id when `pathScope` is sessionAttachment / sessionWorkspace,
    /// mount id when `pathScope` is mount, nil for shared.
    var scopeContext: String?
    var title: String
    var iconRef: WebAppIconRef
    /// Sandbox-relative path of the cached icon bitmap (PNG/JPG) when
    /// iconRef is `.file` or `.htmlExtracted`. Always under
    /// `Library/WebAppIconCache/`. nil for `.preset`.
    var iconCachePath: String?
    let createdAt: Date
    /// Session the user was in when they tapped "Add to Home Screen".
    /// Lets the WebView's "back to chat" affordance jump to a useful place.
    var sourceSessionId: String?

    init(
        id: String = UUID().uuidString,
        htmlPath: String,
        pathScope: WebAppPathScope,
        scopeContext: String? = nil,
        title: String,
        iconRef: WebAppIconRef,
        iconCachePath: String? = nil,
        createdAt: Date = Date(),
        sourceSessionId: String? = nil
    ) {
        self.id = id
        self.htmlPath = htmlPath
        self.pathScope = pathScope
        self.scopeContext = scopeContext
        self.title = title
        self.iconRef = iconRef
        self.iconCachePath = iconCachePath
        self.createdAt = createdAt
        self.sourceSessionId = sourceSessionId
    }
}
