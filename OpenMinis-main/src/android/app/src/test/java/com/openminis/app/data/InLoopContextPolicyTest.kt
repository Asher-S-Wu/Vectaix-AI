package com.openminis.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [T-android-auto-compact-inloop] Pins the ContextPolicy behaviour the in-loop
 * guard in ChatViewModel.runAgentLoop depends on (iOS f70ac173).
 *
 * The guard itself needs a live ViewModel (Context + DB + provider), so these
 * cover the decision inputs rather than the coroutine plumbing: which tiers can
 * auto-compact, and which can only ever report exhaustion.
 *
 * This distinction is load-bearing. `check()` returns NEEDS_COMPACT first
 * whenever compactThreshold > 0, so EXHAUSTED can ONLY come from an
 * `exhaustedOnly` tier — one where compactThreshold is deliberately 0 because
 * the window is too small for compaction to pay for itself. The guard must
 * therefore STOP on EXHAUSTED rather than attempt a "rescue" compaction.
 */
class InLoopContextPolicyTest {

    @Test
    fun `large windows can auto-compact`() {
        val window = 200_000
        val p = ContextPolicy.forContextWindow(window)
        // Just past the compact threshold.
        assertEquals(
            ContextPolicy.CheckResult.NEEDS_COMPACT,
            p.check(p.compactThreshold, window),
        )
    }

    @Test
    fun `mid windows can auto-compact`() {
        val window = 100_000
        val p = ContextPolicy.forContextWindow(window)
        assertEquals(
            ContextPolicy.CheckResult.NEEDS_COMPACT,
            p.check(p.compactThreshold + 1, window),
        )
    }

    @Test
    fun `small windows never ask for compaction - only exhaustion`() {
        // 32K-64K tier: offload only, compactThreshold = 0.
        val window = 40_000
        val p = ContextPolicy.forContextWindow(window)
        assertEquals(0, p.compactThreshold)
        // Well past the exhaust line — must be EXHAUSTED, never NEEDS_COMPACT,
        // which is why the in-loop guard stops instead of compacting here.
        assertEquals(
            ContextPolicy.CheckResult.EXHAUSTED,
            p.check(window - 1_000, window),
        )
    }

    @Test
    fun `tiny windows never ask for compaction - only exhaustion`() {
        val window = 16_000
        val p = ContextPolicy.forContextWindow(window)
        assertEquals(0, p.compactThreshold)
        assertEquals(
            ContextPolicy.CheckResult.EXHAUSTED,
            p.check(window - 100, window),
        )
    }

    @Test
    fun `an idle context proceeds untouched`() {
        val window = 200_000
        val p = ContextPolicy.forContextWindow(window)
        assertEquals(ContextPolicy.CheckResult.OK, p.check(1_000, window))
    }

    @Test
    fun `compaction is only requested at or above the threshold`() {
        val window = 200_000
        val p = ContextPolicy.forContextWindow(window)
        // One token below the line must NOT trigger a compaction — otherwise the
        // in-loop guard would compact on every iteration near the boundary.
        assertEquals(
            ContextPolicy.CheckResult.OK,
            p.check(p.compactThreshold - 1, window),
        )
    }
}
