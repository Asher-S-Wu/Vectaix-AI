import Foundation

/// Hand-rolled field. Use this when the storage backend is not a
/// simple UserDefaults key — singletons with `didSet` persistence,
/// SQLite rows, files, transient managers, etc. The closures run on
/// the main actor so they can freely touch ObservableObject state.
///
/// Validation: pass `valueSchema` and the bridge runs schema.validate
/// before invoking `writer`. The writer may still throw extra
/// invariants (e.g. "the new primary group must already exist").
struct ClosureField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let valueSchema: ConfigValueSchema
    var access: ConfigAccess = .readwrite
    var risk: ConfigRisk = .normal
    var revertable: Bool = true

    let reader: @MainActor () throws -> ConfigValue
    let writer: @MainActor (ConfigValue) throws -> Void

    @MainActor func read() throws -> ConfigValue {
        try reader()
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        try writer(value)
    }
}

/// A read-only field. Useful for stats / status surfaces (storage
/// usage, last-sync timestamp, audit log capacity). Any write attempt
/// returns `permission_denied` since `access = .readonly`; the bridge
/// shouldn't even reach `write` but we still throw to be safe.
struct ReadOnlyField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let valueSchema: ConfigValueSchema
    var access: ConfigAccess = .readonly
    var risk: ConfigRisk = .normal
    var revertable: Bool { false }
    let reader: @MainActor () throws -> ConfigValue

    @MainActor func read() throws -> ConfigValue { try reader() }
    @MainActor func write(_ value: ConfigValue) throws {
        throw ConfigError.permissionDenied(reason: "Read-only")
    }
}

/// A field that exists purely to be hidden. The registry keeps it
/// around so the bridge can return a precise error rather than
/// leaking implementation details with "unknown_path". Examples:
/// `providers.<id>.apiKey`, `providers.<id>.oauthToken`,
/// `envvars.<key>.value`, `permissions.minisConfig.enabled` (the
/// master switch can only be toggled in Settings UI).
struct HiddenField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let valueSchema: ConfigValueSchema = .json
    var access: ConfigAccess { .hidden }
    var risk: ConfigRisk { .destructive }
    var revertable: Bool { false }
    let reason: String

    @MainActor func read() throws -> ConfigValue {
        throw ConfigError.permissionDenied(reason: reason)
    }
    @MainActor func write(_ value: ConfigValue) throws {
        throw ConfigError.permissionDenied(reason: reason)
    }
}

/// Wraps a real field's registration for a feature that does not exist on
/// this device / OS version (iCloud Sync on iOS 16, Live Activity on
/// unsupported hardware). Keeping the path registered — instead of just not
/// registering it — lets the bridge answer with a precise
/// `feature_unavailable` error rather than a confusing `unknown_path`, and
/// keeps `--help` honest about why the setting can't be changed. The bridge
/// checks `unavailableReason` before validation and before the confirmation
/// sheet, so the user is never asked to approve a write that cannot apply.
struct UnavailableField: ConfigField {
    let base: ConfigField
    let reason: String

    var path: String { base.path }
    var displayName: String { base.displayName }
    var description: String { "\(base.description) UNAVAILABLE on this device: \(reason)" }
    var valueSchema: ConfigValueSchema { base.valueSchema }
    var access: ConfigAccess { base.access }
    var risk: ConfigRisk { base.risk }
    var revertable: Bool { false }
    var unavailableReason: String? { reason }

    @MainActor func read() throws -> ConfigValue {
        throw ConfigError.permissionDenied(reason: reason)
    }
    @MainActor func write(_ value: ConfigValue) throws {
        throw ConfigError.permissionDenied(reason: reason)
    }
}

/// A field that can be WRITTEN but never READ — used for credentials the user
/// may supply (e.g. `providers.<id>.apiKey`) where the red line is "writable,
/// not readable". `access = .readwrite` so the bridge permits writes; `read()`
/// throws permission_denied so the secret never flows back out. The bridge
/// additionally masks the written value in the audit log / confirm sheet /
/// response (ConfigValue.secretObjectKeys), so the plaintext only reaches the
/// writer closure (→ Keychain). Not revertable (no old value to restore to).
/// [T-minis-config-provider-add]
struct WriteOnlySecretField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let valueSchema: ConfigValueSchema = .string(maxLength: 4096)
    var access: ConfigAccess { .readwrite }
    var risk: ConfigRisk { .sensitive }
    var revertable: Bool { false }
    let readDenyReason: String
    let writer: @MainActor (ConfigValue) throws -> Void

    @MainActor func read() throws -> ConfigValue {
        throw ConfigError.permissionDenied(reason: readDenyReason)
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        try writer(value)
    }
}
