import Foundation

// MARK: - Tool Preflight + JSON Repair

extension AIChatViewModel {

    // MARK: - Tool Preflight Validation

    /// Reject tool calls that have empty args or are missing required fields
    /// BEFORE the tool helper runs. Returns nil when the call is well-formed,
    /// or a human-readable reason string when it should be blocked.
    ///
    /// Driven off the canonical `AgentToolDefinition.required` list so the
    /// validator never drifts from the schema published to the model. For
    /// string fields we additionally require non-blank content — the model
    /// occasionally emits `{"path": ""}` which passes the "key exists"
    /// check but is just as broken as a missing key. We do NOT validate
    /// type beyond string-emptiness here; richer schema checks (enum,
    /// regex, integer range) belong in the tool's own helper because they
    /// need tool-specific context.
    // MARK: - JSON Repair (T-tool-json-repair b2c4f8a6)

    /// Outcome of running the JSON-repair strategies on a tool call's args.
    /// `args` is the (possibly mutated) dict to use downstream; `repairs`
    /// is a list of human-readable strategy tags (empty when nothing was
    /// changed) suitable for warning logs.
    struct ToolArgsRepairOutcome {
        let args: [String: Any]
        let repairs: [String]
    }

    /// Attempt to salvage a malformed / incomplete tool call's args BEFORE
    /// the preflight validator rejects it. Three strategies, applied in
    /// order, each gated on actually being needed:
    ///
    /// 1. **Truncation repair** — if `args` is empty but the raw stream
    ///    tail is a non-empty string, retry JSON parsing with up to a
    ///    handful of `}` / `]` / `"` closures appended. Models occasionally
    ///    cut off mid-stream and leave a parseable object behind a single
    ///    missing brace.
    /// 2. **Type coercion** — for each required field whose value is
    ///    present but not a String, convert via `String(describing:)` so
    ///    downstream parsers (which uniformly expect strings) see a usable
    ///    value instead of failing the preflight string-non-blank check.
    /// 3. **Fuzzy field-name match** — for each missing required field,
    ///    look for a sibling key whose Levenshtein distance is ≤ 1 and
    ///    rename it. Catches one-off typos like `comand` → `command`.
    ///
    /// `static` so it can be called from any actor isolation context
    /// during stream processing.
    static func repairToolArgs(
        name: String,
        args: [String: Any],
        rawTail: String?,
        tools: [AgentToolDefinition]
    ) -> ToolArgsRepairOutcome {
        guard let toolDef = tools.first(where: { $0.name == name }) else {
            return ToolArgsRepairOutcome(args: args, repairs: [])
        }
        var working = args
        var repairs: [String] = []

        // Strategy 1: truncation repair. Only fires when the dict is empty
        // (or otherwise unusable) but the raw stream tail looks like a JSON
        // object that just got cut. Try appending up to 3 closures of each
        // type — that covers the common "object inside object inside array
        // missing the final ]}" patterns without going wild.
        if working.isEmpty, let tail = rawTail?.trimmingCharacters(in: .whitespacesAndNewlines), !tail.isEmpty {
            let suffixes: [String] = [
                "", "\"", "\"}", "\"]}", "}", "}}", "]}", "]}}", "]", "]]"
            ]
            for suffix in suffixes {
                let candidate = tail + suffix
                guard let data = candidate.data(using: .utf8),
                      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    continue
                }
                working = parsed
                repairs.append("truncation+\(suffix.isEmpty ? "noop" : suffix)")
                break
            }
        }

