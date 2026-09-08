import XCTest
@testable import Minis

/// Phase 2 §2 — persistence layer safety net.
///
/// The single most important property of this layer is NEGATIVE: with no user-authored
/// rules (the state every existing user is in), resolution must be byte-for-byte what it
/// was before persistence existed. A persistence feature that silently changes requests
/// for users who never opened its UI would be the worst possible outcome, so that case
/// gets its own explicit test rather than relying on the golden snapshots alone.
final class ThinkingRulePersistenceTests: XCTestCase {

    private func canonical(_ value: Any) -> String {
        switch value {
        case let d as [String: Any]:
            return "{" + d.keys.sorted().map { "\($0):\(canonical(d[$0]!))" }.joined(separator: ",") + "}"
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
            return "\(n)"
        case let s as String: return "\"\(s)\""
        case is NSNull: return "null"
        default: return "\(value)"
        }
    }

    private func emit(_ ctx: ThinkingResolveContext) -> String {
        var body: [String: Any] = [:]
        _ = ThinkingRuleResolver.apply(to: &body, ctx: ctx)
        return canonical(body)
    }

    private func ctx(
        _ modelId: String,
        level: ThinkingLevel = .high,
        userRules: [ThinkingRule] = []
    ) -> ThinkingResolveContext {
        ThinkingResolveContext(
            modelId: modelId, supportsReasoning: true,
            declaredEffortValues: ["low", "medium", "high", "max"],
            level: level, maxTokens: 8192,
            isOpenRouter: false, usesUnifiedReasoningEffort: false, isMistral: false,
            offEffort: "none", userRules: userRules
        )
    }

    // MARK: - The invariant

    /// An empty user-rule list must resolve EXACTLY like Phase 1 did.
    func testEmptyUserRulesChangesNothing() {
        for id in ["gpt-5.3", "deepseek-v4-pro", "qwen3-32b", "glm-5.2", "mimo-v2.5", "unknown-model"] {
            for level in [ThinkingLevel.off, .low, .high, .max] {
                let withEmpty = emit(ctx(id, level: level, userRules: []))
                // Constructing the context without touching userRules at all must give the
                // same answer as explicitly passing []. If the default ever changes to
                // something non-empty, this catches it.
                var defaulted = ThinkingResolveContext(
                    modelId: id, supportsReasoning: true,
                    declaredEffortValues: ["low", "medium", "high", "max"],
                    level: level, maxTokens: 8192,
                    isOpenRouter: false, usesUnifiedReasoningEffort: false, isMistral: false,
                    offEffort: "none"
                )
                var body: [String: Any] = [:]
                _ = ThinkingRuleResolver.apply(to: &body, ctx: defaulted)
                XCTAssertEqual(withEmpty, canonical(body),
                               "\(id)/\(level.rawValue): empty user rules must be the default behaviour")
                defaulted.userRules = []
                XCTAssertEqual(emit(defaulted), withEmpty)
            }
        }
    }

    // MARK: - Override semantics

    /// A user rule that matches must WIN over the built-in that would otherwise apply.
    func testUserRuleOverridesBuiltIn() {
        // deepseek-v4-pro would normally take the vendor-native sibling shape.
        let builtin = emit(ctx("deepseek-v4-pro"))
        XCTAssertTrue(builtin.contains("thinking"), "precondition: built-in emits the vendor shape: \(builtin)")

        let override = ThinkingRule(
            kind: .custom, scope: .modelPattern("deepseek-v4*"),
            wireFormat: .omitEverything, label: "user override"
        )
        let overridden = emit(ctx("deepseek-v4-pro", userRules: [override]))
        XCTAssertEqual(overridden, "{}", "a matching user rule must shadow the built-in: \(overridden)")
    }

    /// A user rule whose scope does NOT match must leave the built-in result untouched.
    func testNonMatchingUserRuleIsInert() {
        let baseline = emit(ctx("gpt-5.3"))
        let unrelated = ThinkingRule(
            kind: .custom, scope: .modelPattern("claude-*"),
            wireFormat: .omitEverything, label: "unrelated"
        )
        XCTAssertEqual(emit(ctx("gpt-5.3", userRules: [unrelated])), baseline)
    }

