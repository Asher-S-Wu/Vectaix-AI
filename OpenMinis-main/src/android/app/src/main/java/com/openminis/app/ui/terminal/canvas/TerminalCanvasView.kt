package com.openminis.app.ui.terminal.canvas

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.sp
import com.openminis.app.ui.terminal.emulator.CursorShape
import com.openminis.app.ui.terminal.emulator.TerminalCell
import com.openminis.app.ui.terminal.emulator.TerminalColor
import com.openminis.app.ui.terminal.emulator.TerminalEmulator
import com.openminis.app.ui.terminal.emulator.TerminalPalette
import com.openminis.app.ui.terminal.emulator.TextAttributes
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Compose Canvas–based terminal renderer. Ports iOS TerminalCanvasView (the
 * rendering half — UITextView selection is not replicated). Emulator state is
 * read via its [TerminalEmulator.version] State so recomposition happens on
 * every feed() call.
 *
 * Cell dimensions are computed from a monospace Paint; the view reports
 * (cols, rows) back via [onResize] whenever its size changes so the emulator
 * and the PTY winsize stay in sync.
 */
@Composable
fun TerminalCanvasView(
    emulator: TerminalEmulator,
    modifier: Modifier = Modifier,
    fontSizeSp: Float = 13f,
    onResize: (cols: Int, rows: Int) -> Unit,
    onTap: () -> Unit = {},
) {
    val density = LocalDensity.current
    val fontSizePx = with(density) { fontSizeSp.sp.toPx() }

    // T138: bundle JetBrains Mono so glyph widths and baselines look the
    // same on every device. `Typeface.MONOSPACE` aliases to whatever the
    // OEM ships (Droid Sans Mono / Roboto Mono / vendor custom), and
    // those each measure characters slightly differently.
    val terminalTypeface = com.openminis.app.ui.terminal.rememberJetBrainsMonoTypeface()
    val paint = remember(fontSizePx, terminalTypeface) {
        Paint().apply {
            typeface = terminalTypeface
            textSize = fontSizePx
            isAntiAlias = true
            isSubpixelText = true
        }
    }

    val cellWidth = remember(fontSizePx) { paint.measureText("M") }
    val fm = remember(fontSizePx) { paint.fontMetrics }
    val cellHeight = remember(fontSizePx) { fm.bottom - fm.top }
    val baselineOffset = remember(fontSizePx) { -fm.top }

    var cols by remember { mutableIntStateOf(emulator.cols) }
    var rows by remember { mutableIntStateOf(emulator.rows) }

    // Cursor blink — flips every 500ms
    var cursorVisible by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(500)
            cursorVisible = !cursorVisible
        }
    }

    // Redraw trigger: bump when emulator version changes
    val version by emulator.version

    // Scroll state with built-in fling. Drag delta in px is accumulated into a
    // float; whole rows are committed to emulator.scrollOffset. Drag down (+px)
    // moves back through scrollback, drag up (-px) returns toward live tail.
    // Return *consumed* delta (= delta minus residual at edge) so Compose's
    // fling animation keeps running until we genuinely run out of scrollback.
    // Apply pixel delta to emulator.scrollOffset, accumulating fractional rows.
    // Returns true if any row was actually scrolled (false → hit edge).
    val scrollAccumPx = remember { mutableStateOf(0f) }
    val applyScroll: (Float) -> Boolean = { delta ->
        scrollAccumPx.value += delta
        val rowDelta = (scrollAccumPx.value / cellHeight).toInt()
        if (rowDelta == 0) {
            true
        } else {
            val before = emulator.scrollOffset
            emulator.scrollOffset = (before + rowDelta).coerceAtLeast(0)
            val applied = emulator.scrollOffset - before
            scrollAccumPx.value -= applied * cellHeight
            if (applied != rowDelta) {
                scrollAccumPx.value = 0f
                false  // hit edge
            } else true
        }
    }
    val scope = rememberCoroutineScope()

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .background(TerminalPalette.defaultBackground)
            // Single pointerInput handles both: vertical drag → scroll w/ fling,
            // tap → focus. Compose chains the two detectors inside one pointer
            // session; tap fires only when no drag movement was detected.
            .pointerInput(cellHeight) {
                val tracker = androidx.compose.ui.input.pointer.util.VelocityTracker()
                detectVerticalDragGestures(
                    onDragStart = { tracker.resetTracking(); scrollAccumPx.value = 0f },
                    onDragEnd = {
                        val velocity = tracker.calculateVelocity().y
                        scope.launch {
                            var lastValue = 0f
                            AnimationState(initialValue = 0f, initialVelocity = velocity)
                                .animateDecay(exponentialDecay(frictionMultiplier = 0.15f)) {
                                    val frameDelta = value - lastValue
                                    lastValue = value
                                    if (!applyScroll(frameDelta)) cancelAnimation()
                                }
                        }
                    },
                    onDragCancel = { tracker.resetTracking() },
                ) { change, dragAmount ->
                    tracker.addPosition(change.uptimeMillis, change.position)
                    applyScroll(dragAmount)
                }
            }
            .pointerInput(Unit) {
                detectTapGestures(onTap = { onTap() })
            },
    ) {
        // Recompute cols/rows from actual draw size.
        val newCols = maxOf(1, (size.width / cellWidth).toInt())
        val newRows = maxOf(1, (size.height / cellHeight).toInt())
        if (newCols != cols || newRows != rows) {
            cols = newCols
            rows = newRows
            onResize(newCols, newRows)
        }

        @Suppress("UNUSED_EXPRESSION") version  // read so Compose tracks it

        val lines = emulator.visibleLines()
        val defaultBg = TerminalPalette.defaultBackground

        drawIntoCanvas { canvas ->
            val nc = canvas.nativeCanvas
            // Paint each cell row-by-row
            for (r in lines.indices) {
                val row = lines[r]
                val y = r * cellHeight
                for (c in row.indices) {
                    val cell = row[c]
                    if (cell.isWideTrailer) continue  // drawn together with leader
                    drawCell(nc, paint, cell, c * cellWidth, y, cellWidth, cellHeight, baselineOffset)
                }
            }
            // T194: selection highlight (drawn between cells and cursor so it
            // overlays the glyphs but doesn't obscure the blinking caret).
            // Coordinates are viewport-relative cells; the gesture handler
            // that sets the rect lives in the new TerminalView-style wrapper.
            val sel = emulator.selectionRect.value
            if (sel != null) {
                val (sx, sy, ex, ey) = if (sel[1] < sel[3] || (sel[1] == sel[3] && sel[0] <= sel[2])) {
                    intArrayOf(sel[0], sel[1], sel[2], sel[3])
                } else {
                    intArrayOf(sel[2], sel[3], sel[0], sel[1])
                }.let { listOf(it[0], it[1], it[2], it[3]) }
                val selPaint = Paint().apply {
                    // Translucent blue, matches Material text-selection tint.
                    color = android.graphics.Color.argb(0x66, 0x33, 0x99, 0xFF)
                    style = Paint.Style.FILL
                }
                for (r in sy..ey) {
                    if (r !in 0 until rows) continue
                    val cStart = if (r == sy) sx else 0
                    val cEnd = if (r == ey) ex + 1 else cols
                    if (cEnd <= cStart) continue
                    nc.drawRect(
                        cStart * cellWidth, r * cellHeight,
                        cEnd * cellWidth, (r + 1) * cellHeight,
                        selPaint,
                    )
                }
            }

            // Cursor
            if (emulator.cursorVisible && cursorVisible) {
                val (cc, cr) = emulator.cursorPos()
                // Only draw cursor when viewing live (not scrolled back)
                if (emulator.scrollOffset == 0 && cr in 0 until rows && cc in 0 until cols) {
                    val cx = cc * cellWidth
                    val cy = cr * cellHeight
                    val cursorPaint = Paint().apply {
                        color = TerminalPalette.defaultForeground.toArgb()
                        style = Paint.Style.FILL
                    }
                    when (emulator.cursorShape) {
                        CursorShape.BLOCK -> {
                            nc.drawRect(cx, cy, cx + cellWidth, cy + cellHeight, cursorPaint)
                            // Redraw glyph in bg color over cursor
                            val cell = lines.getOrNull(cr)?.getOrNull(cc)
                            if (cell != null && cell.char != ' '.code) {
                                val textPaint = Paint(paint).apply {
                                    color = TerminalPalette.defaultBackground.toArgb()
                                }
                                nc.drawText(
                                    String(intArrayOf(cell.char), 0, 1),
                                    cx, cy + baselineOffset, textPaint,
                                )
                            }
                        }
                        CursorShape.UNDERLINE -> {
                            nc.drawRect(
                                cx, cy + cellHeight - 2f,
                                cx + cellWidth, cy + cellHeight, cursorPaint,
                            )
                        }
                        CursorShape.BAR -> {
                            nc.drawRect(cx, cy, cx + 2f, cy + cellHeight, cursorPaint)
                        }
                    }
                }
            }
        }
    }
}

