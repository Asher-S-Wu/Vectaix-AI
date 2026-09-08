package com.openminis.app.ui.chat

import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * [T-android-table-hscroll-preserve] The key-binding contract that keeps a
 * wide table's horizontal offset alive across streaming re-parses and the
 * live→frozen branch move: the SAME table identity must always resolve to the
 * SAME ScrollState instance, distinct identities to distinct instances, and
 * the recently-used identity must survive LRU pressure.
 */
class TableHScrollStatesTest {

    private fun key(msg: String, shard: String, headers: List<String>) =
        "$msg/$shard/tbl:${headers.joinToString("|")}"

    @Test
    fun `same table identity reuses the same ScrollState instance`() {
        val k = key("m1", "s0", listOf("Name", "Qty", "Price"))
        assertSame(TableHScrollStates.stateFor(k), TableHScrollStates.stateFor(k))
    }

    @Test
    fun `different identities get independent states`() {
        val a = TableHScrollStates.stateFor(key("m1", "s0", listOf("A", "B")))
        val b = TableHScrollStates.stateFor(key("m1", "s1", listOf("A", "B")))
        val c = TableHScrollStates.stateFor(key("m2", "s0", listOf("A", "B")))
        assertNotSame(a, b)
        assertNotSame(a, c)
        assertNotSame(b, c)
    }

    @Test
    fun `recently used identity survives LRU pressure`() {
        val hot = key("hot", "s0", listOf("H"))
        val hotState = TableHScrollStates.stateFor(hot)
        // Flood well past MAX_ENTRIES while re-touching the hot key so the
        // access-ordered LRU keeps it.
        for (i in 0 until 200) {
            TableHScrollStates.stateFor(key("flood$i", "s0", listOf("F")))
            TableHScrollStates.stateFor(hot)
        }
        assertSame(hotState, TableHScrollStates.stateFor(hot))
    }
}
