package com.openminis.app.mcp.oauth

import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * [T-android-mcp-oauth] PKCE (RFC 7636, S256) + RFC 8707 resource-indicator
 * helpers for MCP Static OAuth. Pure and self-contained so the parameter
 * construction can be unit-tested without a device. Mirrors iOS
 * MCPOAuthController's PKCE / canonicalResourceURI / authorize URL building.
 */
object McpPkce {

    private const val URL_SAFE =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

    private val random = SecureRandom()

    /** A random URL-safe string of [length] chars (RFC 7636 unreserved set). */
    fun randomUrlSafe(length: Int): String {
        val sb = StringBuilder(length)
        repeat(length) { sb.append(URL_SAFE[random.nextInt(URL_SAFE.length)]) }
        return sb.toString()
    }

    /** base64url(SHA-256(verifier)), no padding — the S256 code_challenge. */
    fun codeChallengeS256(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }

    /** One PKCE + state triple for an authorization request. */
    data class PkceParams(val verifier: String, val challenge: String, val state: String)

    fun newPkce(): PkceParams {
        val verifier = randomUrlSafe(64)
        return PkceParams(
            verifier = verifier,
            challenge = codeChallengeS256(verifier),
            state = randomUrlSafe(24),
        )
    }

    /**
     * Canonical MCP resource URI (RFC 8707 §2): trim, drop any fragment, strip
     * trailing slashes; must have a scheme and host. Returns null when [raw]
     * isn't a usable absolute URI. Mirrors iOS canonicalResourceURI.
     */
    fun canonicalResourceUri(raw: String?): String? {
        var s = raw?.trim().orEmpty()
        if (s.isEmpty()) return null
        val hash = s.indexOf('#')
        if (hash >= 0) s = s.substring(0, hash)
        while (s.endsWith("/")) s = s.dropLast(1)
        if (s.isEmpty()) return null
        val uri = runCatching { URI(s) }.getOrNull() ?: return null
        if (uri.scheme.isNullOrEmpty() || uri.host.isNullOrEmpty()) return null
        return s
    }

    /**
     * Build the full authorization-endpoint URL for a PKCE code flow. Appends
     * the standard params (response_type, client_id, redirect_uri, state, S256
     * challenge, offline/consent refresh hints), plus the RFC 8707 `resource`
     * and optional scope. Query items already present on [authorizationEndpoint]
     * are preserved. Mirrors iOS authorize().
     */
    fun buildAuthorizationUrl(
        authorizationEndpoint: String,
        clientId: String,
        redirectUri: String,
        pkce: PkceParams,
        resource: String?,
        scopes: String?,
    ): String {
        val params = buildList {
            add("response_type" to "code")
            add("client_id" to clientId)
            add("redirect_uri" to redirectUri)
            add("state" to pkce.state)
            add("code_challenge" to pkce.challenge)
            add("code_challenge_method" to "S256")
            // Refresh-token hints — Google requires both; others ignore unknown
            // params (RFC 6749 §3.1).
            add("access_type" to "offline")
            add("prompt" to "consent")
            if (!resource.isNullOrEmpty()) add("resource" to resource)
            if (!scopes.isNullOrBlank()) add("scope" to scopes.trim())
        }
        val query = params.joinToString("&") { (k, v) -> "$k=${enc(v)}" }
        // Preserve any query already present on the endpoint (RFC 6749 §3.1
        // allows the auth endpoint to carry its own params).
        val sep = if (authorizationEndpoint.contains('?')) "&" else "?"
        return "$authorizationEndpoint$sep$query"
    }

    private fun enc(v: String): String =
        URLEncoder.encode(v, "UTF-8").replace("+", "%20")
}
