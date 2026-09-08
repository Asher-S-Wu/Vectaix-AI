package com.openminis.app.provider

import android.content.Context
import android.util.Log
import com.openminis.app.data.model.LLMModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Fetches and caches the models.dev provider registry.
 * Used as a fallback when a provider's /v1/models endpoint is unavailable,
 * and as the source of truth for model capabilities (context window, output limit, reasoning).
 *
 * Three-tier cache: in-memory → disk cache → bundled asset fallback.
 */
object ModelsDevApi {
    private const val TAG = "ModelsDevApi"
    private const val SOURCE_URL = "https://models.dev/api.json"
    private const val CACHE_TTL_MS = 48 * 3600 * 1000L // 48 hours

    // Provider-key mapping for enrichment lookups (matches iOS)
    private val providerKeyMap = mapOf(
        "Anthropic" to listOf("anthropic"),
        "Google" to listOf("google", "google-vertex"),
        "OpenAI" to listOf("openai"),
        "OpenRouter" to listOf("openrouter"),
        "Antigravity" to emptyList(), // Custom proxy, no public models.dev entry
    )

    private var cachedRegistry: Map<String, ProviderEntry>? = null
    private var cacheTimestamp: Long = 0L
    private val isRefreshing = AtomicBoolean(false)
    private var appContext: Context? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Must be called once at app startup with application context. */
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    // MARK: - Public: Fetch models by base URL (fallback)

    fun fetchModels(forBaseURL: String): List<LLMModel> {
        val registry = loadRegistry() ?: return emptyList()

        // Phase 1: Exact API base match (with/without /v1)
        val candidates = normalizedCandidates(forBaseURL)
        for ((_, provider) in registry) {
            val api = provider.api ?: continue
            if (api.isEmpty()) continue
            val normalizedAPI = stripTrailingSlash(api)
            for (candidate in candidates) {
                if (candidate == normalizedAPI) {
                    val models = buildModels(provider)
                    Log.d(TAG, "Exact match ${provider.id} (api=$api) — ${models.size} models")
                    return models
                }
            }
        }

        // Phase 2: Hostname fallback
        val inputHost = extractHost(forBaseURL)
        if (inputHost != null) {
            for ((_, provider) in registry) {
                val api = provider.api ?: continue
                val providerHost = extractHost(api) ?: continue
                if (inputHost == providerHost) {
                    val models = buildModels(provider)
                    Log.d(TAG, "Host match ${provider.id} (host=$providerHost) — ${models.size} models")
                    return models
                }
            }
        }

        Log.d(TAG, "No models.dev match for base URL: $forBaseURL")
        return emptyList()
    }

    // MARK: - Public: Enrich models with models.dev data

    fun enrichModel(model: LLMModel): LLMModel {
        val registry = loadRegistry() ?: return model

        // Try mapped provider keys first
        val keys = providerKeyMap[model.provider] ?: emptyList()
        for (key in keys) {
            val prov = registry[key] ?: continue
            val devModel = prov.models[model.id] ?: continue
            return applyDevData(model, devModel)
        }

        // Fallback: scan all providers for the model ID
        for ((_, prov) in registry) {
            val devModel = prov.models[model.id] ?: continue
            return applyDevData(model, devModel)
        }

        return model
    }

    fun enrichModels(models: List<LLMModel>): List<LLMModel> {
        val registry = loadRegistry() ?: return models
        return models.map { model ->
            val keys = providerKeyMap[model.provider] ?: emptyList()
            for (key in keys) {
                val prov = registry[key] ?: continue
                val devModel = prov.models[model.id] ?: continue
                return@map applyDevData(model, devModel)
            }
            // Fallback scan: the same model id is published by many providers
            // (e.g. `glm-5.2` appears under 19), and a custom relay's provider
            // name matches none of them, so this scan is what third-party
            // gateways actually hit.
            //
            // [T-reasoning-effort-data-driven] Map iteration order is not a
            // stable contract, and these entries disagree on capabilities: 17 of
            // the 19 `glm-5.2` entries declare effort tiers, 2 declare none.
            // Sort by key for a stable pick and prefer an entry that carries
            // reasoning metadata, so the richer declaration wins over a sparser
            // duplicate. Mirrors iOS ModelsDevAPI.enrichModels.
            val candidates = registry.keys.sorted().mapNotNull { registry[it]?.models?.get(model.id) }
            val best = candidates.firstOrNull { !it.reasoningEffortValues.isNullOrEmpty() }
                ?: candidates.firstOrNull()
            if (best != null) return@map applyDevData(model, best)
            model
        }
    }

