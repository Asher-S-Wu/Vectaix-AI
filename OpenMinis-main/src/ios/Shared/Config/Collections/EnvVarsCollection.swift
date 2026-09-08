import Foundation

/// Exposes EnvVarStore entries under `envvars.<key>.…`.
///
/// IMPORTANT: values are NEVER exposed — neither read nor write here.
/// The agent can list keys, attach a note, or remove a variable, but
/// the actual secret only ever moves through Keychain and the user-
/// facing UI. Adding a variable goes through this collection too, but
/// the agent must use the existing
/// `minis://settings/environments?create_key=…` deep link if it wants
/// the user to populate the value — there's no programmatic write
/// path that accepts a value.
@MainActor
struct EnvVarsCollection: ConfigCollection {
    let basePath = "envvars"
    let displayName = "Environment variables"
    let description = "Metadata only — values are stored in Keychain and never exposed."
    var addable: Bool { false }      // adding requires a value, which we never accept
    var removable: Bool { true }
    let risk: ConfigRisk = .sensitive

    let addPayloadSchema: ConfigValueSchema = .json

    func childIds() -> [String] {
        EnvVarStore.shared.entries.map(\.key)
    }

    func fields(for id: String) -> [ConfigField] {
        guard entry(id) != nil else { return [] }
        return [
            createdAtField(for: id),
            noteField(for: id),
            // Hidden guard: an agent attempting to read or write the
            // value gets a precise permission_denied.
            HiddenField(
                path: "envvars.\(id).value",
                displayName: "Value",
                description: "Hidden — manage via Settings → Environment Variables.",
                reason: "Env var values are stored in Keychain and never exposed to minis-config"
            ),
        ]
    }

    func add(_ payload: ConfigValue) throws -> String {
        throw ConfigError.permissionDenied(
            reason: "Use the deep link `minis://settings/environments?create_key=…` so the user enters the value directly"
        )
    }

    func remove(id: String) throws {
        guard let e = entry(id) else { throw ConfigError.unknownPath("envvars.\(id)") }
        EnvVarStore.shared.delete(id: e.id)
    }

    private func entry(_ key: String) -> EnvVarEntry? {
        EnvVarStore.shared.entries.first { $0.key == key }
    }

    private func createdAtField(for key: String) -> ConfigField {
        ReadOnlyField(
            path: "envvars.\(key).createdAt",
            displayName: "Created at",
            description: "ISO-8601 timestamp.",
            valueSchema: .string(),
            reader: { [self] in
                guard let e = entry(key) else { return .null }
                return .string(ISO8601DateFormatter().string(from: e.createdAt))
            }
        )
    }

    private func noteField(for key: String) -> ConfigField {
        ClosureField(
            path: "envvars.\(key).note",
            displayName: "Note",
            description: "Free-form description (not secret). Empty string clears it.",
            valueSchema: .string(maxLength: 500),
            risk: .normal, revertable: true,
            reader: { [self] in
                guard let e = entry(key) else { return .null }
                return .string(e.note)
            },
            writer: { [self] v in
                guard case .string(let s) = v else { throw ConfigError.typeMismatch(expected: "string") }
                guard let e = entry(key) else { throw ConfigError.unknownPath("envvars.\(key)") }
                // updateNote bypasses the value-aware update path so
                // we never need to read or rewrite the Keychain
                // secret to change a description.
                EnvVarStore.shared.updateNote(id: e.id, note: s)
            }
        )
    }
}
