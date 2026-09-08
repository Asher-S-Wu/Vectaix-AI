package com.openminis.app.accessibility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-a11y-force-stop-recovery] Grant-parsing and timeout contract.
 *
 * [AccessibilityRecoveryManager.isRevokedIn] is deliberately pure so the
 * ENABLED_ACCESSIBILITY_SERVICES parsing rules can be exercised on the JVM —
 * there is no Robolectric in this module, so anything touching Context or
 * Settings.Secure is untestable here. The parsing is the part with real risk:
 * a false "revoked" reading puts a repair dialog in front of the user on every
 * single a11y call.
 */
class AccessibilityRecoveryManagerTest {

    private val PKG = "com.openminis.app"
    private val CLS = "com.openminis.app.accessibility.MinisAccessibilityService"

    private fun revoked(value: String?) =
        AccessibilityRecoveryManager.isRevokedIn(value, PKG, CLS)

    // ── The force-stop signature ─────────────────────────────────────────

    @Test
    fun `null value reads as revoked`() {
        // Exactly what force-stop leaves behind (verified on Pixel 4a / A13).
        assertTrue(revoked(null))
    }

    @Test
    fun `empty value reads as revoked`() {
        assertTrue(revoked(""))
        assertTrue(revoked("   "))
    }

    // ── Healthy grants must NOT read as revoked ──────────────────────────

    @Test
    fun `fully qualified entry is recognized`() {
        assertFalse(revoked("$PKG/$CLS"))
    }

    @Test
    fun `abbreviated entry is recognized`() {
        // The framework normalizes to this form when it rewrites the value.
        // This is the regression that would otherwise loop the repair prompt.
        assertFalse(revoked("$PKG/.accessibility.MinisAccessibilityService"))
    }

    @Test
    fun `case differences are tolerated`() {
        assertFalse(revoked("$PKG/$CLS".uppercase()))
    }

    @Test
    fun `entry surrounded by whitespace is recognized`() {
        assertFalse(revoked("  $PKG/$CLS  "))
    }

    // ── Coexistence with other services ──────────────────────────────────

    @Test
    fun `ours found among several enabled services`() {
        val talkback = "com.google.android.marvin.talkback/.TalkBackService"
        val bitwarden = "com.x8bit.bitwarden/com.x8bit.bitwarden.Accessibility.AccessibilityService"
        assertFalse(revoked("$talkback:$PKG/$CLS:$bitwarden"))
    }

    @Test
    fun `other services present but ours absent reads as revoked`() {
        // The exact post-force-stop state observed when two services were
        // enabled and only Minis was stopped: the framework surgically removed
        // ours and kept TalkBack.
        val talkback = "com.google.android.marvin.talkback/.TalkBackService"
        assertTrue(revoked(talkback))
    }

    @Test
    fun `a different package with a same-named class does not match`() {
        assertTrue(revoked("com.other.app/com.openminis.app.accessibility.MinisAccessibilityService"))
    }

    @Test
    fun `our package with a different service class does not match`() {
        assertTrue(revoked("$PKG/$PKG.accessibility.SomeOtherService"))
    }

    // ── Timeout contract ─────────────────────────────────────────────────

    @Test
    fun `prompt timeout is 60 seconds`() {
        // Spec'd value. Asserted so a casual edit to the constant trips a test
        // rather than silently changing how long an agent turn can stall.
        assertEquals(60_000L, AccessibilityRecoveryManager.PROMPT_TIMEOUT_MS)
    }

    // ── Idempotence of the UI callback ───────────────────────────────────

    @Test
    fun `respond without a pending prompt is a no-op`() {
        // The dialog host can fire respond() after a timeout already resolved
        // the continuation (button tap racing the 60s expiry). That must not
        // throw or resume a dead continuation.
        AccessibilityRecoveryManager.respond(AccessibilityRecoveryManager.Decision.CANCEL)
        AccessibilityRecoveryManager.respond(AccessibilityRecoveryManager.Decision.REPAIR)
        assertEquals(null, AccessibilityRecoveryManager.pendingPrompt.value)
    }
}
