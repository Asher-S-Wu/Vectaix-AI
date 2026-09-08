import Foundation

/// JSON-serializable union covering every value type a ConfigField can
/// hold. The CLI bridge encodes/decodes these into JSON; the confirm
/// sheet renders them via `displayString`; the audit log persists them
/// as JSON text in `old_value` / `new_value` columns.
enum ConfigValue: Codable, Hashable, Equatable, CustomStringConvertible {
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([ConfigValue])
    case object([String: ConfigValue])
    case null

    var description: String { displayString }

    /// Compact human-readable rendering used by the confirm sheet and
    /// `--help` examples. Long strings are truncated with an ellipsis;
    /// arrays/objects show their JSON form.
    var displayString: String {
        switch self {
        case .bool(let b):     return b ? "true" : "false"
        case .int(let i):      return String(i)
        case .double(let d):   return String(d)
        case .string(let s):
            if s.count > 80 {
                let head = s.prefix(60)
                let tail = s.suffix(15)
                return "\"\(head)…\(tail)\""
            }
            return "\"\(s)\""
        case .array, .object:
            if let json = try? JSONEncoder().encode(self),
               let str = String(data: json, encoding: .utf8) {
                return str
            }
            return "?"
        case .null:            return "null"
        }
    }

    /// JSON-text representation suitable for storing in
    /// `config_audit.old_value` / `new_value`. Always single-line.
    func jsonString() -> String {
        if let data = try? JSONEncoder().encode(self),
           let s = String(data: data, encoding: .utf8) {
            return s
        }
        return "null"
    }

