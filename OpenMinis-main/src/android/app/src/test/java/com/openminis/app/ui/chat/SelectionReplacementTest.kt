package com.openminis.app.ui.chat

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [T-android-voice-correction] Capability #3 trigger detection.
 *
 * `captureSelectionReplacement` hands its result to a global object, so these
 * tests exercise the same decision logic through [detect] below, which is a
 * line-for-line mirror of the helper's guards. Keeping them in step matters:
 * a false positive here means noise written into the user's dictionary.
 */
class SelectionReplacementTest {

    /** (replaced, inserted) when this edit is a select-and-replace, else null. */
    private fun detect(previous: TextFieldValue, next: TextFieldValue): Pair<String, String>? {
        val selection = previous.selection
        if (selection.collapsed) return null
        val start = minOf(selection.start, selection.end)
        val end = maxOf(selection.start, selection.end)
        val oldText = previous.text
        if (start < 0 || end > oldText.length || start >= end) return null
        val replaced = oldText.substring(start, end)
        if (replaced.isBlank()) return null
        val prefix = oldText.substring(0, start)
        val suffix = oldText.substring(end)
        val newText = next.text
        if (!newText.startsWith(prefix) || !newText.endsWith(suffix)) return null
        val insertedEnd = newText.length - suffix.length
        if (insertedEnd < prefix.length) return null
        val inserted = newText.substring(prefix.length, insertedEnd)
        if (inserted.isBlank() || inserted == replaced) return null
        return replaced to inserted
    }

    private fun value(text: String, start: Int, end: Int) =
        TextFieldValue(text, TextRange(start, end))

    @Test
    fun `replacing a selected span is detected`() {
        val before = value("我们约在石塘见面", 4, 6)   // "石塘" selected
        val after = TextFieldValue("我们约在食堂见面")
        assertEquals("石塘" to "食堂", detect(before, after))
    }

    @Test
    fun `replacing a span at the start is detected`() {
        val before = value("石塘在哪", 0, 2)
        val after = TextFieldValue("食堂在哪")
        assertEquals("石塘" to "食堂", detect(before, after))
    }

    @Test
    fun `replacing a span at the end is detected`() {
        val before = value("我们去石塘", 3, 5)
        val after = TextFieldValue("我们去食堂")
        assertEquals("石塘" to "食堂", detect(before, after))
    }

    @Test
    fun `a reversed selection range still works`() {
        // Dragging right-to-left gives start > end.
        val before = value("我们约在石塘见面", 6, 4)
        val after = TextFieldValue("我们约在食堂见面")
        assertEquals("石塘" to "食堂", detect(before, after))
    }

    // -- must NOT fire --

    @Test
    fun `ordinary typing is ignored`() {
        // No selection: append-only, carries no correction signal.
        val before = value("我们约在", 4, 4)
        val after = TextFieldValue("我们约在食")
        assertNull(detect(before, after))
    }

    @Test
    fun `deleting a selection is ignored`() {
        // An empty replacement says what was wrong but not what was right.
        val before = value("我们约在石塘见面", 4, 6)
        val after = TextFieldValue("我们约在见面")
        assertNull(detect(before, after))
    }

    @Test
    fun `replacing with identical text is ignored`() {
        val before = value("我们约在石塘见面", 4, 6)
        val after = TextFieldValue("我们约在石塘见面")
        assertNull(detect(before, after))
    }

    @Test
    fun `a whitespace-only selection is ignored`() {
        val before = value("甲   乙", 1, 4)
        val after = TextFieldValue("甲乙丙")
        assertNull(detect(before, after))
    }

    @Test
    fun `an edit that also changes the surrounding text is ignored`() {
        // Prefix no longer matches, so this was not a clean span replacement —
        // treating it as one would learn a bogus pair.
        val before = value("我们约在石塘见面", 4, 6)
        val after = TextFieldValue("他们约在食堂见面")
        assertNull(detect(before, after))
    }

    @Test
    fun `clearing the whole field via select-all is ignored`() {
        val before = value("石塘", 0, 2)
        val after = TextFieldValue("")
        assertNull(detect(before, after))
    }

    @Test
    fun `an out-of-range selection is clamped by TextFieldValue and still handled`() {
        // TextFieldValue clamps TextRange(0,5) on a 1-char string down to (0,1),
        // so this arrives as an ordinary select-all-and-replace and IS a valid
        // correction signal. The bounds guard in the helper therefore never
        // fires for this input — it stays as defence against a caller
        // constructing a range by hand.
        val before = TextFieldValue("短", TextRange(0, 5))
        val after = TextFieldValue("长")
        assertEquals("短" to "长", detect(before, after))
    }
}
