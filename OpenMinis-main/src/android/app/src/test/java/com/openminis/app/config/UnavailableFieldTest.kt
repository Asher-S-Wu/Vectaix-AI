package com.openminis.app.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-config-feature-unavailable] Covers the wrapper that marks a
 * registered config path as unsupported on this device, and the envelope the
 * bridge answers with. The wiring into ConfigBridge's read/write paths is
 * exercised on-device via minis-config (the bridge needs a live registry +
 * Context), so these lock the pure pieces.
 */
class UnavailableFieldTest {

    /** Minimal stand-in for a real registered field. */
    private class FakeField(
        override val path: String = "background.dynamicIsland",
        override val access: ConfigAccess = ConfigAccess.READWRITE,
    ) : ConfigField {
        override val displayName = "Live Updates (dynamic island)"
        override val description = "Show agent progress in the Live Updates chip."
        override val valueSchema = ConfigSchema.Bool
        override val risk = ConfigRisk.NORMAL
        override val revertable = true
        var written: ConfigValue? = null
        override fun read(): ConfigValue = ConfigValue.Bool(false)
        override fun write(value: ConfigValue) { written = value }
    }

    @Test
    fun `an ordinary field reports no unavailable reason`() {
        assertNull(FakeField().unavailableReason)
    }

    @Test
    fun `the wrapper reports its reason`() {
        val wrapped = UnavailableField(FakeField(), "needs Android 16")
        assertEquals("needs Android 16", wrapped.unavailableReason)
    }

    @Test
    fun `the wrapper keeps the delegate's metadata so help stays honest`() {
        // The whole point of wrapping rather than dropping the registration:
        // the agent gets a precise answer, not a confusing unknown_path, and
        // --help still describes the setting correctly.
        val real = FakeField()
        val wrapped = UnavailableField(real, "unsupported")
        assertEquals(real.path, wrapped.path)
        assertEquals(real.displayName, wrapped.displayName)
        assertEquals(real.description, wrapped.description)
        assertEquals(real.access, wrapped.access)
        assertEquals(real.risk, wrapped.risk)
        assertEquals(real.revertable, wrapped.revertable)
        assertEquals("background", wrapped.scope)
    }

    @Test
    fun `the unavailable envelope uses its own error code, not permission_denied`() {
        // Distinct code matters: permission_denied invites the agent to ask the
        // user to grant something; feature_unavailable tells it retrying is futile.
        val env = ConfigBridge.unavailableErrorEnvelope("background.dynamicIsland", "needs Android 16")
        assertEquals(false, env.getBoolean("ok"))
        assertEquals("feature_unavailable", env.getString("error"))
        assertEquals("needs Android 16", env.getString("reason"))
        assertTrue(env.getString("user_message").contains("background.dynamicIsland"))
        assertTrue(env.getString("user_message").contains("needs Android 16"))
    }
}
