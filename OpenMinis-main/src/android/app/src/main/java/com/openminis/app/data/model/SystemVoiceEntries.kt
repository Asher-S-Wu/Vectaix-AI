package com.openminis.app.data.model

/**
 * [T-android-provider-voice] Virtual System voice entries — Android port of
 * iOS UnifiedModelPicker's ModelEntry.systemASROnline / systemASROffline /
 * systemTTS extensions. These are NOT persisted in config.modelEntries: they
 * are synthesized on demand so voice group members like
 * "__builtin_system_speech__/system-asr-online" resolve to a real-looking
 * entry in pickers and group detail instead of rendering as a stale member.
 *
 * uuid is the composite "<sentinel>/<model-id>" — exactly the member id shape
 * ensureDefaultVoiceInputGroup/-OutputGroup write (and the shape iOS
 * ModelEntry.id produces), so `entry.id == memberId` holds everywhere.
 */
object SystemVoiceEntries {

    /** System ASR — Online (server-based). Higher accuracy, needs network. */
    val asrOnline = ModelEntry(
        providerInstanceId = SystemVoiceIds.BUILTIN_PROVIDER_ID,
        baseModel = LLMModel(
            id = SystemVoiceIds.SYSTEM_ASR_ONLINE,
            displayName = "System Recognition (Online)",
            provider = "system",
            inputModalities = listOf("audio"),
        ),
        isHidden = true,
        uuid = "${SystemVoiceIds.BUILTIN_PROVIDER_ID}/${SystemVoiceIds.SYSTEM_ASR_ONLINE}",
    )

    /** System ASR — Offline (on-device). No rate limits; audio stays local. */
    val asrOffline = ModelEntry(
        providerInstanceId = SystemVoiceIds.BUILTIN_PROVIDER_ID,
        baseModel = LLMModel(
            id = SystemVoiceIds.SYSTEM_ASR_OFFLINE,
            displayName = "System Recognition (Offline)",
            provider = "system",
            inputModalities = listOf("audio"),
        ),
        isHidden = true,
        uuid = "${SystemVoiceIds.BUILTIN_PROVIDER_ID}/${SystemVoiceIds.SYSTEM_ASR_OFFLINE}",
    )

    /** System TTS — best installed voice per reply language. */
    val tts = ModelEntry(
        providerInstanceId = SystemVoiceIds.BUILTIN_PROVIDER_ID,
        baseModel = LLMModel(
            id = SystemVoiceIds.SYSTEM_TTS,
            displayName = "System Voice (Auto)",
            provider = "system",
            outputModalities = listOf("audio"),
        ),
        isHidden = true,
        uuid = "${SystemVoiceIds.BUILTIN_PROVIDER_ID}/${SystemVoiceIds.SYSTEM_TTS}",
    )

    val all: List<ModelEntry> = listOf(asrOnline, asrOffline, tts)

    /** Resolve a group member id to a virtual system entry, or null. */
    fun resolve(memberId: String): ModelEntry? = all.find { it.id == memberId }

    fun isSystemEntryId(id: String): Boolean =
        id.startsWith(SystemVoiceIds.BUILTIN_PROVIDER_ID)

    /**
     * Synthetic instance for pickers that group entries by provider — gives
     * the virtual entries a "System" section header. Never persisted.
     */
    // Label resolved by the caller (Composable) via stringResource so the
    // built-in provider name localizes like iOS's String(localized: "System").
    fun syntheticInstance(label: String = "System") = ProviderInstance(
        id = SystemVoiceIds.BUILTIN_PROVIDER_ID,
        label = label,
        providerType = ProviderType.openAI,
        credentialType = ProviderCredential.apiKey,
        isEnabled = true,
    )
}
