package com.openminis.app.ui.terminal.emulator

/**
 * Terminal screen buffer — port of iOS TerminalBuffer.swift.
 * Rows × cols character grid + scrollback history + cursor state + scroll region.
 */
class TerminalBuffer(
    var cols: Int,
    var rows: Int,
    val maxScrollback: Int = 2000,
) {
    var grid: Array<Array<TerminalCell>> = makeGrid(cols, rows)
        private set
    val scrollback: ArrayDeque<Array<TerminalCell>> = ArrayDeque()
    var scrollbackEnabled: Boolean = true

    var cursorCol: Int = 0
    var cursorRow: Int = 0

    private var savedCursorCol: Int = 0
    private var savedCursorRow: Int = 0
    private var savedCursorStyle: CursorStyle = CursorStyle()

    var wrapPending: Boolean = false

    var scrollTop: Int = 0
    var scrollBottom: Int = rows - 1

    private fun makeGrid(c: Int, r: Int): Array<Array<TerminalCell>> =
        Array(r) { Array(c) { TerminalCell.BLANK } }

    private fun blankLine(): Array<TerminalCell> = Array(cols) { TerminalCell.BLANK }

    // ── Cursor movement ────────────────────────────────────────────────────
    fun moveCursorTo(col: Int, row: Int) {
        cursorCol = clampCol(col); cursorRow = clampRow(row); wrapPending = false
    }
    fun moveCursorToColumn(col: Int) { cursorCol = clampCol(col); wrapPending = false }
    fun moveCursorUp(n: Int) { cursorRow = maxOf(scrollTop, cursorRow - n); wrapPending = false }
    fun moveCursorDown(n: Int) { cursorRow = minOf(scrollBottom, cursorRow + n); wrapPending = false }
    fun moveCursorForward(n: Int) { cursorCol = minOf(cols - 1, cursorCol + n); wrapPending = false }
    fun moveCursorBackward(n: Int) { cursorCol = maxOf(0, cursorCol - n); wrapPending = false }

    // ── Save / restore ─────────────────────────────────────────────────────
    fun saveCursor(style: CursorStyle) {
        savedCursorCol = cursorCol; savedCursorRow = cursorRow
        savedCursorStyle = style.copy()
    }
    fun restoreCursor(): CursorStyle {
        cursorCol = clampCol(savedCursorCol); cursorRow = clampRow(savedCursorRow); wrapPending = false
        return savedCursorStyle.copy()
    }

    // ── Writing ────────────────────────────────────────────────────────────
    fun writeChar(codePoint: Int, style: CursorStyle, autoWrap: Boolean) {
        val width = characterWidth(codePoint)
        if (wrapPending) {
            if (autoWrap) { carriageReturn(); lineFeed() }
            wrapPending = false
        }
        if (width == 2 && cursorCol >= cols - 1) {
            if (autoWrap) { carriageReturn(); lineFeed(); wrapPending = false }
            else cursorCol = cols - 2
        }
        if (cursorRow in 0 until rows && cursorCol in 0 until cols) {
            grid[cursorRow][cursorCol] = style.makeCell(codePoint, width)
            if (width == 2 && cursorCol + 1 < cols) {
                grid[cursorRow][cursorCol + 1] = TerminalCell(
                    char = ' '.code,
                    foreground = style.foreground,
                    background = style.background,
                    attributes = style.attributes,
                    width = 1,
                    isWideTrailer = true,
                )
            }
        }
        cursorCol += width
        if (cursorCol >= cols) { cursorCol = cols - 1; wrapPending = true }
    }

    // ── Line ops ───────────────────────────────────────────────────────────
    fun carriageReturn() { cursorCol = 0; wrapPending = false }

    fun lineFeed() {
        if (cursorRow == scrollBottom) scrollUp(1)
        else if (cursorRow < rows - 1) cursorRow++
        wrapPending = false
    }

    fun reverseIndex() {
        if (cursorRow == scrollTop) scrollDown(1)
        else if (cursorRow > 0) cursorRow--
        wrapPending = false
    }

    // ── Scroll ─────────────────────────────────────────────────────────────
    fun scrollUp(n: Int) {
        repeat(n) {
            if (scrollbackEnabled) {
                scrollback.addLast(grid[scrollTop])
                while (scrollback.size > maxScrollback) scrollback.removeFirst()
            }
            // Shift [scrollTop+1..scrollBottom] → [scrollTop..scrollBottom-1]
            for (r in scrollTop until scrollBottom) grid[r] = grid[r + 1]
            grid[scrollBottom] = blankLine()
        }
    }

    fun scrollDown(n: Int) {
        repeat(n) {
            for (r in scrollBottom downTo scrollTop + 1) grid[r] = grid[r - 1]
            grid[scrollTop] = blankLine()
        }
    }

    // ── Erase ──────────────────────────────────────────────────────────────
    fun eraseInDisplay(mode: Int) {
        when (mode) {
            0 -> {
                eraseInLine(0)
                for (r in (cursorRow + 1) until rows) grid[r] = blankLine()
            }
            1 -> {
                eraseInLine(1)
                for (r in 0 until cursorRow) grid[r] = blankLine()
            }
            2 -> for (r in 0 until rows) grid[r] = blankLine()
            3 -> {
                for (r in 0 until rows) grid[r] = blankLine()
                scrollback.clear()
            }
        }
    }

    fun eraseInLine(mode: Int) {
        if (cursorRow !in 0 until rows) return
        when (mode) {
            0 -> for (c in cursorCol until cols) grid[cursorRow][c] = TerminalCell.BLANK
            1 -> for (c in 0..minOf(cursorCol, cols - 1)) grid[cursorRow][c] = TerminalCell.BLANK
            2 -> grid[cursorRow] = blankLine()
        }
    }

    fun eraseCharacters(n: Int) {
        if (cursorRow !in 0 until rows) return
        val end = minOf(cursorCol + n, cols)
        for (c in cursorCol until end) grid[cursorRow][c] = TerminalCell.BLANK
    }

    // ── Insert / delete lines & chars ──────────────────────────────────────
    fun insertLines(n: Int) {
        if (cursorRow !in scrollTop..scrollBottom) return
        val count = minOf(n, scrollBottom - cursorRow + 1)
        repeat(count) {
            for (r in scrollBottom downTo cursorRow + 1) grid[r] = grid[r - 1]
            grid[cursorRow] = blankLine()
        }
    }

    fun deleteLines(n: Int) {
        if (cursorRow !in scrollTop..scrollBottom) return
        val count = minOf(n, scrollBottom - cursorRow + 1)
        repeat(count) {
            for (r in cursorRow until scrollBottom) grid[r] = grid[r + 1]
            grid[scrollBottom] = blankLine()
        }
    }

    fun insertCharacters(n: Int) {
        if (cursorRow !in 0 until rows) return
        val count = minOf(n, cols - cursorCol)
        val row = grid[cursorRow]
        repeat(count) {
            for (c in cols - 1 downTo cursorCol + 1) row[c] = row[c - 1]
            row[cursorCol] = TerminalCell.BLANK
        }
    }

    fun deleteCharacters(n: Int) {
        if (cursorRow !in 0 until rows) return
        val count = minOf(n, cols - cursorCol)
        val row = grid[cursorRow]
        repeat(count) {
            for (c in cursorCol until cols - 1) row[c] = row[c + 1]
            row[cols - 1] = TerminalCell.BLANK
        }
    }

    // ── Scroll region ──────────────────────────────────────────────────────
    fun setScrollRegion(top: Int, bottom: Int) {
        val t = maxOf(0, top - 1)
        val b = minOf(rows - 1, bottom - 1)
        if (t >= b) return
        scrollTop = t; scrollBottom = b
    }

    fun resetScrollRegion() { scrollTop = 0; scrollBottom = rows - 1 }

    // ── Resize ─────────────────────────────────────────────────────────────
    fun resize(newCols: Int, newRows: Int) {
        if (newCols <= 0 || newRows <= 0) return
        val newGrid = Array(newRows) { r ->
            Array(newCols) { c ->
                if (r < rows && c < cols) grid[r][c] else TerminalCell.BLANK
            }
        }
        grid = newGrid
        cols = newCols; rows = newRows
        scrollTop = 0; scrollBottom = newRows - 1
        cursorCol = minOf(cursorCol, newCols - 1)
        cursorRow = minOf(cursorRow, newRows - 1)
        wrapPending = false
    }

    // ── Tabs ───────────────────────────────────────────────────────────────
    fun tabForward() {
        val next = (cursorCol / 8 + 1) * 8
        cursorCol = minOf(next, cols - 1)
        wrapPending = false
    }

    private fun clampCol(c: Int) = maxOf(0, minOf(c, cols - 1))
    private fun clampRow(r: Int) = maxOf(0, minOf(r, rows - 1))

    companion object {
        /** Return 2 for CJK / emoji fullwidth characters, else 1. */
        fun characterWidth(cp: Int): Int {
            // Emoji pictographic ranges (simplified from iOS — covers common cases)
            if (cp in 0x1F000..0x1FAFF) return 2
            if (cp in 0x2600..0x27BF) return 2  // Misc symbols through Dingbats
            if (cp in 0x2B00..0x2BFF) return 2
            // CJK
            if (cp in 0x1100..0x115F) return 2
            if (cp == 0x2329 || cp == 0x232A) return 2
            if (cp in 0x2E80..0x303E) return 2
            if (cp in 0x3040..0x33BF) return 2
            if (cp in 0x3400..0x4DBF) return 2
            if (cp in 0x4E00..0x9FFF) return 2
            if (cp in 0xA000..0xA4CF) return 2
            if (cp in 0xAC00..0xD7AF) return 2
            if (cp in 0xF900..0xFAFF) return 2
            if (cp in 0xFE10..0xFE6F) return 2
            if (cp in 0xFF01..0xFF60) return 2
            if (cp in 0xFFE0..0xFFE6) return 2
            if (cp in 0x20000..0x2FFFF) return 2
            if (cp in 0x30000..0x3FFFF) return 2
            return 1
        }
    }
}