        // Strategy 2: type coercion on required fields. Models sometimes
        // emit `{"command": 123}` or `{"path": true}` — coerce scalar
        // non-string required values to their textual form so the preflight
        // blank-string check still has something usable to pass through.
        //
        // We intentionally restrict to PRIMITIVE scalars:
        //   - String:       skip (already correct)
        //   - NSNull:       treat as missing — wipe so Strategy 3 can fuzzy
        //                   the sibling into this slot rather than letting
        //                   preflight see a non-nil-but-useless NSNull
        //   - NSNumber:     use .stringValue (preserves bool→"true"/"false"
        //                   and int→"123"; String(describing:) on a Bool
        //                   NSNumber would render "1"/"0").
        //   - Bool (raw):   "true" / "false"
        //   - Array / Dict: do NOT coerce — String(describing:) yields
        //                   Swift debug form like `["a", "b"]` that downstream
        //                   tool helpers would interpret as a literal path /
        //                   command, breaking far worse than rejecting.
        //                   Leave the value as-is so preflight rejects it.
        for field in toolDef.required {
            guard let raw = working[field] else { continue }
            if raw is String { continue }
            if raw is NSNull {
                working.removeValue(forKey: field)
                repairs.append("null-strip:\(field)")
                continue
            }
            if raw is [Any] || raw is [String: Any] { continue }
            let coerced: String?
            if let n = raw as? NSNumber {
                // CFBoolean and Bool NSNumbers share NSNumber type — disambiguate
                // by checking objCType. `c` = char (the storage for Bool in
                // CoreFoundation), all other numeric kinds use the literal value.
                if CFGetTypeID(n) == CFBooleanGetTypeID() {
                    coerced = n.boolValue ? "true" : "false"
                } else {
                    coerced = n.stringValue
                }
            } else if let b = raw as? Bool {
                coerced = b ? "true" : "false"
            } else {
                // Unknown scalar (Date, NSData, …) — fall back to description
                // but only if it produces something non-empty. Still safer
                // than blocking outright since this is an extreme edge case.
                let desc = String(describing: raw)
                coerced = desc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : desc
            }
            if let coerced, !coerced.isEmpty {
                working[field] = coerced
                repairs.append("type-coerce:\(field)")
            }
        }

        // Strategy 3: fuzzy field-name match for missing required fields.
        // Only consider sibling keys that are themselves NOT already a
        // recognized schema field (don't steal a sibling that the tool
        // helper would have read directly).
        //
        // Sibling key iteration is .sorted() to make the match deterministic
        // — Swift dictionaries have no guaranteed iteration order, so
        // without sorting two identical inputs could pick different
        // candidates depending on hash seed (manifests as flaky reproducer).
        let schemaFields = Set(toolDef.parameters.keys)
        for field in toolDef.required {
            if working[field] != nil { continue }
            var bestKey: String? = nil
            for key in working.keys.sorted() {
                if schemaFields.contains(key) { continue }
                if levenshteinAtMostOne(key, field) {
                    bestKey = key
                    break
                }
            }
            if let bestKey {
                working[field] = working.removeValue(forKey: bestKey)
                repairs.append("fuzzy:\(bestKey)->\(field)")
            }
        }

