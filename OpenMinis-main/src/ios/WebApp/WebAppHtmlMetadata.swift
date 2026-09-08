import Foundation

private let htmlMetaLogger = AppLogger(category: "WebAppHtmlMeta")

/// Pulls a default title and a candidate icon URL out of an HTML file at
/// rest. Best-effort: reads only the first ~64KB so we don't slurp giant
/// generated single-page apps. Failures fall back gracefully — the picker
/// just shows the filename instead of the parsed title and offers presets
/// when no `<link rel="icon">` is found.
enum WebAppHtmlMetadata {
    struct Parsed {
        let title: String?
        /// Icon URL as it appeared in the HTML (relative or absolute).
        /// Caller resolves it against the HTML's directory before reading
        /// the bitmap from disk.
        let iconHref: String?
    }

    /// Read at most `maxBytes` bytes of the HTML and return what we can
    /// glean. Synchronous on purpose — call from a Task at presentation
    /// time, not from the slot you'll redraw on.
    static func parse(htmlURL: URL, maxBytes: Int = 64 * 1024) -> Parsed {
        guard let handle = try? FileHandle(forReadingFrom: htmlURL) else {
            htmlMetaLogger.warning("parse: cannot open \(htmlURL.lastPathComponent)")
            return Parsed(title: nil, iconHref: nil)
        }
        defer { try? handle.close() }
        let data: Data
        do {
            data = try handle.read(upToCount: maxBytes) ?? Data()
        } catch {
            htmlMetaLogger.warning("parse: read failed \(error)")
            return Parsed(title: nil, iconHref: nil)
        }
        let head = String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .isoLatin1)
            ?? ""
        return Parsed(
            title: extractTitle(head),
            iconHref: extractIconHref(head)
        )
    }

    // MARK: - Title

    /// Find `<title>...</title>`, case-insensitive, first match. Trims
    /// whitespace and decodes the handful of HTML entities common in
    /// titles. Returns nil if absent or empty.
    private static func extractTitle(_ html: String) -> String? {
        // Range search for `<title` so we tolerate attributes (rare but legal).
        guard let openStart = html.range(of: "<title", options: .caseInsensitive) else { return nil }
        guard let openEnd = html.range(of: ">", range: openStart.upperBound..<html.endIndex) else { return nil }
        guard let closeStart = html.range(of: "</title>", options: .caseInsensitive,
                                          range: openEnd.upperBound..<html.endIndex) else { return nil }
        let raw = String(html[openEnd.upperBound..<closeStart.lowerBound])
        let cleaned = decodeEntities(raw).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }

    // MARK: - Icon

    /// Locate the first usable `<link rel="...icon...">` and return its
    /// `href`. Preference order:
    ///   1. apple-touch-icon (typically PNG, sized for iOS home screen)
    ///   2. apple-touch-icon-precomposed
    ///   3. icon (the generic favicon attribute)
    ///   4. shortcut icon
    /// Stops at the first hit per priority tier — we don't try to be
    /// clever about resolution; iOS will scale.
    private static func extractIconHref(_ html: String) -> String? {
        let priorities = [
            "apple-touch-icon",
            "apple-touch-icon-precomposed",
            "icon",
            "shortcut icon",
        ]
        for rel in priorities {
            if let href = findLinkHref(html, relMatching: rel) {
                return href
            }
        }
        return nil
    }

    private static func findLinkHref(_ html: String, relMatching wantedRel: String) -> String? {
        // Walk every <link ...> tag and inspect its attributes.
        var cursor = html.startIndex
        while cursor < html.endIndex,
              let openStart = html.range(of: "<link", options: .caseInsensitive, range: cursor..<html.endIndex),
              let openEnd = html.range(of: ">", range: openStart.upperBound..<html.endIndex) {
            let tag = String(html[openStart.lowerBound..<openEnd.upperBound])
            cursor = openEnd.upperBound
            guard let rel = attribute(tag, name: "rel")?.lowercased() else { continue }
            // rel can be space-separated (`apple-touch-icon precomposed`).
            let tokens = rel.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            // For wanted "shortcut icon" (two-word) we accept exact tokenized form.
            let wantedTokens = wantedRel.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            let allPresent = wantedTokens.allSatisfy { tokens.contains($0) }
            if !allPresent { continue }
            if let href = attribute(tag, name: "href")?.trimmingCharacters(in: .whitespaces),
               !href.isEmpty {
                return href
            }
        }
        return nil
    }

    /// Extract a single attribute value from a tag string. Handles
    /// `name="value"`, `name='value'`, and unquoted (attribute=value).
    /// Returns nil when the attribute is absent.
    private static func attribute(_ tag: String, name: String) -> String? {
        let lower = tag.lowercased()
        let needle = "\(name.lowercased())="
        guard let attrStart = lower.range(of: needle) else { return nil }
        let valStart = tag.index(tag.startIndex, offsetBy: lower.distance(from: lower.startIndex, to: attrStart.upperBound))
        guard valStart < tag.endIndex else { return nil }
        let firstChar = tag[valStart]
        if firstChar == "\"" || firstChar == "'" {
            let quote = firstChar
            let inner = tag.index(after: valStart)
            guard let close = tag.range(of: String(quote), range: inner..<tag.endIndex) else { return nil }
            return decodeEntities(String(tag[inner..<close.lowerBound]))
        } else {
            // Unquoted: read until whitespace or '>'.
            var end = valStart
            while end < tag.endIndex, !tag[end].isWhitespace, tag[end] != ">" {
                end = tag.index(after: end)
            }
            return decodeEntities(String(tag[valStart..<end]))
        }
    }

    /// Decode the small set of HTML entities likely to appear in titles
    /// and href attributes. We don't pull in a full HTML parser for this.
    private static func decodeEntities(_ s: String) -> String {
        var out = s
        let map: [(String, String)] = [
            ("&amp;", "&"),
            ("&lt;", "<"),
            ("&gt;", ">"),
            ("&quot;", "\""),
            ("&#39;", "'"),
            ("&apos;", "'"),
            ("&nbsp;", " "),
        ]
        for (entity, char) in map {
            out = out.replacingOccurrences(of: entity, with: char)
        }
        return out
    }

    /// Resolve a relative `iconHref` against the HTML's directory and
    /// return the resulting host file URL if it exists. Absolute http/https
    /// hrefs are rejected (we never network-fetch icons in the WebApp flow).
    /// Returns nil for any issue — callers should fall back to presets.
    static func resolveLocalIconURL(href: String, htmlURL: URL) -> URL? {
        let trimmed = href.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        // data: URIs aren't supported in the picker right now (would need
        // base64 decode + write). Treated as "no local icon, fall back to
        // presets". TODO if user demand surfaces.
        let lower = trimmed.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") || lower.hasPrefix("//") || lower.hasPrefix("data:") {
            return nil
        }
        let baseDir = htmlURL.deletingLastPathComponent()
        let resolved: URL
        if trimmed.hasPrefix("/") {
            // Absolute-from-HTML-root: resolve against the site root we
            // grant readAccess to. We don't know the readAccess root here
            // (the picker calls us with just htmlURL), so treat absolute
            // paths as relative to baseDir to stay sandboxed. A future
            // enhancement could pass the readAccess root through.
            resolved = baseDir.appendingPathComponent(String(trimmed.dropFirst())).standardizedFileURL
        } else {
            resolved = baseDir.appendingPathComponent(trimmed).standardizedFileURL
        }
        if FileManager.default.fileExists(atPath: resolved.path) {
            return resolved
        }
        return nil
    }
}
