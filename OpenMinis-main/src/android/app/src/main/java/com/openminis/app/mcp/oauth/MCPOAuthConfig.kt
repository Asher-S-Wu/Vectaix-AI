package com.openminis.app.mcp.oauth

import org.json.JSONObject

/**
 * [T-android-mcp-oauth] Non-secret OAuth configuration for an MCP server
 * (Static mode: user-supplied client credentials, PKCE Authorization Code
 * flow). Round-tripped inside the server entry in servers.json. The client
 * SECRET and issued tokens never live here — those go to [MCPOAuthStore]
 * (EncryptedSharedPreferences). Mirrors iOS `MCPOAuthConfig`.
 */
data class MCPOAuthConfig(
    /** "static" = user-supplied client credentials (this implementation).
     *  "dynamic" reserved for discovery + DCR (design-only for now). */
    val mode: String = "static",
    val clientId: String = "",
    val authorizationEndpoint: String = "",
    val tokenEndpoint: String = "",
    /** Space-separated scopes, e.g. "openid email https://.../calendar". */
    val scopes: String? = null,
    /** Custom redirect URI; defaults to the loopback callback when null. */
    val redirectUri: String? = null,
) {
    val isConfigured: Boolean
        get() = clientId.isNotBlank() &&
            authorizationEndpoint.isNotBlank() &&
            tokenEndpoint.isNotBlank()

    fun toJson(): JSONObject = JSONObject().apply {
        put("mode", mode)
        put("client_id", clientId)
        put("authorization_endpoint", authorizationEndpoint)
        put("token_endpoint", tokenEndpoint)
        scopes?.takeIf { it.isNotBlank() }?.let { put("scopes", it) }
        redirectUri?.takeIf { it.isNotBlank() }?.let { put("redirect_uri", it) }
    }

    companion object {
        /** Parse from the `oauth` object inside a server entry. Returns null
         *  when the object is absent or lacks the required endpoints. */
        fun fromJson(obj: JSONObject?): MCPOAuthConfig? {
            if (obj == null) return null
            val config = MCPOAuthConfig(
                mode = obj.optString("mode", "static").ifBlank { "static" },
                clientId = obj.optString("client_id", ""),
                authorizationEndpoint = obj.optString("authorization_endpoint", ""),
                tokenEndpoint = obj.optString("token_endpoint", ""),
                scopes = obj.optString("scopes", "").ifBlank { null },
                redirectUri = obj.optString("redirect_uri", "").ifBlank { null },
            )
            // An oauth block with no endpoints is noise, not configuration.
            return if (config.clientId.isBlank() &&
                config.authorizationEndpoint.isBlank() &&
                config.tokenEndpoint.isBlank()
            ) {
                null
            } else {
                config
            }
        }
    }
}
