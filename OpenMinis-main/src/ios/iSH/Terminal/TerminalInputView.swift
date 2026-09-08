//
//  TerminalInputView.swift
//  MinisApp
//
//  UIViewRepresentable keyboard input capture using UITextInput.
//  Supports CJK (Chinese/Japanese/Korean) input methods by handling
//  marked text (IME composition) properly. Each completed keystroke
//  or committed text is sent directly to the TTY.
//

import SwiftUI
import UIKit

/// Invisible UIView that captures keyboard input and forwards to the terminal
struct TerminalInputView: UIViewRepresentable {
    /// Called with raw bytes to send to the TTY
    var onInput: (Data) -> Void

    /// Whether application cursor key mode is active
    var applicationCursorKeys: Bool

    /// Whether the keyboard should be visible
    @Binding var isActive: Bool

    /// Whether Ctrl modifier is sticky (from accessory bar)
    @Binding var ctrlActive: Bool

    /// Whether the terminal view is currently visible (not obscured by sheet)
    var isTerminalVisible: Bool = true

    func makeUIView(context: Context) -> TerminalKeyInputView {
        let view = TerminalKeyInputView()
        view.onInput = onInput
        view.applicationCursorKeys = applicationCursorKeys
        view.ctrlActive = ctrlActive
        view.onCtrlConsumed = { ctrlActive = false }
        // Hide the predictive text bar iPadOS shows above a physical keyboard
        view.inputAssistantItem.leadingBarButtonGroups = []
        view.inputAssistantItem.trailingBarButtonGroups = []
        context.coordinator.view = view
        return view
    }

