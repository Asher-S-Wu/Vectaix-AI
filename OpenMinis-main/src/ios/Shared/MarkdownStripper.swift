import Foundation

enum MarkdownStripper {

    static func plainText(_ input: String) -> String {
        var s = input

        s = s.replacingOccurrences(
            of: "```[\\s\\S]*?```",
            with: " ",
            options: .regularExpression
        )

        s = s.replacingOccurrences(
            of: "!\\[([^\\]]*)\\]\\([^)]*\\)",
            with: "$1",
            options: .regularExpression
        )

        s = rewriteLinks(s)

        s = s.replacingOccurrences(
            of: "<(https?://[^>]+)>",
            with: "$1",
            options: .regularExpression
        )

        let inlinePatterns: [(String, String)] = [
            ("\\*\\*([^*]+)\\*\\*", "$1"),
            ("__([^_]+)__",          "$1"),
            ("\\*([^*]+)\\*",        "$1"),
            ("(?<!\\w)_([^_]+)_(?!\\w)", "$1"),
            ("~~([^~]+)~~",          "$1"),
            ("`([^`]*)`",            "$1"),
        ]
        for (pattern, replacement) in inlinePatterns {
            s = s.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }

        let lines = s.components(separatedBy: "\n")
        let cleaned: [String] = lines.compactMap { raw in
            var line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { return nil }

            let sepStripped = line.trimmingCharacters(in: CharacterSet(charactersIn: "-=*_ "))
            if sepStripped.isEmpty { return nil }

            if line.hasPrefix("|") || (line.contains("|") && line.hasSuffix("|")) { return nil }
            if line.allSatisfy({ "|-: ".contains($0) }) && line.contains("|") { return nil }

            if line.hasPrefix("```") || line.hasPrefix("~~~") { return nil }

            line = line.replacingOccurrences(
                of: "^#{1,6}\\s+", with: "", options: .regularExpression
            )
            line = line.replacingOccurrences(
                of: "^>\\s?", with: "", options: .regularExpression
            )
            line = line.replacingOccurrences(
                of: "^[-*+]\\s+", with: "", options: .regularExpression
            )
            line = line.replacingOccurrences(
                of: "^\\d+[.):]\\s+", with: "", options: .regularExpression
            )

            line = line.replacingOccurrences(
                of: "[*_~`]{2,}", with: "", options: .regularExpression
            )

            line = line.trimmingCharacters(in: .whitespaces)
            return line.isEmpty ? nil : line
        }

        var result = cleaned.joined(separator: " ")

        result = result.replacingOccurrences(
            of: "  +", with: " ", options: .regularExpression
        )

        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func rewriteLinks(_ text: String) -> String {
        let pattern = "!?\\[([^\\]]*)\\]\\(([^)\\s]+)[^)]*\\)"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return text }
        let ns = text as NSString
        var result = ""
        var last = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let title = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces)
            let url   = ns.substring(with: m.range(at: 2))
            result += title.isEmpty ? url : title
            last = m.range.location + m.range.length
        }
        result += ns.substring(from: last)
        return result
    }
}
