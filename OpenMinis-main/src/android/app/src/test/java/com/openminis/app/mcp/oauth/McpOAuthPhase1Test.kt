package com.openminis.app.mcp.oauth

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

/**
 * [T-android-mcp-oauth] Phase 1 coverage: PKCE parameter generation, RFC 8707
 * resource canonicalization, authorization-URL assembly, and the non-secret
 * MCPOAuthConfig JSON round-trip.
 */
class McpOAuthPhase1Test {

    // -- PKCE (RFC 7636, S256) --

    @Test
    fun `code challenge is base64url SHA-256 of the verifier, no padding`() {
        val verifier = "abc123-verifier_value.test~"
        val expected = Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8)),
        )
        assertEquals(expected, McpPkce.codeChallengeS256(verifier))
        // base64url alphabet only: no +, /, or = padding.
        val ch = McpPkce.codeChallengeS256(verifier)
        assertFalse(ch.contains('+'))
        assertFalse(ch.contains('/'))
        assertFalse(ch.contains('='))
    }

    @Test
    fun `newPkce yields a 64-char verifier from the unreserved set and a fresh state`() {
        val a = McpPkce.newPkce()
        val b = McpPkce.newPkce()
        assertEquals(64, a.verifier.length)
        assertTrue(a.verifier.all { it.isLetterOrDigit() || it in "-._~" })
        assertEquals(McpPkce.codeChallengeS256(a.verifier), a.challenge)
        // Overwhelmingly likely to differ; guards against a constant/seeded RNG.
        assertNotEquals(a.verifier, b.verifier)
        assertNotEquals(a.state, b.state)
    }

    // -- RFC 8707 resource canonicalization --

    @Test
    fun `resource uri drops fragment and trailing slashes`() {
        assertEquals("https://mcp.example.com/api", McpPkce.canonicalResourceUri("https://mcp.example.com/api/"))
        assertEquals("https://mcp.example.com", McpPkce.canonicalResourceUri("https://mcp.example.com/#frag"))
        assertEquals("https://mcp.example.com/v1", McpPkce.canonicalResourceUri("  https://mcp.example.com/v1  "))
    }

    @Test
    fun `resource uri rejects blanks and schemeless or hostless input`() {
        assertNull(McpPkce.canonicalResourceUri(null))
        assertNull(McpPkce.canonicalResourceUri(""))
        assertNull(McpPkce.canonicalResourceUri("   "))
        assertNull(McpPkce.canonicalResourceUri("/just/a/path"))
        assertNull(McpPkce.canonicalResourceUri("not a uri"))
    }

    // -- authorization URL --

    @Test
    fun `authorization url carries all pkce and refresh params`() {
        val pkce = McpPkce.PkceParams(verifier = "v", challenge = "CHAL", state = "STATE123")
        val url = McpPkce.buildAuthorizationUrl(
            authorizationEndpoint = "https://auth.example.com/authorize",
            clientId = "client-42",
            redirectUri = "http://127.0.0.1:54546/callback",
            pkce = pkce,
            resource = "https://mcp.example.com",
            scopes = "openid email",
        )
        assertTrue(url.startsWith("https://auth.example.com/authorize?"))
        assertTrue(url.contains("response_type=code"))
        assertTrue(url.contains("client_id=client-42"))
        assertTrue(url.contains("code_challenge=CHAL"))
        assertTrue(url.contains("code_challenge_method=S256"))
        assertTrue(url.contains("state=STATE123"))
        assertTrue(url.contains("access_type=offline"))
        assertTrue(url.contains("prompt=consent"))
        assertTrue(url.contains("resource=https%3A%2F%2Fmcp.example.com"))
        assertTrue(url.contains("scope=openid%20email"))
        // redirect must be percent-encoded.
        assertTrue(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A54546%2Fcallback"))
    }

    @Test
    fun `authorization url preserves an existing endpoint query and omits absent optionals`() {
        val pkce = McpPkce.PkceParams("v", "CHAL", "S")
        val url = McpPkce.buildAuthorizationUrl(
            authorizationEndpoint = "https://auth.example.com/authorize?audience=x",
            clientId = "c",
            redirectUri = "http://127.0.0.1:54546/callback",
            pkce = pkce,
            resource = null,
            scopes = null,
        )
        assertTrue("keeps preexisting query with &", url.contains("authorize?audience=x&"))
        assertFalse(url.contains("resource="))
        assertFalse(url.contains("scope="))
    }

    // -- MCPOAuthConfig JSON round-trip --

    @Test
    fun `config round-trips through json`() {
        val cfg = MCPOAuthConfig(
            clientId = "cid",
            authorizationEndpoint = "https://a/authorize",
            tokenEndpoint = "https://a/token",
            scopes = "openid",
            redirectUri = "http://127.0.0.1:54546/callback",
        )
        val back = MCPOAuthConfig.fromJson(cfg.toJson())
        assertEquals(cfg, back)
        assertTrue(cfg.isConfigured)
    }

    @Test
    fun `fromJson returns null for absent or empty oauth block`() {
        assertNull(MCPOAuthConfig.fromJson(null))
        assertNull(MCPOAuthConfig.fromJson(JSONObject()))
        // an object with only a mode but no endpoints/clientId is noise.
        assertNull(MCPOAuthConfig.fromJson(JSONObject().put("mode", "static")))
    }

    @Test
    fun `unconfigured config is flagged`() {
        assertFalse(MCPOAuthConfig(clientId = "cid").isConfigured) // endpoints missing
        assertFalse(MCPOAuthConfig().isConfigured)
    }
}
