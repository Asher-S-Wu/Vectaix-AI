import AppIntents
import Foundation

/// Represents a selectable model target in Shortcuts:
/// either a ModelGroup (e.g. "Agent Loop") or a specific ModelEntry (e.g. "claude-opus-4-5").
struct ModelSelectionEntity: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Default Model")
    static var defaultQuery = ModelSelectionEntityQuery()

    var id: String
    var displayName: String
    var subtitle: String
    var kind: Kind

    enum Kind: String {
        case group
        case entry
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(displayName)", subtitle: "\(subtitle)")
    }

    init(group: ModelGroup) {
        self.id = "group:\(group.id)"
        self.displayName = group.name
        self.subtitle = "Group · \(group.memberEntryIds.count) model\(group.memberEntryIds.count == 1 ? "" : "s")"
        self.kind = .group
    }

    init(entry: ModelEntry) {
        self.id = "entry:\(entry.compositeKey)"
        self.displayName = entry.model.displayName
        self.subtitle = "\(entry.model.provider) · \(entry.model.id)"
        self.kind = .entry
    }

    @MainActor
    func toSessionModelBinding(sessionId: String, store: ProviderConfigStore) -> SessionModelBinding? {
        switch kind {
        case .group:
            let groupId = String(id.dropFirst("group:".count))
            guard let group = store.group(for: groupId),
                  let firstMemberId = group.memberEntryIds.first else { return nil }
            return SessionModelBinding(
                sessionId: sessionId,
                primarySource: .group(groupId: groupId, resolvedEntryId: firstMemberId)
            )
        case .entry:
            let compositeKey = String(id.dropFirst("entry:".count))
            guard let entry = store.entry(for: compositeKey) else { return nil }
            return SessionModelBinding(
                sessionId: sessionId,
                primarySource: .directEntry(modelEntryId: entry.id, compositeKey: entry.compositeKey)
            )
        }
    }
}

struct ModelSelectionEntityQuery: EntityQuery, EntityStringQuery {
    typealias Result = IntentItemCollection<ModelSelectionEntity>

    /// [T-shortcuts-disabled-provider] Is this entry OFFERABLE in the Shortcuts
    /// picker — i.e. not hidden, and owned by an ENABLED provider instance?
    ///
    /// Disabling a provider is the user saying "stop using this account". The
    /// picker previously filtered on `!isHidden` alone, so every model of a
    /// disabled provider stayed selectable in Shortcuts and the resulting
    /// automation would fail at run time against a provider the user had
    /// deliberately switched off. `chat.models.list` already applies exactly this
    /// instance check (DebugRPCProviderChat ~857) — the intents surface simply
    /// never got it.
    ///
    /// Deliberately applied ONLY to the two *offering* paths (`entities(matching:)`
    /// and `suggestedEntities()`). `entities(for:)` / `resolveExact` resolve an id
    /// the user ALREADY picked, and must keep resolving it: an existing shortcut
    /// pointing at a temporarily-disabled provider should still display its name
    /// and re-run once the provider is switched back on, rather than silently
    /// becoming an unrecognised entity.
    @MainActor
    private func isOfferable(_ entry: ModelEntry, store: ProviderConfigStore) -> Bool {
        guard !entry.isHidden else { return false }
        return store.instance(for: entry.providerInstanceId)?.isEnabled == true
    }

    @MainActor
    func entities(for identifiers: [String]) async throws -> [ModelSelectionEntity] {
        let store = ProviderConfigStore.shared
        var results: [ModelSelectionEntity] = []
        for id in identifiers {
            if let entity = resolveExact(id: id, store: store) {
                results.append(entity)
            }
        }
        return results
    }

    @MainActor
    func entities(matching string: String) async throws -> IntentItemCollection<ModelSelectionEntity> {
        let store = ProviderConfigStore.shared
        let query = string.lowercased()

        if string.hasPrefix("group:") || string.hasPrefix("entry:") {
            if let entity = resolveExact(id: string, store: store) {
                return IntentItemCollection(items: [entity])
            }
        }

        var results: [ModelSelectionEntity] = []

        for group in store.config.modelGroups {
            if group.name.lowercased().contains(query) {
                results.append(ModelSelectionEntity(group: group))
            }
        }

        for entry in store.config.modelEntries where isOfferable(entry, store: store) {
            if entry.model.displayName.lowercased().contains(query)
                || entry.model.id.lowercased().contains(query)
                || entry.compositeKey.lowercased().contains(query) {
                results.append(ModelSelectionEntity(entry: entry))
            }
        }

        return IntentItemCollection(items: results)
    }

    @MainActor
    func suggestedEntities() async throws -> IntentItemCollection<ModelSelectionEntity> {
        let store = ProviderConfigStore.shared

        let groupItems: [IntentItem<ModelSelectionEntity>] = store.config.modelGroups.map { group in
            IntentItem(
                ModelSelectionEntity(group: group),
                title: LocalizedStringResource(stringLiteral: group.name),
                subtitle: LocalizedStringResource(stringLiteral: "Group · \(group.memberEntryIds.count) model\(group.memberEntryIds.count == 1 ? "" : "s")")
            )
        }

        var seenIds = Set<String>()
        let orderedInstanceIds: [String] = store.config.modelEntries
            .filter { isOfferable($0, store: store) }
            .compactMap { entry -> String? in
                let id = entry.providerInstanceId
                guard !seenIds.contains(id) else { return nil }
                seenIds.insert(id)
                return id
            }

        func providerItems(for instanceId: String) -> [IntentItem<ModelSelectionEntity>] {
            store.config.modelEntries
                .filter { $0.providerInstanceId == instanceId && isOfferable($0, store: store) }
                .map { entry in
                    IntentItem(
                        ModelSelectionEntity(entry: entry),
                        title: LocalizedStringResource(stringLiteral: entry.model.displayName),
                        subtitle: LocalizedStringResource(stringLiteral: entry.model.id)
                    )
                }
        }

        if #available(iOS 16.4, *) {
            var sections: [IntentItemSection<ModelSelectionEntity>] = []

            if !groupItems.isEmpty {
                sections.append(IntentItemSection(
                    LocalizedStringResource("Model Groups"),
                    items: groupItems
                ))
            }

            for iid in orderedInstanceIds {
                let items = providerItems(for: iid)
                guard !items.isEmpty else { continue }
                let label = store.instance(for: iid)?.label ?? "Unknown Provider"
                sections.append(IntentItemSection(
                    LocalizedStringResource(stringLiteral: label),
                    items: items
                ))
            }

            return IntentItemCollection(sections: sections)
        } else {
            var sections: [IntentItemSection<ModelSelectionEntity>] = []

            if !groupItems.isEmpty {
                sections.append(IntentItemSection(items: groupItems))
            }

            for iid in orderedInstanceIds {
                let items = providerItems(for: iid)
                guard !items.isEmpty else { continue }
                sections.append(IntentItemSection(items: items))
            }

            return IntentItemCollection(sections: sections)
        }
    }

    @MainActor
    private func resolveExact(id: String, store: ProviderConfigStore) -> ModelSelectionEntity? {
        if id.hasPrefix("group:") {
            let gid = String(id.dropFirst("group:".count))
            if let g = store.group(for: gid) { return ModelSelectionEntity(group: g) }
        } else if id.hasPrefix("entry:") {
            let ck = String(id.dropFirst("entry:".count))
            if let e = store.entry(for: ck) { return ModelSelectionEntity(entry: e) }
        }
        return nil
    }
}
