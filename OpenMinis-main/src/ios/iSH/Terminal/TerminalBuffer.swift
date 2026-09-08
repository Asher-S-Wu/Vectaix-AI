//
//  TerminalBuffer.swift
//  MinisApp
//
//  Terminal screen buffer with character grid, scrollback, and cursor management
//

import Foundation

/// Terminal screen buffer managing a character grid with scrollback history
final class TerminalBuffer {
    /// Number of columns
    private(set) var cols: Int
    /// Number of rows
    private(set) var rows: Int

    /// The character grid (rows × cols)
    var grid: [[TerminalCell]]

    /// Scrollback history (oldest first)
    var scrollback: [[TerminalCell]] = []
    /// Maximum scrollback lines
    let maxScrollback: Int

    /// Whether scrollback is enabled (disabled for alternate buffer)
    var scrollbackEnabled: Bool = true

    /// Absolute index of scrollback[0] since the last full clear. Incremented
    /// whenever a line is trimmed from the front (scrollback overflow). Reset
    /// to 0 when scrollback is cleared. Renderers use this to detect whether
    /// their cached prefix is still valid.
    private(set) var scrollbackHeadIndex: Int = 0

    // MARK: - Cursor State

    /// Cursor column (0-based)
    var cursorCol: Int = 0
    /// Cursor row (0-based)
    var cursorRow: Int = 0

    /// Saved cursor position
    var savedCursorCol: Int = 0
    var savedCursorRow: Int = 0
    var savedCursorStyle: CursorStyle = CursorStyle()

    /// Whether the cursor is pending a wrap to the next line
    /// (set when a character is written to the last column)
    var wrapPending: Bool = false

    // MARK: - Scroll Region

    /// Top of scroll region (0-based, inclusive)
    var scrollTop: Int = 0
    /// Bottom of scroll region (0-based, inclusive)
    var scrollBottom: Int

    // MARK: - Initialization

    init(cols: Int, rows: Int, maxScrollback: Int = 2000) {
        self.cols = cols
        self.rows = rows
        self.maxScrollback = maxScrollback
        self.scrollBottom = rows - 1
        self.grid = Self.makeGrid(cols: cols, rows: rows)
    }

    private static func makeGrid(cols: Int, rows: Int) -> [[TerminalCell]] {
        Array(repeating: Array(repeating: TerminalCell.blank, count: cols), count: rows)
    }

    /// Clear scrollback and reset the head index so renderers drop their
    /// cached prefix. Call this instead of `scrollback.removeAll()` directly.
    func clearScrollback() {
        scrollback.removeAll()
        scrollbackHeadIndex = 0
    }

    // MARK: - Cursor Movement

    func moveCursorTo(col: Int, row: Int) {
        cursorCol = clampCol(col)
        cursorRow = clampRow(row)
        wrapPending = false
    }

    func moveCursorToColumn(_ col: Int) {
        cursorCol = clampCol(col)
        wrapPending = false
    }

    func moveCursorUp(_ n: Int) {
        cursorRow = max(scrollTop, cursorRow - n)
        wrapPending = false
    }

    func moveCursorDown(_ n: Int) {
        cursorRow = min(scrollBottom, cursorRow + n)
        wrapPending = false
    }

    func moveCursorForward(_ n: Int) {
        cursorCol = min(cols - 1, cursorCol + n)
        wrapPending = false
    }

    func moveCursorBackward(_ n: Int) {
        cursorCol = max(0, cursorCol - n)
        wrapPending = false
    }

    // MARK: - Save/Restore Cursor

    func saveCursor(style: CursorStyle) {
        savedCursorCol = cursorCol
        savedCursorRow = cursorRow
        savedCursorStyle = style
    }

    func restoreCursor() -> CursorStyle {
        cursorCol = clampCol(savedCursorCol)
        cursorRow = clampRow(savedCursorRow)
        wrapPending = false
        return savedCursorStyle
    }

    // MARK: - Writing Characters

    /// Write a character at the cursor position with the given style
    func writeChar(_ char: Character, style: CursorStyle, autoWrap: Bool) {
        let charWidth = Self.characterWidth(char)

        // Handle wrap-pending state
        if wrapPending {
            if autoWrap {
                carriageReturn()
                lineFeed()
            }
            wrapPending = false
        }

        // For wide characters, check if there's room
        if charWidth == 2 && cursorCol >= cols - 1 {
            if autoWrap {
                carriageReturn()
                lineFeed()
                wrapPending = false
            } else {
                // Can't fit wide char, write at last col anyway
                cursorCol = cols - 2
            }
        }

        // Write the cell
        if cursorRow >= 0 && cursorRow < rows && cursorCol >= 0 && cursorCol < cols {
            grid[cursorRow][cursorCol] = style.makeCell(character: char, width: UInt8(charWidth))

            if charWidth == 2 && cursorCol + 1 < cols {
                // Write trailing cell for wide character
                var trailer = TerminalCell.blank
                trailer.isWideTrailer = true
                trailer.foreground = style.foreground
                trailer.background = style.background
                trailer.attributes = style.attributes
                grid[cursorRow][cursorCol + 1] = trailer
            }
        }

        // Advance cursor
        cursorCol += charWidth
        if cursorCol >= cols {
            cursorCol = cols - 1
            wrapPending = true
        }
    }

