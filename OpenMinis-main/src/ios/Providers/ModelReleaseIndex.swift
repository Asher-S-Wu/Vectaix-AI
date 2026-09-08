import Foundation

private let logger = AppLogger(category: "ModelReleaseIndex")

/// [T-model-release-ranking] Ranks models so the newest / most capable land at
/// the top of any list the user picks from — without anyone hand-maintaining an
/// order.
///
/// Why this exists: a picker whose first entries are stale models is an active
/// hazard, not just untidy. OpenMinis#83 was filed as "GPT-5.3 CodeX Spark
/// cannot call tools"; the real cause was that the Codex backend refuses that
/// model on a ChatGPT account (`400 … not supported`), and the refusal renders
/// as an EMPTY assistant turn. A new user picked a dead model off the list and
/// concluded the app was broken. Sorting the same 12 Codex ids by release date
/// puts all 6 callable ones in the top 6 — the failure would never have been
/// reachable from the default ordering.
///
/// IMPORTANT — this ranks, it does NOT gate. The date/availability correlation
/// above is a by-product of OpenAI's current retention policy, not a contract.
/// Never infer "callable" from a release date; that has to come from an actual
/// request (or a verified hardcoded list, as in `allOpenAICodexOAuth`).
enum ModelReleaseIndex {

    /// Sort key for one model. Ordering is: newest release first, then the more
    /// expensive (≈ larger / more capable) model, then the bigger context
    /// window, then name for a stable, non-jittery final order.
    struct Rank: Comparable {
        /// Days since epoch; `nil` release date sorts last (see `<`).
        let releaseDay: Int?
        let outputCostPerMTok: Double
        let contextWindow: Int
        let displayName: String

