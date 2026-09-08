package com.openminis.app.offload

import com.openminis.app.data.model.ModelEntry
import com.openminis.app.data.model.ProviderInstance
import org.json.JSONArray
import org.json.JSONObject

/**
 * Provides model listing and search capabilities for the model_use tool.
 * Only surfaces the Agent-Loop-visible subset (mirrors iOS
 * ProviderConfigStore.resolvedAgentLoopEntries). Models not exposed in
 * Settings > Model Groups > "Available Models in Agent Loop" are hidden.
 *
 * Output shape mirrors iOS `ModelUseOffloadBridge.entryDict` so the agent
 * sees the same fields on both platforms — most importantly `modalities`,
 * which it needs to pick an image-generation / TTS model.
 */
object ModelUseManager {

    private const val NO_MODELS_HINT =
        "No models available. Go to Settings > Model Groups > Available Models in Agent Loop to expose models to the agent."

    /**
     * List the agent-loop-visible models, optionally filtered by a free-text
     * query that matches against model id, display name, or provider.
     */
    fun listModels(
        entries: List<ModelEntry>,
        instances: Map<String, ProviderInstance> = emptyMap(),
        filter: String? = null,
    ): String {
        val filtered = if (filter.isNullOrBlank()) entries else {
            val q = filter.lowercase()
            entries.filter {
                it.model.id.lowercase().contains(q) ||
                    it.model.displayName.lowercase().contains(q) ||
                    it.model.provider.lowercase().contains(q)
            }
        }

        if (filtered.isEmpty()) {
            return if (filter != null) "No models matching '$filter'."
            else NO_MODELS_HINT
        }

        val result = JSONArray()
        for (entry in filtered) {
            result.put(entryDict(entry, instances[entry.providerInstanceId]))
        }
        return result.toString(2)
    }

    /**
     * Emit the per-entry JSON. Field names match iOS exactly:
     * entry_id, model_id, display_name, provider, instance_label,
     * provider_type, modalities, context_window.
     */
    fun entryDict(entry: ModelEntry, instance: ProviderInstance?): JSONObject {
        // Enrich at read time — entries persisted before the modalities field
        // existed won't have inputModalities/outputModalities populated, so
        // look them up from the bundled models.dev registry on the fly.
        val enrichedModel = com.openminis.app.provider.ModelsDevApi.enrichModel(entry.model)
        val modalities = JSONArray()
        val inputs = enrichedModel.inputModalities.orEmpty()
        val outputs = enrichedModel.outputModalities.orEmpty()
        // Fallback when neither models.dev nor pattern inference populated them —
        // every LLM supports text in/out.
        val inputSet = if (inputs.isEmpty() && outputs.isEmpty()) listOf("text") else inputs
        val outputSet = if (inputs.isEmpty() && outputs.isEmpty()) listOf("text") else outputs
        if ("text" in inputSet) modalities.put("text_input")
        if ("text" in outputSet) modalities.put("text_output")
        if ("image" in inputSet) modalities.put("image_input")
        if ("image" in outputSet) modalities.put("image_output")
        if ("audio" in inputSet) modalities.put("audio_input")
        if ("audio" in outputSet) modalities.put("audio_output")
        if ("video" in inputSet) modalities.put("video_input")
        if ("video" in outputSet) modalities.put("video_output")
        if ("pdf" in inputSet) modalities.put("pdf_input")

        return JSONObject().apply {
            put("entry_id", entry.id)
            put("model_id", entry.model.id)
            put("display_name", entry.model.displayName)
            put("provider", entry.model.provider)
            put("instance_label", instance?.label ?: "unknown")
            put("provider_type", instance?.providerType?.displayName ?: "unknown")
            put("modalities", modalities)
            enrichedModel.contextWindow?.let { put("context_window", it) }
        }
    }
}
