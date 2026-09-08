import Foundation

private let classifierLogger = AppLogger(category: "WebAppClassifier")

/// Reverses `WebAppPathResolver`: given a host file URL, classifies it back
/// into `(scope, scopeContext, htmlPath)` so the "Add to Home Screen"
/// flow can persist a stable WebAppShortcut row.
///
/// Returns nil for paths that don't sit inside any of our four scopes —
/// the caller should refuse to offer "Add to Home Screen" in that case
/// (rather than persist an unresolvable row).
@MainActor
enum WebAppPathClassifier {
    struct Classified {
        let scope: WebAppPathScope
        let scopeContext: String?
        /// Path component appended to the scope base. This is what goes
        /// into `WebAppShortcut.htmlPath`.
        let htmlPath: String
    }

    static func classify(hostURL: URL) -> Classified? {
        let target = hostURL.standardizedFileURL.path

        // 1. Session attachments / workspace under
        //    Library/MinisChat/minis/<sid>/{attachments,workspace}/...
        let minisBase = AIChatViewModel.minisPersistentBase.standardizedFileURL.path
        if target.hasPrefix(minisBase + "/") {
            let rel = String(target.dropFirst(minisBase.count + 1))
            // <sid>/<subdir>/<rest>
            let parts = rel.split(separator: "/", maxSplits: 2, omittingEmptySubsequences: true)
            if parts.count >= 3 {
                let sid = String(parts[0])
                let sub = String(parts[1])
                let rest = String(parts[2])
                switch sub {
                case "attachments":
                    return Classified(scope: .sessionAttachment, scopeContext: sid, htmlPath: rest)
                case "workspace":
                    return Classified(scope: .sessionWorkspace, scopeContext: sid, htmlPath: rest)
                default:
                    // Other session subdirs (offloads/, browser/, …) aren't
                    // exposed as WebApp scopes — refuse to classify so the
                    // user gets a clean error instead of a broken tile.
                    classifierLogger.info("classify: minis subdir not supported sub=\(sub) rel=\(rel)")
                    return nil
                }
            }
            return nil
        }

        // 2. Shared persistent dir.
        let sharedBase = AIChatViewModel.minisSharedPersistentDir.standardizedFileURL.path
        if target.hasPrefix(sharedBase + "/") {
            let rel = String(target.dropFirst(sharedBase.count + 1))
            return Classified(scope: .shared, scopeContext: nil, htmlPath: rel)
        }

        // 3. User-mounted folder (Files.app / iCloud / external drive).
        // Walk active mounts and pick the one whose root is a prefix of the
        // target. We use mount.id (UUID) as the scopeContext so
        // WebAppPathResolver can re-resolve the URL at launch.
        let manager = MountedFoldersManager.shared
        for entry in manager.entries {
            guard let root = manager.resolvedURL(for: entry.id) else { continue }
            let rootPath = root.standardizedFileURL.path
            if target.hasPrefix(rootPath + "/") {
                let rel = String(target.dropFirst(rootPath.count + 1))
                return Classified(scope: .mount,
                                  scopeContext: entry.id.uuidString,
                                  htmlPath: rel)
            }
            if target == rootPath {
                // The mount root itself is a directory, not an HTML — but
                // be defensive and treat as no-match.
                return nil
            }
        }

        classifierLogger.info("classify: target not in any known scope: \(target)")
        return nil
    }
}
