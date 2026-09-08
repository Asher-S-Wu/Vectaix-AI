package com.openminis.app.config

/**
 * One configurable setting. Concrete kinds: [com.openminis.app.config.fields.PrefsBoolField]
 * etc. for SharedPreferences-backed scalars; [com.openminis.app.config.fields.ClosureField]
 * when the storage backend is something more bespoke (a repository, a DB row, an
 * in-process singleton). Mirrors iOS `ConfigField` (Shared/Config/ConfigField.swift).
 */
interface ConfigField {
    /** Dot-path id, e.g. `appearance.theme` or `models.<uuid>.maxOutputTokens`. */
    val path: String

    /** Human-readable label rendered in the confirm dialog and topic-help. */
    val displayName: String

    /** One-line description rendered in topic-help. */
    val description: String

    val valueSchema: ConfigSchema
    val access: ConfigAccess
    val risk: ConfigRisk

    /** Whether `audit-revert` may roll a write back. */
    val revertable: Boolean

    /**
     * [T-android-config-feature-unavailable] Non-null when the field's
     * underlying feature does not exist on this device / OS version (e.g. the
     * Android 16 "Live Updates" surface on a device without it). The bridge
     * short-circuits BOTH reads and writes with a `feature_unavailable` error
     * BEFORE validation and before the confirmation dialog — the Settings UI
     * already blocks these entries, and minis-config must not be a side door
     * around that gate.
     *
     * Default null = available everywhere; only [UnavailableField] overrides.
     * Mirrors iOS `ConfigField.unavailableReason` (dba46d42).
     */
    val unavailableReason: String?
        get() = null

    /** Read the current value. May throw [ConfigError] on backend failure. */
    fun read(): ConfigValue

    /** Apply [value]. Schema validation runs in the bridge before this. */
    fun write(value: ConfigValue)

    /** Top-level scope = first dot segment. Used for audit `--scope` filtering. */
    val scope: String
        get() = path.substringBefore('.', missingDelimiterValue = "unknown")
}

/**
 * [T-android-config-feature-unavailable] Wraps a real field so its path stays
 * REGISTERED (help/list keep showing it with correct metadata) while every read
 * and write is refused with `feature_unavailable` plus [reason].
 *
 * Keeping the path registered is the point: the agent gets a precise "this
 * device can't do that, and retrying won't help" instead of a confusing
 * `unknown_path` that looks like a typo. Mirrors iOS `UnavailableField`.
 */
class UnavailableField(
    private val delegate: ConfigField,
    private val reason: String,
) : ConfigField by delegate {
    override val unavailableReason: String = reason
}