    // MARK: - Apply models.dev data

    private fun applyDevData(model: LLMModel, devModel: ModelDevEntry): LLMModel {
        return model.copy(
            contextWindow = devModel.contextWindow ?: model.contextWindow,
            maxOutputTokens = devModel.maxOutputTokens ?: model.maxOutputTokens,
            supportsReasoning = devModel.reasoning ?: model.supportsReasoning,
            interleavedReasoningField = devModel.interleavedField ?: model.interleavedReasoningField,
            inputModalities = devModel.inputModalities ?: model.inputModalities,
            outputModalities = devModel.outputModalities ?: model.outputModalities,
            reasoningEffortValues = devModel.reasoningEffortValues ?: model.reasoningEffortValues,
            // [OpenMinis#163] Only carry the AFFIRMATIVE answer forward, so
            // enriching against an entry the catalog is silent about cannot
            // overwrite a prior real answer with a meaningless `false`.
            declaresNoEffortTiers = if (devModel.declaresNoEffortTiers) true else model.declaresNoEffortTiers,
        )
    }

    // MARK: - Build models from provider entry

    private fun buildModels(provider: ProviderEntry): List<LLMModel> {
        return provider.models.values.mapNotNull { model ->
            val family = model.family?.lowercase() ?: ""
            if (family.contains("embedding") || family.contains("moderation")) return@mapNotNull null
            LLMModel(
                id = model.id,
                displayName = model.name ?: model.id,
                provider = provider.name ?: provider.id,
                contextWindow = model.contextWindow,
                maxOutputTokens = model.maxOutputTokens,
                supportsReasoning = model.reasoning,
                interleavedReasoningField = model.interleavedField,
                inputModalities = model.inputModalities,
                outputModalities = model.outputModalities,
                reasoningEffortValues = model.reasoningEffortValues,
                // [OpenMinis#163] null (not false) when the catalog is silent,
                // so "unknown" stays distinguishable from "declared none".
                declaresNoEffortTiers = if (model.declaresNoEffortTiers) true else null,
            )
        }
    }

    // MARK: - URL Matching Helpers

    private fun normalizedCandidates(url: String): List<String> {
        val stripped = stripTrailingSlash(url)
        val results = mutableListOf(stripped)
        if (stripped.endsWith("/v1")) {
            results.add(stripped.dropLast(3))
        } else {
            results.add("$stripped/v1")
        }
        return results
    }

    private fun stripTrailingSlash(s: String): String {
        var r = s
        while (r.endsWith("/")) r = r.dropLast(1)
        return r
    }

    private fun extractHost(urlString: String): String? {
        return try {
            URL(stripTrailingSlash(urlString)).host?.lowercase()
        } catch (_: Exception) {
            null
        }
    }

    // MARK: - Registry Cache (3-tier)

    /**
     * [T-model-release-ranking] Read-only view of the loaded catalog, for
     * [ModelReleaseIndex] to build its ranking tables from. Returns an empty map
     * rather than null so callers can't accidentally treat "catalog unavailable"
     * as an error state — an absent catalog just means nothing gets a rank and
     * every model keeps its fallback ordering.
     */
    fun registrySnapshot(): Map<String, ProviderEntry> = loadRegistry() ?: emptyMap()

    @Synchronized
    private fun loadRegistry(): Map<String, ProviderEntry>? {
        // 1. In-memory cache (fresh)
        val cached = cachedRegistry
        if (cached != null && System.currentTimeMillis() - cacheTimestamp < CACHE_TTL_MS) {
            return cached
        }

        // 2. In-memory cache exists but stale — return it, schedule refresh
        if (cached != null) {
            scheduleBackgroundRefresh()
            return cached
        }

        // 3. Disk cache
        val diskResult = loadDiskCache()
        if (diskResult != null) {
            val (parsed, diskDate) = diskResult
            cachedRegistry = parsed
            cacheTimestamp = diskDate
            if (System.currentTimeMillis() - diskDate >= CACHE_TTL_MS) {
                scheduleBackgroundRefresh()
            }
            return parsed
        }

        // 4. Bundled fallback
        val bundled = loadBundledRegistry()
        if (bundled != null) {
            cachedRegistry = bundled
            cacheTimestamp = System.currentTimeMillis()
            scheduleBackgroundRefresh()
            return bundled
        }

        return null
    }