    static func decode(json: String) -> ConfigValue? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ConfigValue.self, from: data)
    }

    /// Object/array keys whose VALUES are credentials and must never be
    /// persisted to the audit log or shown in the confirmation sheet in
    /// plaintext. [T-minis-config-provider-add] minis-config can now WRITE a
    /// provider apiKey (literal or `$$ENV` reference), but the secret must not
    /// leak through the audit/confirm surfaces — the red line is "writable, not
    /// readable". A `$$ENV` reference is left intact (it's a pointer, not the
    /// secret); a literal value collapses to a fixed mask.
    static let secretObjectKeys: Set<String> = ["apiKey", "oauthToken", "manualOAuthToken"]

    /// Returns a copy with every `secretObjectKeys` value masked. `$$VAR`
    /// references pass through (not secret); any other non-empty string becomes
    /// "••• (hidden)". Recurses into nested objects/arrays so a secret nested in
    /// an add-payload is caught too.
    func redactingSecrets() -> ConfigValue {
        switch self {
        case .object(let dict):
            var out: [String: ConfigValue] = [:]
            for (k, v) in dict {
                if Self.secretObjectKeys.contains(k), case .string(let s) = v,
                   !s.hasPrefix("$$"), !s.isEmpty {
                    out[k] = .string("••• (hidden)")
                } else {
                    out[k] = v.redactingSecrets()
                }
            }
            return .object(out)
        case .array(let arr):
            return .array(arr.map { $0.redactingSecrets() })
        default:
            return self
        }
    }

    // MARK: Codable — discriminated by value type at runtime.
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .bool(let b):    try c.encode(b)
        case .int(let i):     try c.encode(i)
        case .double(let d):  try c.encode(d)
        case .string(let s):  try c.encode(s)
        case .array(let a):   try c.encode(a)
        case .object(let o):  try c.encode(o)
        case .null:           try c.encodeNil()
        }
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let i = try? c.decode(Int.self) { self = .int(i); return }
        if let d = try? c.decode(Double.self) { self = .double(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([ConfigValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: ConfigValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unknown ConfigValue type")
    }
}

/// Type tag + per-type constraints. Drives validation in `ConfigField`
/// implementations and `--help` rendering. New schema variants only
/// need to be added here; the offload bridge dispatches generically.
indirect enum ConfigValueSchema {
    case bool
    case int(min: Int? = nil, max: Int? = nil)
    case double(min: Double? = nil, max: Double? = nil)
    case string(maxLength: Int? = nil, regex: String? = nil)
    case stringEnum([String])
    case path
    case optional(ConfigValueSchema)
    case array(ConfigValueSchema)
    case json   // free-form; field does its own validation

    /// Render the schema for `--help` output, e.g. "int (1..200)" or
    /// "one of: system, light, dark".
    var helpDescription: String {
        switch self {
        case .bool: return "bool"
        case .int(let lo, let hi):
            return "int (\(lo.map(String.init) ?? "-∞")..\(hi.map(String.init) ?? "+∞"))"
        case .double(let lo, let hi):
            return "double (\(lo.map { String($0) } ?? "-∞")..\(hi.map { String($0) } ?? "+∞"))"
        case .string(let maxLen, let regex):
            var parts: [String] = ["string"]
            if let m = maxLen { parts.append("max \(m) chars") }
            if let r = regex  { parts.append("/\(r)/") }
            return parts.joined(separator: " ")
        case .stringEnum(let cases):
            return "one of: " + cases.joined(separator: ", ")
        case .path: return "path"
        case .optional(let inner): return "\(inner.helpDescription)?"
        case .array(let inner): return "[\(inner.helpDescription)]"
        case .json: return "json"
        }
    }

    /// Validate `value`; throw on failure. Pure check — no side effects.
    func validate(_ value: ConfigValue) throws {
        switch self {
        case .bool:
            guard case .bool = value else { throw ConfigError.typeMismatch(expected: "bool") }
        case .int(let lo, let hi):
            guard case .int(let i) = value else { throw ConfigError.typeMismatch(expected: "int") }
            if let lo, i < lo { throw ConfigError.outOfRange(min: Double(lo), max: hi.map(Double.init)) }
            if let hi, i > hi { throw ConfigError.outOfRange(min: lo.map(Double.init), max: Double(hi)) }
        case .double(let lo, let hi):
            let d: Double
            switch value {
            case .double(let x): d = x
            case .int(let x): d = Double(x)
            default: throw ConfigError.typeMismatch(expected: "double")
            }
            if let lo, d < lo { throw ConfigError.outOfRange(min: lo, max: hi) }
            if let hi, d > hi { throw ConfigError.outOfRange(min: lo, max: hi) }
        case .string(let maxLen, let regex):
            guard case .string(let s) = value else { throw ConfigError.typeMismatch(expected: "string") }
            if let m = maxLen, s.count > m {
                throw ConfigError.invalidValue("string longer than \(m) chars")
            }
            if let r = regex {
                let pred = NSPredicate(format: "SELF MATCHES %@", r)
                if !pred.evaluate(with: s) { throw ConfigError.regexMismatch(pattern: r) }
            }
        case .stringEnum(let cases):
            guard case .string(let s) = value else { throw ConfigError.typeMismatch(expected: "string") }
            if !cases.contains(s) {
                throw ConfigError.invalidValue("must be one of: \(cases.joined(separator: ", "))")
            }
        case .path:
            guard case .string = value else { throw ConfigError.typeMismatch(expected: "path") }
        case .optional(let inner):
            if case .null = value { return }
            try inner.validate(value)
        case .array(let inner):
            guard case .array(let arr) = value else { throw ConfigError.typeMismatch(expected: "array") }
            for v in arr { try inner.validate(v) }
        case .json:
            return // permissive; field-specific validation handled by writer
        }
    }
}

/// Read/write policy.
///
/// `.hidden` is enforced by the offload bridge BEFORE any user-facing
/// confirmation: hidden fields can be registered for documentation /
/// guard purposes (e.g. "providers.<id>.apiKey") so the bridge can
/// short-circuit with a precise error rather than leaking implementation
/// details via "unknown_path".
enum ConfigAccess { case hidden, readonly, readwrite }

/// Risk classification for the confirmation sheet styling.
///
///   .normal       — neutral; default for almost every UI preference.
///   .sensitive    — amber; toggling matters but is reversible (e.g.
///                   disabling iCloud sync; flipping background-keep-
///                   alive; modality removals).
///   .destructive  — red; harder to recover from (e.g. removing a
///                   custom model entry that's a member of a group).
enum ConfigRisk { case normal, sensitive, destructive }

/// One configurable field. Concrete types either subclass via a struct
/// (AppStorageBoolField, AppStorageEnumField, …) or compose a closure-
/// backed `ClosureField` for hand-rolled storage (singletons, files,
/// SQLite). Adding a new field is one `register(...)` call — see
/// `ConfigRegistry+Builtins.swift` for examples.
protocol ConfigField {
    /// Dot-path id, e.g. "appearance.theme". Collection children use
    /// "<base>.<id>.<sub>", e.g. "models.<uuid>.maxOutputTokens".
    var path: String { get }

    /// Human-readable label rendered in confirmation sheet + `--help`.
    var displayName: String { get }

    /// One-line description rendered in `--help` (English; user_message
    /// to the agent uses this verbatim).
    var description: String { get }

    var valueSchema: ConfigValueSchema { get }
    var access: ConfigAccess { get }
    var risk: ConfigRisk { get }

    /// Whether `audit revert <id>` may roll a write back. Add/remove
    /// operations on collections always set this false on the synthetic
    /// audit row that records them.
    var revertable: Bool { get }

    /// Non-nil when the field's underlying feature does not exist on this
    /// device / OS version (e.g. iCloud Sync on iOS 16, Live Activities on
    /// unsupported hardware). The offload bridge short-circuits both reads
    /// and writes with a `feature_unavailable` error BEFORE validation or
    /// the confirmation sheet — the Settings UI hides these entries
    /// entirely, and minis-config must not be a side door around that gate.
    var unavailableReason: String? { get }

    @MainActor func read() throws -> ConfigValue
    @MainActor func write(_ value: ConfigValue) throws
}

extension ConfigField {
    /// Default: available everywhere. Only `UnavailableField` stubs override.
    var unavailableReason: String? { nil }

    /// Default scope = first dot segment of the path. Used for audit
    /// table indexing and the `audit list --scope X` filter.
    var scope: String {
        path.split(separator: ".").first.map(String.init) ?? "unknown"
    }
}
