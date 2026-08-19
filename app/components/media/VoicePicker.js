"use client";

import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  CircleUserRound,
  Mic2,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  AUDIO_LANGUAGE_HINTS,
  PRESET_AUDIO_VOICES,
} from "@/lib/media/shared/models";

const LANGUAGE_LABELS = Object.fromEntries(
  AUDIO_LANGUAGE_HINTS.filter((item) => item.id).map((item) => [item.id, item.label]),
);

export const RECOMMENDED_AUDIO_VOICES = PRESET_AUDIO_VOICES.map((voice) => ({
  voiceId: voice.voice,
  name: voice.name,
  gender: voice.gender,
  age: `${voice.age} 岁`,
  languages: voice.languageLabel,
  languageIds: voice.languages,
  trait: voice.trait,
  scene: voice.scene,
  tier: voice.source === "system" ? "旗舰系统音色" : "精选基础音色",
}));

export const VOICE_STATUS_META = {
  SUBMITTING: {
    label: "提交中",
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  },
  DEPLOYING: {
    label: "制作中",
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  },
  OK: {
    label: "可用",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
  },
  UNDEPLOYED: {
    label: "未通过",
    className: "border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  },
  DELETING: {
    label: "删除中",
    className: "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  },
  RECONCILING: {
    label: "待核对",
    className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300",
  },
};

export function mapRecommendedVoice(voice) {
  return {
    voiceId: voice.voiceId,
    name: voice.name,
    subtitle: `${voice.gender} · ${voice.age} · ${voice.languages}`,
    tier: voice.tier,
    badges: [voice.trait, voice.scene],
    icon: "preset",
    disabled: false,
    payload: {
      voiceId: voice.voiceId,
      name: voice.name,
      kind: "preset",
      description: `${voice.trait} · ${voice.scene}`,
      languages: voice.languageIds,
    },
  };
}

export function mapQwenCustomVoice(voice) {
  const disabled = voice.status !== "OK" || Boolean(voice.requiresAttention);
  const status = VOICE_STATUS_META[voice.requiresAttention ? "RECONCILING" : voice.status] || null;
  const badges = [`${LANGUAGE_LABELS[voice.languageHint] || "自动"}样本`];
  if (voice.enablePreprocess) badges.push("已启用音频优化");
  return {
    voiceId: voice.voiceId,
    name: voice.displayName,
    subtitle: "我的复刻音色",
    statusBadge: status,
    badges,
    icon: "custom",
    disabled,
    disabledHint: disabled
      ? (voice.requiresAttention
        ? (voice.reconciliationKind === "update"
          ? "新样本结果正在自动核对，完成前不会启用"
          : "创建结果暂时无法确认，记录已保留")
        : voice.status === "SUBMITTING"
        ? "样本提交完成后会继续制作"
        : voice.status === "DEPLOYING"
          ? "完成制作后即可用于合成"
          : voice.status === "DELETING"
            ? "正在删除并释放云端音色"
            : "样本审核未通过，可以更换更清晰的声音样本")
      : "",
    payload: {
      voiceId: voice.voiceId,
      name: voice.displayName,
      kind: "custom",
      description: "我的复刻音色",
    },
  };
}

export function mapMinimaxSystemVoice(voice) {
  return {
    voiceId: voice.voiceId,
    name: voice.name,
    subtitle: "系统音色",
    tier: "系统音色",
    badges: Array.isArray(voice.description) ? voice.description.slice(0, 3) : [],
    icon: "preset",
    disabled: false,
    payload: {
      voiceId: voice.voiceId,
      name: voice.name,
      kind: "system",
      description: Array.isArray(voice.description) ? voice.description.join(" · ") : "",
    },
  };
}

export function mapMinimaxCustomVoice(voice) {
  return {
    voiceId: voice.voiceId,
    name: voice.displayName,
    subtitle: "我的复刻音色",
    badges: [],
    icon: "custom",
    disabled: false,
    payload: {
      voiceId: voice.voiceId,
      name: voice.displayName,
      kind: "custom",
      description: "我的复刻音色",
    },
  };
}

function VoiceCard({ voice, selected, onSelect }) {
  return (
    <button
      type="button"
      disabled={voice.disabled}
      onClick={() => onSelect(voice)}
      aria-pressed={selected}
      className={`group relative w-full rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] motion-reduce:transition-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-primary bg-primary/5"
          : "border-zinc-200/80 bg-white/70 hover:border-primary/50 hover:bg-primary/[0.03] dark:border-zinc-800 dark:bg-zinc-950/60"
      }`}
    >
      <span
        className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border ${
          selected
            ? "border-primary bg-primary text-white dark:text-sky-950"
            : "border-zinc-200 bg-white text-transparent dark:border-zinc-700 dark:bg-zinc-900"
        }`}
        aria-hidden="true"
      >
        <Check className="h-3.5 w-3.5" />
      </span>

      <div className="flex items-start gap-3 pr-7">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {voice.icon === "custom" ? <CircleUserRound className="h-5 w-5" /> : <Mic2 className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{voice.name}</span>
            {voice.statusBadge ? (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${voice.statusBadge.className}`}>
                {voice.statusBadge.label}
              </span>
            ) : voice.tier ? (
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
                {voice.tier}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block text-xs text-zinc-500">{voice.subtitle}</span>
        </span>
      </div>

      {voice.badges?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {voice.badges.map((badge) => (
            <span key={badge} className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {voice.disabled && voice.disabledHint ? (
        <span className="mt-3 block text-xs text-zinc-500">{voice.disabledHint}</span>
      ) : null}
    </button>
  );
}

function PickerSection({
  title,
  description,
  voices,
  loading = false,
  error = "",
  selectedVoiceId,
  onSelect,
  emptyTitle = "暂无可用音色",
  emptyDescription = "",
  className = "",
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={className}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 id={titleId} className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        </div>
        <span className="shrink-0 text-xs text-zinc-400">
          {loading ? "读取中" : `${voices.length} 个`}
        </span>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-label={`正在读取${title}`} aria-busy="true">
          {[0, 1].map((item) => (
            <div key={item} className="rounded-2xl border border-zinc-200/80 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800" />
                  <div className="h-3 w-20 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
          {error}
        </div>
      ) : voices.length === 0 ? (
        <div className="flex min-h-[128px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-5 text-center dark:border-zinc-800">
          <UserRound className="mb-2 h-6 w-6 text-zinc-400" />
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{emptyTitle}</p>
          {emptyDescription ? <p className="mt-1 text-xs text-zinc-500">{emptyDescription}</p> : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {voices.map((voice) => (
            <VoiceCard
              key={voice.voiceId}
              voice={voice}
              selected={selectedVoiceId === voice.voiceId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function VoicePicker({
  open,
  brandLabel = "Qwen Audio",
  title = "选择音色",
  description = "为这段内容选择合适的声音角色。",
  presetSection,
  customSection,
  selectedVoiceId,
  onClose,
  onSelect,
}) {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || []).filter((element) => element.getAttribute("aria-hidden") !== "true");
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!dialogRef.current?.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  const chooseVoice = (voice) => {
    onSelect(voice.payload);
    onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-zinc-950/45 backdrop-blur-sm"
            onClick={onClose}
            aria-label="关闭音色选择器"
            tabIndex={-1}
          />
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-picker-title"
            initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex max-h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[28px] border border-zinc-200 bg-white shadow-pop sm:max-h-[82dvh] sm:rounded-[28px] dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800 sm:px-6">
              <div>
                <div className="mb-1 flex items-center gap-2 text-primary">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-[0.16em]">{brandLabel}</span>
                </div>
                <h2 id="voice-picker-title" className="text-lg font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-zinc-500">{description}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="fade-scrollbar overflow-y-auto px-5 py-5 sm:px-6">
              {presetSection ? (
                <PickerSection
                  title={presetSection.title}
                  description={presetSection.description}
                  voices={presetSection.voices}
                  loading={presetSection.loading}
                  error={presetSection.error}
                  selectedVoiceId={selectedVoiceId}
                  onSelect={chooseVoice}
                  emptyTitle={presetSection.emptyTitle}
                  emptyDescription={presetSection.emptyDescription}
                />
              ) : null}

              {customSection ? (
                <PickerSection
                  title={customSection.title}
                  description={customSection.description}
                  voices={customSection.voices}
                  loading={customSection.loading}
                  error={customSection.error}
                  selectedVoiceId={selectedVoiceId}
                  onSelect={chooseVoice}
                  emptyTitle={customSection.emptyTitle}
                  emptyDescription={customSection.emptyDescription}
                  className={presetSection ? "mt-7 border-t border-zinc-200 pt-6 dark:border-zinc-800" : ""}
                />
              ) : null}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