private fun drawCell(
    canvas: android.graphics.Canvas,
    basePaint: Paint,
    cell: TerminalCell,
    x: Float,
    y: Float,
    w: Float,
    h: Float,
    baselineOffset: Float,
) {
    val attrs = cell.attributes
    val inverse = attrs.has(TextAttributes.INVERSE)
    val bold = attrs.has(TextAttributes.BOLD)
    val fgColor = TerminalPalette.resolve(
        if (inverse) cell.background else cell.foreground,
        isForeground = true,
        bold = bold,
    )
    val bgColor = TerminalPalette.resolve(
        if (inverse) cell.foreground else cell.background,
        isForeground = false,
    )
    val cellW = if (cell.width == 2) w * 2 else w

    // Background fill (skip default bg — Canvas is already black)
    if (bgColor != TerminalPalette.defaultBackground) {
        val bgPaint = Paint().apply {
            color = bgColor.toArgb()
            style = Paint.Style.FILL
        }
        canvas.drawRect(x, y, x + cellW, y + h, bgPaint)
    }

    // Skip drawing printable glyph if blank + default style (faster path)
    val ch = cell.char
    if (ch == ' '.code && !attrs.has(TextAttributes.UNDERLINE) && !attrs.has(TextAttributes.STRIKETHROUGH)) {
        return
    }

    val glyphPaint = Paint(basePaint).apply {
        color = fgColor.toArgb()
        isFakeBoldText = bold
        val italic = attrs.has(TextAttributes.ITALIC)
        // T138: derive italic/bold from the *base* typeface (JetBrains
        // Mono) so we don't fall back to the OEM monospace for styled
        // runs. Typeface.create(<jbmono>, BOLD/ITALIC) keeps the family
        // and synthesizes the style — JetBrains Mono ships a real bold
        // file too, but Typeface.create handles both cases transparently.
        val base = basePaint.typeface ?: Typeface.MONOSPACE
        typeface = when {
            bold && italic -> Typeface.create(base, Typeface.BOLD_ITALIC)
            bold -> Typeface.create(base, Typeface.BOLD)
            italic -> Typeface.create(base, Typeface.ITALIC)
            else -> base
        }
        if (attrs.has(TextAttributes.UNDERLINE)) isUnderlineText = true
        if (attrs.has(TextAttributes.STRIKETHROUGH)) isStrikeThruText = true
        if (attrs.has(TextAttributes.DIM)) alpha = 128
        if (attrs.has(TextAttributes.HIDDEN)) alpha = 0
    }

    val s = String(intArrayOf(ch), 0, 1)
    canvas.drawText(s, x, y + baselineOffset, glyphPaint)
}

