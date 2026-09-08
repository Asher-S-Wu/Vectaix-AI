import Foundation

/// How a model group routes requests across its members.
enum RoutingStrategy: String, Codable, Hashable, Sendable {
    /// Try models in order; advance to next on failure.
    case fallback
    /// Distribute sessions across models deterministically.
    case loadBalance
}

/// When to trigger fallback to the next model in a fallback group.
enum FallbackStrategy: String, Codable, Hashable, Sendable {
    /// Default behavior: only fallback on provider-level errors (rate limit, invalid key,
    /// provider rejection). Network and transient errors are retried on the current model first.
    case limited
    /// Fallback on any error — including network errors and transient server errors —
    /// without retrying on the current model. Cycles through all group members.
    case always
}

/// Named group of ModelEntry refs with a routing strategy.
struct ModelGroup: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    /// Ordered ModelEntry.id values (composite "{instanceId}:{modelId}").
    var memberEntryIds: [String]
    var strategy: RoutingStrategy
    /// Controls which errors trigger fallback. Only applies when `strategy == .fallback`.
    var fallbackStrategy: FallbackStrategy
    /// Default thinking level applied to new sessions bound to this group. nil = off (no override).
    var defaultThinkingLevel: ThinkingLevel?
    /// Context window limit override in tokens applied in-memory to sessions bound to this group.
    /// nil = unlimited (use model's native context window).
    var contextLimitTokens: Int?
    /// Last user-selected context limit, retained while `contextLimitTokens` is nil
    /// so toggling "Limit Context Window" off then back on restores the previous
    /// choice instead of resetting to 128K.
    var lastContextLimitTokens: Int?

    /// [T-icloud-provider-sync-consistency] Per-member add/remove timestamps
    /// for conflict-free multi-device member merging. `memberEntryIds` stays a
    /// plain ordered `[String]` (router and UI are unchanged); these two
    /// side-maps drive the UNION merge on inbound sync:
    ///   - addedMembers[m]   = when m was last added to this group
    ///   - removedMembers[m] = when m was last removed from this group
    /// Merge rule (per member, after unioning both devices' maps by max-time):
    ///   m is present in the group  iff  addedAt(m) >= removedAt(m)
    /// i.e. the most recent intent wins per member. Two devices each adding a
    /// different model both keep their addition (union); a removal on one
    /// device only drops the member if no newer re-add exists anywhere. Empty
    /// maps mean "legacy group, treat every current member as added at time 0".
    var addedMembers: [String: Date]
    var removedMembers: [String: Date]

    init(
        id: String = UUID().uuidString,
        name: String,
        memberEntryIds: [String],
        strategy: RoutingStrategy = .fallback,
        fallbackStrategy: FallbackStrategy = .limited,
        defaultThinkingLevel: ThinkingLevel? = nil,
        contextLimitTokens: Int? = nil,
        lastContextLimitTokens: Int? = nil,
        addedMembers: [String: Date] = [:],
        removedMembers: [String: Date] = [:]
    ) {
        self.id = id
        self.name = name
        self.memberEntryIds = memberEntryIds
        self.strategy = strategy
        self.fallbackStrategy = fallbackStrategy
        self.defaultThinkingLevel = defaultThinkingLevel
        self.contextLimitTokens = contextLimitTokens
        self.lastContextLimitTokens = lastContextLimitTokens
        self.addedMembers = addedMembers
        self.removedMembers = removedMembers
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, memberEntryIds, strategy, fallbackStrategy, defaultThinkingLevel, contextLimitTokens, lastContextLimitTokens, addedMembers, removedMembers
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        memberEntryIds = try container.decode([String].self, forKey: .memberEntryIds)
        strategy = try container.decode(RoutingStrategy.self, forKey: .strategy)
        fallbackStrategy = try container.decodeIfPresent(FallbackStrategy.self, forKey: .fallbackStrategy) ?? .limited
        if let raw = try container.decodeIfPresent(String.self, forKey: .defaultThinkingLevel) {
            defaultThinkingLevel = ThinkingLevel.decoded(raw)
        } else {
            defaultThinkingLevel = nil
        }
        contextLimitTokens = try container.decodeIfPresent(Int.self, forKey: .contextLimitTokens)
        lastContextLimitTokens = try container.decodeIfPresent(Int.self, forKey: .lastContextLimitTokens)
        addedMembers = try container.decodeIfPresent([String: Date].self, forKey: .addedMembers) ?? [:]
        removedMembers = try container.decodeIfPresent([String: Date].self, forKey: .removedMembers) ?? [:]
    }
}
