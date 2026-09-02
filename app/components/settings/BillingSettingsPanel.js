"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { apiJson } from "@/lib/client/apiClient";
import { useCredits } from "@/lib/client/credits/CreditContext";
import { useToast } from "../common/ToastProvider";

const GENERAL_FIELDS = Object.freeze([
  { path: ["initialCredits"], label: "新用户注册初始积分", step: 1 },
  { path: ["costMultiplier"], label: "成本安全系数", step: 0.01 },
  { path: ["usdToCny"], label: "美元兑人民币汇率", step: 0.01 },
  { path: ["chatReservationLimit"], label: "聊天单次最多冻结积分", step: 1 },
]);

const RATE_FIELDS = Object.freeze([
  { path: ["rates", "chat", "gpt-5.6-sol", "inputPerMillion"], label: "GPT-5.6 Sol 输入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "gpt-5.6-sol", "cachedInputPerMillion"], label: "GPT-5.6 Sol 缓存输入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "gpt-5.6-sol", "cacheWritePerMillion"], label: "GPT-5.6 Sol 缓存写入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "gpt-5.6-sol", "outputPerMillion"], label: "GPT-5.6 Sol 输出", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "gpt-5.6-sol", "longContextThreshold"], label: "GPT 长上下文起算值", unit: "输入 token", step: 1 },
  { path: ["rates", "chat", "gpt-5.6-sol", "longInputMultiplier"], label: "GPT 长上下文输入倍数", unit: "倍", step: 0.01 },
  { path: ["rates", "chat", "gpt-5.6-sol", "longOutputMultiplier"], label: "GPT 长上下文输出倍数", unit: "倍", step: 0.01 },
  { path: ["rates", "chat", "claude-opus-5", "inputPerMillion"], label: "Claude Opus 5 输入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "claude-opus-5", "outputPerMillion"], label: "Claude Opus 5 输出", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "google/gemini-3.7-flash", "inputPerMillion"], label: "Gemini 3.7 Flash 输入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "google/gemini-3.7-flash", "outputPerMillion"], label: "Gemini 3.7 Flash 输出", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "grok-4.6", "inputPerMillion"], label: "Grok 4.6 输入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "grok-4.6", "outputPerMillion"], label: "Grok 4.6 输出", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "grok-4.6", "longContextThreshold"], label: "Grok 长上下文起算值", unit: "输入 token", step: 1 },
  { path: ["rates", "chat", "grok-4.6", "longContextMultiplier"], label: "Grok 长上下文价格倍数", unit: "倍", step: 0.01 },
  { path: ["rates", "chat", "kimi-k3", "inputPerMillion"], label: "Kimi K3 输入预估", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "kimi-k3", "outputPerMillion"], label: "Kimi K3 输出预估", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "qwen-3.8-max", "inputPerMillion"], label: "Qwen 3.8 Max 输入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "qwen-3.8-max", "cachedInputPerMillion"], label: "Qwen 3.8 Max 缓存输入", unit: "美元 / 百万 token" },
  { path: ["rates", "chat", "qwen-3.8-max", "outputPerMillion"], label: "Qwen 3.8 Max 输出", unit: "美元 / 百万 token" },
  { path: ["rates", "exa", "search20Usd"], label: "Exa 搜索（20 条）", unit: "美元 / 次" },
  { path: ["rates", "exa", "contentsUsd"], label: "Exa 网页读取", unit: "美元 / 页" },
  { path: ["rates", "qwenImage", "outputCny", "1K"], label: "Qwen 图片 1K 输出", unit: "元 / 张" },
  { path: ["rates", "qwenImage", "outputCny", "2K"], label: "Qwen 图片 2K 输出", unit: "元 / 张" },
  { path: ["rates", "qwenImage", "inputImageCny"], label: "Qwen 图片参考图", unit: "元 / 张" },
  { path: ["rates", "happyHorse", "generationCnyPerSecond", "480"], label: "HappyHorse 480P", unit: "元 / 秒" },
  { path: ["rates", "happyHorse", "generationCnyPerSecond", "720"], label: "HappyHorse 720P", unit: "元 / 秒" },
  { path: ["rates", "happyHorse", "generationCnyPerSecond", "1080"], label: "HappyHorse 1080P", unit: "元 / 秒" },
  { path: ["rates", "happyHorse", "editCnyPerSecond", "720"], label: "HappyHorse 编辑 720P", unit: "元 / 计费秒" },
  { path: ["rates", "happyHorse", "editCnyPerSecond", "1080"], label: "HappyHorse 编辑 1080P", unit: "元 / 计费秒" },
  { path: ["rates", "qwenTts", "cnyPer10000Characters"], label: "Qwen 语音合成", unit: "元 / 万字" },
  { path: ["rates", "qwenTts", "voiceCloneUsd"], label: "Qwen 音色复刻", unit: "美元 / 次" },
  { path: ["rates", "minimaxTts", "cnyPer10000Characters", "hd"], label: "MiniMax 2.8 HD", unit: "元 / 万字" },
  { path: ["rates", "minimaxTts", "cnyPer10000Characters", "turbo"], label: "MiniMax 2.8 Turbo", unit: "元 / 万字" },
  { path: ["rates", "minimaxTts", "firstVoiceCloneCny"], label: "MiniMax 复刻音色首次使用", unit: "元 / 音色" },
  { path: ["rates", "seedAudio", "cnyPerMinute"], label: "Seed Audio 1.0", unit: "元 / 分钟" },
  { path: ["rates", "mediaKit", "cnyPerMinute"], label: "AI MediaKit 视频增强", unit: "元 / 分钟" },
]);

