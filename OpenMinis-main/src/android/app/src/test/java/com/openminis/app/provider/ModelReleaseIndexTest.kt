package com.openminis.app.provider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-model-release-ranking] Guards the parsing and ordering rules that keep a
 * stale (or uncallable) model off the top of a picker — see OpenMinis#83.
 *
 * These exercise the pure logic (date parsing + the Rank comparator). The id
 * matcher itself needs the bundled catalog, which is an Android asset and so is
 * out of reach of a plain JVM unit test; its behaviour was validated separately
 * against the real catalog and a live 868-model device list.
 */
class ModelReleaseIndexTest {

    // ── date parsing ──────────────────────────────────────────────────────

    @Test
    fun `parses full ISO dates`() {
        assertEquals(2026_07_09, ModelReleaseIndex.parseReleaseDay("2026-07-09"))
        assertEquals(2025_08_08, ModelReleaseIndex.parseReleaseDay("2025-08-08"))
    }

    /**
     * 181 entries in the bundled catalog publish `YYYY-MM` with no day. A strict
     * parser would return null for all of them and silently sink those models to
     * the bottom of every list, so the short form must be accepted.
     */
    @Test
    fun `accepts year-month with no day and treats it as the 1st`() {
        assertEquals(2026_01_01, ModelReleaseIndex.parseReleaseDay("2026-01"))
    }

    @Test
    fun `rejects junk rather than guessing`() {
        assertNull(ModelReleaseIndex.parseReleaseDay(null))
        assertNull(ModelReleaseIndex.parseReleaseDay(""))
        assertNull(ModelReleaseIndex.parseReleaseDay("soon"))
        assertNull(ModelReleaseIndex.parseReleaseDay("2026"))          // year only
        assertNull(ModelReleaseIndex.parseReleaseDay("2026-13-01"))    // month 13
        assertNull(ModelReleaseIndex.parseReleaseDay("2026-07-32"))    // day 32
        assertNull(ModelReleaseIndex.parseReleaseDay("26-07-09"))      // 2-digit year
    }

    @Test
    fun `packed day numbers sort chronologically`() {
        val older = ModelReleaseIndex.parseReleaseDay("2026-02-24")!!
        val newer = ModelReleaseIndex.parseReleaseDay("2026-03-05")!!
        assertTrue("March must sort after February", newer > older)
    }

    // ── ordering ──────────────────────────────────────────────────────────

    private fun rank(day: Int?, cost: Double = 0.0, ctx: Int = 0, name: String = "m") =
        ModelReleaseIndex.Rank(day, cost, ctx, name)

    private fun sorted(vararg ranks: ModelReleaseIndex.Rank) =
        ranks.toList().sortedWith(ModelReleaseIndex.comparator)

    @Test
    fun `newer release sorts first`() {
        val new = rank(2026_07_09, name = "new")
        val old = rank(2025_08_08, name = "old")
        assertEquals(listOf(new, old), sorted(old, new))
    }

    /**
     * The concrete regression: sol/terra/luna all shipped 2026-07-09, so date
     * alone cannot separate them. Output price is what reflects the capability
     * tier (30 / 12 / 1.2 USD per Mtok).
     */
    @Test
    fun `same-day models break the tie on output price, dearest first`() {
        val sol = rank(2026_07_09, cost = 30.0, name = "sol")
        val terra = rank(2026_07_09, cost = 12.0, name = "terra")
        val luna = rank(2026_07_09, cost = 1.2, name = "luna")
        assertEquals(listOf(sol, terra, luna), sorted(luna, terra, sol))
    }

    @Test
    fun `context window breaks a same-day same-price tie`() {
        val big = rank(2026_07_09, cost = 5.0, ctx = 1_000_000, name = "big")
        val small = rank(2026_07_09, cost = 5.0, ctx = 128_000, name = "small")
        assertEquals(listOf(big, small), sorted(small, big))
    }

    /**
     * Undated models are custom / local / relay-hosted entries. They must sink
     * below everything dated, but they must NOT be dropped — hiding them would
     * break exactly the users who self-host.
     */
    @Test
    fun `undated models sink to the bottom but are kept`() {
        val dated = rank(2020_01_01, name = "ancient-but-dated")
        val undated = rank(null, cost = 999.0, ctx = 9_999_999, name = "custom")
        val out = sorted(undated, dated)
        assertEquals(listOf(dated, undated), out)
        assertEquals("nothing may be dropped", 2, out.size)
    }

    @Test
    fun `two undated models still order deterministically by name`() {
        val a = rank(null, name = "alpha")
        val b = rank(null, name = "beta")
        assertEquals(listOf(a, b), sorted(b, a))
    }

    /**
     * End-to-end shape of the OpenMinis#83 scenario: ranking the Codex OAuth ids
     * by their real release dates must float every callable model above every
     * one the backend rejects.
     */
    @Test
    fun `codex oauth ordering puts callable models above rejected ones`() {
        val callable = mapOf(
            "gpt-5.6-sol" to "2026-07-09", "gpt-5.6-terra" to "2026-07-09",
            "gpt-5.6-luna" to "2026-07-09", "gpt-5.5" to "2026-04-24",
            "gpt-5.4-mini" to "2026-03-19", "gpt-5.4" to "2026-03-05",
        )
        val rejected = mapOf(
            "gpt-5.3-codex" to "2026-02-24", "gpt-5.3-codex-spark" to "2026-02-12",
            "gpt-5.2" to "2026-01-01", "gpt-5" to "2025-08-08",
        )
        val ordered = (callable + rejected)
            .map { (id, date) -> id to rank(ModelReleaseIndex.parseReleaseDay(date), name = id) }
            .sortedWith(compareBy(ModelReleaseIndex.comparator) { it.second })
            .map { it.first }

        val topSix = ordered.take(callable.size).toSet()
        assertEquals(
            "every callable Codex model must rank above every rejected one",
            callable.keys, topSix
        )
    }
}
