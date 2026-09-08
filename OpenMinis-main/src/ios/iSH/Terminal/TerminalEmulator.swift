//
//  TerminalEmulator.swift
//  MinisApp
//
//  Core terminal emulator: connects ANSIParser → TerminalBuffer, handles all sequences
//

import Foundation
import Combine

/// Core terminal emulator with primary + alternate screen buffers
final class TerminalEmulator: ObservableObject {
    /// Incremented once per feed() call — drives SwiftUI redraw
    @Published var version: UInt64 = 0

    /// Window/icon title from OSC sequences
    @Published var title: String = ""

    // MARK: - Buffers

    /// Primary screen buffer (normal shell)
    private(set) var primaryBuffer: TerminalBuffer
    /// Alternate screen buffer (vim, htop, etc.)
    private(set) var alternateBuffer: TerminalBuffer
    /// Whether alternate buffer is active
    private(set) var isAlternateActive: Bool = false

    /// Current active buffer
    var activeBuffer: TerminalBuffer {
        isAlternateActive ? alternateBuffer : primaryBuffer
    }

    // MARK: - Parser

    private let parser = ANSIParser()

    // MARK: - Terminal Modes

    /// Application cursor key mode (DECCKM) — changes arrow key output
    private(set) var applicationCursorKeys: Bool = false
    /// Auto-wrap mode (DECAWM)
    private(set) var autoWrap: Bool = true
    /// Cursor visible (DECTCEM)
    private(set) var cursorVisible: Bool = true
    /// Bracketed paste mode
    private(set) var bracketedPaste: Bool = false
    /// Application keypad mode (DECKPAM/DECKPNM)
    private(set) var applicationKeypad: Bool = false
    /// Origin mode (DECOM)
    private(set) var originMode: Bool = false

    /// Cursor shape
    private(set) var cursorShape: CursorShape = .block

    /// Callback to send responses back to the TTY (e.g. DSR cursor position report).
    /// Set by the view model that owns this emulator.
    var onResponse: ((Data) -> Void)?

    // MARK: - Current SGR State

    private(set) var cursorStyle = CursorStyle()

    // MARK: - Scrollback Viewing

    /// Lines scrolled back from live (0 = viewing live)
    var scrollOffset: Int = 0 {
        didSet {
            scrollOffset = max(0, min(scrollOffset, activeBuffer.scrollback.count))
        }
    }

    // MARK: - Terminal Size

    private(set) var cols: Int
    private(set) var rows: Int

    // MARK: - Initialization

    init(cols: Int = 80, rows: Int = 24) {
        self.cols = cols
        self.rows = rows
        self.primaryBuffer = TerminalBuffer(cols: cols, rows: rows, maxScrollback: 2000)
        self.alternateBuffer = TerminalBuffer(cols: cols, rows: rows, maxScrollback: 0)
        self.alternateBuffer.scrollbackEnabled = false
    }

    // MARK: - Feed Data

    /// Feed raw terminal output data. Thread-safe — dispatches to main for publishing.
    func feed(_ data: Data) {
        parser.feed(data) { [self] action in
            handleAction(action)
        }
        // Single version bump per feed call (batched)
        version &+= 1
    }

    // MARK: - Visible Lines

    /// Returns the lines to display: scrollback slice + screen, adjusted by scroll offset.
    /// Returns exactly `rows` lines.
    func visibleLines() -> [[TerminalCell]] {
        let buf = activeBuffer

        if scrollOffset == 0 {
            // Live view — just the screen
            return buf.grid
        }

        // Scrolled back: show lines from scrollback
        let scrollbackCount = buf.scrollback.count
        let totalLines = scrollbackCount + buf.grid.count

        // The "viewport" starts at (totalLines - rows - scrollOffset)
        let viewStart = max(0, totalLines - rows - scrollOffset)
        var result: [[TerminalCell]] = []
        result.reserveCapacity(rows)

        for i in viewStart..<(viewStart + rows) {
            if i < scrollbackCount {
                var line = buf.scrollback[i]
                // Pad or trim to current column count
                if line.count < cols {
                    line.append(contentsOf: Array(repeating: TerminalCell.blank, count: cols - line.count))
                } else if line.count > cols {
                    line = Array(line.prefix(cols))
                }
                result.append(line)
            } else {
                let gridRow = i - scrollbackCount
                if gridRow < buf.grid.count {
                    result.append(buf.grid[gridRow])
                } else {
                    result.append(Array(repeating: TerminalCell.blank, count: cols))
                }
            }
        }

        return result
    }