    /// Order is priority: the FIRST matching user rule wins, later ones are ignored.
    func testFirstMatchingUserRuleWins() {
        let first = ThinkingRule(kind: .custom, scope: .allModels,
                                 wireFormat: .reasoningEffort(offValue: nil), label: "first")
        let second = ThinkingRule(kind: .custom, scope: .allModels,
                                  wireFormat: .omitEverything, label: "second")
        let out = emit(ctx("anything", userRules: [first, second]))
        XCTAssertTrue(out.contains("reasoning_effort"),
                      "the first rule must win, not the second: \(out)")
    }

    /// Built-ins remain reachable as a floor — a user rule that matches nothing must not
    /// break stage A's guarantee that something always matches.
    func testBuiltInFloorStillApplies() {
        let narrow = ThinkingRule(kind: .custom, scope: .modelPattern("nothing-matches-this"),
                                  wireFormat: .omitEverything, label: "narrow")
        let out = emit(ctx("some-relay-model", userRules: [narrow]))
        XCTAssertFalse(out.isEmpty, "resolution must still land on a built-in: \(out)")
    }

    // MARK: - Encoding round-trip

    /// Every wire format must survive persistence unchanged. A format that silently
    /// changes meaning across a save/load cycle would corrupt user rules on app restart.
    func testWireFormatRoundTrip() {
        let cases: [ThinkingWireFormat] = [
            .omitEverything,
            .reasoningEffort(offValue: "none"),
            .reasoningEffort(offValue: nil),
            .reasoningEffortNested(offValue: "minimal"),
            .deepSeekSibling,
            .qwenDual,
            .anthropicThinking(style: .adaptive),
            .anthropicThinking(style: .budgetTokens),
            .geminiBudget(floor: 128, canDisable: false),
            .geminiThinkingLevel,
            .booleanToggle(path: "thinking"),
            .extraBodyToggle(path: "extra_body.thinking.enabled"),
            .customPath(path: "a.b.c", values: [.high: "hi", .low: "lo"], offValue: "off"),
        ]
        for fmt in cases {
            let json = fmt.persistedJSON
            guard let back = ThinkingWireFormat.fromPersistedJSON(json) else {
                return XCTFail("failed to decode \(fmt)")
            }
            XCTAssertEqual(back, fmt, "round-trip changed \(fmt) -> \(back)")
        }
    }

    /// An unknown `kind` (a rule written by a NEWER build) must decode to nil so the
    /// caller can skip that ROW, rather than throwing and taking out the whole table.
    func testUnknownFormatDecodesToNil() {
        XCTAssertNil(ThinkingWireFormat.fromPersistedJSON(["kind": "somethingFromTheFuture"]))
        XCTAssertNil(ThinkingWireFormat.fromPersistedJSON([:]))
    }

    /// Scope encoding round-trip, including the `.`/`-` normalisation that made the
    /// Claude Opus catalog rules match nothing until 5aa9dc64.
    func testScopeRoundTripAndNormalisation() {
        let all = ThinkingRule.Scope.allModels
        XCTAssertEqual(ThinkingRule.Scope.fromPersisted(kind: all.persistedKind, pattern: all.persistedPattern), all)

        let pat = ThinkingRule.Scope.modelPattern("claude-opus-4*")
        XCTAssertEqual(ThinkingRule.Scope.fromPersisted(kind: pat.persistedKind, pattern: pat.persistedPattern), pat)
        XCTAssertTrue(pat.matches("claude-opus-4.8"))
        XCTAssertTrue(pat.matches("claude-opus-4-8"))
    }

    /// The cache must behave as "absent == no rules", never as a partial/stale answer.
    func testCacheEmptyIsSafeDefault() {
        let cache = ThinkingRuleCache.shared
        let id = "test-instance-\(UUID().uuidString)"
        XCTAssertEqual(cache.rules(for: id).count, 0)
        let r = ThinkingRule(kind: .custom, scope: .allModels, wireFormat: .omitEverything, label: "t")
        cache.set([r], for: id)
        XCTAssertEqual(cache.rules(for: id).count, 1)
        cache.set([], for: id)
        XCTAssertEqual(cache.rules(for: id).count, 0, "setting [] must clear, not retain a stale list")
    }
}