    // MARK: - Line Operations

    func carriageReturn() {
        cursorCol = 0
        wrapPending = false
    }

    /// Line feed: move cursor down, scrolling if at bottom of scroll region
    func lineFeed() {
        if cursorRow == scrollBottom {
            scrollUp(1)
        } else if cursorRow < rows - 1 {
            cursorRow += 1
        }
        wrapPending = false
    }

    /// Reverse index: move cursor up, scrolling down if at top of scroll region
    func reverseIndex() {
        if cursorRow == scrollTop {
            scrollDown(1)
        } else if cursorRow > 0 {
            cursorRow -= 1
        }
        wrapPending = false
    }

    // MARK: - Scrolling

    /// Scroll the scroll region up by n lines (content moves up, new blank lines at bottom)
    func scrollUp(_ n: Int) {
        for _ in 0..<n {
            if scrollbackEnabled {
                scrollback.append(grid[scrollTop])
                if scrollback.count > maxScrollback {
                    scrollback.removeFirst()
                    scrollbackHeadIndex += 1
                }
            }
            grid.remove(at: scrollTop)
            grid.insert(blankLine(), at: scrollBottom)
        }
    }

    /// Scroll the scroll region down by n lines (content moves down, new blank lines at top)
    func scrollDown(_ n: Int) {
        for _ in 0..<n {
            grid.remove(at: scrollBottom)
            grid.insert(blankLine(), at: scrollTop)
        }
    }

    // MARK: - Erase Operations

    /// Erase in display
    /// - mode 0: from cursor to end of display
    /// - mode 1: from start of display to cursor
    /// - mode 2: entire display
    /// - mode 3: entire display + scrollback
    func eraseInDisplay(_ mode: Int) {
        switch mode {
        case 0:
            // Cursor to end: clear rest of current line, then all lines below
            eraseInLine(0)
            for r in (cursorRow + 1)..<rows {
                grid[r] = blankLine()
            }
        case 1:
            // Start to cursor: clear beginning of current line, then all lines above
            eraseInLine(1)
            for r in 0..<cursorRow {
                grid[r] = blankLine()
            }
        case 2:
            // Entire display
            for r in 0..<rows {
                grid[r] = blankLine()
            }
        case 3:
            // Entire display + scrollback
            for r in 0..<rows {
                grid[r] = blankLine()
            }
            scrollback.removeAll()
            scrollbackHeadIndex = 0
        default:
            break
        }
    }

    /// Erase in line
    /// - mode 0: from cursor to end of line
    /// - mode 1: from start of line to cursor
    /// - mode 2: entire line
    func eraseInLine(_ mode: Int) {
        guard cursorRow >= 0 && cursorRow < rows else { return }
        switch mode {
        case 0:
            for c in cursorCol..<cols {
                grid[cursorRow][c] = .blank
            }
        case 1:
            for c in 0...min(cursorCol, cols - 1) {
                grid[cursorRow][c] = .blank
            }
        case 2:
            grid[cursorRow] = blankLine()
        default:
            break
        }
    }

    /// Erase n characters from cursor position
    func eraseCharacters(_ n: Int) {
        guard cursorRow >= 0 && cursorRow < rows else { return }
        let end = min(cursorCol + n, cols)
        for c in cursorCol..<end {
            grid[cursorRow][c] = .blank
        }
    }

    // MARK: - Insert/Delete Lines

    /// Insert n blank lines at cursor row, scrolling down within scroll region
    func insertLines(_ n: Int) {
        guard cursorRow >= scrollTop && cursorRow <= scrollBottom else { return }
        let count = min(n, scrollBottom - cursorRow + 1)
        for _ in 0..<count {
            if scrollBottom < rows {
                grid.remove(at: scrollBottom)
            }
            grid.insert(blankLine(), at: cursorRow)
        }
    }

    /// Delete n lines at cursor row, scrolling up within scroll region
    func deleteLines(_ n: Int) {
        guard cursorRow >= scrollTop && cursorRow <= scrollBottom else { return }
        let count = min(n, scrollBottom - cursorRow + 1)
        for _ in 0..<count {
            grid.remove(at: cursorRow)
            grid.insert(blankLine(), at: scrollBottom)
        }
    }

