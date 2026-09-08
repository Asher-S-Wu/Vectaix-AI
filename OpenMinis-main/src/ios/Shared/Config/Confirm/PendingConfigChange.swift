import Foundation

/// One row in a pending change request. A single CLI call may carry
/// multiple changes (`--batch`) — they're presented to the user in a
/// single sheet and confirmed/rejected as a unit (with per-row reject).
struct PendingConfigChangeItem: Identifiable {
    let id: String                      // UUID per row
    /// Label shown on the row. Comes from the field's displayName.
    let displayName: String
    /// Dot path; shown in fine print.
    let path: String
    /// Old value (humanized, via ConfigValue.displayString). Empty for
    /// add-collection rows.
    let oldDisplay: String
    /// New value (humanized). Empty for remove-collection rows.
    let newDisplay: String
    /// Verb shown in the row (set / add / remove / hide / show / revert).
    let verb: String
    let risk: ConfigRisk
    /// Per-row reject toggle, defaults true (allow).
    var isApproved: Bool = true
}

/// A queued CLI request awaiting user confirmation. The bridge enqueues
/// one of these and suspends; the sheet UI flips `outcome` and resumes
/// the awaiting continuation.
final class PendingConfigChange: Identifiable, ObservableObject {
    enum Outcome {
        case pending
        /// Approved subset (each row is approved iff isApproved was true
        /// at confirm time). The bridge only writes the approved rows.
        case approved(items: [PendingConfigChangeItem])
        case rejected
        case timedOut
    }

    let id: String                      // UUID per request
    /// Items in this batch. Mutable so the UI can flip per-row toggles.
    @Published var items: [PendingConfigChangeItem]
    /// Free-form caption ("minis-config models hide …") shown above
    /// the row table. Helps the user understand what the agent ran.
    let caption: String?
    /// Final disposition. Sheet sets this, gate observes.
    @Published var outcome: Outcome = .pending

    init(items: [PendingConfigChangeItem], caption: String? = nil) {
        self.id = UUID().uuidString
        self.items = items
        self.caption = caption
    }
}
