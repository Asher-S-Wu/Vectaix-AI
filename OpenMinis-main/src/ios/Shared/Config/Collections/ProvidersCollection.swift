import Foundation

/// Exposes ProviderInstance fields under `providers.<id>.…`.
///
/// [T-minis-config-provider-add] Write is open, secret READ stays shut.
/// The agent CAN now create a provider (`add`) and write its credential
/// (`apiKey`, literal or `$$ENV` reference) and other settings — every write
/// goes through the confirmation sheet + revertable audit, and the user
/// initiates these flows. What stays locked is READING a secret: `get
/// providers` is a credential-free summary, and the `apiKey` / `oauthToken`
/// fields return `permission_denied` on read. Net rule: writable (incl.
/// secrets), never readable (secrets).
@MainActor
struct ProvidersCollection: ConfigCollection {
    let basePath = "providers"
    let displayName = "LLM provider instances"
    let description = "Configured provider accounts (Anthropic, OpenAI, …). Credentials can be written but are never read back."
    let addable = true
    // Removing a provider is intentionally still blocked: it orphans the
    // instance's model entries / group memberships / session bindings and can
    // break later tool calls mid-conversation. The user removes a provider in
    // the Settings UI. (Spec left remove to our judgement — kept denied.)
    let removable = false
    let risk: ConfigRisk = .sensitive
    let addPayloadSchema: ConfigValueSchema = .json

    func childIds() -> [String] {
        ProviderConfigStore.shared.config.instances.map(\.id)
    }

    func fields(for id: String) -> [ConfigField] {
        guard ProviderConfigStore.shared.config.instances.contains(where: { $0.id == id }) else {
            return []
        }
        return [
            // Read-only summary fields (helpful for `get`).
            providerType(for: id),
            credentialType(for: id),
            // Editable fields.
            label(for: id),
            enabled(for: id),
            customBaseURL(for: id),
            customUserAgent(for: id),
            appendV1Suffix(for: id),
            imageEndpointMode(for: id),
            // [T-minis-config-provider-add] API key is now WRITABLE (literal or
            // `$$ENV`) but reading it still returns permission_denied — the
            // secret only ever moves INTO Keychain, never back out.
            apiKeyField(for: id),
            // OAuth tokens remain fully hidden (read AND write): they're minted
            // by interactive OAuth flows, not a value the agent can supply.
            HiddenField(
                path: "providers.\(id).oauthToken",
                displayName: "OAuth Token",
                description: "Hidden — managed by the in-app OAuth login flow.",
                reason: "OAuth tokens are never exposed to minis-config"
            ),
        ]
    }

    // MARK: - Add

    /// Create a new provider instance.
    ///
    /// Payload (JSON object):
    ///   providerType   (required) one of ProviderType.rawValue
    ///                  (openAI / anthropic / gemini / openRouter /
    ///                   openAIResponses / xAI / antigravity)
    ///   label          (required) user-facing nickname
    ///   apiKey         (optional) literal secret OR `$$ENV_VAR` reference.
    ///                  When omitted the instance is created credential-less
    ///                  (user populates the key later in Settings).
    ///   customBaseURL  (optional) override endpoint (for OpenAI/Anthropic-
    ///                  compatible proxies)
    ///   appendV1Suffix (optional, default true)
    ///   imageEndpointMode (optional) auto / images_generations / chat_completions
    func add(_ payload: ConfigValue) throws -> String {
        guard case .object(let dict) = payload else {
            throw ConfigError.invalidValue("Expected a JSON object")
        }
        guard case .string(let typeRaw)? = dict["providerType"], !typeRaw.isEmpty else {
            throw ConfigError.invalidValue("`providerType` is required (e.g. \"openAI\", \"anthropic\")")
        }
        guard let providerType = ProviderType(rawValue: typeRaw) else {
            let valid = ProviderType.allCases.map(\.rawValue).joined(separator: ", ")
            throw ConfigError.invalidValue("Unknown providerType \"\(typeRaw)\". Valid: \(valid)")
        }
        guard case .string(let label)? = dict["label"], !label.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw ConfigError.invalidValue("`label` is required")
        }

        let store = ProviderConfigStore.shared
        if store.config.instances.contains(where: { $0.label == label }) {
            throw ConfigError.invalidValue("A provider labelled \"\(label)\" already exists")
        }

        // Resolve the credential (literal or $$ENV) BEFORE creating the
        // instance, so a bad $$ reference fails the add atomically.
        var resolvedKey: String? = nil
        if case .string(let rawKey)? = dict["apiKey"], !rawKey.isEmpty {
            resolvedKey = try Self.resolveSecret(rawKey)
        }