    /// Insert n blank characters at cursor, shifting existing characters right
    func insertCharacters(_ n: Int) {
        guard cursorRow >= 0 && cursorRow < rows else { return }
        let count = min(n, cols - cursorCol)
        for _ in 0..<count {
            grid[cursorRow].removeLast()
            grid[cursorRow].insert(.blank, at: cursorCol)
        }
    }

    /// Delete n characters at cursor, shifting remaining characters left
    func deleteCharacters(_ n: Int) {
        guard cursorRow >= 0 && cursorRow < rows else { return }
        let count = min(n, cols - cursorCol)
        for _ in 0..<count {
            grid[cursorRow].remove(at: cursorCol)
            grid[cursorRow].append(.blank)
        }
    }

    // MARK: - Scroll Region

    /// Set scroll region (1-based top and bottom, as received from CSI)
    func setScrollRegion(top: Int, bottom: Int) {
        let t = max(0, top - 1)
        let b = min(rows - 1, bottom - 1)
        guard t < b else { return }
        scrollTop = t
        scrollBottom = b
    }

    /// Reset scroll region to full screen
    func resetScrollRegion() {
        scrollTop = 0
        scrollBottom = rows - 1
    }

    // MARK: - Resize

    /// Resize the buffer, preserving as much content as possible
    func resize(newCols: Int, newRows: Int) {
        guard newCols > 0 && newRows > 0 else { return }

        // Create new grid
        var newGrid = Self.makeGrid(cols: newCols, rows: newRows)

        // Copy existing content
        let copyRows = min(rows, newRows)
        let copyCols = min(cols, newCols)
        for r in 0..<copyRows {
            for c in 0..<copyCols {
                newGrid[r][c] = grid[r][c]
            }
        }

        grid = newGrid
        cols = newCols
        rows = newRows
        scrollTop = 0
        scrollBottom = newRows - 1
        cursorCol = min(cursorCol, newCols - 1)
        cursorRow = min(cursorRow, newRows - 1)
        wrapPending = false
    }

    // MARK: - Tab Stops

    /// Move cursor to next tab stop (every 8 columns)
    func tabForward() {
        let nextTab = ((cursorCol / 8) + 1) * 8
        cursorCol = min(nextTab, cols - 1)
        wrapPending = false
    }

    // MARK: - Helpers

    private func blankLine() -> [TerminalCell] {
        Array(repeating: TerminalCell.blank, count: cols)
    }

    private func clampCol(_ c: Int) -> Int {
        max(0, min(c, cols - 1))
    }

    private func clampRow(_ r: Int) -> Int {
        max(0, min(r, rows - 1))
    }