    // MARK: - Resize

    func resize(cols: Int, rows: Int) {
        guard cols > 0 && rows > 0, cols != self.cols || rows != self.rows else { return }
        self.cols = cols
        self.rows = rows
        primaryBuffer.resize(newCols: cols, newRows: rows)
        alternateBuffer.resize(newCols: cols, newRows: rows)
        version &+= 1
    }

    // MARK: - Action Dispatch

    private func handleAction(_ action: ParsedAction) {
        switch action {
        case .printable(let char):
            activeBuffer.writeChar(char, style: cursorStyle, autoWrap: autoWrap)

        case .controlChar(let byte):
            handleControlChar(byte)

        case .csiDispatch(let params, let intermediate, let finalByte):
            handleCSI(params: params, intermediate: intermediate, finalByte: finalByte)

        case .escDispatch(let char):
            handleESC(char)

        case .oscDispatch(let command, let payload):
            handleOSC(command: command, payload: payload)
        }
    }

    // MARK: - Control Characters

    private func handleControlChar(_ byte: UInt8) {
        let buf = activeBuffer
        switch byte {
        case 0x07: // BEL
            break // Could trigger haptic/sound
        case 0x08: // BS (Backspace)
            buf.moveCursorBackward(1)
        case 0x09: // HT (Tab)
            buf.tabForward()
        case 0x0A, 0x0B, 0x0C: // LF, VT, FF
            buf.lineFeed()
        case 0x0D: // CR
            buf.carriageReturn()
        case 0x0E: // SO (Shift Out) — G1 charset, ignored
            break
        case 0x0F: // SI (Shift In) — G0 charset, ignored
            break
        default:
            break
        }
    }

    // MARK: - CSI Sequences

