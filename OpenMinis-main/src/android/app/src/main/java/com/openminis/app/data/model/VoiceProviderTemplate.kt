package com.openminis.app.data.model

/**
 * [T-android-provider-voice] Voice provider templates — Android port of iOS
 * VoiceProviderTemplate.swift (single source of truth for voice vendors).
 *
 * Voice-specialised vendors (MiniMax / Alibaba / Doubao / iFlytek / MiMo …)
 * are NOT distinct ProviderType cases — they ride on an OpenAI/Anthropic-
 * compatible instance identified by its base URL. A template:
 *   1. Preseeds the Add-Provider flow (underlying type + base URL).
 *   2. Carries mock voice models tagged with the exact single-flag SEED
 *      modality shape (see VoiceModality): ASR seed = inputs ["audio"] only,
 *      TTS seed = outputs ["audio"] only. These vendors have no OpenAI-style
 *      /models endpoint, so addInstance seeds these entries directly. Once
 *      seeded they are ordinary ModelEntry values.
 *
 * `baseURLMarkers` serve TWO narrow roles only: (1) seed the mock voice models
 * at add-time, (2) route voice REQUESTS to the right vendor adapter in
 * VoiceProviderFactory. They never classify an instance as "voice-only" —
 * voice visibility is per-model-modality (shadow view over audio entries).
 *
 * Model ids / display names / base URLs are kept byte-identical to iOS so a
 * config exported on one platform imports losslessly on the other.
 */
