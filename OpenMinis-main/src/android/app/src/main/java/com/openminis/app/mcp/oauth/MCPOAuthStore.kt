package com.openminis.app.mcp.oauth

import android.content.Context
import android.content.SharedPreferences
import com.openminis.app.logging.AppLogger
import com.openminis.app.util.EncryptedPrefsFactory
import org.json.JSONObject

/**
 * [T-android-mcp-oauth] Secret storage for MCP OAuth: the client secret and the
 * issued access / refresh tokens, per server, in EncryptedSharedPreferences —
 * the Android analog of iOS keeping these in the Keychain (distinct from the
 * non-secret [MCPOAuthConfig] that lives in servers.json). All keys are
 * namespaced by server id.
 */
object MCPOAuthStore {

    private const val TAG = "MCPOAuthStore"
    private const val FILE = "mcp_oauth_secrets"

    /** Issued tokens for a server. [expiresAtMs] is 0 when the server gave no
     *  expires_in (treated as "never proactively refresh"). */
    data class StoredTokens(
        val accessToken: String,
        val refreshToken: String?,
        val expiresAtMs: Long,
    )

    @Volatile
    private var prefsRef: SharedPreferences? = null

    private fun prefs(context: Context): SharedPreferences =
        prefsRef ?: synchronized(this) {
            prefsRef ?: EncryptedPrefsFactory.safeCreate(context.applicationContext, FILE)
                .also { prefsRef = it }
        }

    private fun secretKey(server: String) = "secret::$server"
    private fun tokensKey(server: String) = "tokens::$server"

    // -- client secret --

    fun setClientSecret(context: Context, server: String, secret: String?) {
        val p = prefs(context)
        if (secret.isNullOrEmpty()) {
            p.edit().remove(secretKey(server)).apply()
        } else {
            p.edit().putString(secretKey(server), secret).apply()
        }
    }

    fun clientSecret(context: Context, server: String): String? =
        prefs(context).getString(secretKey(server), null)?.takeIf { it.isNotEmpty() }

    // -- tokens --

    fun setTokens(context: Context, server: String, tokens: StoredTokens) {
        val json = JSONObject().apply {
            put("access_token", tokens.accessToken)
            tokens.refreshToken?.let { put("refresh_token", it) }
            put("expires_at_ms", tokens.expiresAtMs)
        }
        prefs(context).edit().putString(tokensKey(server), json.toString()).apply()
    }

    fun tokens(context: Context, server: String): StoredTokens? {
        val raw = prefs(context).getString(tokensKey(server), null) ?: return null
        return runCatching {
            val o = JSONObject(raw)
            StoredTokens(
                accessToken = o.getString("access_token"),
                refreshToken = o.optString("refresh_token", "").ifBlank { null },
                expiresAtMs = o.optLong("expires_at_ms", 0L),
            )
        }.onFailure { AppLogger.warning(TAG, "corrupt tokens for $server: ${it.message}") }
            .getOrNull()
    }

    fun isAuthorized(context: Context, server: String): Boolean =
        tokens(context, server)?.accessToken?.isNotEmpty() == true

    /** Forget issued tokens but keep the client secret (sign out, re-auth later). */
    fun signOut(context: Context, server: String) {
        prefs(context).edit().remove(tokensKey(server)).apply()
    }

    /** Forget everything for a server — tokens AND client secret (server deleted). */
    fun purge(context: Context, server: String) {
        prefs(context).edit().remove(tokensKey(server)).remove(secretKey(server)).apply()
    }
}