    private func handleCSI(params: [Int], intermediate: Character?, finalByte: Character) {
        let buf = activeBuffer

        // DEC private modes (CSI ? ... h/l)
        if intermediate == "?" {
            handleDECPrivateMode(params: params, set: finalByte == "h")
            return
        }

        // CSI > ... c — Secondary Device Attributes: respond as VT100
        if intermediate == ">" && finalByte == "c" {
            if let data = "\u{1b}[>0;0;0c".data(using: .utf8) {
                onResponse?(data)
            }
            return
        }
        if intermediate == ">" { return }

        switch finalByte {
        // -- Cursor Movement --
        case "A": // CUU — Cursor Up
            buf.moveCursorUp(max(1, params.first ?? 1))

        case "B": // CUD — Cursor Down
            buf.moveCursorDown(max(1, params.first ?? 1))

        case "C": // CUF — Cursor Forward
            buf.moveCursorForward(max(1, params.first ?? 1))

        case "D": // CUB — Cursor Backward
            buf.moveCursorBackward(max(1, params.first ?? 1))

        case "E": // CNL — Cursor Next Line
            buf.moveCursorDown(max(1, params.first ?? 1))
            buf.carriageReturn()

        case "F": // CPL — Cursor Previous Line
            buf.moveCursorUp(max(1, params.first ?? 1))
            buf.carriageReturn()

        case "G": // CHA — Cursor Horizontal Absolute
            buf.moveCursorToColumn(max(1, params.first ?? 1) - 1)

        case "H", "f": // CUP — Cursor Position
            let row = max(1, params.count > 0 ? params[0] : 1)
            let col = max(1, params.count > 1 ? params[1] : 1)
            if originMode {
                buf.moveCursorTo(col: col - 1, row: buf.scrollTop + row - 1)
            } else {
                buf.moveCursorTo(col: col - 1, row: row - 1)
            }

        case "d": // VPA — Vertical Position Absolute
            let row = max(1, params.first ?? 1)
            buf.moveCursorTo(col: buf.cursorCol, row: row - 1)

        // -- Erase --
        case "J": // ED — Erase in Display
            buf.eraseInDisplay(params.first ?? 0)

        case "K": // EL — Erase in Line
            buf.eraseInLine(params.first ?? 0)

        case "X": // ECH — Erase Characters
            buf.eraseCharacters(max(1, params.first ?? 1))

        // -- Insert/Delete --
        case "L": // IL — Insert Lines
            buf.insertLines(max(1, params.first ?? 1))

        case "M": // DL — Delete Lines
            buf.deleteLines(max(1, params.first ?? 1))

        case "@": // ICH — Insert Characters
            buf.insertCharacters(max(1, params.first ?? 1))

        case "P": // DCH — Delete Characters
            buf.deleteCharacters(max(1, params.first ?? 1))

        // -- Scrolling --
        case "S": // SU — Scroll Up
            buf.scrollUp(max(1, params.first ?? 1))

        case "T": // SD — Scroll Down
            buf.scrollDown(max(1, params.first ?? 1))

        // -- Scroll Region --
        case "r": // DECSTBM — Set Scrolling Region
            let top = params.count > 0 ? params[0] : 1
            let bottom = params.count > 1 ? params[1] : rows
            buf.setScrollRegion(top: top, bottom: bottom)
            // DECSTBM also homes the cursor
            if originMode {
                buf.moveCursorTo(col: 0, row: buf.scrollTop)
            } else {
                buf.moveCursorTo(col: 0, row: 0)
            }

        // -- SGR — Select Graphic Rendition --
        case "m":
            handleSGR(params: params.isEmpty ? [0] : params)

        // -- Device Status Report --
        case "n":
            let code = params.first ?? 0
            if code == 6 {
                // CPR — Cursor Position Report: respond with ESC[row;colR (1-based)
                let row = buf.cursorRow + 1
                let col = buf.cursorCol + 1
                if let data = "\u{1b}[\(row);\(col)R".data(using: .utf8) {
                    onResponse?(data)
                }
            } else if code == 5 {
                // DSR — Device Status Report: respond "OK"
                if let data = "\u{1b}[0n".data(using: .utf8) {
                    onResponse?(data)
                }
            }

        // -- Device Attributes --
        case "c": // DA — Primary Device Attributes
            if (params.first ?? 0) == 0 {
                // Respond as VT220 with ANSI color
                if let data = "\u{1b}[?62;22c".data(using: .utf8) {
                    onResponse?(data)
                }
            }

        // -- Cursor Save/Restore (ANSI) --
        case "s": // SCP — Save Cursor Position
            buf.saveCursor(style: cursorStyle)

        case "u": // RCP — Restore Cursor Position
            cursorStyle = buf.restoreCursor()

        // -- Tab --
        case "I": // CHT — Cursor Horizontal Tab
            let count = max(1, params.first ?? 1)
            for _ in 0..<count {
                buf.tabForward()
            }

        // -- Cursor shape (DECSCUSR) --
        case "q":
            if intermediate == " " {
                let p = params.first ?? 1
                switch p {
                case 0, 1: cursorShape = .block
                case 2: cursorShape = .block // steady block
                case 3, 4: cursorShape = .underline
                case 5, 6: cursorShape = .bar
                default: break
                }
            }

        default:
            break
        }
    }

    // MARK: - DEC Private Modes