    func updateUIView(_ uiView: TerminalKeyInputView, context: Context) {
        uiView.onInput = onInput
        uiView.applicationCursorKeys = applicationCursorKeys
        uiView.ctrlActive = ctrlActive

        let shouldBeFirstResponder = isActive && isTerminalVisible
        let coord = context.coordinator
        // Edge-triggered: only act when shouldBeFirstResponder changed.
        // Unrelated SwiftUI redraws (chat list sizing, etc.) re-run updateUIView
        // often; unconditionally re-becoming first responder here makes the
        // keyboard bounce whenever a sibling view redraws.
        let shouldBeChanged = coord.lastShouldBeFirstResponder != shouldBeFirstResponder
        coord.lastShouldBeFirstResponder = shouldBeFirstResponder

        guard shouldBeChanged else { return }
        if shouldBeFirstResponder, !uiView.isFirstResponder {
            DispatchQueue.main.async { uiView.becomeFirstResponder() }
        } else if !shouldBeFirstResponder, uiView.isFirstResponder {
            DispatchQueue.main.async { uiView.resignFirstResponder() }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator {
        weak var view: TerminalKeyInputView?
        var lastShouldBeFirstResponder: Bool = false
    }
}

// MARK: - UITextInput View

/// Custom UIView implementing UITextInput for terminal input with IME support.
/// UITextInput (superset of UIKeyInput) is required for CJK input methods
/// that use marked text (composition) before committing final characters.
class TerminalKeyInputView: UIView, UITextInput {
    var onInput: ((Data) -> Void)?
    var applicationCursorKeys: Bool = false
    var ctrlActive: Bool = false
    var onCtrlConsumed: (() -> Void)?

    // MARK: - Marked text state (IME composition)

    /// Text currently being composed by IME (e.g. pinyin → Chinese)
    private var _markedText: String?
    private var _markedRange: NSRange = NSRange(location: NSNotFound, length: 0)
    private var _selectedRange: NSRange = NSRange(location: 0, length: 0)

    // MARK: - UIKeyInput

    var hasText: Bool { true }

    func insertText(_ text: String) {
        let t0 = TerminalRedrawLog.nowMs()
        // Stamp the pipeline entry time so the render side can log
        // end-to-end "keystroke → pixels" latency. Only set if we're not
        // already tracking an in-flight key (avoids overwriting when the
        // user mashes keys faster than the render loop).
        if TerminalRedrawLog.pendingInputAt == nil {
            TerminalRedrawLog.pendingInputAt = t0
            TerminalRedrawLog.pendingInputChar = text.replacingOccurrences(of: "\n", with: "\\n")
        }

        // Clear any remaining marked text state
        _markedText = nil
        _markedRange = NSRange(location: NSNotFound, length: 0)

        if ctrlActive {
            // Convert to control character
            if let firstChar = text.lowercased().first,
               let ascii = firstChar.asciiValue,
               ascii >= Character("a").asciiValue!,
               ascii <= Character("z").asciiValue! {
                let controlCode = ascii - Character("a").asciiValue! + 1
                sendBytes([controlCode])
                onCtrlConsumed?()
                TerminalRedrawLog.log(String(format: "insertText ctrl='%@' dispatch=%.1fms", text, TerminalRedrawLog.nowMs() - t0))
                return
            }
            onCtrlConsumed?()
        }

        if let data = text.data(using: .utf8) {
            onInput?(data)
        }
        TerminalRedrawLog.log(String(format: "insertText '%@' bytes=%d dispatch=%.1fms",
            text.replacingOccurrences(of: "\n", with: "\\n"),
            text.utf8.count,
            TerminalRedrawLog.nowMs() - t0))
    }

    func deleteBackward() {
        // If there's marked text, just clear it (IME cancelled)
        if _markedText != nil {
            _markedText = nil
            _markedRange = NSRange(location: NSNotFound, length: 0)
            return
        }
        // Send DEL (0x7F) for backspace
        sendBytes([0x7F])
    }

    // MARK: - UITextInput: Marked Text (IME composition)

    func setMarkedText(_ markedText: String?, selectedRange: NSRange) {
        _markedText = markedText
        if let text = markedText, !text.isEmpty {
            _markedRange = NSRange(location: 0, length: text.count)
        } else {
            _markedRange = NSRange(location: NSNotFound, length: 0)
        }
        _selectedRange = selectedRange
    }

    func unmarkText() {
        // IME committed — send the composed text to the terminal
        if let text = _markedText, !text.isEmpty,
           let data = text.data(using: .utf8) {
            onInput?(data)
        }
        _markedText = nil
        _markedRange = NSRange(location: NSNotFound, length: 0)
    }

    var markedTextRange: UITextRange? {
        guard _markedText != nil, _markedRange.location != NSNotFound else { return nil }
        return TerminalTextRange(range: _markedRange)
    }

    var markedTextStyle: [NSAttributedString.Key: Any]? {
        get { nil }
        set { /* ignored */ }
    }

    // MARK: - UITextInput: Selection

    var selectedTextRange: UITextRange? {
        get { TerminalTextRange(range: _selectedRange) }
        set { /* Terminal doesn't need text selection on the input view */ }
    }

    // MARK: - UITextInput: Text manipulation (minimal stubs for protocol conformance)

    func text(in range: UITextRange) -> String? {
        return _markedText
    }

    func replace(_ range: UITextRange, withText text: String) {
        // For terminal, just send the replacement text
        if let data = text.data(using: .utf8) {
            onInput?(data)
        }
    }

    var beginningOfDocument: UITextPosition {
        TerminalTextPosition(offset: 0)
    }

    var endOfDocument: UITextPosition {
        TerminalTextPosition(offset: _markedText?.count ?? 0)
    }

    func textRange(from fromPosition: UITextPosition, to toPosition: UITextPosition) -> UITextRange? {
        guard let from = fromPosition as? TerminalTextPosition,
              let to = toPosition as? TerminalTextPosition else { return nil }
        let range = NSRange(location: from.offset, length: to.offset - from.offset)
        return TerminalTextRange(range: range)
    }

    func position(from position: UITextPosition, offset: Int) -> UITextPosition? {
        guard let pos = position as? TerminalTextPosition else { return nil }
        let newOffset = pos.offset + offset
        guard newOffset >= 0 else { return nil }
        return TerminalTextPosition(offset: newOffset)
    }

    func position(from position: UITextPosition, in direction: UITextLayoutDirection, offset: Int) -> UITextPosition? {
        return self.position(from: position, offset: direction == .right || direction == .down ? offset : -offset)
    }

    func compare(_ position: UITextPosition, to other: UITextPosition) -> ComparisonResult {
        guard let a = position as? TerminalTextPosition,
              let b = other as? TerminalTextPosition else { return .orderedSame }
        if a.offset < b.offset { return .orderedAscending }
        if a.offset > b.offset { return .orderedDescending }
        return .orderedSame
    }

    func offset(from: UITextPosition, to toPosition: UITextPosition) -> Int {
        guard let a = from as? TerminalTextPosition,
              let b = toPosition as? TerminalTextPosition else { return 0 }
        return b.offset - a.offset
    }

    // MARK: - UITextInput: Layout (stubs — invisible view has no layout)

    var inputDelegate: (any UITextInputDelegate)? {
        get { _inputDelegate }
        set { _inputDelegate = newValue }
    }
    private weak var _inputDelegate: (any UITextInputDelegate)?

    lazy var tokenizer: any UITextInputTokenizer = UITextInputStringTokenizer(textInput: self)

    func position(within range: UITextRange, farthestIn direction: UITextLayoutDirection) -> UITextPosition? {
        guard let r = range as? TerminalTextRange else { return nil }
        return direction == .right || direction == .down
            ? TerminalTextPosition(offset: r.range.upperBound)
            : TerminalTextPosition(offset: r.range.location)
    }

    func characterRange(byExtending position: UITextPosition, in direction: UITextLayoutDirection) -> UITextRange? {
        return nil
    }

    func baseWritingDirection(for position: UITextPosition, in direction: UITextStorageDirection) -> NSWritingDirection {
        .leftToRight
    }

    func setBaseWritingDirection(_ writingDirection: NSWritingDirection, for range: UITextRange) {}

    func firstRect(for range: UITextRange) -> CGRect { .zero }
    func caretRect(for position: UITextPosition) -> CGRect { .zero }

    func selectionRects(for range: UITextRange) -> [UITextSelectionRect] { [] }

    func closestPosition(to point: CGPoint) -> UITextPosition? { nil }
    func closestPosition(to point: CGPoint, within range: UITextRange) -> UITextPosition? { nil }
    func characterRange(at point: CGPoint) -> UITextRange? { nil }

    // MARK: - UIResponder

    override var canBecomeFirstResponder: Bool { true }

    // MARK: - UITextInputTraits

    var keyboardAppearance: UIKeyboardAppearance = .dark
    var autocorrectionType: UITextAutocorrectionType = .no
    var autocapitalizationType: UITextAutocapitalizationType = .none
    var smartQuotesType: UITextSmartQuotesType = .no
    var smartDashesType: UITextSmartDashesType = .no
    var smartInsertDeleteType: UITextSmartInsertDeleteType = .no
    var spellCheckingType: UITextSpellCheckingType = .no
    // Use .default to allow all input methods including CJK
    var keyboardType: UIKeyboardType = .default

    // MARK: - Key Commands
    // Ctrl+letter via UIKeyCommand — these override system shortcuts (Ctrl+C=copy,
    // Ctrl+A=selectAll, etc.) because custom keyCommands take priority over
    // the system's default key bindings.
    override var keyCommands: [UIKeyCommand]? {
        var commands: [UIKeyCommand] = []
        for c in "abcdefghijklmnopqrstuvwxyz" {
            // Ctrl+letter → control code (0x01-0x1A)
            let ctrl = UIKeyCommand(input: String(c), modifierFlags: .control, action: #selector(handleCtrlKey(_:)))
            ctrl.wantsPriorityOverSystemBehavior = true
            commands.append(ctrl)

            // Alt+letter → ESC + letter (Meta key mode)
            let alt = UIKeyCommand(input: String(c), modifierFlags: .alternate, action: #selector(handleAltKey(_:)))
            alt.wantsPriorityOverSystemBehavior = true
            commands.append(alt)
        }
        // Alt+common non-letter keys
        for ch in "0123456789-=[]\\;',./`" {
            let cmd = UIKeyCommand(input: String(ch), modifierFlags: .alternate, action: #selector(handleAltKey(_:)))
            cmd.wantsPriorityOverSystemBehavior = true
            commands.append(cmd)
        }
        return commands
    }

    @objc private func handleCtrlKey(_ command: UIKeyCommand) {
        guard let input = command.input,
              let first = input.first,
              let ascii = first.asciiValue else { return }
        let controlCode = ascii - Character("a").asciiValue! + 1
        sendBytes([controlCode])
    }

    @objc private func handleAltKey(_ command: UIKeyCommand) {
        guard let input = command.input,
              let data = input.data(using: .utf8) else { return }
        // Send ESC prefix + the key character
        var bytes: [UInt8] = [0x1B]
        bytes.append(contentsOf: data)
        sendBytes(bytes)
    }

    // MARK: - Physical Key Presses
    // Arrow keys, Tab, and Escape are handled here instead of keyCommands
    // because UITextInput intercepts them for cursor/text manipulation.

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var handled = false

        for press in presses {
            guard let key = press.key else { continue }

            switch key.keyCode {
            // Arrow keys with modifier combos
            // Modifier codes: 2=Shift, 3=Alt, 4=Shift+Alt, 5=Ctrl, 6=Ctrl+Shift
            case .keyboardUpArrow:
                sendModifiedArrow(0x41, key.modifierFlags) // A
                handled = true
            case .keyboardDownArrow:
                sendModifiedArrow(0x42, key.modifierFlags) // B
                handled = true
            case .keyboardRightArrow:
                sendModifiedArrow(0x43, key.modifierFlags) // C
                handled = true
            case .keyboardLeftArrow:
                sendModifiedArrow(0x44, key.modifierFlags) // D
                handled = true
            // Escape
            case .keyboardEscape:
                sendBytes([0x1B])
                handled = true
            // Tab
            case .keyboardTab:
                sendBytes([0x09])
                handled = true
            case .keyboardHome:
                sendBytes([0x1B, 0x5B, 0x48]) // ESC[H
                handled = true
            case .keyboardEnd:
                sendBytes([0x1B, 0x5B, 0x46]) // ESC[F
                handled = true
            case .keyboardPageUp:
                sendBytes([0x1B, 0x5B, 0x35, 0x7E]) // ESC[5~
                handled = true
            case .keyboardPageDown:
                sendBytes([0x1B, 0x5B, 0x36, 0x7E]) // ESC[6~
                handled = true
            case .keyboardDeleteForward:
                sendBytes([0x1B, 0x5B, 0x33, 0x7E]) // ESC[3~
                handled = true
            case .keyboardF1:
                sendBytes([0x1B, 0x4F, 0x50]) // ESC OP
                handled = true
            case .keyboardF2:
                sendBytes([0x1B, 0x4F, 0x51]) // ESC OQ
                handled = true
            case .keyboardF3:
                sendBytes([0x1B, 0x4F, 0x52]) // ESC OR
                handled = true
            case .keyboardF4:
                sendBytes([0x1B, 0x4F, 0x53]) // ESC OS
                handled = true
            case .keyboardF5:
                sendBytes([0x1B, 0x5B, 0x31, 0x35, 0x7E]) // ESC[15~
                handled = true
            case .keyboardF6:
                sendBytes([0x1B, 0x5B, 0x31, 0x37, 0x7E]) // ESC[17~
                handled = true
            case .keyboardF7:
                sendBytes([0x1B, 0x5B, 0x31, 0x38, 0x7E]) // ESC[18~
                handled = true
            case .keyboardF8:
                sendBytes([0x1B, 0x5B, 0x31, 0x39, 0x7E]) // ESC[19~
                handled = true
            case .keyboardF9:
                sendBytes([0x1B, 0x5B, 0x32, 0x30, 0x7E]) // ESC[20~
                handled = true
            case .keyboardF10:
                sendBytes([0x1B, 0x5B, 0x32, 0x31, 0x7E]) // ESC[21~
                handled = true
            case .keyboardF11:
                sendBytes([0x1B, 0x5B, 0x32, 0x33, 0x7E]) // ESC[23~
                handled = true
            case .keyboardF12:
                sendBytes([0x1B, 0x5B, 0x32, 0x34, 0x7E]) // ESC[24~
                handled = true
            default:
                break
            }
        }

        if !handled {
            super.pressesBegan(presses, with: event)
        }
    }

    // MARK: - Helpers

    private func sendArrow(_ direction: ArrowDirection) {
        // Normal mode: ESC [ A/B/C/D
        // Application mode: ESC O A/B/C/D
        let prefix: UInt8 = applicationCursorKeys ? 0x4F : 0x5B // O or [
        let code: UInt8
        switch direction {
        case .up:    code = 0x41 // A
        case .down:  code = 0x42 // B
        case .right: code = 0x43 // C
        case .left:  code = 0x44 // D
        }
        sendBytes([0x1B, prefix, code])
    }

    /// Send arrow key with modifier: ESC[1;{mod}A/B/C/D
    /// Modifier codes: 2=Shift, 3=Alt, 4=Shift+Alt, 5=Ctrl, 6=Ctrl+Shift, 7=Ctrl+Alt
    private func sendModifiedArrow(_ arrowCode: UInt8, _ flags: UIKeyModifierFlags) {
        var mod = 1
        if flags.contains(.shift)     { mod += 1 }
        if flags.contains(.alternate) { mod += 2 }
        if flags.contains(.control)   { mod += 4 }

        if mod == 1 {
            // No modifier — send plain arrow
            sendBytes([0x1B, applicationCursorKeys ? 0x4F : 0x5B, arrowCode])
        } else {
            // ESC [ 1 ; {mod} {A/B/C/D}
            let modChar = UInt8(0x30 + mod) // ASCII digit
            sendBytes([0x1B, 0x5B, 0x31, 0x3B, modChar, arrowCode])
        }
    }

    private func sendBytes(_ bytes: [UInt8]) {
        let data = Data(bytes)
        onInput?(data)
    }
}

// MARK: - UITextInput helper types

private class TerminalTextPosition: UITextPosition {
    let offset: Int
    init(offset: Int) {
        self.offset = offset
        super.init()
    }
}

private class TerminalTextRange: UITextRange {
    let range: NSRange
    init(range: NSRange) {
        self.range = range
        super.init()
    }
    override var start: UITextPosition { TerminalTextPosition(offset: range.location) }
    override var end: UITextPosition { TerminalTextPosition(offset: range.upperBound) }
    override var isEmpty: Bool { range.length == 0 }
}
