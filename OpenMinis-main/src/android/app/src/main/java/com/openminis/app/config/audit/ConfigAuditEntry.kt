package com.openminis.app.config.audit

/** Who initiated the change. Mirrors iOS `ConfigAuditActor`. */
enum class ConfigAuditActor(val raw: String) {
    AGENT("agent"),
    USER("user"),
    AGENT_REVERT("agent-revert"),
    USER_REVERT("user-revert");

    companion object {
        fun fromRaw(s: String?): ConfigAuditActor =
            values().firstOrNull { it.raw == s } ?: AGENT
    }
}

/** Final disposition of a config-change attempt. Mirrors iOS. */
enum class ConfigAuditStatus(val raw: String) {
    APPLIED("applied"),
    REJECTED("rejected"),
    TIMEOUT("timeout"),
    REVERTED("reverted");

    companion object {
        fun fromRaw(s: String?): ConfigAuditStatus? =
            values().firstOrNull { it.raw == s }
    }
}

/**
 * One row in the rolling audit log. Persisted in `minis-config-audit.db`,
 * capped at 1000 most-recent rows.
 */
data class ConfigAuditEntry(
    val id: String,
    /** Epoch millis (Java convention; iOS uses TimeInterval since 1970). */
    val at: Long,
    val actor: ConfigAuditActor,
    /** Active session id at the time of the call. Nil for user-initiated UI. */
    val sessionId: String?,
    /** Top-level scope, e.g. `appearance`, `models`. Drives `--scope` filter. */
    val scope: String,
    /** Dot path of the affected field. */
    val key: String,
    val oldValueJSON: String,
    val newValueJSON: String,
    /** Epoch millis when the user resolved the confirm dialog, or null. */
    val confirmedAt: Long?,
    val status: ConfigAuditStatus,
    /** If this entry IS a revert, the audit id it undid. */
    val revertOf: String?,
    /** Caller-supplied `--caption "..."` text. Optional. */
    val caption: String?,
)
