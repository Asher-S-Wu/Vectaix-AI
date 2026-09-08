package com.openminis.app.ui.terminal.emulator

/** Actions emitted by the parser. */
sealed class ParsedAction {
    data class Printable(val codePoint: Int) : ParsedAction()
    data class ControlChar(val byte: Int) : ParsedAction()
    data class CsiDispatch(
        val params: IntArray,
        val intermediate: Char?,
        val finalByte: Char,
    ) : ParsedAction()
    data class EscDispatch(val char: Char) : ParsedAction()
    data class OscDispatch(val command: Int, val payload: String) : ParsedAction()
}

/**
 * VT100/xterm escape sequence parser — state machine port of iOS ANSIParser.swift.
 * Feed raw bytes via [feed]; emits [ParsedAction] values through the callback.
 */
class AnsiParser {
    private enum class State {
        GROUND, ESCAPE, ESCAPE_INTERMEDIATE,
        CSI_ENTRY, CSI_PARAM, CSI_INTERMEDIATE,
        OSC_PARAM, OSC_STRING,
    }

    private var state = State.GROUND

    private val csiParams = mutableListOf<Int>()
    private var currentParam = 0
    private var hasParam = false
    private var csiIntermediate: Char? = null

    private var oscCommand = 0
    private var oscPayload = StringBuilder()

    private val utf8Buffer = ByteArray(4)
    private var utf8Len = 0
    private var utf8Remaining = 0

    fun feed(bytes: ByteArray, len: Int, action: (ParsedAction) -> Unit) {
        for (i in 0 until len) processByte(bytes[i].toInt() and 0xFF, action)
    }

    fun reset() {
        state = State.GROUND
        csiParams.clear()
        currentParam = 0
        hasParam = false
        csiIntermediate = null
        oscCommand = 0
        oscPayload.setLength(0)
        utf8Len = 0
        utf8Remaining = 0
    }

    private fun processByte(byte: Int, action: (ParsedAction) -> Unit) {
        // UTF-8 continuation handling (only in ground state)
        if (utf8Remaining > 0) {
            if (byte and 0xC0 == 0x80) {
                utf8Buffer[utf8Len++] = byte.toByte()
                utf8Remaining--
                if (utf8Remaining == 0) {
                    val cp = decodeUtf8(utf8Buffer, utf8Len)
                    utf8Len = 0
                    if (cp >= 0) action(ParsedAction.Printable(cp))
                }
                return
            } else {
                utf8Len = 0
                utf8Remaining = 0
                // fall through to re-process this byte
            }
        }

        when (state) {
            State.GROUND -> processGround(byte, action)
            State.ESCAPE -> processEscape(byte, action)
            State.ESCAPE_INTERMEDIATE -> processEscapeIntermediate(byte, action)
            State.CSI_ENTRY -> processCsiEntry(byte, action)
            State.CSI_PARAM -> processCsiParam(byte, action)
            State.CSI_INTERMEDIATE -> processCsiIntermediate(byte, action)
            State.OSC_PARAM -> processOscParam(byte, action)
            State.OSC_STRING -> processOscString(byte, action)
        }
    }

