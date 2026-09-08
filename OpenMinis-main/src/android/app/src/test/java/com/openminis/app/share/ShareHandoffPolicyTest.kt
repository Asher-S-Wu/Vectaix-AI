package com.openminis.app.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-share-launch-crash] Proves the guard that keeps a failed
 * MainActivity hand-off from crashing the app (vivo V2352A / GH share crash).
 *
 * The device could not be used to prove this: forcing `startActivity` to fail
 * needs `pm disable-user`, which the shell is not permitted to do on this
 * device ("SecurityException: Shell cannot change component state"). Driving
 * the decision layer directly is stronger anyway — it reproduces the exact
 * exception shape from the crash log, which no device-side injection would.
 */
class ShareHandoffPolicyTest {

    /**
     * The observed failure: system_server's freeform logic NPEs, and the
     * exception marshalled back has a NULL message, so Parcel.readException
     * NPEs again while rebuilding it. A guard that reads `t.message` naively
     * would itself NPE here — hence a cause with a null message.
     */
    private fun vivoStyleFailure(): RuntimeException =
        RuntimeException(
            "Unable to start activity ComponentInfo{com.openminis.app/…ShareReceiverActivity}",
            NullPointerException(/* message = */ null),
        )

    @Test
    fun `normal device launches on the first attempt and never runs the fallback`() {
        var primary = 0
        var fallback = 0
        val outcome = ShareHandoffPolicy.handOff(
            primary = { primary++ },
            fallback = { fallback++ },
        )
        assertEquals(ShareHandoffPolicy.Outcome.LAUNCHED, outcome)
        assertEquals(1, primary)
        assertEquals("fallback must stay dormant on a healthy device", 0, fallback)
    }

    @Test
    fun `the vivo crash is caught and the fallback launch is used`() {
        var fallback = 0
        val outcome = ShareHandoffPolicy.handOff(
            primary = { throw vivoStyleFailure() },
            fallback = { fallback++ },
        )
        assertEquals(ShareHandoffPolicy.Outcome.LAUNCHED_VIA_FALLBACK, outcome)
        assertEquals(1, fallback)
    }

    @Test
    fun `both attempts failing reports FAILED instead of throwing`() {
        // This is the case that used to kill the app. handOff must return.
        val outcome = ShareHandoffPolicy.handOff(
            primary = { throw vivoStyleFailure() },
            fallback = { throw vivoStyleFailure() },
        )
        assertEquals(ShareHandoffPolicy.Outcome.FAILED, outcome)
    }

    @Test
    fun `a cause carrying a null message does not defeat the guard`() {
        // Direct regression on the double-NPE: the inner NPE has no message,
        // which is precisely what made Parcel.readException blow up a second
        // time on the reporter's device.
        val npe = NullPointerException(null as String?)
        val outcome = ShareHandoffPolicy.handOff(
            primary = { throw npe },
            fallback = { throw npe },
        )
        assertEquals(ShareHandoffPolicy.Outcome.FAILED, outcome)
    }

    @Test
    fun `Errors are caught too, not just Exceptions`() {
        // The Binder unwrap can surface as something outside Exception; a
        // best-effort hand-off has no failure worth crashing over.
        val outcome = ShareHandoffPolicy.handOff(
            primary = { throw StackOverflowError("deep OEM stack") },
            fallback = { throw AssertionError("boom") },
        )
        assertEquals(ShareHandoffPolicy.Outcome.FAILED, outcome)
    }

    @Test
    fun `each failure is reported with its stage`() {
        val stages = mutableListOf<String>()
        ShareHandoffPolicy.handOff(
            primary = { throw vivoStyleFailure() },
            fallback = { throw vivoStyleFailure() },
            onError = { stage, _ -> stages.add(stage) },
        )
        assertEquals(listOf("primary", "fallback"), stages)
    }

    @Test
    fun `a throwing logger cannot defeat the guard`() {
        // Defensive: the whole point is that nothing escapes onCreate.
        val outcome = ShareHandoffPolicy.handOff(
            primary = { throw vivoStyleFailure() },
            fallback = { throw vivoStyleFailure() },
            onError = { _, _ -> throw IllegalStateException("logger died") },
        )
        assertEquals(ShareHandoffPolicy.Outcome.FAILED, outcome)
    }

    @Test
    fun `handOff never throws for any failure combination`() {
        // The guarantee the crash fix depends on, stated directly.
        val throwers: List<() -> Unit> = listOf(
            { },
            { throw vivoStyleFailure() },
            { throw NullPointerException(null as String?) },
            { throw AssertionError("x") },
        )
        for (p in throwers) {
            for (f in throwers) {
                val outcome = ShareHandoffPolicy.handOff(primary = p, fallback = f)
                assertTrue(outcome in ShareHandoffPolicy.Outcome.entries)
            }
        }
    }
}
