package com.openminis.app.provider

import com.openminis.app.BuildConfig
import okhttp3.Request

/**
 * [T-provider-custom-user-agent] Single chokepoint for the per-provider
 * User-Agent override. Each provider/models-api request builder calls this
 * right before `.build()`, so the "null/blank → fall back, non-blank →
 * replace" rule lives in exactly one place.
 *
 * `.header(...)` replaces any value the builder set earlier (e.g. the Codex
 * `codex_cli_rs/...` UA or the Anthropic OAuth `claude-cli/...` UA), so a
 * non-blank override wins over the provider default.
 *
 * **Fallback policy (T-android-default-ua):** when `customUserAgent` is
 * null/blank, we now apply [MinisUserAgent.DEFAULT] instead of leaving
 * the builder UA-less (which lets OkHttp insert its own `okhttp/4.12.0`).
 * The default carries the Minis version so request logs upstream can be
 * traced back to the app build that issued them — matching the
 * "branded UA except where a specific client identity is required"
 * intent of the feature.
 *
 * Callers that issue requests under a SPECIFIC client identity (Codex
 * OAuth's `codex_cli_rs/...`, Anthropic OAuth's `claude-cli/...`) MUST
 * pass `defaultUserAgent = null` so this helper leaves their previously-
 * set UA header alone. Everywhere else the default takes effect.
 */
fun Request.Builder.applyUserAgentOverride(
    customUserAgent: String?,
    defaultUserAgent: String? = MinisUserAgent.DEFAULT,
): Request.Builder {
    val ua = customUserAgent?.trim()
    when {
        !ua.isNullOrEmpty() -> header("User-Agent", ua)
        defaultUserAgent != null -> header("User-Agent", defaultUserAgent)
        // else: leave whatever UA the builder already had (preserves
        // Codex / Claude CLI fingerprints on OAuth paths).
    }
    return this
}

/**
 * [T-android-default-ua] Branded User-Agent used by every Minis-originated
 * outbound request that doesn't have a SDK-specific UA requirement.
 *
 * Format mirrors iOS exactly:
 *   `Minis/<version> (Android <release>; <model>)`
 *
 * e.g. `Minis/0.14-preview (Android 13; Pixel 4a)` — same shape as iOS's
 * `Minis/1.10 (iOS 26.5; iPhone)`.
 *
 * Version comes from BuildConfig (auto-tracks every release). OS release
 * from `Build.VERSION.RELEASE` (the marketing version a user recognises;
 * the API-level SDK_INT is omitted for parity with iOS, which doesn't
 * carry a sibling axis). Model is `Build.MODEL` — already broadcast by
 * default OkHttp UAs, useful for device-specific diagnosis without
 * de-anonymising the user further.
 *
 * Built lazily — only the first request constructs the string, so the
 * `Build.*` reads (cheap but JNI-bound) don't cost startup time.
 */
object MinisUserAgent {
    val DEFAULT: String by lazy {
        val release = android.os.Build.VERSION.RELEASE ?: "unknown"
        val model = (android.os.Build.MODEL ?: "unknown").trim().ifEmpty { "unknown" }
        "Minis/${BuildConfig.VERSION_NAME} (Android $release; $model)"
    }
}
