package com.openminis.app.config.fields

import com.openminis.app.config.ConfigAccess
import com.openminis.app.config.ConfigError
import com.openminis.app.config.ConfigField
import com.openminis.app.config.ConfigRisk
import com.openminis.app.config.ConfigSchema
import com.openminis.app.config.ConfigValue

/**
 * Hand-rolled field — use when the storage backend is not a simple
 * SharedPreferences key (a repository, a DB row, a singleton). Mirrors
 * iOS `ClosureField`.
 *
 * Schema validation runs in the bridge before [writer] is invoked; the
 * writer may still throw [ConfigError] on extra invariants ("the new
 * primary group must already exist").
 */
class ClosureField(
    override val path: String,
    override val displayName: String,
    override val description: String,
    override val valueSchema: ConfigSchema,
    override val access: ConfigAccess = ConfigAccess.READWRITE,
    override val risk: ConfigRisk = ConfigRisk.NORMAL,
    override val revertable: Boolean = true,
    private val reader: () -> ConfigValue,
    private val writer: (ConfigValue) -> Unit,
) : ConfigField {
    override fun read(): ConfigValue = reader()
    override fun write(value: ConfigValue) {
        valueSchema.validate(value)
        writer(value)
    }
}

/**
 * A read-only field. Useful for stats / status surfaces (audit log
 * usage, summary aggregates). Any write attempt returns
 * `permission_denied`; the bridge shouldn't even reach `write` since
 * `access = READONLY`, but we throw to be safe.
 */
class ReadOnlyField(
    override val path: String,
    override val displayName: String,
    override val description: String,
    override val valueSchema: ConfigSchema,
    override val risk: ConfigRisk = ConfigRisk.NORMAL,
    private val reader: () -> ConfigValue,
) : ConfigField {
    override val access: ConfigAccess get() = ConfigAccess.READONLY
    override val revertable: Boolean get() = false
    override fun read(): ConfigValue = reader()
    override fun write(value: ConfigValue) {
        throw ConfigError.PermissionDenied("Read-only")
    }
}

/**
 * A field that exists purely to be hidden. The registry keeps it
 * around so the bridge can return a precise `permission_denied` rather
 * than leaking implementation details with `unknown_path`.
 */
class HiddenField(
    override val path: String,
    override val displayName: String,
    override val description: String,
    private val reason: String,
) : ConfigField {
    override val valueSchema: ConfigSchema get() = ConfigSchema.Json
    override val access: ConfigAccess get() = ConfigAccess.HIDDEN
    override val risk: ConfigRisk get() = ConfigRisk.DESTRUCTIVE
    override val revertable: Boolean get() = false
    override fun read(): ConfigValue {
        throw ConfigError.PermissionDenied(reason)
    }
    override fun write(value: ConfigValue) {
        throw ConfigError.PermissionDenied(reason)
    }
}
