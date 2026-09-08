package com.openminis.app.config

/**
 * Type tag + per-type constraints for a [ConfigField]. Drives the
 * pre-write validation in the bridge and `--help` rendering. Mirrors
 * iOS `ConfigValueSchema` (Shared/Config/ConfigField.swift).
 */
sealed class ConfigSchema {
    object Bool : ConfigSchema()
    data class Int(val min: kotlin.Int? = null, val max: kotlin.Int? = null) : ConfigSchema()
    data class Double(val min: kotlin.Double? = null, val max: kotlin.Double? = null) : ConfigSchema()
    data class Str(val maxLength: kotlin.Int? = null, val regex: String? = null) : ConfigSchema()
    data class StrEnum(val cases: List<String>) : ConfigSchema()
    object Path : ConfigSchema()
    data class Optional(val inner: ConfigSchema) : ConfigSchema()
    data class Array(val inner: ConfigSchema) : ConfigSchema()
    /** Free-form: validation is the writer's responsibility. */
    object Json : ConfigSchema()

    /** Human-readable schema description for `topic-help` output. */
    val helpDescription: String
        get() = when (this) {
            Bool -> "bool"
            is Int -> "int (${min?.toString() ?: "-∞"}..${max?.toString() ?: "+∞"})"
            is Double -> "double (${min?.toString() ?: "-∞"}..${max?.toString() ?: "+∞"})"
            is Str -> buildString {
                append("string")
                if (maxLength != null) append(" max $maxLength chars")
                if (regex != null) append(" /$regex/")
            }
            is StrEnum -> "one of: " + cases.joinToString(", ")
            Path -> "path"
            is Optional -> "${inner.helpDescription}?"
            is Array -> "[${inner.helpDescription}]"
            Json -> "json"
        }

    /** Pure validation. Throws [ConfigError] on failure; never mutates. */
    fun validate(value: ConfigValue) {
        when (this) {
            Bool -> {
                if (value !is ConfigValue.Bool) throw ConfigError.TypeMismatch("bool")
            }
            is Int -> {
                val i = (value as? ConfigValue.Int)?.value
                    ?: throw ConfigError.TypeMismatch("int")
                if (min != null && i < min) throw ConfigError.OutOfRange(min.toDouble(), max?.toDouble())
                if (max != null && i > max) throw ConfigError.OutOfRange(min?.toDouble(), max.toDouble())
            }
            is Double -> {
                val d: kotlin.Double = when (value) {
                    is ConfigValue.Double -> value.value
                    is ConfigValue.Int -> value.value.toDouble()
                    else -> throw ConfigError.TypeMismatch("double")
                }
                if (min != null && d < min) throw ConfigError.OutOfRange(min, max)
                if (max != null && d > max) throw ConfigError.OutOfRange(min, max)
            }
            is Str -> {
                val s = (value as? ConfigValue.Str)?.value
                    ?: throw ConfigError.TypeMismatch("string")
                if (maxLength != null && s.length > maxLength) {
                    throw ConfigError.InvalidValue("string longer than $maxLength chars")
                }
                if (regex != null) {
                    val re = try { Regex(regex) } catch (_: Throwable) { null }
                    if (re != null && !re.matches(s)) throw ConfigError.RegexMismatch(regex)
                }
            }
            is StrEnum -> {
                val s = (value as? ConfigValue.Str)?.value
                    ?: throw ConfigError.TypeMismatch("string")
                if (s !in cases) {
                    throw ConfigError.InvalidValue("must be one of: ${cases.joinToString(", ")}")
                }
            }
            Path -> {
                if (value !is ConfigValue.Str) throw ConfigError.TypeMismatch("path")
            }
            is Optional -> {
                if (value === ConfigValue.Null) return
                inner.validate(value)
            }
            is Array -> {
                val arr = (value as? ConfigValue.Arr)?.value
                    ?: throw ConfigError.TypeMismatch("array")
                for (v in arr) inner.validate(v)
            }
            Json -> Unit
        }
    }
}

enum class ConfigAccess { HIDDEN, READONLY, READWRITE }

/** Risk classification surfaced in the confirm dialog. */
enum class ConfigRisk { NORMAL, SENSITIVE, DESTRUCTIVE }
