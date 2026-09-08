package com.openminis.app.auth

import org.json.JSONObject

/**
 * [T-kimi-oauth] Pure RFC 8628 Device Authorization Grant logic for Kimi Code
 * — request/response parsing and poll classification, no network, no Android
 * dependencies beyond org.json. Mirrors iOS `KimiDeviceFlow.swift` so the two
 * platforms stay behavior-identical; unit-tested in KimiDeviceFlowTest.
 *
 * Wire facts verified against the live endpoint (2026-07-23, iOS):
 * - Bodies MUST be application/x-www-form-urlencoded. A JSON body makes the
 *   server report `client_id is required` (HTTP 400).
 * - Do NOT send a `scope` field — any explicit scope is rejected with
 *   `invalid_scope` for this client. Omit it entirely.
 */
object KimiDeviceFlow {

    const val AUTH_HOST = "https://auth.kimi.com"
    const val DEVICE_AUTHORIZATION_URL = "$AUTH_HOST/api/oauth/device_authorization"
    const val TOKEN_URL = "$AUTH_HOST/api/oauth/token"

    /** Default coding API base; the provider layer appends `/v1` (the real
     *  endpoints are `/coding/v1/chat/completions`, `/coding/v1/models` —
     *  `/coding/chat/completions` 404s). */
    const val CODING_API_BASE = "https://api.kimi.com/coding"

    data class DeviceAuthorization(
        val deviceCode: String,
        val userCode: String,
        val verificationUri: String,
        val verificationUriComplete: String?,
        /** Seconds until the device code expires. Server default fallback 900. */
        val expiresInSeconds: Long,
        /** Poll interval in seconds. Server default fallback 5. */
        val intervalSeconds: Long,
    ) {
        /** URL to open for the user — prefers the pre-filled complete URL. */
        val openUrl: String get() = verificationUriComplete ?: verificationUri
    }

    /**
     * Parse a device_authorization response. Returns null when any REQUIRED
     * field (device_code / user_code / a verification URI) is missing —
     * caller surfaces a provider error. Accepts both `verification_uri` and
     * `verification_url` spellings (iOS parity).
     */
    fun parseDeviceAuthorization(json: JSONObject): DeviceAuthorization? {
        val deviceCode = json.optString("device_code", "").ifEmpty { return null }
        val userCode = json.optString("user_code", "").ifEmpty { return null }
        val uri = json.optString("verification_uri", "")
            .ifEmpty { json.optString("verification_url", "") }
            .ifEmpty { return null }
        val uriComplete = json.optString("verification_uri_complete", "")
            .ifEmpty { json.optString("verification_url_complete", "") }
            .ifEmpty { null }
        return DeviceAuthorization(
            deviceCode = deviceCode,
            userCode = userCode,
            verificationUri = uri,
            verificationUriComplete = uriComplete,
            expiresInSeconds = json.optLong("expires_in", 0).takeIf { it > 0 } ?: 900L,
            intervalSeconds = json.optLong("interval", 0).takeIf { it > 0 } ?: 5L,
        )
    }

    /** Classification of one token-endpoint poll. */
    sealed class PollResult {
        data class Success(
            val accessToken: String,
            val refreshToken: String?,
            val expiresInSeconds: Long?,
        ) : PollResult()

        /** authorization_pending — keep polling at the current interval. */
        object Pending : PollResult()

        /** slow_down — keep polling, interval += 5s (RFC 8628 §3.5). */
        object SlowDown : PollResult()

        /** Terminal failures. */
        data class Denied(val description: String) : PollResult()
        data class Expired(val description: String) : PollResult()
        data class Fatal(val description: String) : PollResult()
    }

    /**
     * Classify a token-endpoint poll response. Success is 2xx with an
     * access_token; pending/slow_down arrive as OAuth errors (non-2xx) with
     * an `error` field.
     */
    fun classifyPoll(json: JSONObject, httpOK: Boolean): PollResult {
        if (httpOK) {
            val access = json.optString("access_token", "")
            if (access.isNotEmpty()) {
                return PollResult.Success(
                    accessToken = access,
                    refreshToken = json.optString("refresh_token", "").ifEmpty { null },
                    expiresInSeconds = json.optLong("expires_in", 0).takeIf { it > 0 },
                )
            }
        }
        val error = json.optString("error", "").lowercase().ifEmpty { "unknown_error" }
        val description = json.optString("error_description", "").ifEmpty { error }
        return when (error) {
            "authorization_pending" -> PollResult.Pending
            "slow_down" -> PollResult.SlowDown
            "access_denied" -> PollResult.Denied(description)
            "expired_token" -> PollResult.Expired(description)
            else -> PollResult.Fatal(description)
        }
    }

    /** RFC 8628 slow_down: bump the running interval by a fixed 5 seconds. */
    fun bumpedInterval(currentSeconds: Long): Long = currentSeconds + 5

    /**
     * [T-oauth-refresh-race] Compare-before-delete decision after a refresh
     * classified as INVALID_GRANT (iOS 36d506ca): deleting is only correct
     * when the persisted refresh token is STILL the one this failed request
     * used. If a concurrent refresh already rotated it, the "invalid grant"
     * is stale — the new credentials must be kept or the freshly-won login
     * is destroyed ("signed out ~45 min after signing in" bug class).
     *
     * @param staleRefreshToken the refresh token the FAILED request sent
     * @param currentStoredRefreshToken the refresh token persisted right now
     * @return true if credentials should be deleted, false to keep them
     */
    fun shouldDeleteAfterInvalidGrant(
        staleRefreshToken: String,
        currentStoredRefreshToken: String?,
    ): Boolean {
        val current = currentStoredRefreshToken ?: return true
        return current == staleRefreshToken
    }
}
