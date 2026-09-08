import Foundation

/// Exposes ModelGroup fields under `groups.<id>.…`. Includes member
/// list reordering via the `members` field (writes a JSON array of
/// entry UUIDs in the desired order). Add/remove fully supported —
/// users frequently want to spin up named bundles for fallback.
@MainActor
struct GroupsCollection: ConfigCollection {
    let basePath = "groups"
    let displayName = "Model groups"
    let description = "Named bundles of models with fallback / load-balance routing."
    let addable = true
    let removable = true
    let risk: ConfigRisk = .sensitive

    /// Add payload schema (all optional except `name`):
    /// {
    ///   "name": "Fast group",
    ///   "entries": ["<entry-uuid>", "<entry-uuid>"],   // or legacy "members"
    ///   "strategy": "fallback" | "loadBalance",
    ///   "fallback_strategy": "limited" | "always",
    ///   "default_thinking_level": "off" | "low" | "medium" | "high" | "xhigh",
    ///   "context_limit_tokens": 64000
    /// }
    let addPayloadSchema: ConfigValueSchema = .json

    func childIds() -> [String] {
        ProviderConfigStore.shared.config.modelGroups.map(\.id)
    }

    func fields(for id: String) -> [ConfigField] {
        guard group(id) != nil else { return [] }
        return [
            nameField(for: id),
            strategyField(for: id),
            fallbackStrategyField(for: id),
            defaultThinkingLevelField(for: id),
            contextLimitField(for: id),
            // Single canonical name — `entries` matches the aggregate
            // `groups` summary's key. The earlier `members` alias was
            // dropped to avoid showing two identical fields in
            // topic-help.
            entriesField(for: id),
        ]
    }

    func add(_ payload: ConfigValue) throws -> String {
        guard case .object(let dict) = payload else {
            throw ConfigError.invalidValue("Expected JSON object")
        }
        guard case .string(let name)? = dict["name"], !name.isEmpty else {
            throw ConfigError.invalidValue("`name` required")
        }
        // Accept either `entries` (matches the group's display field + the
        // aggregate `groups` summary key) or the legacy `members` alias.
        var members: [String] = []
        if case .array(let arr)? = (dict["entries"] ?? dict["members"]) {
            for v in arr {
                if case .string(let s) = v, !s.isEmpty { members.append(s) }
            }
        }
        var strategy: RoutingStrategy = .fallback
        if case .string(let s)? = dict["strategy"], let parsed = RoutingStrategy(rawValue: s) {
            strategy = parsed
        }
        var fallbackStrategy: FallbackStrategy = .limited
        if case .string(let s)? = dict["fallback_strategy"], let parsed = FallbackStrategy(rawValue: s) {
            fallbackStrategy = parsed
        }
        var defaultThinking: ThinkingLevel? = nil
        if case .string(let s)? = dict["default_thinking_level"], !s.isEmpty {
            defaultThinking = ThinkingLevel.decoded(s)
        }
        var contextLimit: Int? = nil
        if case .int(let i)? = dict["context_limit_tokens"], i > 0 {
            contextLimit = i
        }
        let g = ModelGroup(
            name: name, memberEntryIds: members,
            strategy: strategy, fallbackStrategy: fallbackStrategy,
            defaultThinkingLevel: defaultThinking,
            contextLimitTokens: contextLimit
        )
        ProviderConfigStore.shared.addGroup(g)
        return g.id
    }

    func remove(id: String) throws {
        guard group(id) != nil else { throw ConfigError.unknownPath("groups.\(id)") }
        ProviderConfigStore.shared.removeGroup(id)
    }

    // MARK: Field factories

    private func group(_ id: String) -> ModelGroup? {
        ProviderConfigStore.shared.config.modelGroups.first { $0.id == id }
    }

    private func mutate(_ id: String, _ apply: (inout ModelGroup) -> Void) throws {
        guard var g = group(id) else { throw ConfigError.unknownPath("groups.\(id)") }
        apply(&g)
        ProviderConfigStore.shared.updateGroup(g)
    }

    private func nameField(for id: String) -> ConfigField {
        ClosureField(
            path: "groups.\(id).name",
            displayName: "Name",
            description: "User-visible label.",
            valueSchema: .string(maxLength: 200),
            risk: .normal, revertable: true,
            reader: { [self] in
                guard let g = group(id) else { return .null }
                return .string(g.name)
            },
            writer: { [self] v in
                guard case .string(let s) = v else { throw ConfigError.typeMismatch(expected: "string") }
                try mutate(id) { $0.name = s }
            }
        )
    }

