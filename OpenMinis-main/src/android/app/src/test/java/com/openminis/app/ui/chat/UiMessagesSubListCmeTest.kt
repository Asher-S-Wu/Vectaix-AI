package com.openminis.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.ConcurrentModificationException

/**
 * [T-android-uimessages-sublist-cme] Properties of the `subList` idiom.
 *
 * SCOPE — read this before trusting the name. These tests pin the MECHANICS of
 * ArrayList.subList. They do NOT reproduce the user's reported crash, and the
 * production `.toList()` calls they justify are defensive hardening rather than
 * a proven fix.
 *
 * Reported stack (realme RMX5010 / Android 16, build 22; 2026-08-10/11/12):
 *
 *   java.util.ConcurrentModificationException
 *     at java.util.ArrayList$SubList.checkForComodification
 *     at java.util.ArrayList$SubList.equals        <-- comparing a stale view
 *     ... androidx.compose.ui.platform.AndroidUiDispatcher (main looper)
 *
 * `ChatViewModel` did emit / store live subList views, which is a real hazard.
 * But a SubList only throws CME once its PARENT is structurally mutated IN
 * PLACE, and every `_messages.value` write allocates a fresh ArrayList
 * (`+` / filterNot / map) instead of mutating. Confirmed on device: with the
 * `truncateBeforeEdit` copy deliberately reverted, editing a middle message
 * truncated the list and a further send still did NOT crash.
 *
 * So the actual trigger for the reported crash is still unidentified — some
 * site must mutate a subList's parent in place. Until it is found, treat a
 * passing run here as "the idiom behaves as documented", not as "the crash is
 * fixed".
 */
class UiMessagesSubListCmeTest {

    private fun backingList(n: Int = 100) = ArrayList<String>().apply {
        repeat(n) { add("m$it") }
    }

    @Test
    fun `a live subList view throws CME on equals after the backing list changes`() {
        val backing = backingList()
        val emitted: List<String> = backing.subList(60, backing.size)   // pre-fix uiMessages

        backing.add("m100")   // any later append to _messages.value's backing array

        assertThrows(ConcurrentModificationException::class.java) {
            // The comparison Compose would run between old and new state.
            // NOTE: reaching this in production needs an IN-PLACE mutation of
            // the parent, which `_messages.value = <new list>` never does —
            // hence this is the hazard's shape, not the observed crash path.
            emitted == listOf("anything")
        }
    }

    @Test
    fun `the toList copy survives the same mutation`() {
        val backing = backingList()
        val emitted: List<String> = backing.subList(60, backing.size).toList()   // the fix

        backing.add("m100")

        // No exception, and the window keeps the contents it was emitted with —
        // a snapshot is also the CORRECT semantics here, not merely the safe one.
        assertEquals(40, emitted.size)
        assertEquals("m60", emitted.first())
        assertEquals("m99", emitted.last())
        assertEquals(false, emitted == listOf("anything"))
    }

    @Test
    fun `storing a live view as the new list poisons every later append`() {
        // truncateBeforeEdit: `kept = messages.subList(0, index)` assigned into
        // _messages.value. The stored value is a view of the list it came from,
        // so it is invalidated by edits to its own backing array.
        val backing = backingList()
        val kept: List<String> = backing.subList(0, 50)

        backing.add("m100")

        assertThrows(ConcurrentModificationException::class.java) {
            kept == listOf("anything")
        }
    }

    @Test
    fun `truncating with toList yields an independent list`() {
        val backing = backingList()
        val kept: List<String> = backing.subList(0, 50).toList()

        backing.add("m100")
        backing.clear()   // even a wholesale reset must not affect the snapshot

        assertEquals(50, kept.size)
        assertEquals("m49", kept.last())
    }

    @Test
    fun `the under-cap fast path stays identity-equal`() {
        // The fix must not cost an allocation on the common path: short sessions
        // return the SAME reference, which is what keeps Compose from
        // recomposing the whole list on every emission.
        val raw: List<String> = backingList(10)
        val cap = 40
        val threshold = 50

        val emitted = if (raw.size <= threshold || raw.size <= cap) raw
        else raw.subList(raw.size - cap, raw.size).toList()

        assertEquals(true, emitted === raw)
    }
}
