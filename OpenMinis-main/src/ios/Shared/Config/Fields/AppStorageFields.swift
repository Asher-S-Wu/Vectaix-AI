import Foundation

/// Convenience wrappers for the most common backend (UserDefaults).
/// These cover ~70% of the registered fields without writing custom
/// closures. Add new variants here when a different primitive type
/// (Float, Date, …) starts to recur — the bridge cares only about
/// `ConfigValue` shape, so the wrappers translate.

struct AppStorageBoolField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let userDefaultsKey: String
    let defaultValue: Bool
    var access: ConfigAccess = .readwrite
    var risk: ConfigRisk = .normal
    var revertable: Bool = true
    var valueSchema: ConfigValueSchema { .bool }

    @MainActor func read() throws -> ConfigValue {
        if UserDefaults.standard.object(forKey: userDefaultsKey) == nil {
            return .bool(defaultValue)
        }
        return .bool(UserDefaults.standard.bool(forKey: userDefaultsKey))
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        guard case .bool(let b) = value else { throw ConfigError.typeMismatch(expected: "bool") }
        UserDefaults.standard.set(b, forKey: userDefaultsKey)
    }
}

struct AppStorageIntField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let userDefaultsKey: String
    let defaultValue: Int
    var min: Int? = nil
    var max: Int? = nil
    var access: ConfigAccess = .readwrite
    var risk: ConfigRisk = .normal
    var revertable: Bool = true
    var valueSchema: ConfigValueSchema { .int(min: min, max: max) }

    @MainActor func read() throws -> ConfigValue {
        if UserDefaults.standard.object(forKey: userDefaultsKey) == nil {
            return .int(defaultValue)
        }
        return .int(UserDefaults.standard.integer(forKey: userDefaultsKey))
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        guard case .int(let i) = value else { throw ConfigError.typeMismatch(expected: "int") }
        UserDefaults.standard.set(i, forKey: userDefaultsKey)
    }
}

struct AppStorageDoubleField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let userDefaultsKey: String
    let defaultValue: Double
    var min: Double? = nil
    var max: Double? = nil
    var access: ConfigAccess = .readwrite
    var risk: ConfigRisk = .normal
    var revertable: Bool = true
    var valueSchema: ConfigValueSchema { .double(min: min, max: max) }

    @MainActor func read() throws -> ConfigValue {
        if UserDefaults.standard.object(forKey: userDefaultsKey) == nil {
            return .double(defaultValue)
        }
        return .double(UserDefaults.standard.double(forKey: userDefaultsKey))
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        let d: Double
        switch value {
        case .double(let x): d = x
        case .int(let x): d = Double(x)
        default: throw ConfigError.typeMismatch(expected: "double")
        }
        UserDefaults.standard.set(d, forKey: userDefaultsKey)
    }
}

struct AppStorageStringField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let userDefaultsKey: String
    let defaultValue: String
    var maxLength: Int? = nil
    var regex: String? = nil
    var access: ConfigAccess = .readwrite
    var risk: ConfigRisk = .normal
    var revertable: Bool = true
    var valueSchema: ConfigValueSchema { .string(maxLength: maxLength, regex: regex) }

    @MainActor func read() throws -> ConfigValue {
        .string(UserDefaults.standard.string(forKey: userDefaultsKey) ?? defaultValue)
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        guard case .string(let s) = value else { throw ConfigError.typeMismatch(expected: "string") }
        UserDefaults.standard.set(s, forKey: userDefaultsKey)
    }
}

/// String-enum stored as raw string in UserDefaults. The schema's
/// `stringEnum` variant validates the value before write; readers see
/// the same token they'd see via @AppStorage.
struct AppStorageEnumField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let userDefaultsKey: String
    let cases: [String]
    let defaultValue: String
    var access: ConfigAccess = .readwrite
    var risk: ConfigRisk = .normal
    var revertable: Bool = true
    var valueSchema: ConfigValueSchema { .stringEnum(cases) }

    @MainActor func read() throws -> ConfigValue {
        let raw = UserDefaults.standard.string(forKey: userDefaultsKey) ?? defaultValue
        return .string(cases.contains(raw) ? raw : defaultValue)
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        guard case .string(let s) = value else { throw ConfigError.typeMismatch(expected: "string") }
        UserDefaults.standard.set(s, forKey: userDefaultsKey)
    }
}

/// Some legacy app preferences store the picker index (Int) but we
/// surface it as a clean string enum to the agent. Reads map index→case;
/// writes map case→index. Keeps the existing UI bindings unbroken.
struct AppStorageIntCodedEnumField: ConfigField {
    let path: String
    let displayName: String
    let description: String
    let userDefaultsKey: String
    /// Cases ordered by their persisted Int value. cases[0] ↔ stored 0, etc.
    let cases: [String]
    let defaultIndex: Int
    var access: ConfigAccess = .readwrite
    var risk: ConfigRisk = .normal
    var revertable: Bool = true
    var valueSchema: ConfigValueSchema { .stringEnum(cases) }

    @MainActor func read() throws -> ConfigValue {
        let idx: Int
        if UserDefaults.standard.object(forKey: userDefaultsKey) == nil {
            idx = defaultIndex
        } else {
            idx = UserDefaults.standard.integer(forKey: userDefaultsKey)
        }
        let safe = (idx >= 0 && idx < cases.count) ? idx : defaultIndex
        return .string(cases[safe])
    }
    @MainActor func write(_ value: ConfigValue) throws {
        try valueSchema.validate(value)
        guard case .string(let s) = value else { throw ConfigError.typeMismatch(expected: "string") }
        guard let idx = cases.firstIndex(of: s) else {
            throw ConfigError.invalidValue("must be one of: \(cases.joined(separator: ", "))")
        }
        UserDefaults.standard.set(idx, forKey: userDefaultsKey)
    }
}
