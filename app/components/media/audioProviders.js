"use client";

import { Gauge, SlidersHorizontal, Volume2 } from "lucide-react";
import { useI18n } from "@/lib/client/i18n";
import AudioSliderField from "./AudioSliderField";
import {
  ELEVENLABS_AUDIO_DEFAULTS, ELEVENLABS_AUDIO_FORMATS, ELEVENLABS_AUDIO_MODEL, ELEVENLABS_AUDIO_MODEL_LABEL,
  ELEVENLABS_AUDIO_SAMPLE_RATES, ELEVENLABS_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/elevenlabsAudio";
import {
  MINIMAX_AUDIO_BITRATES, MINIMAX_AUDIO_DEFAULTS, MINIMAX_AUDIO_EMOTIONS, MINIMAX_AUDIO_FORMATS, MINIMAX_AUDIO_MODEL,
  MINIMAX_AUDIO_MODEL_LABEL, MINIMAX_AUDIO_SAMPLE_RATES, MINIMAX_AUDIO_TEXT_MAX_LENGTH, MINIMAX_LANGUAGE_BOOSTS,
  MINIMAX_SOUND_EFFECTS, MINIMAX_TEXT_NORMALIZATION_MODES,
} from "@/lib/media/shared/minimaxAudio";

export const inputClass = "w-full min-w-0 rounded-xl border border-zinc-200 bg-white p-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700";

const optionDefaults = ({ enabled: _enabled, baseUrl: _baseUrl, provider: _provider, model: _model, voiceId: _voiceId, ...options }) => options;

function SelectField({ id, label, value, disabled, onChange, options }) {
  return <div><label htmlFor={id} className="mb-2 block text-xs">{label}</label><select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className={inputClass}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></div>;
}

function ElevenLabsOptions({ value, onChange, disabled }) {
  const { t, formatNumber } = useI18n();
  const percent = key => `${formatNumber(value[key] * 100)}%`;
  return <div className="grid grid-cols-2 gap-3">
    <SelectField id="elevenlabs-format" label={t("音频格式", "Audio format")} value={value.format} disabled={disabled} onChange={format => onChange({ format, sampleRate: ELEVENLABS_AUDIO_DEFAULTS.sampleRate })} options={ELEVENLABS_AUDIO_FORMATS.map(format => [format, format.toUpperCase()])} />
    <SelectField id="elevenlabs-sample-rate" label={t("采样率", "Sample rate")} value={value.sampleRate} disabled={disabled} onChange={rate => onChange({ sampleRate: Number(rate) })} options={ELEVENLABS_AUDIO_SAMPLE_RATES[value.format].map(rate => [rate, `${formatNumber(rate / 1000)} kHz`])} />
    <AudioSliderField id="elevenlabs-speed" label={t("语速", "Speed")} icon={Gauge} valueLabel={`${formatNumber(value.speed, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}×`} value={value.speed} min={0.7} max={1.2} step={0.05} disabled={disabled} onChange={event => onChange({ speed: Number(event.target.value) })} />
    <AudioSliderField id="elevenlabs-stability" label={t("稳定度", "Stability")} icon={SlidersHorizontal} valueLabel={percent("stability")} value={value.stability} min={0} max={1} step={0.05} disabled={disabled} onChange={event => onChange({ stability: Number(event.target.value) })} />
    <AudioSliderField id="elevenlabs-similarity" label={t("相似度", "Similarity")} icon={SlidersHorizontal} valueLabel={percent("similarityBoost")} value={value.similarityBoost} min={0} max={1} step={0.05} disabled={disabled} onChange={event => onChange({ similarityBoost: Number(event.target.value) })} />
    <AudioSliderField id="elevenlabs-style" label={t("风格强度", "Style intensity")} icon={SlidersHorizontal} valueLabel={percent("style")} value={value.style} min={0} max={1} step={0.05} disabled={disabled} onChange={event => onChange({ style: Number(event.target.value) })} />
    <label className="col-span-2 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={value.useSpeakerBoost} disabled={disabled} onChange={event => onChange({ useSpeakerBoost: event.target.checked })} />{t("说话人增强", "Speaker boost")}</label>
  </div>;
}

export function useMiniMaxLabels() {
  const { t, locale } = useI18n();
  const names = new Intl.DisplayNames([locale === "zh" ? "zh-CN" : "en"], { type: "language" });
  return {
    emotions: {
      auto: t("自动匹配", "Automatic"), happy: t("高兴", "Happy"), sad: t("悲伤", "Sad"), angry: t("愤怒", "Angry"),
      fearful: t("害怕", "Fearful"), disgusted: t("厌恶", "Disgusted"), surprised: t("惊讶", "Surprised"), calm: t("平静", "Calm"),
    },
    soundEffects: {
      none: t("无音效", "None"), spacious_echo: t("空旷回音", "Spacious echo"), auditorium_echo: t("礼堂广播", "Auditorium"),
      lofi_telephone: t("电话音质", "Telephone"), robotic: t("机器人电音", "Robotic"),
    },
    textNormalization: {
      off: t("关闭", "Off"), basic: t("基础：数字、日期读法更准确", "Basic: better numbers and dates"), quality: t("高质量：更准确，稍慢", "High quality: more accurate, slower"),
    },
    language: value => value === "auto" ? t("自动识别", "Detect automatically") : names.of(MINIMAX_LANGUAGE_BOOSTS[value]),
  };
}

function MiniMaxOptions({ value, onChange, disabled }) {
  const { t, formatNumber } = useI18n();
  const labels = useMiniMaxLabels();
  return <div className="grid grid-cols-2 gap-3">
    <SelectField id="minimax-format" label={t("音频格式", "Audio format")} value={value.format} disabled={disabled} onChange={format => onChange({ format })} options={MINIMAX_AUDIO_FORMATS.map(format => [format, format.toUpperCase()])} />
    <SelectField id="minimax-sample-rate" label={t("采样率", "Sample rate")} value={value.sampleRate} disabled={disabled} onChange={rate => onChange({ sampleRate: Number(rate) })} options={MINIMAX_AUDIO_SAMPLE_RATES.map(rate => [rate, `${formatNumber(rate / 1000)} kHz`])} />
    {value.format === "mp3" && <SelectField id="minimax-bitrate" label={t("比特率", "Bitrate")} value={value.bitrate} disabled={disabled} onChange={bitrate => onChange({ bitrate: Number(bitrate) })} options={MINIMAX_AUDIO_BITRATES.map(rate => [rate, `${formatNumber(rate / 1000)} kbps`])} />}
    <SelectField id="minimax-emotion" label={t("情绪", "Emotion")} value={value.emotion} disabled={disabled} onChange={emotion => onChange({ emotion })} options={MINIMAX_AUDIO_EMOTIONS.map(emotion => [emotion, labels.emotions[emotion]])} />
    <SelectField id="minimax-language" label={t("语言增强", "Language boost")} value={value.languageBoost} disabled={disabled} onChange={languageBoost => onChange({ languageBoost })} options={Object.keys(MINIMAX_LANGUAGE_BOOSTS).map(language => [language, labels.language(language)])} />
    <SelectField id="minimax-sound-effect" label={t("音效", "Sound effect")} value={value.soundEffect} disabled={disabled} onChange={soundEffect => onChange({ soundEffect })} options={MINIMAX_SOUND_EFFECTS.map(effect => [effect, labels.soundEffects[effect]])} />
    <div className="col-span-2"><SelectField id="minimax-text-normalization" label={t("数字与符号读法", "Numbers and symbols")} value={value.textNormalization} disabled={disabled} onChange={textNormalization => onChange({ textNormalization })} options={MINIMAX_TEXT_NORMALIZATION_MODES.map(mode => [mode, labels.textNormalization[mode]])} /></div>
    <AudioSliderField id="minimax-speed" label={t("语速", "Speed")} icon={Gauge} valueLabel={`${formatNumber(value.speed, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}×`} value={value.speed} min={0.5} max={2} step={0.05} disabled={disabled} onChange={event => onChange({ speed: Number(event.target.value) })} />
    <AudioSliderField id="minimax-volume" label={t("音量", "Volume")} icon={Volume2} valueLabel={formatNumber(value.volume, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} value={value.volume} min={0.1} max={10} step={0.1} disabled={disabled} onChange={event => onChange({ volume: Number(event.target.value) })} />
    <div className="col-span-2"><AudioSliderField id="minimax-pitch" label={t("语调", "Pitch")} icon={SlidersHorizontal} valueLabel={value.pitch > 0 ? `+${formatNumber(value.pitch)}` : formatNumber(value.pitch)} value={value.pitch} min={-12} max={12} step={1} disabled={disabled} onChange={event => onChange({ pitch: Number(event.target.value) })} /></div>
  </div>;
}

function MiniMaxCloneOptions({ value, onChange, disabled }) {
  const { t } = useI18n();
  return <div className="space-y-2">
    <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={value.needNoiseReduction} onChange={event => onChange({ needNoiseReduction: event.target.checked })} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />{t("降噪处理（录音有明显背景噪音时开启）", "Reduce noise (for recordings with background noise)")}</label>
    <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={value.needVolumeNormalization} onChange={event => onChange({ needVolumeNormalization: event.target.checked })} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />{t("音量均衡（录音忽大忽小时开启）", "Even out volume (for uneven recordings)")}</label>
  </div>;
}

export const AUDIO_PROVIDERS = Object.freeze({
  elevenlabs: {
    id: "elevenlabs", name: "ElevenLabs", model: ELEVENLABS_AUDIO_MODEL, modelLabel: ELEVENLABS_AUDIO_MODEL_LABEL, settingsSection: "audio",
    maxTextLength: ELEVENLABS_AUDIO_TEXT_MAX_LENGTH, defaults: optionDefaults(ELEVENLABS_AUDIO_DEFAULTS), Options: ElevenLabsOptions,
    cloneDefaults: {}, CloneOptions: null, readyStatuses: ["trained"],
    textHint: t => t("支持多语言，可选择系统音色或自己的复刻音色。", "Supports multiple languages with built-in or cloned voices."),
    cloneHint: t => t("上传清晰的单人录音，时长 10 秒至 5 分钟，建议 1 至 2 分钟。支持 WAV、MP3、M4A，最多 20MB。", "Upload a clear recording of one speaker, 10 seconds to 5 minutes long (1–2 minutes recommended). WAV, MP3, or M4A, up to 20 MB."),
    statusLabel: (voice, { t }) => ({ trained: t("可用", "Ready"), verification_required: t("请在 ElevenLabs 完成声音验证后刷新", "Complete voice verification in ElevenLabs, then refresh") })[voice.status],
  },
  minimax: {
    id: "minimax", name: "MiniMax", model: MINIMAX_AUDIO_MODEL, modelLabel: MINIMAX_AUDIO_MODEL_LABEL, settingsSection: "minimaxAudio",
    maxTextLength: MINIMAX_AUDIO_TEXT_MAX_LENGTH, defaults: optionDefaults(MINIMAX_AUDIO_DEFAULTS), Options: MiniMaxOptions,
    cloneDefaults: { needNoiseReduction: false, needVolumeNormalization: false }, CloneOptions: MiniMaxCloneOptions, readyStatuses: ["trained", "pending_activation"],
    textHint: t => t("可插入语气词，如 (laughs) 笑声、(sighs) 叹气、(breath) 换气；输入 <#0.5#> 可停顿 0.5 秒。", "Add sounds such as (laughs), (sighs), or (breath). Type <#0.5#> to pause for 0.5 seconds."),
    cloneHint: t => t("上传清晰的单人录音，时长 10 秒至 5 分钟，建议 1 至 2 分钟。支持 WAV、MP3、M4A，最多 20MB。创建音色不收费，第一次试听或生成时会收取一次复刻费；创建后 7 天内没有使用，MiniMax 会自动删除该音色。", "Upload a clear recording of one speaker, 10 seconds to 5 minutes long (1–2 minutes recommended). WAV, MP3, or M4A, up to 20 MB. Creating a voice is free. A one-time cloning fee applies the first time you preview or use it. MiniMax deletes voices that are not used within 7 days."),
    statusLabel: (voice, { t, formatDate }) => {
      if (voice.status === "pending_activation") return t("待激活：第一次试听或生成时收取复刻费，{date} 前未使用将被自动删除", "Not activated: the cloning fee applies on first use. Unused voices are deleted after {date}.", { date: formatDate(voice.expiresAt, { dateStyle: "medium", timeStyle: "short" }) });
      if (voice.status === "expired") return t("已失效：7 天内未使用，已被 MiniMax 删除", "Expired: unused for 7 days and deleted by MiniMax");
      return t("可用", "Ready");
    },
  },
});
export const AUDIO_PROVIDER_IDS = Object.freeze(Object.keys(AUDIO_PROVIDERS));
