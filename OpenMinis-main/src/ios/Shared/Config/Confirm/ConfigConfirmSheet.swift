import SwiftUI

private let confirmSheetLogger = AppLogger(category: "ConfigConfirmSheet")

/// The user-facing sheet that gates every minis-config write.
///
/// Mounted at app root; observes ConfigConfirmationGate.shared.pending
/// and presents a sheet whenever a change is queued. Users can:
///   • toggle approval per-row
///   • tap "Apply" (writes the approved subset)
///   • tap "Cancel" (rejects the entire batch)
/// Auto-dismisses after the gate's 30 s timeout fires (gate sets
/// outcome = .timedOut → pending becomes nil shortly after via the
/// resolve path).
struct ConfigConfirmSheet: View {
    @ObservedObject var gate: ConfigConfirmationGate
    /// Local mirror of the change's items so per-row toggles update
    /// immediately even though the underlying object is in a separate
    /// observable. We sync the toggles back when the user taps Apply.
    @State private var workingItems: [PendingConfigChangeItem] = []

    var body: some View {
        if let change = gate.pending {
            sheetBody(change: change)
                .onAppear {
                    workingItems = change.items
                    confirmSheetLogger.info("appear id=\(change.id) items=\(workingItems.count) approved=\(approvedCount)")
                }
                .onChange(of: change.id) { _ in
                    workingItems = change.items
                    confirmSheetLogger.info("change id=\(change.id) items=\(workingItems.count) approved=\(approvedCount)")
                }
        } else {
            EmptyView()
        }
    }

    @ViewBuilder
    private func sheetBody(change: PendingConfigChange) -> some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let caption = change.caption, !caption.isEmpty {
                    Text(caption)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.top, 8)
                }
                List {
                    ForEach($workingItems) { $item in
                        ConfigConfirmRow(item: $item)
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle(workingItems.count > 1
                             ? "Confirm \(workingItems.count) changes"
                             : "Confirm change")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", role: .cancel) {
                        gate.userReject()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(approvedCount == 0 ? "Reject All" : "Apply") {
                        confirmSheetLogger.info("tap primary pending=\(change.id) items=\(workingItems.count) approved=\(approvedCount)")
                        gate.userApprove(items: workingItems)
                    }
                    .bold()
                    .disabled(workingItems.isEmpty)
                }
            }
        }
        .presentationDetents([.fraction(0.75)])
        .interactiveDismissDisabled()    // force explicit Apply / Cancel
    }

    private var approvedCount: Int {
        workingItems.filter { $0.isApproved }.count
    }
}

private struct ConfigConfirmRow: View {
    @Binding var item: PendingConfigChangeItem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(item.verb.uppercased())
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(verbBackground, in: Capsule())
                Text(item.displayName)
                    .font(.system(.body, design: .default))
                    .foregroundStyle(.primary)
                Spacer()
                Toggle("", isOn: $item.isApproved)
                    .labelsHidden()
                    .scaleEffect(0.85)
            }
            Text(item.path)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            HStack(alignment: .top, spacing: 6) {
                if !item.oldDisplay.isEmpty {
                    Text(item.oldDisplay)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .foregroundStyle(.secondary)
                    Image(systemName: "arrow.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if !item.newDisplay.isEmpty {
                    Text(item.newDisplay)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .foregroundStyle(item.risk == .destructive ? .red
                                         : item.risk == .sensitive ? .orange
                                         : .primary)
                        .fontWeight(.medium)
                }
            }
            .font(.system(.footnote, design: .monospaced))

            if item.risk == .destructive {
                Label("This may affect later tool calls.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(.red)
            } else if item.risk == .sensitive {
                Label("Reversible, but worth a quick look.", systemImage: "exclamationmark.circle")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 4)
        .opacity(item.isApproved ? 1.0 : 0.45)
    }

    private var verbBackground: Color {
        switch item.verb.lowercased() {
        case "remove", "delete": return .red
        case "add", "create":    return .green
        case "hide":             return .gray
        case "show":             return .blue
        case "revert":           return .purple
        default:                 return .accentColor
        }
    }
}
