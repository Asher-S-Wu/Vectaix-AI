import SwiftUI

// MARK: - Equatable-gated context menu (message bubbles)

/// [T-ios-msg-contextmenu-recursion-crash] Wraps heavy `.contextMenu` content in
/// an Equatable view keyed on a small value so SwiftUI skips rebuilding the whole
/// menu subtree on every cell `body` re-evaluation.
///
/// Why this exists: `View.contextMenu(menuItems:)` is **eager** — SwiftUI
/// materializes the full menu subtree (Buttons + conditional branches + Labels
/// with SF-Symbol images + a large captured `fullReplyText`) on *every* body pass
/// of the cell, not lazily on long-press. During `gh`/shell streaming output the
/// assistant + tool cells re-evaluate their body continuously, so each frame
/// rebuilt and re-diffed the entire menu tree. AttributeGraph's
/// `assignWithCopy for ContextMenuModifier` plus the nested `if let` branches
/// (each an `UnwrapConditional`) drove ever-deeper recursive
/// `ConditionalTypeDescriptor.project` diffing until the update stack blew into
/// unmapped heap and the process took an EXC_BAD_ACCESS / CODESIGNING kill
/// (incident 98E8805F, 2026-07-07). This is the message-bubble twin of the
/// sidebar leak fixed in c78baaf5 (T-ios-sidebar-contextmenu-memory).
///
/// The `menuItems` closure at the call site still runs each pass, but it now
/// returns only this cheap wrapper; the expensive menu body is rebuilt only when
/// `key` (the values that actually change what the menu renders) changes.
struct EquatableMenuGate<Key: Equatable, Content: View>: View, Equatable {
    let key: Key
    @ViewBuilder let content: () -> Content

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.key == rhs.key }

    var body: some View { content() }
}

/// Value key for the assistant reply bubble's long-press menu. Only these
/// fields change what the menu RENDERS (which optional actions appear + the
/// streaming-disabled state). The captured `fullReplyText` is intentionally
/// NOT part of the key: the Copy buttons read it lazily at tap time, so its
/// growth during streaming must not thrash the menu tree.
struct AssistantMenuKey: Equatable {
    let messageId: UUID
    let hasReadAloud: Bool
    let hasCopyScreenshot: Bool
    let hasCompact: Bool
    let isActive: Bool
}

/// Value key for the tool-capsule long-press menu. `blockId` identifies the
/// tool; `isProcessing` toggles the "Re-run From Here" branch;
/// `canRevokeMemoryWrite` toggles the "Undo This Memory Write" branch. The
/// clipboard dump and the written-memory text are built lazily at tap time and
/// deliberately excluded from the key.
struct ToolMenuKey: Equatable {
    let blockId: UUID
    let isProcessing: Bool
    let canRevokeMemoryWrite: Bool
}
