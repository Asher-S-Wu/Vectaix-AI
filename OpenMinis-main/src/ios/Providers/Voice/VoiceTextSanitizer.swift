import Foundation

// MARK: - VoiceTextSanitizer
//
// Cleans a text unit before it is sent to TTS: removes emoji and other
// non-speakable glyphs (pictographs, symbols, dingbats, variation selectors,
// zero-width joiners) and collapses the whitespace they leave behind, so the
// reader doesn't try to pronounce "🔥" / "✅" or stumble over stray symbols.
// Keeps letters, numbers, CJK, and normal punctuation that affects prosody.

enum VoiceTextSanitizer {

    /// Strip common Markdown syntax + emoji / non-speakable symbols and tidy
    /// whitespace. Returns the cleaned, speakable string (may be empty).
    static func sanitize(_ text: String) -> String {
        var s = stripMarkdown(text)
        // Replace any remaining bare URLs in plain text with "<host> 的链接" so the
        // reader never voices a long, unstoppable URL.
        s = rewriteBareURLs(s)
        // Remove emoji / non-speakable glyphs.
        var out = String.UnicodeScalarView()
        out.reserveCapacity(s.unicodeScalars.count)
        for scalar in s.unicodeScalars {
            out.append(isSpeakable(scalar) ? scalar : " ")
        }
        s = String(out)
        // Collapse whitespace introduced by removals.
        return s
            .replacingOccurrences(of: "[ \\t]{2,}", with: " ", options: .regularExpression)
            .replacingOccurrences(of: " *\\n *", with: "\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Remove the common Markdown syntax that shouldn't be pronounced, keeping the
    /// visible text. Order matters: links/images before emphasis before markers.
    private static func stripMarkdown(_ text: String) -> String {
        var s = text
        func sub(_ pattern: String, _ replacement: String) {
            s = s.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        // Fenced / inline code → keep inner text (code blocks are usually skipped
        // upstream, but strip fences/backticks defensively).
        sub("```[\\s\\S]*?```", " ")                 // fenced code block → drop
        sub("`([^`]+)`", "$1")                        // inline `code` → code
        // Markdown links/images: keep the description; if there's no description,
        // read "<host> 的链接" instead of the (possibly very long) URL.
        s = rewriteMarkdownLinks(s)
        // Bold / italic / strikethrough: **x** __x__ *x* _x_ ~~x~~ → x
        sub("\\*\\*([^*]+)\\*\\*", "$1")
        sub("__([^_]+)__", "$1")
        sub("\\*([^*]+)\\*", "$1")
        sub("(?<!\\w)_([^_]+)_(?!\\w)", "$1")
        sub("~~([^~]+)~~", "$1")
        // Leading block markers per line: headings (#), blockquote (>), list
        // bullets (-, *, +), ordered list (1.), and table pipes/separators.
        sub("(?m)^\\s{0,3}#{1,6}\\s*", "")            // # headings
        sub("(?m)^\\s{0,3}>\\s?", "")                 // > blockquote
        sub("(?m)^\\s{0,3}[-*+]\\s+", "")             // - bullet
        sub("(?m)^\\s{0,3}\\d+[.)]\\s+", "")          // 1. ordered
        sub("(?m)^\\s*\\|?[-:| ]+\\|?\\s*$", " ")     // table separator row
        sub("\\|", " ")                               // table cell pipes
        // Horizontal rules --- *** ___
        sub("(?m)^\\s*([-*_])\\1{2,}\\s*$", " ")
        // Stray leftover emphasis markers.
        //
        // [T-voice-sanitizer-underscore] Underscores must NOT be stripped
        // unconditionally: that ate the underscores inside identifiers —
        // "read_image_file" was spoken as "readimagefile" — defeating the
        // (?<!\w)_..._(?!\w) italic guard above. Strip underscores only when
        // NOT sitting between word characters so snake_case survives; the
        // other markers are never meaningful mid-identifier and stay
        // unconditional. Mirrors the Android port's fix (VoiceTextSanitizer.kt).
        sub("(?<!\\w)_+|_+(?!\\w)", "")
        sub("[*~`]{1,}", "")
        return s
    }

    // MARK: - Link handling

    /// Rewrite Markdown links/images `[desc](url)` / `![alt](url)`:
    ///  • non-empty description → keep the description text
    ///  • empty description → "<host> 的链接"
    private static func rewriteMarkdownLinks(_ text: String) -> String {
        let pattern = "!?\\[([^\\]]*)\\]\\(([^)\\s]+)[^)]*\\)"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return text }
        let ns = text as NSString
        var result = ""
        var last = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let desc = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces)
            let url = ns.substring(with: m.range(at: 2))
            result += desc.isEmpty ? linkPhrase(for: url) : desc
            last = m.range.location + m.range.length
        }
        result += ns.substring(from: last)
        return result
    }

    /// Replace bare http(s) URLs in plain text with "<host> 的链接".
    private static func rewriteBareURLs(_ text: String) -> String {
        let pattern = "https?://[^\\s)\\]]+"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return text }
        let ns = text as NSString
        var result = ""
        var last = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            result += linkPhrase(for: ns.substring(with: m.range))
            last = m.range.location + m.range.length
        }
        result += ns.substring(from: last)
        return result
    }

    /// "<host> 的链接" — host stripped of a leading "www.". Falls back to "链接".
    private static func linkPhrase(for url: String) -> String {
        let host = hostOf(url)
        return host.isEmpty ? "链接" : "\(host) 的链接"
    }

    private static func hostOf(_ url: String) -> String {
        if let h = URL(string: url)?.host { return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h }
        var s = url
        if let r = s.range(of: "://") { s = String(s[r.upperBound...]) }
        if let slash = s.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) { s = String(s[..<slash]) }
        if s.hasPrefix("www.") { s = String(s.dropFirst(4)) }
        return s
    }

    /// True if the scalar should be spoken (kept). Drops emoji & symbol ranges.
    private static func isSpeakable(_ s: Unicode.Scalar) -> Bool {
        // Keep ASCII (letters, digits, common punctuation, whitespace).
        if s.value < 0x80 { return true }

        // Drop known non-speakable categories.
        let v = s.value
        switch v {
        case 0x200B...0x200F,            // zero-width / directional marks
             0xFE00...0xFE0F,            // variation selectors
             0x2190...0x21FF,            // arrows
             0x2300...0x23FF,            // misc technical (⌚⏰ etc.)
             0x2460...0x24FF,            // enclosed alphanumerics
             0x2500...0x257F,            // box drawing
             0x2580...0x259F,            // block elements
             0x25A0...0x25FF,            // geometric shapes
             0x2600...0x26FF,            // misc symbols (☀☂♠ etc.)
             0x2700...0x27BF,            // dingbats (✅✂✈ etc.)
             0x2B00...0x2BFF,            // misc symbols & arrows (⭐⬆ etc.)
             0x1F000...0x1FAFF,          // emoji / pictographs / supplemental
             0xE0000...0xE007F:          // tags
            return false
        default:
            break
        }
        // Drop combining enclosing marks (keycap combiner) and regional indicators.
        if (0x1F1E6...0x1F1FF).contains(v) { return false }   // flag regional indicators
        if v == 0x20E3 { return false }                        // combining keycap
        return true
    }
}
