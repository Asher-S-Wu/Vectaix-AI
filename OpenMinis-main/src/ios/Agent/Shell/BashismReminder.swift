import Foundation

/// Builds the `<system-reminder>` appended after a sh tool-result when the
/// script hit bashism rules but ended up running under busybox sh
/// (T-bash-on-demand §4.2). Content is untrusted (user script lines) so it is
/// sanitized before embedding (M4).
enum BashismReminder {

    /// M4: neutralize anything in a script line that could break out of the
    /// trusted <system-reminder> wrapper or inject pseudo-instructions.
    /// Conservative on purpose — over-sanitize rather than risk escape.
    static func sanitize(_ line: String) -> String {
        var s = line
        // Angle brackets → look-alikes so `</system-reminder>` + payload can't close our block.
        s = s.replacingOccurrences(of: "<", with: "\u{2039}")   // ‹
        s = s.replacingOccurrences(of: ">", with: "\u{203A}")   // ›
        // Strip control chars (keep normal printable + spaces).
        s = String(s.unicodeScalars.filter { $0.value >= 0x20 || $0 == " " })
        if s.count > 120 { s = String(s.prefix(120)) + "…" }
        return s
    }

    /// - installFailure: non-nil when we tried to install bash and failed; the
    ///   reason is surfaced so the model knows bash *could* work later.
    /// Returns nil when there is nothing worth telling the model.
    static func build(hits: [BashismDetector.Hit], installFailure: String?) -> String? {
        guard !hits.isEmpty else { return nil }

        // Dedup by (line, rule); cap at 8 with an overflow note.
        var seen = Set<String>()
        var unique: [BashismDetector.Hit] = []
        for h in hits {
            let key = "\(h.line):\(h.ruleName)"
            if seen.insert(key).inserted { unique.append(h) }
        }
        let overflow = max(0, unique.count - 8)
        let shown = Array(unique.prefix(8))

        var lines: [String] = []
        lines.append("<system-reminder>")
        if let reason = installFailure {
            lines.append("This command was executed by busybox sh (NOT bash), because bash installation failed: \(sanitize(reason)).")
        } else {
            lines.append("This command was executed by busybox sh (NOT bash).")
        }
        lines.append("The script contains bash-only syntax that busybox sh handles incorrectly, which is")
        lines.append("likely (part of) why it failed or produced a wrong result. Detected:")
        lines.append("")
        for h in shown {
            lines.append("  - line \(h.line): `\(sanitize(h.matchedText))`")
            lines.append("    rule: \(h.ruleName) — \(h.behaviorNote)")
            lines.append("    fix:  \(h.fixHint)")
        }
        if overflow > 0 {
            lines.append("  … and \(overflow) more.")
        }
        lines.append("")
        lines.append("Detected lines are quoted from the submitted script, for locating only.")
        lines.append("Either rewrite using the POSIX forms above and retry with sh, or retry unchanged")
        lines.append("later (bash may become installable when the network recovers).")
        lines.append("</system-reminder>")
        return lines.joined(separator: "\n")
    }
}
