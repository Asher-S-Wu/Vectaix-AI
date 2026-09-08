package com.openminis.app.auth

import android.content.Context
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Antigravity OAuth manager — mirrors iOS `AntigravityOAuthManager`.
 *
 * Antigravity is Google's experimental "Cloud Code Assist" proxy that routes
 * Claude / Gemini / GPT models through a Gemini-format request envelope. It
 * reuses Google's OAuth endpoints but with its own client_id + client_secret
 * and two extra scopes (`cclog`, `experimentsandconfigs`), and runs a local
 * HTTP callback on port 8086 (distinct from Gemini's 8085 so the two can
 * coexist).
 *
 * **Scaffolding only** — this file captures the OAuth constants and project
 * discovery flow so the provider layer can consume them. Actual request
 * dispatch (the `AntigravityProvider` + `AntigravityAgentProvider` pair from
 * iOS) is not wired yet; when it lands it will reuse
 * [activeBaseURL] + [gcpProjectId] persisted here.
 */
class AntigravityOAuthManager(context: Context, instanceId: String) : OAuthManager(context, instanceId) {
    companion object {
        private const val TAG = "AntigravityOAuth"
        private const val USER_AGENT = "antigravity/1.107.0 android/aarch64"

        /**
         * Candidate Cloud Code Assist base URLs, probed in order on login.
         * `daily-cloudcode-pa` is the preview / daily release channel; the
         * public `cloudcode-pa` is the fallback. Matches iOS
         * `AntigravityOAuthManager.cloudCodeBaseURLs`.
         */
        val cloudCodeBaseURLs = listOf(
            "https://daily-cloudcode-pa.sandbox.googleapis.com",
            "https://cloudcode-pa.googleapis.com",
        )
    }

    override val authURL = "https://accounts.google.com/o/oauth2/v2/auth"
    override val tokenURL = "https://oauth2.googleapis.com/token"
    override val clientId = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
    // Placeholder. Google OAuth requires a client secret alongside the
    // client id; supply your own from Google Cloud Console to use this
    // sign-in. API-key providers are unaffected.
    override val clientSecret = "GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxx"
    override val callbackPort = 8086
    override val redirectPath = "/oauth2callback"
    override val scopes = listOf(
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/cclog",
        "https://www.googleapis.com/auth/experimentsandconfigs",
    ).joinToString(" ")

    override fun buildAuthorizationUrl(): String {
        val (_, challenge) = generateHexPKCE()
        val state = generateState()
        return "$authURL?" + listOf(
            "client_id=$clientId",
            "redirect_uri=${Uri.encode(redirectUri)}",
            "response_type=code",
            "scope=${Uri.encode(scopes)}",
            "state=$state",
            "code_challenge=$challenge",
            "code_challenge_method=S256",
            "access_type=offline",
            "prompt=consent",
        ).joinToString("&")
    }

    /** Cached user email from Google userinfo. */
    var email: String?
        get() = loadOAuthString("email")
        private set(value) { value?.let { saveOAuthString("email", it) } }

    /** GCP project ID discovered via Cloud Code Assist loadCodeAssist. */
    var gcpProjectId: String?
        get() = loadOAuthString("gcp_project")
        private set(value) { value?.let { saveOAuthString("gcp_project", it) } }

    /**
     * Cloud Code Assist base URL that successfully returned the project on
     * login. Subsequent requests pin to this URL so the provider doesn't
     * re-probe the daily/fallback pair on every call.
     */
    var activeBaseURL: String?
        get() = loadOAuthString("base_url")
        private set(value) { value?.let { saveOAuthString("base_url", it) } }

    override suspend fun onTokensReceived(json: JSONObject) {
        fetchUserEmail()
        discoverProjectIfNeeded()
    }

    private suspend fun fetchUserEmail() = withContext(Dispatchers.IO) {
        val token = validAccessToken() ?: return@withContext
        try {
            val conn = URL("https://www.googleapis.com/oauth2/v1/userinfo").openConnection() as HttpURLConnection
            conn.setRequestProperty("Authorization", "Bearer $token")
            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                email = JSONObject(body).optString("email")
            }
            conn.disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch email", e)
        }
    }

    /**
     * Probe each candidate Cloud Code Assist base URL in [cloudCodeBaseURLs]
     * until one returns a project ID. Persists the winning URL in
     * [activeBaseURL] so the provider avoids re-probing.
     */
    suspend fun discoverProjectIfNeeded(): Boolean = withContext(Dispatchers.IO) {
        if (!gcpProjectId.isNullOrEmpty() && !activeBaseURL.isNullOrEmpty()) return@withContext true
        val token = validAccessToken() ?: return@withContext false

        for (baseURL in cloudCodeBaseURLs) {
            val projectId = loadCodeAssist(token, baseURL)
            if (!projectId.isNullOrEmpty()) {
                gcpProjectId = projectId
                activeBaseURL = baseURL
                Log.i(TAG, "Antigravity project discovered via $baseURL")
                return@withContext true
            }
        }
        Log.w(TAG, "Antigravity project discovery failed on all base URLs")
        false
    }

    private fun loadCodeAssist(token: String, baseURL: String): String? {
        return try {
            val req = Request.Builder()
                .url("$baseURL/v1internal:loadCodeAssist")
                .post("{}".toRequestBody("application/json".toMediaType()))
                .header("Authorization", "Bearer $token")
                .header("User-Agent", USER_AGENT)
                .header("X-Client-Name", "antigravity")
                .header("X-Client-Version", "1.107.0")
                .build()
            val response = httpClient.newCall(req).execute()
            val body = if (response.isSuccessful) response.body?.string() else null
            response.close()
            body?.let { JSONObject(it).optString("gcpProjectId").ifEmpty { null } }
        } catch (e: Exception) {
            Log.d(TAG, "loadCodeAssist failed on $baseURL: ${e.message}")
            null
        }
    }
}