        return ToolArgsRepairOutcome(args: working, repairs: repairs)
    }

    /// `true` iff Levenshtein edit distance between `a` and `b` is ≤ 1
    /// (case-insensitive). Implemented as a tight short-circuit rather
    /// than a full DP matrix because we only care about distance ≤ 1.
    private static func levenshteinAtMostOne(_ a: String, _ b: String) -> Bool {
        let aLower = a.lowercased()
        let bLower = b.lowercased()
        if aLower == bLower { return true }
        let ac = Array(aLower)
        let bc = Array(bLower)
        let diff = ac.count - bc.count
        if diff > 1 || diff < -1 { return false }
        if ac.count == bc.count {
            // One substitution allowed.
            var mismatches = 0
            for i in 0..<ac.count where ac[i] != bc[i] {
                mismatches += 1
                if mismatches > 1 { return false }
            }
            return mismatches == 1
        }
        // One insertion / deletion allowed: align until first mismatch,
        // then skip one char on the longer side and verify the rest.
        let (longer, shorter) = ac.count > bc.count ? (ac, bc) : (bc, ac)
        var i = 0, j = 0
        var skipped = false
        while i < longer.count && j < shorter.count {
            if longer[i] == shorter[j] {
                i += 1; j += 1
            } else if !skipped {
                i += 1; skipped = true
            } else {
                return false
            }
        }
        return true
    }

    /// Fields that stay in each tool's `required` list (so the schema keeps
    /// nudging the model to always emit them — `tool_title` drives the live
    /// pill header) but must NOT block the call when absent. They carry no
    /// execution semantics: a missing `tool_title` only costs a nicer label,
    /// never a broken tool run, so rejecting the whole call over it is pure
    /// downside. Preflight skips these when checking for missing required
    /// fields. [T-preflight-tool-title-nonblocking]
    static let preflightNonBlockingFields: Set<String> = ["tool_title"]

    /// (tool name → field names) where an EMPTY STRING is a semantically valid
    /// value and must not be treated as "missing". Distinct from
    /// `preflightNonBlockingFields` (which skips the missing-field check
    /// entirely): these fields must still be *present* in args — they are just
    /// allowed to hold "" as their content. The canonical case is
    /// `file_edit.new_string`: the tool schema explicitly documents
    /// "Use empty string to delete old_string", so blocking `new_string: ""`
    /// broke a promised deletion workflow and pushed the model into
    /// shell_execute workarounds. [T-preflight-empty-string-allowed]
    static let preflightEmptyStringAllowedFields: [String: Set<String>] = [
        "file_edit": ["new_string"],
    ]

    nonisolated static func preflightEmptyStringAllowed(tool: String, field: String) -> Bool {
        preflightEmptyStringAllowedFields[tool]?.contains(field) ?? false
    }

    nonisolated static func preflightValidateToolCall(name: String,
                                                      args: [String: Any],
                                                      tools: [AgentToolDefinition]) -> String? {
        // Unknown tool names go through to the existing default branch in the
        // dispatch switch which already returns an "Unknown tool" error to
        // the model. Preflight stays silent so we don't double-fail.
        guard let toolDef = tools.first(where: { $0.name == name }) else {
            return nil
        }
        // Required fields that actually gate execution (everything except the
        // non-blocking ones like tool_title).
        let enforced = toolDef.required.filter { !Self.preflightNonBlockingFields.contains($0) }
        // Empty args object on a tool that requires anything → block. Gate on
        // `enforced` so a tool whose only required field is non-blocking isn't
        // rejected for empty args, and the message lists only real blockers.
        if args.isEmpty && !enforced.isEmpty {
            return "Tool '\(name)' was called with empty arguments {} but requires: \(enforced.joined(separator: ", "))."
        }
        var missing: [String] = []
        for field in enforced {
            // Absent — or present as JSON null (JSONSerialization surfaces it
            // as NSNull): both are genuinely missing values. NSNull previously
            // slipped through this guard and reached the tool as a non-String.
            guard let raw = args[field], !(raw is NSNull) else {
                missing.append(field)
                continue
            }
            // String fields: only reject the truly-empty literal "". The
            // earlier blank check trimmed with `.whitespacesAndNewlines`
            // before testing emptiness, which over-rejected legitimate
            // payloads — most notably `file_edit` with
            // `new_string: "\n"` (replace a code block with a single
            // blank line) or `old_string: "  "` (match a literal run of
            // spaces). Both are valid edits, neither is stream corruption.
            // A `"   "` argument the validator was originally guarding
            // against is itself well-formed JSON and a model intentionally
            // typing whitespace is rare and benign — let it through; the
            // tool's own helper will surface a sensible error if it
            // genuinely doesn't make sense.
            //
            // And even the empty literal is legal for whitelisted
            // (tool, field) pairs — file_edit.new_string == "" is the
            // documented "delete old_string" form, not a missing value.
            // [T-preflight-empty-string-allowed]
            if let s = raw as? String, s.isEmpty,
               !Self.preflightEmptyStringAllowed(tool: name, field: field) {
                missing.append(field)
            }
        }
        if !missing.isEmpty {
            return "Tool '\(name)' is missing required parameter(s): \(missing.joined(separator: ", "))."
        }
        return nil
    }

}
