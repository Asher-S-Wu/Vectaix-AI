import { IMAGE_SIZE_OPTIONS, VIDEO_ASPECT_RATIO_OPTIONS, VIDEO_DURATION_OPTIONS, VIDEO_RESOLUTION_OPTIONS, VIDEO_MODE_OPTIONS } from "@/lib/media/shared/models";
import { MINIMAX_AUDIO_MODELS, MINIMAX_AUDIO_EMOTION_OPTIONS, MINIMAX_AUDIO_LANGUAGE_OPTIONS, MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS } from "@/lib/media/shared/minimaxAudio";

export function mediaSettingsFields(mediaSettings) {
    const options = entries => entries.map(item => ({ value: String(item.id), label: item.label }));
    const off = { value: "", label: "不启用" };
    const qwen = values => values.audioProvider === "qwen";
    const minimax = values => values.audioProvider === "minimax";
    const doubao = values => values.audioProvider === "doubao";
    return [
      { name: "imageSize", label: "图片生成", type: "select", value: mediaSettings.image?.size || "", options: [off, ...options(IMAGE_SIZE_OPTIONS)] },
      { name: "audioProvider", label: "配音供应商", type: "select", value: mediaSettings.audio?.provider || "", options: [off, { value: "qwen", label: "通义千问" }, { value: "minimax", label: "MiniMax" }, { value: "doubao", label: "豆包" }] },
      { name: "voiceId", label: "音色编号", value: mediaSettings.audio?.voiceId || "", hint: "填写对应供应商的音色编号，可在创作中心的配音页面查看和试听。" },
      { name: "format", label: "音频格式", type: "select", value: mediaSettings.audio?.format || "mp3", options: [{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }] },
      { name: "sampleRate", label: "音频采样率", type: "select", value: String(mediaSettings.audio?.sampleRate || 24000), options: values => values.audioProvider === "minimax" ? options(MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS) : [16000, 24000, 48000].map(rate => ({ value: String(rate), label: `${rate / 1000} kHz` })) },
      { name: "instruction", label: "配音要求", value: mediaSettings.audio?.instruction || "", multiline: true, rows: 2, when: qwen },
      { name: "rate", label: "语速（1 为正常）", type: "number", value: mediaSettings.audio?.rate ?? 1, min: 0.5, max: 2, step: 0.1, when: qwen },
      { name: "pitch", label: "音调（1 为正常）", type: "number", value: mediaSettings.audio?.provider === "qwen" ? mediaSettings.audio.pitch : 1, min: 0.5, max: 2, step: 0.1, when: qwen },
      { name: "volume", label: "音量（0–100）", type: "number", value: mediaSettings.audio?.provider === "qwen" ? mediaSettings.audio.volume : 50, min: 0, max: 100, step: 1, when: qwen },
      { name: "audioModel", label: "MiniMax 配音模型", type: "select", value: mediaSettings.audio?.model || MINIMAX_AUDIO_MODELS[0].id, options: options(MINIMAX_AUDIO_MODELS), when: minimax },
      { name: "emotion", label: "情绪", type: "select", value: mediaSettings.audio?.emotion || "", options: options(MINIMAX_AUDIO_EMOTION_OPTIONS), when: minimax },
      { name: "languageBoost", label: "语言增强", type: "select", value: mediaSettings.audio?.languageBoost || "", options: options(MINIMAX_AUDIO_LANGUAGE_OPTIONS), when: minimax },
      { name: "minimaxSpeed", label: "语速（1 为正常）", type: "number", value: mediaSettings.audio?.speed ?? 1, min: 0.5, max: 2, step: 0.1, when: minimax },
      { name: "minimaxVolume", label: "音量（1 为正常）", type: "number", value: mediaSettings.audio?.provider === "minimax" ? mediaSettings.audio.volume : 1, min: 0.1, max: 10, step: 0.1, when: minimax },
      { name: "minimaxPitch", label: "音调（0 为正常）", type: "number", value: mediaSettings.audio?.provider === "minimax" ? mediaSettings.audio.pitch : 0, min: -12, max: 12, step: 1, when: minimax },
      { name: "doubaoInstruction", label: "配音要求", value: mediaSettings.audio?.instruction || "", multiline: true, rows: 2, maxLength: 300, when: doubao },
      { name: "speechRate", label: "语速（0 为正常）", type: "number", value: mediaSettings.audio?.speechRate ?? 0, min: -50, max: 100, step: 1, when: doubao },
      { name: "loudnessRate", label: "音量（0 为正常）", type: "number", value: mediaSettings.audio?.loudnessRate ?? 0, min: -50, max: 100, step: 1, when: doubao },
      { name: "pitchRate", label: "音调（0 为正常）", type: "number", value: mediaSettings.audio?.pitchRate ?? 0, min: -12, max: 12, step: 1, when: doubao },
      { name: "videoMode", label: "视频生成方式", type: "select", value: mediaSettings.video?.mode || "", options: [off, ...options(VIDEO_MODE_OPTIONS)], hint: "先将参考图片或视频添加到对话或项目资料，再告诉 AI 使用哪些素材。" },
      { name: "resolution", label: "视频分辨率", type: "select", value: mediaSettings.video?.resolution || "720P", options: values => options(VIDEO_RESOLUTION_OPTIONS.filter(option => values.videoMode !== "edit" || option.id !== "480P")) },
      { name: "ratio", label: "视频比例", type: "select", value: mediaSettings.video?.ratio || "16:9", options: options(VIDEO_ASPECT_RATIO_OPTIONS), when: values => ["text", "reference"].includes(values.videoMode) },
      { name: "duration", label: "视频时长", type: "select", value: String(mediaSettings.video?.duration || 5), options: options(VIDEO_DURATION_OPTIONS), when: values => values.videoMode !== "edit" },
      { name: "audioSetting", label: "视频编辑音频", type: "select", value: mediaSettings.video?.audioSetting || "auto", options: [{ value: "auto", label: "自动处理" }, { value: "origin", label: "保留原音频" }], when: values => values.videoMode === "edit" },
      { name: "watermark", label: "视频水印", type: "select", value: String(mediaSettings.video?.watermark === true), options: [{ value: "false", label: "不添加" }, { value: "true", label: "添加" }] },
      { name: "enhancementResolution", label: "视频画质增强", type: "select", value: mediaSettings.enhancement?.resolution || "", options: [off, ...["720p", "1080p", "2k"].map(value => ({ value, label: value }))] },
      { name: "bitrate", label: "增强后画质", type: "select", value: mediaSettings.enhancement?.bitrate?.value || "medium", options: [{ value: "low", label: "较小文件" }, { value: "medium", label: "标准" }, { value: "high", label: "高画质" }] },
    ];
}