        static func < (lhs: Rank, rhs: Rank) -> Bool {
            // A model we can't date sinks below every dated one. It is NOT
            // hidden — custom, local and relay-hosted models legitimately have
            // no catalog entry, and dropping them would break those users.
            switch (lhs.releaseDay, rhs.releaseDay) {
            case let (l?, r?) where l != r: return l > r
            case (nil, _?): return false
            case (_?, nil): return true
            default: break
            }
            if lhs.outputCostPerMTok != rhs.outputCostPerMTok {
                return lhs.outputCostPerMTok > rhs.outputCostPerMTok
            }
            if lhs.contextWindow != rhs.contextWindow {
                return lhs.contextWindow > rhs.contextWindow
            }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    /// How a lookup resolved — surfaced for diagnostics only.
    enum MatchTier: String {
        case exact   // full id hit, including any vendor/ prefix
        case tail    // matched after dropping vendor prefix / date suffix
        case prefix  // matched a shorter family id (gpt-5.6-sol → gpt-5.6)
        case miss
    }

    /// Release date for a model id, or nil when the catalog has nothing for it.
    ///
    /// Accepts every id shape seen in the wild: `gpt-5.6-sol`,
    /// `abc/gpt-5.6-sol`, `crossmodel/moonshot/kimi-k2.5`, `kimi-k2-6:free`,
    /// `claude-sonnet-5@default`, `claude-opus-4-5-20251101` and the Bedrock
    /// form `us.anthropic.claude-opus-4-5-20251101-v1:0`.
    static func releaseDate(for modelId: String) -> Date? {
        resolve(modelId).date
    }

    /// Full ranking key. Pass the display name so same-date/same-price models
    /// still land in a deterministic order.
    static func rank(modelId: String, displayName: String, contextWindow: Int?) -> Rank {
        let hit = resolve(modelId)
        return Rank(
            releaseDay: hit.day,
            outputCostPerMTok: hit.outputCost ?? 0,
            contextWindow: contextWindow ?? hit.context ?? 0,
            displayName: displayName
        )
    }

    // MARK: - Resolution

    private struct Hit {
        var date: Date?
        var day: Int?
        var outputCost: Double?
        var context: Int?
        var tier: MatchTier
    }

    private static func resolve(_ raw: String) -> Hit {
        guard let index = ModelsDevAPI.releaseIndex() else {
            return Hit(date: nil, day: nil, outputCost: nil, context: nil, tier: .miss)
        }
        let cleaned = clean(raw)

        // 1. Full id — MUST be tried before the tail. Entries such as
        //    `aion-labs/aion-2.0` and `amazon/nova-lite-v1` exist ONLY under
        //    their namespaced id; going tail-first silently loses them (measured:
        //    58% → 80% resolution on a real 868-model device catalog).
        if let e = index.byFullId[cleaned] { return hit(e, .exact) }

        // 2. Tail (drop `vendor/…` and any `vendor.` prefix).
        var tail = cleaned.split(separator: "/").last.map(String.init) ?? cleaned
        tail = stripVendorDotPrefix(tail)
        if let e = index.byTail[tail] { return hit(e, .tail) }

        // 3. Tail minus a trailing `-20YYMMDD` snapshot stamp.
        let undated = stripDateSuffix(tail)
        if undated != tail, let e = index.byTail[undated] { return hit(e, .tail) }

        // 4. Walk the family up one token at a time: gpt-5.6-sol → gpt-5.6 → gpt.
        var parts = undated.split(separator: "-").map(String.init)
        while parts.count > 1 {
            parts.removeLast()
            if let e = index.byTail[parts.joined(separator: "-")] { return hit(e, .prefix) }
        }

        // Deliberately NO fuzzy/substring fallback. An earlier prototype scanned
        // for a shared family prefix and matched
        // `us.anthropic.claude-opus-4-5-20251101-v1:0` onto `claude-opus-5` —
        // a different model, six months off. A wrong date is worse than none:
        // it promotes a stale model to the top, which is exactly the failure
        // this type exists to prevent. Unknown stays unknown.
        return Hit(date: nil, day: nil, outputCost: nil, context: nil, tier: .miss)
    }

    private static func hit(_ e: ModelsDevAPI.ReleaseEntry, _ tier: MatchTier) -> Hit {
        Hit(date: e.date, day: e.day, outputCost: e.outputCost, context: e.context, tier: tier)
    }

    // MARK: - Id normalization

    /// Lowercase and strip the decorations providers bolt onto ids.
    private static func clean(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let i = s.firstIndex(of: ":") { s = String(s[s.startIndex..<i]) }   // `…:free`
        if let i = s.firstIndex(of: "@") { s = String(s[s.startIndex..<i]) }   // `…@default`
        for region in ["us.", "eu.", "apac.", "global."] where s.hasPrefix(region) {
            s = String(s.dropFirst(region.count))                              // Bedrock region
            break
        }
        return s
    }

    /// Drop a leading `vendor.` segment (`anthropic.claude-…`), but only when it
    /// looks like a namespace rather than part of a version (`gpt-5.6` must not
    /// lose anything here — the dot there is not preceded by a bare word token).
    private static func stripVendorDotPrefix(_ s: String) -> String {
        guard let dot = s.firstIndex(of: ".") else { return s }
        let head = s[s.startIndex..<dot]
        guard !head.isEmpty, head.allSatisfy({ $0.isLetter }) else { return s }
        return String(s[s.index(after: dot)...])
    }

    /// Remove a trailing `-20YYMMDD` snapshot stamp.
    private static func stripDateSuffix(_ s: String) -> String {
        guard s.count > 9 else { return s }
        let tail = s.suffix(9)
        guard tail.first == "-" else { return s }
        let digits = tail.dropFirst()
        guard digits.count == 8, digits.allSatisfy(\.isNumber), digits.hasPrefix("20") else { return s }
        return String(s.dropLast(9))
    }

    // MARK: - Date parsing

    private static let calendar = Calendar(identifier: .gregorian)
    private static let epoch = DateComponents(calendar: Calendar(identifier: .gregorian),
                                              timeZone: TimeZone(secondsFromGMT: 0),
                                              year: 1970, month: 1, day: 1).date!

    /// Parse `YYYY-MM-DD` **or** `YYYY-MM` (181 bundled entries use the short
    /// form). Returns nil for anything else rather than guessing.
    static func parseReleaseDate(_ raw: String) -> (date: Date, day: Int)? {
        let parts = raw.split(separator: "-")
        guard parts.count == 2 || parts.count == 3,
              let year = Int(parts[0]), parts[0].count == 4,
              let month = Int(parts[1]), (1...12).contains(month) else { return nil }
        var day = 1
        if parts.count == 3 {
            guard let d = Int(parts[2]), (1...31).contains(d) else { return nil }
            day = d
        }
        var c = DateComponents()
        c.year = year; c.month = month; c.day = day
        c.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = calendar.date(from: c) else { return nil }
        let days = Int(date.timeIntervalSince(epoch) / 86_400)
        return (date, days)
    }
}
