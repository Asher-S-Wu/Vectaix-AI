import Foundation

/// One entry in a provider's thinking-rules list.
///
/// PHASE 1: only built-in rules exist (`.officialVendor` / `.providerTypeDefault`).
/// User-authored rules, persistence, reordering and the Provider-detail UI are Phase 2 —
/// `.custom` is declared so the ordering semantics below are already correct when they
/// arrive, but nothing constructs it yet.
struct ThinkingRule: Equatable, Identifiable {

    enum Kind: Equatable {
        /// A user-authored rule. Phase 2. Always sorts ABOVE built-ins.
        case custom
        /// A specific vendor's documented shape (DeepSeek official, Venice, Ark…).
        case officialVendor
        /// The fallback for a providerType when no vendor rule matched. Its scope is
        /// always `.allModels`, which is what guarantees resolution never falls through.
        case providerTypeDefault
    }

    /// Which models this rule applies to.
    enum Scope: Equatable {
        case allModels
        /// Glob against the model id, `*` being the only wildcard.
        case modelPattern(String)

        /// Case-insensitive, and normalises `.` to `-` before matching.
        ///
        /// That normalisation is not cosmetic: the built-in catalog spells Claude ids
        /// with hyphens (`claude-opus-4-8`) while third-party proxies return dots
        /// (`claude-opus-4.8`). A rule set written in one spelling silently matched
        /// NOTHING for a year — every Opus model fell through to the wrong ceiling until
        /// 5aa9dc64 normalised it. MiMo has the same hazard in the other direction:
        /// docs say `mimo-2.5`, the live API serves `mimo-v2.5` (72968c4f).
        func matches(_ modelId: String) -> Bool {
            switch self {
            case .allModels:
                return true
            case .modelPattern(let pattern):
                return Self.glob(pattern.lowercased().replacingOccurrences(of: ".", with: "-"),
                                 matches: modelId.lowercased().replacingOccurrences(of: ".", with: "-"))
            }
        }

        /// Minimal glob: `*` matches any run of characters, everything else is literal.
        /// Implemented directly rather than via NSPredicate/regex so the semantics are
        /// identical to the Kotlin port character-for-character.
        static func glob(_ pattern: String, matches input: String) -> Bool {
            let parts = pattern.components(separatedBy: "*")
            if parts.count == 1 { return input == pattern }

            var cursor = input.startIndex
            for (i, part) in parts.enumerated() {
                if part.isEmpty { continue }
                if i == 0 {
                    guard input.hasPrefix(part) else { return false }
                    cursor = input.index(cursor, offsetBy: part.count)
                    continue
                }
                if i == parts.count - 1 && !pattern.hasSuffix("*") {
                    // Trailing literal must land exactly at the end.
                    guard input.hasSuffix(part),
                          input.distance(from: cursor, to: input.endIndex) >= part.count else { return false }
                    continue
                }
                guard let found = input.range(of: part, range: cursor..<input.endIndex) else { return false }
                cursor = found.upperBound
            }
            return true
        }
    }

    var kind: Kind
    var scope: Scope
    /// `nil` means "this rule expresses no opinion on the wire shape" — resolution then
    /// falls through to the next fallback layer (design §4.2 stage B).
    var wireFormat: ThinkingWireFormat?
    /// Phase 2. Declared so the shape is stable; the echo path still lives in
    /// `flattenChatCompletionsMessages` for now.
    var reasoningEcho: ReasoningEchoPolicy?
    /// Human-readable identifier, surfaced in the resolution trace.
    var label: String
    /// Stable identity. User rules get a UUID at creation and keep it for the row's
    /// lifetime (it is the primary key in `provider_thinking_rules`, and what
    /// drag-reorder rewrites positions against). Built-in rules get a deterministic id so
    /// a trace is reproducible across launches.
    ///
    /// [T-thinking-rules-phase2] The built-in id includes the SCOPE, not just the label.
    /// Deriving it from the label alone was a real bug: the five OpenAI-native rules
    /// (o1*/o3*/o4*/gpt-5*/gpt-4*) deliberately share the label "openai-native", so they
    /// all collapsed to the same id — and SwiftUI's `ForEach`, which de-duplicates by
    /// `Identifiable`, rendered the FIRST row five times. The provider detail page showed
    /// five identical "openai-native / o1*" entries instead of the five distinct patterns.
    /// Resolution was unaffected (it walks the array and never consults `id`), so this was
    /// display-only — but it made the rule list actively misleading about what would run.
    /// Including the scope makes a collision impossible for any two rules that differ in
    /// what they match, which is the property the list actually needs.
    var id: String

    /// True when the user may edit or delete this rule. Built-ins are read-only: they can
    /// be OVERRIDDEN by placing a custom rule above them, but never removed — otherwise a
    /// provider could end up with no matching rule at all and stage A would fall through.
    var isEditable: Bool { kind == .custom }

    init(
        kind: Kind,
        scope: Scope,
        wireFormat: ThinkingWireFormat?,
        reasoningEcho: ReasoningEchoPolicy? = nil,
        label: String,
        id: String? = nil
    ) {
        self.kind = kind
        self.scope = scope
        self.wireFormat = wireFormat
        self.reasoningEcho = reasoningEcho
        self.label = label
        self.id = id ?? (kind == .custom
            ? UUID().uuidString
            : "builtin:\(label):\(scope.persistedKind):\(scope.persistedPattern ?? "*")")
    }
}

/// How captured reasoning is echoed back on assistant history turns.
///
/// PHASE 1: declared but not yet enforced through the resolver — the live behaviour
/// still lives in `flattenChatCompletionsMessages`. It is modelled here because the
/// send-side and echo-side are two halves of ONE vendor contract, and splitting them is
/// exactly what let OpenMinis#22 be fixed on the OpenAI path while OpenMinis#70 stayed
/// broken on the Anthropic path.
struct ReasoningEchoPolicy: Equatable {
    /// `reasoning_content` / `reasoning` / `reasoning_text` — the three spellings observed
    /// in the wild, sometimes three different ones on a single gateway (OpenMinis#171).
    var fieldName: String
    var timing: Timing

    enum Timing: Equatable {
        /// Some gateways validate unconditionally once thinking is active (nous).
        case everyTurn
        /// DeepSeek's documented requirement: only tool-call turns must echo.
        case afterToolUseOnly
        /// Mistral: never, in any situation.
        case never
    }
}