function getValue(root, path) {
  return path.reduce((value, key) => value?.[key], root);
}

function setValue(root, path, value) {
  const next = structuredClone(root);
  let target = next;
  for (let index = 0; index < path.length - 1; index += 1) {
    target = target[path[index]];
  }
  target[path[path.length - 1]] = value;
  return next;
}

function NumberField({ field, settings, onChange }) {
  const value = getValue(settings, field.path);
  return (
    <label className="block rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
      <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">{field.label}</span>
      {field.unit ? <span className="mt-0.5 block text-[11px] text-zinc-400">{field.unit}</span> : null}
      <input
        type="number"
        min="0"
        step={field.step || "any"}
        value={value ?? ""}
        onChange={(event) => onChange(field.path, event.target.value)}
        className="mt-2 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-800 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
    </label>
  );
}

export default function BillingSettingsPanel({ active }) {
  const toast = useToast();
  const { refreshCredit } = useCredits();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewReasons, setReviewReasons] = useState({});
  const [reviewCharges, setReviewCharges] = useState({});
  const [reviewSaving, setReviewSaving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsPayload, reviewsPayload] = await Promise.all([
        apiJson("/api/admin/billing-settings", { cache: "no-store" }),
        apiJson("/api/admin/credit-transactions?status=review_required&limit=20", { cache: "no-store" }),
      ]);
      setSettings(settingsPayload?.settings || null);
      setReviewItems(Array.isArray(reviewsPayload?.transactions) ? reviewsPayload.transactions : []);
    } catch (error) {
      toast.error(error?.message || "加载积分设置失败");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!active || settings) return;
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [active, load, settings]);

  const updateNumber = (path, rawValue) => {
    if (!settings) return;
    const parsed = Number(rawValue);
    setSettings((current) => setValue(current, path, Number.isFinite(parsed) ? parsed : rawValue));
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const payload = await apiJson("/api/admin/billing-settings", {
        method: "PATCH",
        body: { settings, expectedVersion: settings.version },
      });
      setSettings(payload.settings);
      await refreshCredit().catch(() => null);
      toast.success("积分和模型费率已保存");
    } catch (error) {
      toast.error(error?.message || "保存积分设置失败");
    } finally {
      setSaving(false);
    }
  };

  const resolveReview = async (item, action) => {
    const reason = reviewReasons[item.operationId]?.trim();
    if (!reason) {
      toast.warning("请先填写核对原因");
      return;
    }
    const chargedPoints = action === "settle"
      ? Number(reviewCharges[item.operationId]
        ?? (item.chargedPoints || item.reservedPoints || 1))
      : 0;
    if (
      action === "settle"
      && (!Number.isSafeInteger(chargedPoints) || chargedPoints < 1)
    ) {
      toast.warning("实扣积分必须是大于 0 的整数");
      return;
    }
    setReviewSaving(item.operationId);
    try {
      await apiJson("/api/admin/credit-transactions", {
        method: "PATCH",
        body: {
          operationId: item.operationId,
          action,
          reason,
          ...(action === "settle" ? { chargedPoints } : {}),
        },
      });
      setReviewItems((current) => current.filter((entry) => entry.operationId !== item.operationId));
      toast.success(action === "release" ? "冻结积分已退回" : `已实扣 ${chargedPoints} 积分`);
    } catch (error) {
      toast.error(error?.message || "核对流水失败");
    } finally {
      setReviewSaving(null);
    }
  };

  if (loading && !settings) {
    return <div className="flex justify-center py-16 text-zinc-400"><Loader2 className="animate-spin" size={20} /></div>;
  }
  if (!settings) {
    return <button type="button" onClick={load} className="mx-auto block rounded-xl border px-4 py-2 text-sm">重新加载积分设置</button>;
  }

  return (
    <div className="space-y-5 pb-2">
      <section>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">基础规则</h3>
            <p className="text-xs text-zinc-400">当前版本 {settings.version} · 核价日期 {settings.pricingDate}</p>
          </div>
          <input
            type="date"
            value={settings.pricingDate || ""}
            onChange={(event) => setSettings((current) => ({ ...current, pricingDate: event.target.value }))}
            className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            aria-label="核价日期"
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GENERAL_FIELDS.map((field) => <NumberField key={field.label} field={field} settings={settings} onChange={updateNumber} />)}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">模型实际费率</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {RATE_FIELDS.map((field) => <NumberField key={field.label} field={field} settings={settings} onChange={updateNumber} />)}
        </div>
      </section>

      <section>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">待人工核对</h3>
          <p className="text-xs text-zinc-400">只有无法从供应商确认最终用量的请求会出现在这里。</p>
        </div>
        {reviewItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 py-7 text-center text-xs text-zinc-400 dark:border-zinc-800">没有待核对流水</div>
        ) : (
          <div className="space-y-2">
            {reviewItems.map((item) => (
              <article key={item.operationId} className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/70 dark:bg-amber-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.model || item.feature || "模型请求"}</span>
                  <span className="text-zinc-500">{item.userEmail} · 冻结 {Number(item.reservedPoints || 0).toLocaleString("zh-CN")}</span>
                </div>
                <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
                  {item.reason || "供应商最终用量尚未确认"}
                  {Number.isFinite(item.actualCostCny) ? ` · 已记录成本 ¥${Number(item.actualCostCny).toFixed(4)}` : ""}
                  {Number.isSafeInteger(item.pricingVersion) ? ` · 费率版本 ${item.pricingVersion}` : ""}
                </p>
                {item.type === "model_usage" ? (
                  <>
                    <input
                      type="text"
                      maxLength={200}
                      value={reviewReasons[item.operationId] || ""}
                      onChange={(event) => setReviewReasons((current) => ({ ...current, [item.operationId]: event.target.value }))}
                      placeholder="填写核对依据或处理原因"
                      className="mt-2 h-9 w-full rounded-lg border border-amber-200 bg-white px-2.5 text-xs outline-none focus:border-primary dark:border-amber-900 dark:bg-zinc-950"
                    />
                    <label className="mt-2 block text-xs text-zinc-600 dark:text-zinc-300">
                      核实后的实扣积分
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={reviewCharges[item.operationId]
                          ?? (item.chargedPoints || item.reservedPoints || 1)}
                        onChange={(event) => setReviewCharges((current) => ({
                          ...current,
                          [item.operationId]: event.target.value,
                        }))}
                        className="mt-1 h-9 w-full rounded-lg border border-amber-200 bg-white px-2.5 text-xs outline-none focus:border-primary dark:border-amber-900 dark:bg-zinc-950"
                      />
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button type="button" disabled={reviewSaving !== null} onClick={() => resolveReview(item, "release")} className="rounded-lg border border-zinc-200 bg-white py-2 text-xs font-medium text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">全部退回</button>
                      <button type="button" disabled={reviewSaving !== null} onClick={() => resolveReview(item, "settle")} className="rounded-lg bg-amber-600 py-2 text-xs font-medium text-white disabled:opacity-50">按核实积分结算</button>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-amber-800 dark:bg-zinc-950/60 dark:text-amber-200">
                    这条管理流水无法自动确认，请核对当前余额后重新执行对应操作。
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {saving ? "保存中…" : "保存积分设置"}
      </button>
    </div>
  );
}
