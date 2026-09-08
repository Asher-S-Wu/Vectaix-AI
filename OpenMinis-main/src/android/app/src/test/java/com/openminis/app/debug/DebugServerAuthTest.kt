package com.openminis.app.debug

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-debugserver-auth] The auth gate contract: loopback (adb
 * forward) is exempt; any non-loopback client must present the exact
 * per-install token.
 */
class DebugServerAuthTest {

    private val token = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"

    @Test
    fun `loopback is exempt regardless of token`() {
        assertTrue(DebugServer.isAuthorized(isLoopback = true, providedToken = null, expectedToken = token))
        assertTrue(DebugServer.isAuthorized(isLoopback = true, providedToken = "wrong", expectedToken = token))
    }

    @Test
    fun `remote without token is rejected`() {
        assertFalse(DebugServer.isAuthorized(isLoopback = false, providedToken = null, expectedToken = token))
        assertFalse(DebugServer.isAuthorized(isLoopback = false, providedToken = "", expectedToken = token))
    }

    @Test
    fun `remote with wrong token is rejected`() {
        assertFalse(DebugServer.isAuthorized(isLoopback = false, providedToken = "deadbeef", expectedToken = token))
        // Same length, one char off — the constant-time compare must still reject.
        assertFalse(
            DebugServer.isAuthorized(
                isLoopback = false,
                providedToken = token.dropLast(1) + "X",
                expectedToken = token,
            ),
        )
    }

    @Test
    fun `remote with correct token is accepted`() {
        assertTrue(DebugServer.isAuthorized(isLoopback = false, providedToken = token, expectedToken = token))
    }

    @Test
    fun `empty expected token never authorizes remote`() {
        // Defensive: a failed token write must not silently open the gate.
        assertFalse(DebugServer.isAuthorized(isLoopback = false, providedToken = "", expectedToken = ""))
        assertFalse(DebugServer.isAuthorized(isLoopback = false, providedToken = "x", expectedToken = ""))
    }
}