export function parseMediaSettings(values) {
        if (values.audioProvider && !values.voiceId.trim()) throw new Error("启用配音时，请填写所选供应商的音色编号。");
        const next = {};
        if (values.imageSize) next.image = { size: values.imageSize };
        if (values.audioProvider) {
          next.audio = { provider: values.audioProvider, voiceId: values.voiceId.trim(), format: values.format, sampleRate: Number(values.sampleRate) };
          if (values.audioProvider === "qwen") Object.assign(next.audio, { instruction: values.instruction, rate: Number(values.rate), pitch: Number(values.pitch), volume: Number(values.volume), languageHint: "" });
          if (values.audioProvider === "minimax") Object.assign(next.audio, { model: values.audioModel, emotion: values.emotion, speed: Number(values.minimaxSpeed), volume: Number(values.minimaxVolume), pitch: Number(values.minimaxPitch), languageBoost: values.languageBoost });
          if (values.audioProvider === "doubao") Object.assign(next.audio, { instruction: values.doubaoInstruction, speechRate: Number(values.speechRate), loudnessRate: Number(values.loudnessRate), pitchRate: Number(values.pitchRate) });
        }
        if (values.videoMode) next.video = { mode: values.videoMode, resolution: values.resolution, ...(values.videoMode === "edit" ? { audioSetting: values.audioSetting } : { ...(values.videoMode === "first-frame" ? {} : { ratio: values.ratio }), duration: Number(values.duration) }), watermark: values.watermark === "true" };
        if (values.enhancementResolution) next.enhancement = { resolution: values.enhancementResolution, bitrate: { mode: "level", value: values.bitrate } };
  return next;
}
