// Shared BashismDetector conformance validator (T-bash-on-demand).
// Runs the iOS detector algorithm (Foundation NSRegularExpression, the same
// engine the app uses) against bashism_rules.json + bashism_test_vectors.json.
// The Xcode MinisTests host target can't link the iSH static libs in this
// project, so this standalone harness is the canonical iOS-side regression
// gate. Run: `swift src/shared/bashism/validate_detector.swift`
import Foundation

// Standalone harness: the EXACT algorithm from BashismDetector.swift, run with
// Foundation's NSRegularExpression (same engine iOS uses), against the shared
// rules + vectors JSON. Proves regex correctness + heredoc stripping on the
// real engine without the app's broken test-host linkage.

// Resolve the JSON dir relative to this script so it runs from anywhere:
//   swift src/shared/bashism/validate_detector.swift
let base = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
struct Rule { let name: String; let tier: String; let rx: NSRegularExpression }
let rulesData = try! Data(contentsOf: URL(fileURLWithPath: "\(base)/bashism_rules.json"))
let rulesObj = try! JSONSerialization.jsonObject(with: rulesData) as! [String: Any]
let rules: [Rule] = (rulesObj["rules"] as! [[String: Any]]).compactMap { r in
    guard let n = r["name"] as? String, let t = r["tier"] as? String, let p = r["pattern"] as? String,
          let rx = try? NSRegularExpression(pattern: p) else {
        FileHandle.standardError.write("BAD REGEX: \(r["name"] ?? "?")\n".data(using: .utf8)!)
        return nil
    }
    return Rule(name: n, tier: t, rx: rx)
}
let heredoc = try! NSRegularExpression(pattern: "<<-?\\s*[\"']?(\\w+)[\"']?")

func shellLayerLines(_ script: String) -> [(Int, String?)] {
    let lines = script.components(separatedBy: "\n"); var out: [(Int, String?)] = []; var i = 0
    while i < lines.count {
        let line = lines[i]; out.append((i+1, line))
        let ns = line as NSString; var delims: [String] = []
        for m in heredoc.matches(in: line, range: NSRange(location: 0, length: ns.length)) where m.numberOfRanges > 1 {
            delims.append(ns.substring(with: m.range(at: 1)))
        }
        i += 1
        for d in delims {
            while i < lines.count && lines[i].trimmingCharacters(in: .whitespaces) != d { out.append((i+1, nil)); i += 1 }
            if i < lines.count { out.append((i+1, nil)); i += 1 }
        }
    }
    return out
}
func detect(_ script: String) -> Set<String> {
    var hits = Set<String>()
    for (_, maybe) in shellLayerLines(script) {
        guard let text = maybe, !text.isEmpty else { continue }
        let scan = text.count > 4096 ? String(text.prefix(4096)) : text
        let ns = scan as NSString; let range = NSRange(location: 0, length: ns.length)
        for r in rules where r.rx.firstMatch(in: scan, range: range) != nil { hits.insert(r.name) }
    }
    return hits
}

struct Vec: Decodable { let name: String; let script: String; let expect: [String] }
struct Vecs: Decodable { let sHits: [Vec]; let eHits: [Vec]; let compat: [Vec] }
let vd = try! Data(contentsOf: URL(fileURLWithPath: "\(base)/bashism_test_vectors.json"))
let vecs = try! JSONDecoder().decode(Vecs.self, from: vd)
var fail = 0, total = 0
for (label, group) in [("sHits", vecs.sHits), ("eHits", vecs.eHits), ("compat", vecs.compat)] {
    for v in group {
        total += 1
        let got = detect(v.script); let exp = Set(v.expect)
        if got != exp { fail += 1; print("FAIL [\(label)] \(v.name): expected \(exp.sorted()), got \(got.sorted())") }
    }
}
print("\(total-fail)/\(total) vectors passed (NSRegularExpression engine)")
exit(fail == 0 ? 0 : 1)
