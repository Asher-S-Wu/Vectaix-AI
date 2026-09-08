package com.openminis.app.mcp.oauth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-mcp-oauth] Phase 2 coverage: the token-exchange form body
 * (authorization_code grant). The browser round-trip + real HTTP exchange are
 * device/mock-server territory (need a Context-bound token store + Custom Tab)
 * and are exercised on-device, not here.
 */
class McpOAuthTokenExchangeTest {

    @Test
    fun `token body carries the required authorization_code fields`() {
        val body = MCPOAuthController.buildTokenExchangeBody(
            code = "the code",
            redirect = "http://localhost:54546/callback",
            clientId = "client-1",
            verifier = "verifier-xyz",
            clientSecret = null,
            resource = null,
        )
        assertTrue(body.contains("grant_type=authorization_code"))
        assertTrue(body.contains("code=the+code")) // form-encoded space
        assertTrue(body.contains("client_id=client-1"))
        assertTrue(body.contains("code_verifier=verifier-xyz"))
        assertTrue(body.contains("redirect_uri=http%3A%2F%2Flocalhost%3A54546%2Fcallback"))
    }

    @Test
    fun `client secret and resource are included only when present`() {
        val without = MCPOAuthController.buildTokenExchangeBody(
            code = "c", redirect = "r", clientId = "i", verifier = "v",
            clientSecret = null, resource = null,
        )
        assertFalse(without.contains("client_secret="))
        assertFalse(without.contains("resource="))

        val with = MCPOAuthController.buildTokenExchangeBody(
            code = "c", redirect = "r", clientId = "i", verifier = "v",
            clientSecret = "sekret", resource = "https://mcp.example.com",
        )
        assertTrue(with.contains("client_secret=sekret"))
        assertTrue(with.contains("resource=https%3A%2F%2Fmcp.example.com"))
    }

    @Test
    fun `empty client secret is treated as absent`() {
        val body = MCPOAuthController.buildTokenExchangeBody(
            code = "c", redirect = "r", clientId = "i", verifier = "v",
            clientSecret = "", resource = null,
        )
        assertFalse(body.contains("client_secret="))
    }
}
