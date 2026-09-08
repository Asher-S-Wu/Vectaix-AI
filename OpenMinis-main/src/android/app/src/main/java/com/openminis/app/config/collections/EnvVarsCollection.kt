package com.openminis.app.config.collections

import com.openminis.app.config.ConfigCollection
import com.openminis.app.config.ConfigError
import com.openminis.app.config.ConfigField
import com.openminis.app.config.ConfigRisk
import com.openminis.app.config.ConfigSchema
import com.openminis.app.config.ConfigValue
import com.openminis.app.config.fields.ClosureField
import com.openminis.app.config.fields.HiddenField
import com.openminis.app.config.fields.ReadOnlyField
import com.openminis.app.data.repository.EnvVarRepository
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Exposes `EnvVarRepository` entries under `envvars.<key>.…`. Mirrors
 * iOS `EnvVarsCollection`.
 *
 * IMPORTANT: values are NEVER exposed — neither read nor write here.
 * The agent can list keys, attach a note, or remove a variable, but
 * the actual secret only ever moves through the encrypted prefs and
 * the user-facing UI. Adding a variable goes through the deep link
 * `minis://settings/environments?create_key=…` so the user supplies
 * the value directly.
 */
class EnvVarsCollection(
    private val repo: EnvVarRepository,
) : ConfigCollection {
    override val basePath: String get() = "envvars"
    override val displayName: String get() = "Environment variables"
    override val description: String get() =
        "Metadata only — values are stored in encrypted prefs and never exposed."
    override val addable: Boolean get() = false
    override val removable: Boolean get() = true
    override val risk: ConfigRisk get() = ConfigRisk.SENSITIVE
    override val addPayloadSchema: ConfigSchema get() = ConfigSchema.Json

    private val isoFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun childIds(): List<String> = repo.entries.value.map { it.key }

    override fun fields(forId: String): List<ConfigField> {
        val entry = repo.entries.value.firstOrNull { it.key == forId } ?: return emptyList()
        return listOf(
            createdAtField(forId),
            noteField(forId),
            // Hidden guard: an agent attempt to read or write the
            // value gets a precise permission_denied.
            HiddenField(
                path = "envvars.$forId.value",
                displayName = "Value",
                description = "Hidden — manage via Settings → Environment Variables.",
                reason = "Env var values are stored in encrypted prefs and never exposed to minis-config",
            ),
        )
    }

    override fun add(payload: ConfigValue): String {
        throw ConfigError.PermissionDenied(
            "Use the deep link `minis://settings/environments?create_key=…` so the user enters the value directly"
        )
    }

    override fun remove(id: String) {
        val entry = repo.entries.value.firstOrNull { it.key == id }
            ?: throw ConfigError.UnknownPath("envvars.$id")
        repo.delete(entry.id)
    }

    private fun createdAtField(key: String): ConfigField =
        ReadOnlyField(
            path = "envvars.$key.createdAt",
            displayName = "Created at",
            description = "ISO-8601 timestamp.",
            valueSchema = ConfigSchema.Str(),
            reader = {
                val e = repo.entries.value.firstOrNull { it.key == key }
                if (e == null) ConfigValue.Null
                else ConfigValue.Str(isoFormatter.format(Date(e.createdAt)))
            },
        )

    private fun noteField(key: String): ConfigField =
        ClosureField(
            path = "envvars.$key.note",
            displayName = "Note",
            description = "Free-form description (not secret). Empty string clears it.",
            valueSchema = ConfigSchema.Str(maxLength = 500),
            risk = ConfigRisk.NORMAL,
            revertable = true,
            reader = {
                val e = repo.entries.value.firstOrNull { it.key == key }
                if (e == null) ConfigValue.Null
                else ConfigValue.Str(e.note)
            },
            writer = { v ->
                val s = (v as? ConfigValue.Str)?.value ?: throw ConfigError.TypeMismatch("string")
                val e = repo.entries.value.firstOrNull { it.key == key }
                    ?: throw ConfigError.UnknownPath("envvars.$key")
                // Update via a value-preserving path: read existing value
                // back out of encrypted prefs, then write the new note
                // alongside it. The repo's [update] keeps the secret
                // in place when the same key is provided.
                val currentValue = repo.getValue(e.key) ?: ""
                repo.update(e.id, e.key, currentValue, s)
            },
        )
}
