package com.openminis.app.speech

import java.util.Locale
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-voice-entry-always-available] Pins the degradation semantics the
 * voice UI now relies on.
 *
 * Two properties matter:
 *  1. Degradation is PER-ENGINE — a poisoned system engine must not mask a
 *     working provider engine, because `refreshAvailability()` is
 *     `engines.any { it.isAvailable }`.
 *  2. Degradation is REVERSIBLE — it used to be permanent for the process
 *     lifetime with no reset path, so one transient failure (mic held by
 *     another app, permission not yet granted, provider since configured)
 *     disabled voice input until the app restarted.
 *
 * A minimal fake stands in for the real engines: they need a Context, a
 * SpeechRecognizer and provider repositories, none of which exist on the JVM.
 * The behaviour under test is the flag itself plus the `any {}` aggregation.
 */
class EngineDegradationIsolationTest {

    private class FakeEngine(
        override val id: String,
        private var installed: Boolean,
    ) : SpeechRecognitionEngine {
        private var degraded = false
        override val displayName: String = id
        override val supportsPartialResults: Boolean = false
        override val supportedLocales: List<Locale> = emptyList()
        // Mirrors both real engines: `!degraded && <cheap probe>`.
        override val isAvailable: Boolean get() = !degraded && installed
        override fun start(locale: Locale, listener: SpeechRecognitionEngine.Listener) {}
        override fun stop() {}
        override fun cancel() {}
        override fun markDegraded() { degraded = true }
        override fun clearDegraded() { degraded = false }
    }

    /** The aggregation `refreshAvailability()` performs. */
    private fun anyAvailable(vararg e: SpeechRecognitionEngine) = e.any { it.isAvailable }

    @Test
    fun `a degraded system engine does not mask a working provider engine`() {
        val system = FakeEngine("system", installed = true)
        val provider = FakeEngine("provider", installed = true)

        system.markDegraded()

        assertFalse("system must report itself unavailable", system.isAvailable)
        assertTrue("provider is untouched", provider.isAvailable)
        assertTrue(
            "overall availability must survive on the provider engine",
            anyAvailable(system, provider),
        )
    }

    @Test
    fun `overall availability only drops when every engine is out`() {
        val system = FakeEngine("system", installed = true)
        // No ASR provider configured — the common case on a stock device.
        val provider = FakeEngine("provider", installed = false)

        assertTrue(anyAvailable(system, provider))
        system.markDegraded()
        assertFalse(
            "with no provider configured, a degraded system engine leaves nothing",
            anyAvailable(system, provider),
        )
    }

    @Test
    fun `degradation is reversible so a transient failure is not permanent`() {
        val system = FakeEngine("system", installed = true)
        system.markDegraded()
        assertFalse(system.isAvailable)

        // The user re-entering voice mode / picking the engine clears it.
        system.clearDegraded()
        assertTrue(
            "a retry must give the engine another chance — degradation used to " +
                "have no reset path at all",
            system.isAvailable,
        )
    }

    @Test
    fun `clearing degradation cannot resurrect an engine that is not installed`() {
        // Reset must not override the underlying probe: a provider that is
        // still unconfigured stays unavailable.
        val provider = FakeEngine("provider", installed = false)
        provider.markDegraded()
        provider.clearDegraded()
        assertFalse(provider.isAvailable)
    }
}
