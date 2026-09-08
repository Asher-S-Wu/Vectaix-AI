import Foundation

/// A dynamically-keyed group of fields, e.g. one ModelEntry per uuid,
/// one ProviderInstance per id, one ModelGroup per id.
///
/// Static fields go through the flat `ConfigRegistry.fields` map. A
/// collection adds two more capabilities:
///
///   1. Enumerate runtime children (`childIds()`) — the bridge uses
///      this for `minis-config <topic> list` and to resolve dynamic
///      paths like `models.<uuid>.maxOutputTokens`.
///
///   2. Define `add` / `remove` semantics — these create or dispose
///      the entire child rather than mutate one of its fields. The
///      bridge surfaces them as topic subcommands and they CANNOT be
///      reverted (revert would need to re-mint a uuid that no longer
///      exists in dependent stores like model groups).
///
/// New collections subclass-by-conformance: implement the protocol,
/// register an instance via `ConfigRegistry.shared.register(collection)`.
@MainActor
protocol ConfigCollection {
    /// First segment of every member's path, e.g. "models" or "groups".
    var basePath: String { get }
    var displayName: String { get }
    var description: String { get }

    var addable: Bool { get }
    var removable: Bool { get }
    /// Risk applied to add/remove operations (children declare their own
    /// per-field risk). Defaults to `.sensitive` because creating or
    /// destroying structured records is more impactful than tweaking a
    /// scalar.
    var risk: ConfigRisk { get }

    /// Currently-existing child ids. Order is meaningful for the few
    /// collections where ordering is user-visible (e.g. group members).
    func childIds() -> [String]

    /// All field instances exposed for one child id. Empty if id missing.
    /// Each returned field's `path` MUST start with "<basePath>.<id>.".
    func fields(for id: String) -> [ConfigField]

    /// Schema for the JSON object accepted by `add`. Drives `--help`
    /// output and pre-write validation. `.json` allows the collection
    /// to do its own parsing.
    var addPayloadSchema: ConfigValueSchema { get }

    /// Create a new child. Returns the new id; the bridge appends an
    /// audit row `<basePath>.<newId>` with old="" and new=payload.
    func add(_ payload: ConfigValue) throws -> String

    /// Remove a child. Throws if id missing or not removable (e.g.
    /// API-reported model entries can't be deleted, only hidden).
    func remove(id: String) throws
}

extension ConfigCollection {
    var addable: Bool { true }
    var removable: Bool { true }
    var risk: ConfigRisk { .sensitive }
}
