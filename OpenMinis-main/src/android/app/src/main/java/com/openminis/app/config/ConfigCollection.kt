package com.openminis.app.config

/**
 * A dynamically-keyed group of fields, e.g. one ProviderInstance per id,
 * one ModelEntry per uuid, one ModelGroup per id. Mirrors iOS
 * `ConfigCollection` (Shared/Config/Fields/ConfigCollection.swift).
 *
 * Static fields go through the registry's flat field map. A collection
 * adds two more capabilities:
 *   1. Enumerate runtime children ([childIds]) — used for dynamic path
 *      resolution like `models.<uuid>.maxOutputTokens`.
 *   2. Define `add` / `remove` semantics — these create or dispose the
 *      whole child rather than mutate a single field.
 */
interface ConfigCollection {
    /** First segment of every member's path, e.g. `models` or `groups`. */
    val basePath: String
    val displayName: String
    val description: String

    val addable: Boolean get() = true
    val removable: Boolean get() = true

    /**
     * Risk applied to add/remove operations (children declare per-field
     * risk). Defaults to [ConfigRisk.SENSITIVE] because creating /
     * destroying structured records is more impactful than tweaking a
     * scalar.
     */
    val risk: ConfigRisk get() = ConfigRisk.SENSITIVE

    /** Currently-existing child ids. Order is meaningful where user-visible. */
    fun childIds(): List<String>

    /** Field set exposed for one child id. Empty if id missing. */
    fun fields(forId: String): List<ConfigField>

    /** JSON schema accepted by [add]. `Json` allows free-form parsing. */
    val addPayloadSchema: ConfigSchema get() = ConfigSchema.Json

    /** Create a new child. Returns the new id. */
    fun add(payload: ConfigValue): String

    /** Remove a child. Throws on missing id or non-removable. */
    fun remove(id: String)
}
