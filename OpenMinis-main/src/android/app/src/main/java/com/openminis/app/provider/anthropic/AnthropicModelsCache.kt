package com.openminis.app.provider.anthropic

import android.content.Context
import com.openminis.app.data.model.LLMModel
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest

/**
 * On-disk cache for `/v1/models` results, keyed by a SHA-256 hash of the
 * credential so the raw API key / OAuth token never lands in the cache file
 * name. Mirrors iOS `ModelsCache` (AnthropicModelsAPI.swift): 7-day TTL,
 * `context.cacheDir/models-cache/<hash>.json`.
 */
internal object AnthropicModelsCache {
    private const val TTL_MS = 7L * 24 * 3600 * 1000
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Serializable
    private data class CacheEntry(val models: List<LLMModel>, val savedAt: Long)

    private fun cacheDir(context: Context): File =
        File(context.cacheDir, "models-cache").apply { mkdirs() }

    private fun keyFile(context: Context, credential: String): File {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(credential.toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }
        return File(cacheDir(context), "$hex.json")
    }

    /** Load cached models if the entry is fresh (<7d). Returns null otherwise. */
    fun load(context: Context, credential: String): List<LLMModel>? {
        val file = keyFile(context, credential)
        if (!file.isFile) return null
        val entry = runCatching { json.decodeFromString<CacheEntry>(file.readText()) }
            .getOrNull() ?: return null
        if (System.currentTimeMillis() - entry.savedAt > TTL_MS) return null
        return entry.models
    }

    /** Persist models for next lookup. Silently drops write errors — cache is advisory. */
    fun save(context: Context, credential: String, models: List<LLMModel>) {
        val file = keyFile(context, credential)
        runCatching {
            file.writeText(json.encodeToString(CacheEntry(models, System.currentTimeMillis())))
        }
    }

    /** Drop the cache file for [credential]. Used on auth failure to avoid stale data. */
    fun invalidate(context: Context, credential: String) {
        runCatching { keyFile(context, credential).delete() }
    }
}