    private func strategyField(for id: String) -> ConfigField {
        ClosureField(
            path: "groups.\(id).strategy",
            displayName: "Routing strategy",
            description: "fallback (try in order) / loadBalance (distribute).",
            valueSchema: .stringEnum(["fallback", "loadBalance"]),
            risk: .sensitive, revertable: true,
            reader: { [self] in
                guard let g = group(id) else { return .null }
                return .string(g.strategy.rawValue)
            },
            writer: { [self] v in
                guard case .string(let s) = v,
                      let parsed = RoutingStrategy(rawValue: s) else {
                    throw ConfigError.invalidValue("Unknown strategy")
                }
                try mutate(id) { $0.strategy = parsed }
            }
        )
    }

    private func fallbackStrategyField(for id: String) -> ConfigField {
        ClosureField(
            path: "groups.\(id).fallbackStrategy",
            displayName: "Fallback policy",
            description: "limited (only on provider rejection) / always (also on transient errors).",
            valueSchema: .stringEnum(["limited", "always"]),
            risk: .sensitive, revertable: true,
            reader: { [self] in
                guard let g = group(id) else { return .null }
                return .string(g.fallbackStrategy.rawValue)
            },
            writer: { [self] v in
                guard case .string(let s) = v,
                      let parsed = FallbackStrategy(rawValue: s) else {
                    throw ConfigError.invalidValue("Unknown fallback strategy")
                }
                try mutate(id) { $0.fallbackStrategy = parsed }
            }
        )
    }

    private func defaultThinkingLevelField(for id: String) -> ConfigField {
        ClosureField(
            path: "groups.\(id).defaultThinkingLevel",
            displayName: "Default thinking level",
            description: "Applied to new sessions bound to this group. Empty = off.",
            valueSchema: .stringEnum(["", "off", "low", "medium", "high", "xhigh", "max", "ultra"]),
            risk: .normal, revertable: true,
            reader: { [self] in
                guard let g = group(id) else { return .null }
                return .string(g.defaultThinkingLevel?.rawValue ?? "")
            },
            writer: { [self] v in
                guard case .string(let s) = v else { throw ConfigError.typeMismatch(expected: "string") }
                try mutate(id) {
                    if s.isEmpty {
                        $0.defaultThinkingLevel = nil
                    } else {
                        $0.defaultThinkingLevel = ThinkingLevel.decoded(s)
                    }
                }
            }
        )
    }

    private func contextLimitField(for id: String) -> ConfigField {
        ClosureField(
            path: "groups.\(id).contextLimitTokens",
            displayName: "Context limit (tokens)",
            description: "0 = no limit (use model's native context window).",
            valueSchema: .int(min: 0, max: 4_000_000),
            risk: .sensitive, revertable: true,
            reader: { [self] in
                guard let g = group(id) else { return .null }
                return .int(g.contextLimitTokens ?? 0)
            },
            writer: { [self] v in
                guard case .int(let i) = v else { throw ConfigError.typeMismatch(expected: "int") }
                try mutate(id) { $0.contextLimitTokens = (i == 0) ? nil : i }
            }
        )
    }

    /// Entries live as a JSON array of model entry UUIDs. Writing
    /// replaces the whole list — the same path covers add / remove /
    /// reorder in one operation. Use `groups.<id>.entries.append`
    /// or `.remove` (handled by the bridge) for single-element ops.
    /// The audit row carries the diff so the user can revert to the
    /// old order.
    private func entriesField(for id: String) -> ConfigField {
        ClosureField(
            path: "groups.\(id).entries",
            displayName: "Entries",
            description: "Ordered list of model entry UUIDs.",
            valueSchema: .array(.string()),
            risk: .sensitive, revertable: true,
            reader: { [self] in
                guard let g = group(id) else { return .null }
                return .array(g.memberEntryIds.map { .string($0) })
            },
            writer: { [self] v in
                guard case .array(let arr) = v else { throw ConfigError.typeMismatch(expected: "array") }
                let ids: [String] = arr.compactMap {
                    if case .string(let s) = $0 { return s } else { return nil }
                }
                // Verify every id refers to an existing entry; reject
                // the whole batch on first invalid id.
                let validIds = Set(ProviderConfigStore.shared.config.modelEntries.map(\.id))
                for entryId in ids where !validIds.contains(entryId) {
                    throw ConfigError.invalidValue("Unknown model entry uuid: \(entryId)")
                }
                try mutate(id) { $0.memberEntryIds = ids }
            }
        )
    }
}
