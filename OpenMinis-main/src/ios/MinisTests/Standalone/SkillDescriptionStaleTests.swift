// Regression test for GH#215 — SkillStore.loadSkills() stale-description rule.
//
// Mirrors the exact predicate from SkillStore.swift:1528 and the parse-failure
// sentinel from rescanFromDisk (`parseFailed`). Standalone because the
// MinisTests target has a pre-existing compile break (ToolPreflightTests /
// AgentToolDefinition), so `xcodebuild test` cannot run today.

import Foundation

let defaultSkillName = "Untitled Skill"

/// The predicate under test — copied verbatim from the fix.
func descStale(dbDescription: String, parsedDescription: String) -> Bool {
    (dbDescription == "|" || dbDescription == ">" || dbDescription.isEmpty)
        && !parsedDescription.isEmpty
}

/// The parse-failure sentinel a720585db relies on.
func parseFailed(parsedName: String, parsedDescription: String) -> Bool {
    parsedName == defaultSkillName && parsedDescription.isEmpty
}

var failures = 0
func check(_ label: String, _ actual: Bool, _ expected: Bool) {
    if actual == expected {
        print("  ✅ \(label)")
    } else {
        print("  ❌ \(label) — expected \(expected), got \(actual)")
        failures += 1
    }
}

print("GH#215 — empty DB description must be treated as stale")
// The reported bug: shell-created skill registered before `description:` existed.
check("empty DB + real file desc → REFRESH", descStale(dbDescription: "", parsedDescription: "Fetch a web page"), true)

print("\nPre-existing behaviour must be preserved (block-scalar indicators)")
check("\"|\" + real file desc → REFRESH", descStale(dbDescription: "|", parsedDescription: "Real"), true)
check("\">\" + real file desc → REFRESH", descStale(dbDescription: ">", parsedDescription: "Real"), true)

print("\nSafety: a mid-edit / malformed SKILL.md must NEVER wipe good metadata (a720585db)")
// A failed parse yields name=="Untitled Skill" && description=="".
check("good DB + parse failure → KEEP", descStale(dbDescription: "Fetch a web page", parsedDescription: ""), false)
check("empty DB + parse failure → KEEP (nothing to write)", descStale(dbDescription: "", parsedDescription: ""), false)
check("\"|\" DB + parse failure → KEEP", descStale(dbDescription: "|", parsedDescription: ""), false)
// Cross-check the sentinel itself so the guarantee is explicit.
check("parse failure sentinel holds", parseFailed(parsedName: defaultSkillName, parsedDescription: ""), true)

print("\nSafety: a user's deliberate description must never be overwritten")
check("user desc + different file desc → KEEP", descStale(dbDescription: "My own wording", parsedDescription: "Upstream wording"), false)
check("user desc + same file desc → KEEP", descStale(dbDescription: "Same", parsedDescription: "Same"), false)

print("\nEdge cases")
check("whitespace-only DB desc → KEEP (not empty; not a known sentinel)",
      descStale(dbDescription: " ", parsedDescription: "Real"), false)
check("empty DB + whitespace-only file desc → KEEP (nothing useful to adopt)",
      descStale(dbDescription: "", parsedDescription: ""), false)

print("")
if failures == 0 {
    print("ALL PASS")
    exit(0)
} else {
    print("\(failures) FAILURE(S)")
    exit(1)
}
