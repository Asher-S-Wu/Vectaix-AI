import Foundation

private let logger = AppLogger(category: "Bashism")

/// Detects busybox-ash-incompatible bash syntax in a script so `shell_execute`
/// can transparently install + switch to bash only when needed
/// (T-bash-on-demand). Rules and their fix hints live in the shared JSON
/// (`bashism_rules.json`, also loaded by Android) — this type is only the
/// matching engine.
///
/// Algorithm (design §1):
///   1. strip heredoc BODIES (they are data — python/awk/SQL — not shell
///      syntax; scanning them caused the F1 false-positive storm),
///   2. line-by-line regex scan of the remaining shell-layer text,
///   3. 50ms wall-clock fuse (fail-open) + 4KB per-line cap (M2 ReDoS guard).
enum BashismDetector {

    enum Tier: String { case S, E, T1 }

    struct Rule {
        let name: String
        let tier: Tier
        let regex: NSRegularExpression
        let behaviorNote: String
        let fixHint: String
    }

    struct Hit {
        let line: Int          // 1-based, into the ORIGINAL script
        let ruleName: String
        let tier: Tier
        let matchedText: String  // sanitized + truncated snippet of the hit line
        let behaviorNote: String
        let fixHint: String
    }

    struct Result {
        let hits: [Hit]
        /// Any hit at all → confirm/install bash.
        var needsBash: Bool { !hits.isEmpty }
        /// A hit that requires switching the interpreter to bash (S or E, not
        /// the T1 "script already asks for bash" case).
        var mustSwitchInterpreter: Bool { hits.contains { $0.tier == .S || $0.tier == .E } }
        var hasSilent: Bool { hits.contains { $0.tier == .S } }
    }

    // MARK: - Rule loading

    private static let heredocOpen = try! NSRegularExpression(
        pattern: "<<-?\\s*[\"']?(\\w+)[\"']?")

    private static let rules: [Rule] = loadRules()
    /// Public so the reminder builder and tests can read fix hints by name.
    static var rulesByName: [String: Rule] { Dictionary(rules.map { ($0.name, $0) }, uniquingKeysWith: { a, _ in a }) }

    private static func loadRules() -> [Rule] {
        guard let url = Bundle.main.url(forResource: "bashism_rules", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["rules"] as? [[String: Any]] else {
            logger.error("[Bashism] bashism_rules.json missing or malformed — detector disabled")
            return []
        }
        var out: [Rule] = []
        for r in arr {
            guard let name = r["name"] as? String,
                  let tierRaw = r["tier"] as? String, let tier = Tier(rawValue: tierRaw),
                  let pattern = r["pattern"] as? String else { continue }
            guard let rx = try? NSRegularExpression(pattern: pattern) else {
                logger.error("[Bashism] rule '\(name)' has an invalid regex — skipped")
                continue
            }
            out.append(Rule(name: name, tier: tier, regex: rx,
                            behaviorNote: r["behaviorNote"] as? String ?? "",
                            fixHint: r["fixHint"] as? String ?? ""))
        }
        logger.info("[Bashism] loaded \(out.count) rules")
        return out
    }

    // MARK: - Heredoc stripping (F1)

    /// Returns each original line paired with the text to scan; heredoc-body
    /// lines (and the delimiter lines) are returned as nil so they are skipped
    /// while line numbers stay aligned to the original script.
    static func shellLayerLines(_ script: String) -> [(line: Int, text: String?)] {
        let lines = script.components(separatedBy: "\n")
        var out: [(Int, String?)] = []
        var i = 0
        while i < lines.count {
            let line = lines[i]
            out.append((i + 1, line))  // opening line IS shell-layer
            // Collect every heredoc delimiter opened on this line, in order.
            let ns = line as NSString
            var delims: [String] = []
            for m in heredocOpen.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
                if m.numberOfRanges > 1 {
                    delims.append(ns.substring(with: m.range(at: 1)))
                }
            }
            i += 1
            for delim in delims {
                while i < lines.count && lines[i].trimmingCharacters(in: .whitespaces) != delim {
                    out.append((i + 1, nil))  // body line — do not scan
                    i += 1
                }
                if i < lines.count {   // the delimiter line itself
                    out.append((i + 1, nil))
                    i += 1
                }
            }
        }
        return out
    }

    // MARK: - Detection

    static func detect(_ script: String, fuseMs: Double = 50) -> Result {
        guard !rules.isEmpty else { return Result(hits: []) }
        let start = Date()
        var hits: [Hit] = []
        for (lineNo, maybeText) in shellLayerLines(script) {
            guard let text = maybeText, !text.isEmpty else { continue }
            let scan = text.count > 4096 ? String(text.prefix(4096)) : text
            let ns = scan as NSString
            let range = NSRange(location: 0, length: ns.length)
            for rule in rules {
                if Date().timeIntervalSince(start) * 1000 > fuseMs {
                    logger.info("[Bashism] scan fuse tripped at \(hits.count) hits — fail-open")
                    return Result(hits: hits)
                }
                if rule.regex.firstMatch(in: scan, range: range) != nil {
                    hits.append(Hit(line: lineNo, ruleName: rule.name, tier: rule.tier,
                                    matchedText: scan.trimmingCharacters(in: .whitespaces),
                                    behaviorNote: rule.behaviorNote, fixHint: rule.fixHint))
                }
            }
        }
        return Result(hits: hits)
    }
}