        var customBaseURL: String? = nil
        if case .string(let s)? = dict["customBaseURL"], !s.isEmpty { customBaseURL = s }

        var appendV1Suffix = true
        if case .bool(let b)? = dict["appendV1Suffix"] { appendV1Suffix = b }

        var imageEndpointMode: ImageEndpointMode = .auto
        if case .string(let s)? = dict["imageEndpointMode"], let m = ImageEndpointMode(rawValue: s) {
            imageEndpointMode = m
        }

        let instance = ProviderInstance(
            label: label,
            providerType: providerType,
            credentialType: .apiKey,
            customBaseURL: customBaseURL,
            appendV1Suffix: appendV1Suffix,
            imageEndpointMode: imageEndpointMode
        )

        // Save credential to Keychain BEFORE addInstance() so the model-refresh
        // it kicks off can authenticate.
        if let key = resolvedKey {
            ProviderKeychainHelper.saveAPIKey(key, instanceId: instance.id)
        }
        store.addInstance(instance)
        return instance.id
    }

    func remove(id: String) throws {
        throw ConfigError.permissionDenied(
            reason: "Removing a provider may orphan its models/groups and break later tool calls — use the Settings UI"
        )
    }

    /// Resolve a credential string: a `$$VAR` reference is expanded from the
    /// App environment variables (reusing the existing EnvVarStore); anything
    /// else is treated as a literal secret. Throws if a `$$VAR` reference names
    /// a variable that doesn't exist (fail loud instead of saving an empty key).
    static func resolveSecret(_ raw: String) throws -> String {
        guard raw.hasPrefix("$$") else { return raw }
        let name = String(raw.dropFirst(2))
        guard !name.isEmpty else {
            throw ConfigError.invalidValue("`$$` reference is missing a variable name")
        }
        guard let value = EnvVarStore.loadValueSync(forKey: name), !value.isEmpty else {
            throw ConfigError.invalidValue("Environment variable \"\(name)\" is not set — create it in Settings → Environment Variables first")
        }
        return value
    }

    // MARK: Field factories

    private func instance(_ id: String) -> ProviderInstance? {
        ProviderConfigStore.shared.config.instances.first(where: { $0.id == id })
    }

    private func mutate(_ id: String, _ apply: (inout ProviderInstance) -> Void) throws {
        guard var inst = instance(id) else {
            throw ConfigError.unknownPath("providers.\(id)")
        }
        apply(&inst)
        ProviderConfigStore.shared.updateInstance(inst)
    }

    /// Write-only credential field: writing accepts a literal secret or a
    /// `$$ENV` reference (resolved to the real value, then stored in Keychain);
    /// reading always returns permission_denied. The bridge masks the value in
    /// the audit/confirm surfaces (ConfigValue.secretObjectKeys).
    /// [T-minis-config-provider-add]
    private func apiKeyField(for id: String) -> ConfigField {
        WriteOnlySecretField(
            path: "providers.\(id).apiKey",
            displayName: "API Key",
            description: "Write a literal API key or a `$$ENV_VAR` reference (resolved at write time). Cannot be read back.",
            readDenyReason: "API keys are never exposed to minis-config",
            writer: { v in
                guard case .string(let raw) = v else {
                    throw ConfigError.typeMismatch(expected: "string")
                }
                guard instance(id) != nil else { throw ConfigError.unknownPath("providers.\(id)") }
                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else {
                    throw ConfigError.invalidValue("API key cannot be empty")
                }
                let resolved = try Self.resolveSecret(trimmed)
                ProviderKeychainHelper.saveAPIKey(resolved, instanceId: id)
                // Keep the instance's credentialType consistent with having a key.
                try? mutate(id) { _ in }   // touch → updateInstance persists/notifies
            }
        )
    }

    private func providerType(for id: String) -> ConfigField {
        ReadOnlyField(
            path: "providers.\(id).providerType",
            displayName: "Provider type",
            description: "Anthropic / OpenAI / Gemini / OpenRouter / OpenAI-compatible / Anthropic-compatible.",
            valueSchema: .string(),
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .string(inst.providerType.rawValue)
            }
        )
    }

    private func credentialType(for id: String) -> ConfigField {
        ReadOnlyField(
            path: "providers.\(id).credentialType",
            displayName: "Credential type",
            description: "API key vs OAuth.",
            valueSchema: .string(),
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .string(String(describing: inst.credentialType))
            }
        )
    }

    private func label(for id: String) -> ConfigField {
        ClosureField(
            path: "providers.\(id).label",
            displayName: "Label",
            description: "User-facing nickname for this instance.",
            valueSchema: .string(maxLength: 200),
            risk: .normal, revertable: true,
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .string(inst.label)
            },
            writer: { [self] v in
                guard case .string(let s) = v else { throw ConfigError.typeMismatch(expected: "string") }
                try mutate(id) { $0.label = s }
            }
        )
    }

    private func enabled(for id: String) -> ConfigField {
        ClosureField(
            path: "providers.\(id).isEnabled",
            displayName: "Enabled",
            description: "When false, the instance is excluded from agent calls.",
            valueSchema: .bool,
            risk: .sensitive, revertable: true,
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .bool(inst.isEnabled)
            },
            writer: { [self] v in
                guard case .bool(let b) = v else { throw ConfigError.typeMismatch(expected: "bool") }
                try mutate(id) { $0.isEnabled = b }
            }
        )
    }

    private func customBaseURL(for id: String) -> ConfigField {
        ClosureField(
            path: "providers.\(id).customBaseURL",
            displayName: "Custom base URL",
            description: "Override the default API endpoint. Empty string = use default.",
            valueSchema: .string(maxLength: 1000),
            risk: .sensitive, revertable: true,
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .string(inst.customBaseURL ?? "")
            },
            writer: { [self] v in
                guard case .string(let s) = v else { throw ConfigError.typeMismatch(expected: "string") }
                try mutate(id) {
                    $0.customBaseURL = s.isEmpty ? nil : s
                    // Resetting the base means we should re-probe the
                    // image endpoint on next call.
                    $0.imageEndpointResolved = nil
                }
            }
        )
    }

    private func customUserAgent(for id: String) -> ConfigField {
        ClosureField(
            path: "providers.\(id).customUserAgent",
            displayName: "Custom User-Agent",
            description: "Override the outbound User-Agent header. Empty string = use default.",
            valueSchema: .string(maxLength: 256),
            risk: .normal, revertable: true,
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .string(inst.customUserAgent ?? "")
            },
            writer: { [self] v in
                guard case .string(let s) = v else { throw ConfigError.typeMismatch(expected: "string") }
                // [T-ua-block-oauth-provider] Custom UA only applies to third-party
                // API-key providers. OAuth providers (Anthropic/Codex) use their own
                // CLI-gated authentication UA; overriding it can break the OAuth
                // handshake or be rejected upstream. Reject any write (including the
                // empty-string clear) for non-apiKey instances; reads stay unguarded.
                guard let inst = instance(id) else { throw ConfigError.invalidValue("Provider not found") }
                guard inst.credentialType == .apiKey else {
                    throw ConfigError.invalidValue("Custom User-Agent is only supported for third-party API-key providers. OAuth providers (Anthropic/Codex) use their own authentication UA and cannot be overridden.")
                }
                try mutate(id) {
                    $0.customUserAgent = s.isEmpty ? nil : s
                }
            }
        )
    }

    private func appendV1Suffix(for id: String) -> ConfigField {
        ClosureField(
            path: "providers.\(id).appendV1Suffix",
            displayName: "Append /v1 suffix",
            description: "When false, the custom base URL is treated as already-versioned.",
            valueSchema: .bool,
            risk: .normal, revertable: true,
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .bool(inst.appendV1Suffix)
            },
            writer: { [self] v in
                guard case .bool(let b) = v else { throw ConfigError.typeMismatch(expected: "bool") }
                try mutate(id) {
                    $0.appendV1Suffix = b
                    $0.imageEndpointResolved = nil
                }
            }
        )
    }

    private func imageEndpointMode(for id: String) -> ConfigField {
        ClosureField(
            path: "providers.\(id).imageEndpointMode",
            displayName: "Image endpoint mode",
            description: "auto / images_generations / chat_completions.",
            valueSchema: .stringEnum(ImageEndpointMode.allCases.map(\.rawValue)),
            risk: .normal, revertable: true,
            reader: { [self] in
                guard let inst = instance(id) else { return .null }
                return .string(inst.imageEndpointMode.rawValue)
            },
            writer: { [self] v in
                guard case .string(let s) = v,
                      let mode = ImageEndpointMode(rawValue: s) else {
                    throw ConfigError.invalidValue("Unknown image endpoint mode")
                }
                try mutate(id) {
                    $0.imageEndpointMode = mode
                    $0.imageEndpointResolved = nil
                }
            }
        )
    }
}