    private fun processGround(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            0x1B -> state = State.ESCAPE
            in 0x00..0x1A, in 0x1C..0x1F -> action(ParsedAction.ControlChar(byte))
            in 0x20..0x7E -> action(ParsedAction.Printable(byte))
            0x7F -> { /* DEL ignored */ }
            in 0xC0..0xDF -> {
                utf8Buffer[0] = byte.toByte(); utf8Len = 1; utf8Remaining = 1
            }
            in 0xE0..0xEF -> {
                utf8Buffer[0] = byte.toByte(); utf8Len = 1; utf8Remaining = 2
            }
            in 0xF0..0xF7 -> {
                utf8Buffer[0] = byte.toByte(); utf8Len = 1; utf8Remaining = 3
            }
            else -> { /* invalid start byte */ }
        }
    }

    private fun processEscape(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            0x5B -> { // [
                state = State.CSI_ENTRY
                csiParams.clear()
                currentParam = 0
                hasParam = false
                csiIntermediate = null
            }
            0x5D -> { // ]
                state = State.OSC_PARAM
                oscCommand = 0
                oscPayload.setLength(0)
            }
            in 0x20..0x2F -> {
                state = State.ESCAPE_INTERMEDIATE
            }
            in 0x30..0x7E -> {
                action(ParsedAction.EscDispatch(byte.toChar()))
                state = State.GROUND
            }
            0x1B -> { /* new ESC, stay in escape */ }
            else -> state = State.GROUND
        }
    }

    private fun processEscapeIntermediate(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            in 0x20..0x2F -> { /* absorb additional intermediates */ }
            in 0x30..0x7E -> {
                action(ParsedAction.EscDispatch(byte.toChar()))
                state = State.GROUND
            }
            0x1B -> state = State.ESCAPE
            else -> state = State.GROUND
        }
    }

    private fun processCsiEntry(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            in 0x30..0x39 -> {
                currentParam = byte - 0x30
                hasParam = true
                state = State.CSI_PARAM
            }
            0x3B -> {
                csiParams.add(0)
                state = State.CSI_PARAM
            }
            in 0x3C..0x3F -> {
                csiIntermediate = byte.toChar()
                state = State.CSI_PARAM
            }
            in 0x20..0x2F -> {
                csiIntermediate = byte.toChar()
                state = State.CSI_INTERMEDIATE
            }
            in 0x40..0x7E -> {
                action(ParsedAction.CsiDispatch(IntArray(0), null, byte.toChar()))
                state = State.GROUND
            }
            0x1B -> state = State.ESCAPE
            else -> state = State.GROUND
        }
    }

    private fun processCsiParam(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            in 0x30..0x39 -> {
                currentParam = currentParam * 10 + (byte - 0x30)
                hasParam = true
            }
            0x3B -> {
                csiParams.add(if (hasParam) currentParam else 0)
                currentParam = 0
                hasParam = false
            }
            in 0x3C..0x3F -> {
                if (csiIntermediate == null) csiIntermediate = byte.toChar()
            }
            in 0x20..0x2F -> {
                if (hasParam) {
                    csiParams.add(currentParam)
                    currentParam = 0
                    hasParam = false
                }
                if (csiIntermediate == null) csiIntermediate = byte.toChar()
                state = State.CSI_INTERMEDIATE
            }
            in 0x40..0x7E -> {
                if (hasParam) csiParams.add(currentParam)
                action(ParsedAction.CsiDispatch(
                    csiParams.toIntArray(),
                    csiIntermediate,
                    byte.toChar()
                ))
                state = State.GROUND
            }
            0x1B -> state = State.ESCAPE
            else -> state = State.GROUND
        }
    }

    private fun processCsiIntermediate(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            in 0x20..0x2F -> { /* more intermediates */ }
            in 0x40..0x7E -> {
                if (hasParam) csiParams.add(currentParam)
                action(ParsedAction.CsiDispatch(
                    csiParams.toIntArray(),
                    csiIntermediate,
                    byte.toChar()
                ))
                state = State.GROUND
            }
            0x1B -> state = State.ESCAPE
            else -> state = State.GROUND
        }
    }

    private fun processOscParam(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            in 0x30..0x39 -> {
                oscCommand = oscCommand * 10 + (byte - 0x30)
            }
            0x3B -> state = State.OSC_STRING
            0x07 -> {
                action(ParsedAction.OscDispatch(oscCommand, oscPayload.toString()))
                state = State.GROUND
            }
            0x1B -> {
                action(ParsedAction.OscDispatch(oscCommand, oscPayload.toString()))
                state = State.ESCAPE
            }
            else -> state = State.GROUND
        }
    }

    private fun processOscString(byte: Int, action: (ParsedAction) -> Unit) {
        when (byte) {
            0x07 -> {
                action(ParsedAction.OscDispatch(oscCommand, oscPayload.toString()))
                state = State.GROUND
            }
            0x1B -> {
                action(ParsedAction.OscDispatch(oscCommand, oscPayload.toString()))
                state = State.ESCAPE
            }
            in 0x20..0x7E, in 0x80..0xFF -> {
                oscPayload.append(byte.toChar())
            }
            else -> { /* ignore */ }
        }
    }

    private fun decodeUtf8(buf: ByteArray, len: Int): Int {
        // buf[0..len-1] is a complete UTF-8 sequence
        val b0 = buf[0].toInt() and 0xFF
        return when {
            len == 2 -> ((b0 and 0x1F) shl 6) or (buf[1].toInt() and 0x3F)
            len == 3 -> ((b0 and 0x0F) shl 12) or ((buf[1].toInt() and 0x3F) shl 6) or (buf[2].toInt() and 0x3F)
            len == 4 -> ((b0 and 0x07) shl 18) or ((buf[1].toInt() and 0x3F) shl 12) or ((buf[2].toInt() and 0x3F) shl 6) or (buf[3].toInt() and 0x3F)
            else -> -1
        }
    }
}