    private func handleDECPrivateMode(params: [Int], set: Bool) {
        for p in params {
            switch p {
            case 1: // DECCKM — Application Cursor Keys
                applicationCursorKeys = set

            case 6: // DECOM — Origin Mode
                originMode = set
                // Origin mode change homes the cursor
                if set {
                    activeBuffer.moveCursorTo(col: 0, row: activeBuffer.scrollTop)
                } else {
                    activeBuffer.moveCursorTo(col: 0, row: 0)
                }

            case 7: // DECAWM — Auto-Wrap Mode
                autoWrap = set

            case 12: // Cursor blink (att610) — ignore
                break

            case 25: // DECTCEM — Cursor Visibility
                cursorVisible = set

            case 47, 1047: // Alternate Screen Buffer
                switchBuffer(toAlternate: set)

            case 1048: // Save/Restore Cursor (xterm)
                if set {
                    activeBuffer.saveCursor(style: cursorStyle)
                } else {
                    cursorStyle = activeBuffer.restoreCursor()
                }

            case 1049: // Alternate Screen Buffer with cursor save/restore
                if set {
                    primaryBuffer.saveCursor(style: cursorStyle)
                    switchBuffer(toAlternate: true)
                    activeBuffer.eraseInDisplay(2)
                } else {
                    switchBuffer(toAlternate: false)
                    cursorStyle = primaryBuffer.restoreCursor()
                }

            case 2004: // Bracketed Paste Mode
                bracketedPaste = set

            default:
                break
            }
        }
    }

    // MARK: - SGR (Select Graphic Rendition)

    private func handleSGR(params: [Int]) {
        var i = 0
        while i < params.count {
            let p = params[i]
            switch p {
            case 0: // Reset
                cursorStyle = CursorStyle()
            case 1:
                cursorStyle.attributes.insert(.bold)
            case 2:
                cursorStyle.attributes.insert(.dim)
            case 3:
                cursorStyle.attributes.insert(.italic)
            case 4:
                cursorStyle.attributes.insert(.underline)
            case 5:
                cursorStyle.attributes.insert(.blink)
            case 7:
                cursorStyle.attributes.insert(.inverse)
            case 8:
                cursorStyle.attributes.insert(.hidden)
            case 9:
                cursorStyle.attributes.insert(.strikethrough)
            case 21: // Double underline → just underline
                cursorStyle.attributes.insert(.underline)
            case 22: // Normal intensity (not bold, not dim)
                cursorStyle.attributes.remove(.bold)
                cursorStyle.attributes.remove(.dim)
            case 23:
                cursorStyle.attributes.remove(.italic)
            case 24:
                cursorStyle.attributes.remove(.underline)
            case 25:
                cursorStyle.attributes.remove(.blink)
            case 27:
                cursorStyle.attributes.remove(.inverse)
            case 28:
                cursorStyle.attributes.remove(.hidden)
            case 29:
                cursorStyle.attributes.remove(.strikethrough)

            // Foreground colors
            case 30...37:
                cursorStyle.foreground = .indexed(UInt8(p - 30))
            case 38: // Extended foreground
                i = parseSGRColor(params: params, index: i, isForeground: true)
            case 39:
                cursorStyle.foreground = .default

            // Background colors
            case 40...47:
                cursorStyle.background = .indexed(UInt8(p - 40))
            case 48: // Extended background
                i = parseSGRColor(params: params, index: i, isForeground: false)
            case 49:
                cursorStyle.background = .default

            // Bright foreground
            case 90...97:
                cursorStyle.foreground = .indexed(UInt8(p - 90 + 8))

            // Bright background
            case 100...107:
                cursorStyle.background = .indexed(UInt8(p - 100 + 8))

            default:
                break
            }
            i += 1
        }
    }

    /// Parse SGR 38/48 extended color sequences
    /// Returns the index of the last consumed parameter
    private func parseSGRColor(params: [Int], index: Int, isForeground: Bool) -> Int {
        guard index + 1 < params.count else { return index }

        let mode = params[index + 1]
        switch mode {
        case 5: // 256-color: 38;5;N
            guard index + 2 < params.count else { return index + 1 }
            let colorIndex = UInt8(clamping: params[index + 2])
            let color = TerminalColor.indexed(colorIndex)
            if isForeground {
                cursorStyle.foreground = color
            } else {
                cursorStyle.background = color
            }
            return index + 2

        case 2: // RGB: 38;2;R;G;B
            guard index + 4 < params.count else { return index + 1 }
            let r = UInt8(clamping: params[index + 2])
            let g = UInt8(clamping: params[index + 3])
            let b = UInt8(clamping: params[index + 4])
            let color = TerminalColor.rgb(r, g, b)
            if isForeground {
                cursorStyle.foreground = color
            } else {
                cursorStyle.background = color
            }
            return index + 4

        default:
            return index
        }
    }