data class VoiceProviderTemplate(
    val id: String,
    val name: String,
    val providerType: ProviderType,
    val baseURL: String,
    val appendV1: Boolean,
    /** What the vendor can do — UI localizes the label from this. */
    val capability: Capability,
    val baseURLMarkers: List<String>,
    val mockModels: List<LLMModel>,
    /** Optional caveat surfaced in the UI (extra credentials etc.). */
    val note: String? = null,
) {
    enum class Capability { TTS, ASR, BOTH }

    companion object {
        /** The template whose base-URL markers match [baseURL], if any. */
        fun template(forBaseURL: String?): VoiceProviderTemplate? {
            val base = forBaseURL?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
            return all.firstOrNull { tpl -> tpl.baseURLMarkers.any { base.contains(it) } }
        }

        /** Build the seed ModelEntry list for an instance matching a template. */
        fun mockEntries(instance: ProviderInstance): List<ModelEntry> {
            val tpl = template(instance.customBaseURL) ?: return emptyList()
            return tpl.mockModels.map { ModelEntry(providerInstanceId = instance.id, baseModel = it) }
        }

        private fun tts(id: String, name: String, provider: String) = LLMModel(
            id = id, displayName = name, provider = provider,
            outputModalities = listOf("audio"),
        )

        private fun asr(id: String, name: String, provider: String) = LLMModel(
            id = id, displayName = name, provider = provider,
            inputModalities = listOf("audio"),
        )

        val all: List<VoiceProviderTemplate> = listOf(
            VoiceProviderTemplate(
                id = "elevenlabs",
                name = "ElevenLabs",
                providerType = ProviderType.openAI,
                baseURL = "https://api.elevenlabs.io",
                appendV1 = false,
                capability = Capability.TTS,
                baseURLMarkers = listOf("elevenlabs"),
                mockModels = listOf(
                    // The model `id` is the ElevenLabs voice_id.
                    tts("21m00Tcm4TlvDq8ikWAM", "Rachel (EN, F)", "elevenlabs"),
                    tts("pNInz6obpgDQGcFmaJgB", "Adam (EN, M)", "elevenlabs"),
                    tts("EXAVITQu4vr4xnSDxMaL", "Bella (EN, F)", "elevenlabs"),
                    tts("ErXwobaYiN019PkySvjV", "Antoni (EN, M)", "elevenlabs"),
                ),
            ),
            VoiceProviderTemplate(
                id = "deepgram",
                name = "Deepgram",
                providerType = ProviderType.openAI,
                baseURL = "https://api.deepgram.com",
                appendV1 = false,
                capability = Capability.BOTH,
                baseURLMarkers = listOf("deepgram"),
                mockModels = listOf(
                    asr("nova-2", "Nova-2 (ASR)", "deepgram"),
                    asr("nova-3", "Nova-3 (ASR)", "deepgram"),
                    tts("aura-asteria-en", "Aura Asteria (TTS, EN F)", "deepgram"),
                    tts("aura-luna-en", "Aura Luna (TTS, EN F)", "deepgram"),
                    tts("aura-orion-en", "Aura Orion (TTS, EN M)", "deepgram"),
                ),
            ),
            VoiceProviderTemplate(
                id = "azure-tts",
                name = "Azure TTS",
                providerType = ProviderType.openAI,
                baseURL = "https://eastasia.tts.speech.microsoft.com",
                appendV1 = false,
                capability = Capability.TTS,
                baseURLMarkers = listOf("tts.speech.microsoft.com"),
                mockModels = listOf(
                    // Chinese (Mandarin)
                    tts("zh-CN-XiaoxiaoNeural", "Xiaoxiao (ZH, F)", "azure-tts"),
                    tts("zh-CN-YunxiNeural", "Yunxi (ZH, M)", "azure-tts"),
                    tts("zh-CN-YunyangNeural", "Yunyang (ZH, M)", "azure-tts"),
                    tts("zh-CN-XiaoyiNeural", "Xiaoyi (ZH, F)", "azure-tts"),
                    tts("zh-CN-XiaochenNeural", "Xiaochen (ZH, F)", "azure-tts"),
                    tts("zh-CN-XiaohanNeural", "Xiaohan (ZH, F)", "azure-tts"),
                    tts("zh-CN-XiaomengNeural", "Xiaomeng (ZH, F)", "azure-tts"),
                    tts("zh-CN-XiaomoNeural", "Xiaomo (ZH, F)", "azure-tts"),
                    tts("zh-CN-XiaoruiNeural", "Xiaorui (ZH, F)", "azure-tts"),
                    tts("zh-CN-XiaoshuangNeural", "Xiaoshuang (ZH, F, Child)", "azure-tts"),
                    tts("zh-CN-XiaoyouNeural", "Xiaoyou (ZH, F, Child)", "azure-tts"),
                    tts("zh-CN-XiaozhenNeural", "Xiaozhen (ZH, F)", "azure-tts"),
                    tts("zh-CN-YunfengNeural", "Yunfeng (ZH, M)", "azure-tts"),
                    tts("zh-CN-YunhaoNeural", "Yunhao (ZH, M)", "azure-tts"),
                    tts("zh-CN-YunjianNeural", "Yunjian (ZH, M)", "azure-tts"),
                    tts("zh-CN-YunxiaNeural", "Yunxia (ZH, M)", "azure-tts"),
                    tts("zh-CN-YunyeNeural", "Yunye (ZH, M)", "azure-tts"),
                    tts("zh-CN-YunzeNeural", "Yunze (ZH, M)", "azure-tts"),
                    // Chinese (Cantonese)
                    tts("zh-HK-HiuMaanNeural", "HiuMaan (HK, F)", "azure-tts"),
                    tts("zh-HK-WanLungNeural", "WanLung (HK, M)", "azure-tts"),
                    tts("zh-HK-HiuGaaiNeural", "HiuGaai (HK, F)", "azure-tts"),
                    // Chinese (Taiwanese)
                    tts("zh-TW-HsiaoChenNeural", "HsiaoChen (TW, F)", "azure-tts"),
                    tts("zh-TW-YunJheNeural", "YunJhe (TW, M)", "azure-tts"),
                    tts("zh-TW-HsiaoYuNeural", "HsiaoYu (TW, F)", "azure-tts"),
                    // English (US) — popular picks
                    tts("en-US-JennyNeural", "Jenny (EN, F)", "azure-tts"),
                    tts("en-US-GuyNeural", "Guy (EN, M)", "azure-tts"),
                    tts("en-US-AriaNeural", "Aria (EN, F)", "azure-tts"),
                    tts("en-US-DavisNeural", "Davis (EN, M)", "azure-tts"),
                    tts("en-US-AvaNeural", "Ava (EN, F)", "azure-tts"),
                    tts("en-US-AndrewNeural", "Andrew (EN, M)", "azure-tts"),
                    tts("en-US-EmmaNeural", "Emma (EN, F)", "azure-tts"),
                    tts("en-US-BrianNeural", "Brian (EN, M)", "azure-tts"),
                    // Japanese
                    tts("ja-JP-NanamiNeural", "Nanami (JA, F)", "azure-tts"),
                    tts("ja-JP-KeitaNeural", "Keita (JA, M)", "azure-tts"),
                    tts("ja-JP-AoiNeural", "Aoi (JA, F)", "azure-tts"),
                    tts("ja-JP-DaichiNeural", "Daichi (JA, M)", "azure-tts"),
                    tts("ja-JP-ShioriNeural", "Shiori (JA, F)", "azure-tts"),
                    // Korean
                    tts("ko-KR-SunHiNeural", "SunHi (KO, F)", "azure-tts"),
                    tts("ko-KR-InJoonNeural", "InJoon (KO, M)", "azure-tts"),
                ),
                note = "Enter the Azure Speech Services subscription key. Set the base URL to your region, e.g. https://eastasia.tts.speech.microsoft.com",
            ),
            VoiceProviderTemplate(
                id = "minimax",
                name = "MiniMax",
                providerType = ProviderType.anthropic,
                baseURL = "https://api.minimax.io",
                appendV1 = false,
                capability = Capability.TTS,
                baseURLMarkers = listOf("minimax"),
                mockModels = listOf(
                    tts("speech-2.8-hd", "MiniMax Speech 2.8 HD", "minimax"),
                    tts("speech-2.8-turbo", "MiniMax Speech 2.8 Turbo", "minimax"),
                ),
            ),
            VoiceProviderTemplate(
                id = "alibaba",
                name = "Alibaba Bailian",
                providerType = ProviderType.openAI,
                baseURL = "https://dashscope.aliyuncs.com/compatible-mode",
                appendV1 = true,
                capability = Capability.BOTH,
                baseURLMarkers = listOf("dashscope"),
                mockModels = listOf(
                    asr("paraformer-realtime-v2", "Paraformer Realtime v2", "alibaba"),
                    tts("cosyvoice-v2", "CosyVoice v2", "alibaba"),
                ),
            ),
            VoiceProviderTemplate(
                id = "doubao",
                name = "Doubao (Volcano)",
                providerType = ProviderType.openAI,
                baseURL = "https://openspeech.bytedance.com",
                appendV1 = false,
                capability = Capability.BOTH,
                baseURLMarkers = listOf("openspeech.bytedance", "volcano"),
                mockModels = listOf(
                    asr("bigmodel", "Doubao ASR (bigmodel)", "doubao"),
                    // Seed TTS 2.0 (big model, uranus)
                    tts("zh_female_cancan_uranus_bigtts", "灿灿 (通用, 女)", "doubao"),
                    tts("zh_female_vv_uranus_bigtts", "Vivi (表现力, 女)", "doubao"),
                    tts("zh_male_liufei_uranus_bigtts", "刘飞 (通用, 男)", "doubao"),
                    tts("zh_male_m191_uranus_bigtts", "云舟 (清爽, 男)", "doubao"),
                    // Seed TTS 1.0 (big model, moon)
                    tts("zh_female_shuangkuaisisi_moon_bigtts", "爽快思思 (爽朗, 女)", "doubao"),
                    tts("zh_female_sajiaonvyou_moon_bigtts", "撒娇女友 (撒娇, 女)", "doubao"),
                    tts("zh_female_gaolengyujie_moon_bigtts", "高冷御姐 (御姐, 女)", "doubao"),
                    tts("multi_female_shuangkuaisisi_moon_bigtts", "爽快思思 (多语, 女)", "doubao"),
                ),
                note = "Enter the API Key from the Volcano Engine new console.",
            ),
            VoiceProviderTemplate(
                id = "xunfei",
                name = "iFlytek (Xunfei)",
                providerType = ProviderType.openAI,
                baseURL = "https://iat-api.xfyun.cn",
                appendV1 = false,
                capability = Capability.BOTH,
                baseURLMarkers = listOf("xfyun"),
                mockModels = listOf(
                    asr("iat", "iFlytek IAT (ASR)", "xunfei"),
                    tts("xiaoyan", "讯飞·晓燕 (TTS, 中文女)", "xunfei"),
                    tts("aisjiuxu", "讯飞·许久 (TTS, 中文男)", "xunfei"),
                ),
                note = "iFlytek needs App ID and API Secret — enter them as \"appId;apiKey;apiSecret\" in the API Key field.",
            ),
            VoiceProviderTemplate(
                id = "mimo",
                name = "Xiaomi MiMo",
                providerType = ProviderType.openAI,
                baseURL = "https://api.xiaomimimo.com",
                appendV1 = true,
                capability = Capability.BOTH,
                baseURLMarkers = listOf("xiaomimimo"),
                mockModels = listOf(
                    asr("mimo-v2.5-asr", "MiMo ASR v2.5", "mimo"),
                    tts("mimo_default", "MiMo 默认 (Auto)", "mimo"),
                    tts("冰糖", "冰糖 (中文, 女)", "mimo"),
                    tts("茉莉", "茉莉 (中文, 女)", "mimo"),
                    tts("苏打", "苏打 (中文, 男)", "mimo"),
                    tts("白桦", "白桦 (中文, 男)", "mimo"),
                    tts("Mia", "Mia (EN, F)", "mimo"),
                    tts("Chloe", "Chloe (EN, F)", "mimo"),
                    tts("Milo", "Milo (EN, M)", "mimo"),
                    tts("Dean", "Dean (EN, M)", "mimo"),
                ),
            ),
        )
    }
}