    private fun scheduleBackgroundRefresh() {
        if (!isRefreshing.compareAndSet(false, true)) return
        Thread {
            try {
                refreshFromNetwork()
            } finally {
                isRefreshing.set(false)
            }
        }.apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
            start()
        }
    }

    private fun refreshFromNetwork() {
        try {
            val request = Request.Builder().url(SOURCE_URL).build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                Log.e(TAG, "models.dev HTTP error: ${response.code}")
                response.close()
                return
            }
            val body = response.body?.string() ?: return
            response.close()

            val parsed = parseRegistry(body)
            if (parsed != null) {
                synchronized(this) {
                    cachedRegistry = parsed
                    cacheTimestamp = System.currentTimeMillis()
                }
                saveDiskCache(body)
                Log.d(TAG, "Background-refreshed models.dev registry: ${parsed.size} providers")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch models.dev: ${e.message}")
        }
    }

    // MARK: - Parse registry JSON

    private fun parseRegistry(jsonStr: String): Map<String, ProviderEntry>? {
        return try {
            val json = JSONObject(jsonStr)
            val result = mutableMapOf<String, ProviderEntry>()
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val provObj = json.optJSONObject(key) ?: continue
                val entry = parseProviderEntry(key, provObj) ?: continue
                result[key] = entry
            }
            if (result.isEmpty()) null else result
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse models.dev JSON: ${e.message}")
            null
        }
    }

    private fun parseProviderEntry(id: String, obj: JSONObject): ProviderEntry? {
        val name = obj.optString("name", "").ifEmpty { null }
        val api = obj.optString("api", "").ifEmpty { null }
        val modelsObj = obj.optJSONObject("models") ?: return ProviderEntry(id, name, api, emptyMap())

        val models = mutableMapOf<String, ModelDevEntry>()
        val modelKeys = modelsObj.keys()
        while (modelKeys.hasNext()) {
            val modelKey = modelKeys.next()
            val modelObj = modelsObj.optJSONObject(modelKey) ?: continue
            models[modelKey] = parseModelDevEntry(modelKey, modelObj)
        }
        return ProviderEntry(id, name, api, models)
    }

    private fun parseModelDevEntry(id: String, obj: JSONObject): ModelDevEntry {
        val name = obj.optString("name", "").ifEmpty { null }
        val family = obj.optString("family", "").ifEmpty { null }

        // Parse limits
        val limitObj = obj.optJSONObject("limit")
        val contextWindow = limitObj?.optInt("context", 0)?.takeIf { it > 0 }
        val maxOutputTokens = limitObj?.optInt("output", 0)?.takeIf { it > 0 }

        // Parse reasoning
        val reasoning = if (obj.has("reasoning")) obj.optBoolean("reasoning") else null

        // Parse interleaved (can be bool or object {"field": "reasoning_content"})
        var interleavedField: String? = null
        if (obj.has("interleaved")) {
            val interleaved = obj.opt("interleaved")
            when (interleaved) {
                is JSONObject -> interleavedField = interleaved.optString("field", "").ifEmpty { null }
                is Boolean -> if (interleaved) interleavedField = "reasoning_content"
                true -> interleavedField = "reasoning_content" // JSON true
            }
        }

        // Parse modalities.input / modalities.output arrays
        val modalitiesObj = obj.optJSONObject("modalities")
        fun parseArray(key: String): List<String>? {
            val arr = modalitiesObj?.optJSONArray(key) ?: return null
            val out = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                arr.optString(i, "").takeIf { it.isNotEmpty() }?.let(out::add)
            }
            return out.takeIf { it.isNotEmpty() }
        }
        val inputModalities = parseArray("input")
        val outputModalities = parseArray("output")

        // [T-reasoning-effort-data-driven] reasoning_options is an array of
        // {type, values?, min?, max?}; pick the `effort` entry's values.
        var reasoningEffortValues: List<String>? = null
        val reasoningOptions = obj.optJSONArray("reasoning_options")
        reasoningOptions?.let { arr ->
            for (i in 0 until arr.length()) {
                val opt = arr.optJSONObject(i) ?: continue
                if (opt.optString("type") != "effort") continue
                val vals = opt.optJSONArray("values") ?: continue
                val out = mutableListOf<String>()
                for (j in 0 until vals.length()) {
                    vals.optString(j, "").takeIf { it.isNotEmpty() }?.let { out.add(it.lowercase()) }
                }
                reasoningEffortValues = out.takeIf { it.isNotEmpty() }
                break
            }
        }
        // [OpenMinis#163] The catalog AFFIRMATIVELY says this model has no
        // effort tiers, as opposed to saying nothing at all. reasoningEffortValues
        // collapses both to null, losing the difference that matters on the wire:
        //   • reasoning_options absent → no opinion. Stay permissive and keep
        //     sending reasoning_effort; relays serve models the catalog has
        //     never heard of.
        //   • reasoning_options PRESENT but with no usable `effort` entry ([],
        //     or an effort entry whose values are empty) → the model reasons
        //     WITHOUT an effort parameter. Sending it is a hard 400: xAI
        //     grok-build-0.1 and grok-4.20-0309-reasoning both ship
        //     "reasoning": true with "reasoning_options": [].
        // Deliberately keyed on "no usable effort entry" rather than
        // "reasoning_options is empty", so a model declaring only toggle /
        // budget_tokens — also affirmatively not effort-controlled — counts.
        val declaresNoEffortTiers = reasoningOptions != null && reasoningEffortValues == null

        return ModelDevEntry(
            id = id,
            name = name,
            family = family,
            contextWindow = contextWindow,
            maxOutputTokens = maxOutputTokens,
            reasoning = reasoning,
            interleavedField = interleavedField,
            inputModalities = inputModalities,
            outputModalities = outputModalities,
            reasoningEffortValues = reasoningEffortValues,
            declaresNoEffortTiers = declaresNoEffortTiers,
            releaseDate = obj.optString("release_date", "").ifEmpty { null },
            outputCost = obj.optJSONObject("cost")
                ?.optDouble("output", Double.NaN)
                ?.takeIf { !it.isNaN() },
        )
    }

    // MARK: - Bundled Fallback

    private fun loadBundledRegistry(): Map<String, ProviderEntry>? {
        val ctx = appContext ?: return null
        return try {
            val jsonStr = ctx.assets.open("models-dev-api.json").bufferedReader().readText()
            val parsed = parseRegistry(jsonStr)
            Log.d(TAG, "Loaded bundled models.dev registry: ${parsed?.size ?: 0} providers")
            parsed
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load bundled models-dev-api.json: ${e.message}")
            null
        }
    }

    // MARK: - Disk Cache

    private fun getCacheFile(): File? {
        val ctx = appContext ?: return null
        val dir = File(ctx.cacheDir, "models-dev-cache")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "api.json")
    }

    private fun loadDiskCache(): Pair<Map<String, ProviderEntry>, Long>? {
        val file = getCacheFile() ?: return null
        if (!file.exists()) return null
        return try {
            val jsonStr = file.readText()
            val parsed = parseRegistry(jsonStr) ?: return null
            Pair(parsed, file.lastModified())
        } catch (_: Exception) {
            null
        }
    }

    private fun saveDiskCache(jsonStr: String) {
        val file = getCacheFile() ?: return
        try {
            file.writeText(jsonStr)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save disk cache: ${e.message}")
        }
    }

    // MARK: - Data classes

    data class ProviderEntry(
        val id: String,
        val name: String?,
        val api: String?,
        val models: Map<String, ModelDevEntry>,
    )

    data class ModelDevEntry(
        val id: String,
        val name: String?,
        val family: String?,
        val contextWindow: Int?,
        val maxOutputTokens: Int?,
        val reasoning: Boolean?,
        val interleavedField: String?,
        // modalities.input / modalities.output from models.dev (e.g. ["text","image"]).
        val inputModalities: List<String>?,
        val outputModalities: List<String>?,
        // [T-reasoning-effort-data-driven] `values` of the reasoning_options
        // entry whose type == "effort"; null when the model declares only
        // toggle / budget_tokens (different mechanisms, not effort control).
        val reasoningEffortValues: List<String>?,
        // [OpenMinis#163] True when reasoning_options was PRESENT but declared
        // no usable effort tier — "reasons, but takes no reasoning_effort".
        // Distinct from reasoningEffortValues == null, which also covers "the
        // catalog has never heard of this model"; only this affirmative case
        // may suppress the field.
        val declaresNoEffortTiers: Boolean = false,
        // [T-model-release-ranking] Raw `release_date`. models.dev fills this
        // for every entry, but 181 of them carry `YYYY-MM` with no day — the
        // parser must tolerate that or those models sink in every sorted list.
        val releaseDate: String?,
        // [T-model-release-ranking] USD per million output tokens. Tie-breaker
        // for same-day releases: sol/terra/luna all shipped 2026-07-09 and only
        // price (30 / 12 / 1.2) separates their tiers.
        val outputCost: Double?,
    )
}
