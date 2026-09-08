package com.openminis.app.provider

import android.content.Context
import com.openminis.app.data.model.LLMModel
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest

/**
 * Per-provider disk cache for `/v1/models`-style responses, keyed by a
 * SHA-256 hash of the credential so raw API keys / OAuth tokens never land
 * in cache file names. Mirrors iOS `ModelsCache` (7-day TTL, cacheDir-scoped)
 * but namespaces each provider under its own subdirectory so rotating one
 * credential can't poison another family's cache.
 *
 * Construct once per provider (e.g. `ProviderModelsCache("openrouter")`),
 * then call [load] / [save] / [invalidate] with a credential + optional
 * baseURL in the key.
 */
internal class ProviderModelsCache(
    private val namespace: String,
    private val ttlMs: Long = DEFAULT_TTL_MS,
) {
    @Serializable
    private data class Entry(val models: List<LLMModel>, val savedAt: Long)

    private fun cacheDir(context: Context): File =
        File(context.cacheDir, "models-cache/$namespace").apply { mkdirs() }

    private fun keyFile(context: Context, cacheKey: String): File {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(cacheKey.toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }
        return File(cacheDir(context), "$hex.json")
    }

    fun load(context: Context, cacheKey: String): List<LLMModel>? {
        val file = keyFile(context, cacheKey)
        if (!file.isFile) return null
        val entry = runCatching { JSON.decodeFromString<Entry>(file.readText()) }
            .getOrNull() ?: return null
        if (System.currentTimeMillis() - entry.savedAt > ttlMs) return null
        return entry.models
    }

    fun save(context: Context, cacheKey: String, models: List<LLMModel>) {
        val file = keyFile(context, cacheKey)
        runCatching {
            file.writeText(JSON.encodeToString(Entry(models, System.currentTimeMillis())))
        }
    }

    fun invalidate(context: Context, cacheKey: String) {
        runCatching { keyFile(context, cacheKey).delete() }
    }

    companion object {
        const val DEFAULT_TTL_MS = 7L * 24 * 3600 * 1000
        private val JSON = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    }
}
