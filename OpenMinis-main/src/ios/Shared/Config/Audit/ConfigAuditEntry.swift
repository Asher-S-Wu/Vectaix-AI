import Foundation

/// Who initiated the change.
enum ConfigAuditActor: String, Codable {
    /// LLM agent invoked `minis-config <topic> set …`.
    case agent
    /// User interacted with a Settings UI control directly (rare; only
    /// recorded when the surface explicitly funnels through ConfigRegistry,
    /// e.g. toggling the master `permissions.minisConfig.enabled` switch).
    case user
    /// Agent invoked `minis-config audit revert <id>`.
    case agentRevert = "agent-revert"
    /// User tapped Revert in Logs → Config Changes.
    case userRevert = "user-revert"
}

/// Final disposition of a config-change attempt.
enum ConfigAuditStatus: String, Codable {
    /// Confirmed by user, value written successfully.
    case applied
    /// User tapped Cancel in the confirmation sheet.
    case rejected
    /// Confirmation sheet timed out (30 s default).
    case timeout
    /// A later revert undid this entry. The entry itself is still
    /// `applied` historically; this status is a soft annotation set
    /// when a `userRevert` / `agentRevert` succeeds against it.
    case reverted
}

/// One row in the rolling audit log.
///
/// Entries are written for EVERY confirmed write through ConfigRegistry.
/// Rejected / timed-out attempts are also recorded so the user can see
/// what the agent tried (transparency >> disk thrift). The store caps
/// the table at 1000 most-recent rows.
struct ConfigAuditEntry: Identifiable, Codable, Hashable {
    let id: String                      // UUID
    let at: Date                        // when the attempt happened
    let actor: ConfigAuditActor
    /// Active session id at the time of the agent call. Nil for user-
    /// initiated UI changes.
    let sessionId: String?
    /// Top-level scope, e.g. `appearance`, `models`, `groups`. Drives
    /// filtering in the audit list UI.
    let scope: String
    /// Human-readable dot path of the affected field, e.g.
    /// `appearance.theme` or `models.<uuid>.maxOutputTokens`.
    let key: String
    /// JSON-encoded prior value. Empty string for additions.
    let oldValueJSON: String
    /// JSON-encoded new value. Empty string for removals.
    let newValueJSON: String
    /// When the user acted on the confirmation sheet. Nil if the entry
    /// represents an agent attempt that hasn't been resolved yet (those
    /// rows are not persisted — only resolved attempts hit the log).
    let confirmedAt: Date?
    var status: ConfigAuditStatus
    /// If this entry IS a revert, points back at the audit id it undid.
    let revertOf: String?
    /// Caller-supplied description (`minis-config set --caption "..."`),
    /// shown alongside the row in the Logs UI to make the agent's intent
    /// scannable. Nil/empty when the caller didn't pass one. Older rows
    /// written before this column existed decode as nil.
    let caption: String?
}