    /// Determine character display width (1 for most, 2 for CJK/emoji fullwidth)
    static func characterWidth(_ char: Character) -> Int {
        guard let scalar = char.unicodeScalars.first else { return 1 }
        let v = scalar.value

        // Emoji: multi-scalar sequences (ZWJ, skin tone, etc.) are always wide
        if char.unicodeScalars.count > 1 {
            // Check if it's an emoji presentation (has VS16 or ZWJ)
            for s in char.unicodeScalars {
                if s.value == 0xFE0F || // Variation Selector-16 (emoji presentation)
                   s.value == 0x200D {   // Zero Width Joiner
                    return 2
                }
            }
            // Multi-scalar characters in emoji ranges are wide
            if v >= 0x1F000 {
                return 2
            }
        }

        // Emoji ranges (single codepoint emoji are also width 2)
        if (v >= 0x231A && v <= 0x231B) ||     // Watch, Hourglass
           (v >= 0x23E9 && v <= 0x23F3) ||     // Playback symbols
           v == 0x23F0 ||                       // Alarm clock
           v == 0x23F3 ||                       // Hourglass flowing
           (v >= 0x25AA && v <= 0x25AB) ||     // Small squares
           v == 0x25B6 || v == 0x25C0 ||       // Play buttons
           (v >= 0x25FB && v <= 0x25FE) ||     // Medium squares
           (v >= 0x2600 && v <= 0x2604) ||     // Sun, Cloud, etc.
           v == 0x260E || v == 0x2611 ||       // Phone, Checkbox
           (v >= 0x2614 && v <= 0x2615) ||     // Umbrella, Hot beverage
           v == 0x2618 ||                       // Shamrock
           v == 0x261D ||                       // Index pointing up
           v == 0x2620 ||                       // Skull and crossbones
           (v >= 0x2622 && v <= 0x2623) ||     // Radioactive, Biohazard
           v == 0x2626 || v == 0x262A ||       // Orthodox cross, Star and crescent
           (v >= 0x262E && v <= 0x262F) ||     // Peace, Yin yang
           (v >= 0x2638 && v <= 0x263A) ||     // Wheel of dharma, Smiley
           v == 0x2640 || v == 0x2642 ||       // Female, Male signs
           (v >= 0x2648 && v <= 0x2653) ||     // Zodiac signs
           (v >= 0x265F && v <= 0x2660) ||     // Chess
           v == 0x2663 || v == 0x2665 ||       // Club, Heart
           v == 0x2666 || v == 0x2668 ||       // Diamond, Hot springs
           v == 0x267B || v == 0x267E ||       // Recycle, Infinity
           v == 0x267F ||                       // Wheelchair
           (v >= 0x2692 && v <= 0x2697) ||     // Tools
           v == 0x2699 || v == 0x269B ||       // Gear, Atom
           v == 0x269C ||                       // Fleur-de-lis
           (v >= 0x26A0 && v <= 0x26A1) ||     // Warning, Zap
           (v >= 0x26AA && v <= 0x26AB) ||     // Circles
           (v >= 0x26B0 && v <= 0x26B1) ||     // Coffin, Urn
           (v >= 0x26BD && v <= 0x26BE) ||     // Soccer, Baseball
           (v >= 0x26C4 && v <= 0x26C5) ||     // Snowman, Sun behind cloud
           v == 0x26CE || v == 0x26CF ||       // Ophiuchus, Pick
           v == 0x26D1 ||                       // Helmet
           (v >= 0x26D3 && v <= 0x26D4) ||     // Chains, No entry
           (v >= 0x26E9 && v <= 0x26EA) ||     // Shinto shrine, Church
           (v >= 0x26F0 && v <= 0x26F5) ||     // Mountain, Sailboat
           (v >= 0x26F7 && v <= 0x26FA) ||     // Skier, Tent
           v == 0x26FD ||                       // Fuel pump
           (v >= 0x2702 && v <= 0x2705) ||     // Scissors, Check mark
           (v >= 0x2708 && v <= 0x270D) ||     // Airplane, Writing hand
           v == 0x270F ||                       // Pencil
           v == 0x2712 ||                       // Black nib
           v == 0x2714 || v == 0x2716 ||       // Check, Cross marks
           v == 0x271D ||                       // Latin cross
           v == 0x2721 ||                       // Star of David
           v == 0x2728 ||                       // Sparkles
           (v >= 0x2733 && v <= 0x2734) ||     // Eight-spoked asterisks
           v == 0x2744 || v == 0x2747 ||       // Snowflake, Sparkle
           v == 0x274C || v == 0x274E ||       // Cross marks
           (v >= 0x2753 && v <= 0x2755) ||     // Question marks
           v == 0x2757 ||                       // Exclamation
           (v >= 0x2763 && v <= 0x2764) ||     // Heart exclamation, Heart
           (v >= 0x2795 && v <= 0x2797) ||     // Plus, Minus, Division
           v == 0x27A1 || v == 0x27B0 ||       // Arrow, Curly loop
           v == 0x27BF ||                       // Double curly loop
           (v >= 0x2934 && v <= 0x2935) ||     // Arrows
           (v >= 0x2B05 && v <= 0x2B07) ||     // Arrows
           (v >= 0x2B1B && v <= 0x2B1C) ||     // Squares
           v == 0x2B50 || v == 0x2B55 ||       // Star, Circle
           v == 0x3030 || v == 0x303D ||       // Wavy dash, Part alternation
           v == 0x3297 || v == 0x3299 ||       // Circled ideographs
           (v >= 0x1F000 && v <= 0x1FAFF) ||   // All emoji blocks (Mahjong through Symbols Extended-A)
           (v >= 0xE0020 && v <= 0xE007F) {    // Tags (flag sequences)
            return 2
        }

        // Common CJK ranges
        if (v >= 0x1100 && v <= 0x115F) ||    // Hangul Jamo
           v == 0x2329 || v == 0x232A ||       // Angle brackets
           (v >= 0x2E80 && v <= 0x303E) ||     // CJK Radicals
           (v >= 0x3040 && v <= 0x33BF) ||     // Japanese
           (v >= 0x3400 && v <= 0x4DBF) ||     // CJK Unified Extension A
           (v >= 0x4E00 && v <= 0x9FFF) ||     // CJK Unified
           (v >= 0xA000 && v <= 0xA4CF) ||     // Yi
           (v >= 0xAC00 && v <= 0xD7AF) ||     // Hangul Syllables
           (v >= 0xF900 && v <= 0xFAFF) ||     // CJK Compatibility
           (v >= 0xFE10 && v <= 0xFE6F) ||     // CJK Forms
           (v >= 0xFF01 && v <= 0xFF60) ||     // Fullwidth Forms
           (v >= 0xFFE0 && v <= 0xFFE6) ||     // Fullwidth Signs
           (v >= 0x20000 && v <= 0x2FFFF) ||   // CJK Extension B+
           (v >= 0x30000 && v <= 0x3FFFF) {    // CJK Extension G+
            return 2
        }
        return 1
    }
}