    // MARK: - ESC Sequences

    private func handleESC(_ char: Character) {
        switch char {
        case "7": // DECSC — Save Cursor
            activeBuffer.saveCursor(style: cursorStyle)

        case "8": // DECRC — Restore Cursor
            cursorStyle = activeBuffer.restoreCursor()

        case "D": // IND — Index (move down, scroll if at bottom)
            activeBuffer.lineFeed()

        case "M": // RI — Reverse Index (move up, scroll if at top)
            activeBuffer.reverseIndex()

        case "E": // NEL — Next Line
            activeBuffer.carriageReturn()
            activeBuffer.lineFeed()

        case "c": // RIS — Full Reset
            resetTerminal()

        case "=": // DECKPAM — Application Keypad
            applicationKeypad = true

        case ">": // DECKPNM — Normal Keypad
            applicationKeypad = false

        case "H": // HTS — Horizontal Tab Set (ignored, we use fixed 8-col tabs)
            break

        default:
            // Charset designators (B, 0, etc.) — ignored for now
            break
        }
    }

    // MARK: - OSC Sequences

    private func handleOSC(command: Int, payload: String) {
        switch command {
        case 0: // Set Icon Name + Window Title
            title = payload
        case 1: // Set Icon Name
            break
        case 2: // Set Window Title
            title = payload
        case 1337: // iTerm2 proprietary — used by /usr/local/bin/minis-open
            // Payload looks like `MinisOpenURL=https://example.com`. Forward
            // the URL to MinisOpenURLBroker so the host can present the in-app
            // WKWebView preview. ANSIParser already stripped the ESC]…BEL
            // envelope, so `payload` is just `key=value` here.
            handleITermOSC(payload: payload)
        default:
            break
        }
    }

    private func handleITermOSC(payload: String) {
        // Payload is `key=value` — we only recognise `MinisOpenURL=<url>`,
        // emitted by `/usr/local/bin/minis-open` in the rootfs overlay.
        guard let eq = payload.firstIndex(of: "="),
              payload[..<eq] == "MinisOpenURL" else { return }
        let urlString = String(payload[payload.index(after: eq)...])
        guard !urlString.isEmpty, let url = URL(string: urlString) else { return }
        // The broker is @MainActor. `feed()` is already called on the main
        // queue from ISHTerminalViewModel's output callback, but hopping
        // through a `Task { @MainActor }` keeps the compiler happy without
        // an explicit `DispatchQueue.main` dance.
        Task { @MainActor in
            guard MinisOpenURLBroker.isSupportedScheme(url.scheme) else { return }
            MinisOpenURLBroker.shared.offer(url)
        }
    }

    // MARK: - Buffer Switching

    private func switchBuffer(toAlternate: Bool) {
        if toAlternate && !isAlternateActive {
            isAlternateActive = true
            alternateBuffer.resize(newCols: cols, newRows: rows)
            alternateBuffer.moveCursorTo(col: 0, row: 0)
        } else if !toAlternate && isAlternateActive {
            isAlternateActive = false
        }
    }

    // MARK: - Full Reset

    private func resetTerminal() {
        cursorStyle = CursorStyle()
        applicationCursorKeys = false
        autoWrap = true
        cursorVisible = true
        bracketedPaste = false
        applicationKeypad = false
        originMode = false
        cursorShape = .block

        primaryBuffer = TerminalBuffer(cols: cols, rows: rows, maxScrollback: 2000)
        alternateBuffer = TerminalBuffer(cols: cols, rows: rows, maxScrollback: 0)
        alternateBuffer.scrollbackEnabled = false
        isAlternateActive = false
        scrollOffset = 0
    }
}
