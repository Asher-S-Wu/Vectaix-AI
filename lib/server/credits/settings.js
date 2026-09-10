import mongoose from "mongoose";

import dbConnect from "@/lib/db";
import BillingSettings from "@/models/BillingSettings";
import { BILLING_SETTINGS_KEY, DEFAULT_BILLING_SETTINGS } from "./constants";
import { CreditError, invalidCreditArgument } from "./errors";
import { getManagedChatRates } from '@/lib/server/models/service';

const SETTINGS_KEYS = ["key", "initialCredits", "costMultiplier", "usdToCny", "chatReservationLimit", "pricingDate", "rates"];
const STORED_METADATA_KEYS = ["_id", "__v", "version", "updatedBy", "updatedAt"];
const RATE_ROOT_KEYS = ["chat", "qwenImage", "happyHorse", "qwenTts", "minimaxTts", "seedAudio", "mediaKit"];

function clone(value) {
  return structuredClone(value);
}

function assertFiniteNonNegative(value, path) {
  if (!Number.isFinite(value) || value < 0) throw invalidCreditArgument(`${path} 必须是非负有限数字`);
}

function assertFinitePositive(value, path) {
  if (!Number.isFinite(value) || value <= 0) throw invalidCreditArgument(`${path} 必须是大于 0 的有限数字`);
}

function assertNonNegativeInteger(value, path) {
  assertFiniteNonNegative(value, path);
  if (!Number.isSafeInteger(value)) throw invalidCreditArgument(`${path} 必须是非负安全整数`);
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || !value.trim()) throw invalidCreditArgument(`${path} 必须是非空字符串`);
}

function requireObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidCreditArgument(`${path} 必须是对象`);
  return value;
}

function assertExactKeys(value, expectedKeys, path) {
  const object = requireObject(value, path);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidCreditArgument(`${path} 字段必须严格为：${expected.join(", ")}`);
  }
  return object;
}

function validateDate(value) {
  assertNonEmptyString(value, "pricingDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidCreditArgument("pricingDate 必须使用 YYYY-MM-DD 格式");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalidCreditArgument("pricingDate 必须是真实日历日期");
  }
}

function validateChatRates(chat) {
  requireObject(chat,'rates.chat');
  for (const [modelId,rate] of Object.entries(chat)) {
    requireObject(rate,`rates.chat.${modelId}`);
    assertNonEmptyString(rate.provider, `rates.chat.${modelId}.provider`);
    if (rate.currency !== "USD") throw invalidCreditArgument(`rates.chat.${modelId}.currency 必须是 USD`);
    assertFiniteNonNegative(rate.inputPerMillion, `rates.chat.${modelId}.inputPerMillion`);
    assertFiniteNonNegative(rate.outputPerMillion, `rates.chat.${modelId}.outputPerMillion`);
  }
}

function validateRates(rates) {
  assertExactKeys(rates, RATE_ROOT_KEYS, "rates");
  validateChatRates(rates.chat);

  const image = assertExactKeys(rates.qwenImage, ["outputCny", "inputImageCny"], "rates.qwenImage");
  const imageOutput = assertExactKeys(image.outputCny, ["1K", "2K"], "rates.qwenImage.outputCny");
  assertFiniteNonNegative(imageOutput["1K"], "rates.qwenImage.outputCny.1K");
  assertFiniteNonNegative(imageOutput["2K"], "rates.qwenImage.outputCny.2K");
  assertFiniteNonNegative(image.inputImageCny, "rates.qwenImage.inputImageCny");

  const horse = assertExactKeys(rates.happyHorse, ["generationCnyPerSecond", "editCnyPerSecond"], "rates.happyHorse");
  const generation = assertExactKeys(horse.generationCnyPerSecond, ["480", "720", "1080"], "rates.happyHorse.generationCnyPerSecond");
  const edit = assertExactKeys(horse.editCnyPerSecond, ["720", "1080"], "rates.happyHorse.editCnyPerSecond");
  for (const [resolution, value] of Object.entries(generation)) assertFiniteNonNegative(value, `rates.happyHorse.generationCnyPerSecond.${resolution}`);
  for (const [resolution, value] of Object.entries(edit)) assertFiniteNonNegative(value, `rates.happyHorse.editCnyPerSecond.${resolution}`);

  const qwenTts = assertExactKeys(rates.qwenTts, ["cnyPer10000Characters", "voiceCloneUsd"], "rates.qwenTts");
  assertFiniteNonNegative(qwenTts.cnyPer10000Characters, "rates.qwenTts.cnyPer10000Characters");
  assertFiniteNonNegative(qwenTts.voiceCloneUsd, "rates.qwenTts.voiceCloneUsd");

  const minimax = assertExactKeys(rates.minimaxTts, ["cnyPer10000Characters", "firstVoiceCloneCny"], "rates.minimaxTts");
  const minimaxCharacters = assertExactKeys(minimax.cnyPer10000Characters, ["hd", "turbo"], "rates.minimaxTts.cnyPer10000Characters");
  assertFiniteNonNegative(minimaxCharacters.hd, "rates.minimaxTts.cnyPer10000Characters.hd");
  assertFiniteNonNegative(minimaxCharacters.turbo, "rates.minimaxTts.cnyPer10000Characters.turbo");
  assertFiniteNonNegative(minimax.firstVoiceCloneCny, "rates.minimaxTts.firstVoiceCloneCny");

  const seed = assertExactKeys(rates.seedAudio, ["cnyPerMinute"], "rates.seedAudio");
  assertFiniteNonNegative(seed.cnyPerMinute, "rates.seedAudio.cnyPerMinute");
  const mediaKit = assertExactKeys(rates.mediaKit, ["cnyPerMinute"], "rates.mediaKit");
  assertFiniteNonNegative(mediaKit.cnyPerMinute, "rates.mediaKit.cnyPerMinute");
}

export function validateBillingSettings(input, { allowStoredMetadata = false } = {}) {
  let settings;
  if (allowStoredMetadata) {
    settings = requireObject(input, "settings");
    const allowedKeys = new Set([...SETTINGS_KEYS, ...STORED_METADATA_KEYS]);
    if (Object.keys(settings).some((key) => !allowedKeys.has(key))) {
      throw invalidCreditArgument("settings 包含未允许的字段");
    }
    if (SETTINGS_KEYS.some((key) => !Object.hasOwn(settings, key))) {
      throw invalidCreditArgument("settings 缺少必需字段");
    }
  } else {
    settings = assertExactKeys(input, SETTINGS_KEYS, "settings");
  }
  if (settings.key !== BILLING_SETTINGS_KEY) throw invalidCreditArgument("settings.key 只能是 default");
  assertNonNegativeInteger(settings.initialCredits, "initialCredits");
  assertFinitePositive(settings.costMultiplier, "costMultiplier");
  assertFinitePositive(settings.usdToCny, "usdToCny");
  assertNonNegativeInteger(settings.chatReservationLimit, "chatReservationLimit");
  validateDate(settings.pricingDate);
  validateRates(settings.rates);
  return clone({
    key: BILLING_SETTINGS_KEY,
    initialCredits: settings.initialCredits,
    costMultiplier: settings.costMultiplier,
    usdToCny: settings.usdToCny,
    chatReservationLimit: settings.chatReservationLimit,
    pricingDate: settings.pricingDate,
    rates: settings.rates,
  });
}

export async function getBillingSettings() {
  await dbConnect();
  const defaults = validateBillingSettings(DEFAULT_BILLING_SETTINGS, { allowStoredMetadata: true });
  const document = await BillingSettings.findOneAndUpdate(
    { key: BILLING_SETTINGS_KEY },
    { $setOnInsert: { ...defaults, version: 1, updatedBy: null, updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true, lean: true },
  );
  const validated = validateBillingSettings(document, { allowStoredMetadata: true });
  if (!Number.isSafeInteger(document.version) || document.version < 1) {
    throw new CreditError("数据库中的计费设置版本无效", { code: "INVALID_BILLING_SETTINGS", statusCode: 500 });
  }
  return { ...validated, rates: {...validated.rates,chat:await getManagedChatRates()}, version: document.version, updatedBy: document.updatedBy, updatedAt: document.updatedAt };
}

export async function updateBillingSettings(input, { updatedBy, expectedVersion } = {}) {
  await dbConnect();
  const validated = validateBillingSettings(input, { allowStoredMetadata: true });
  validated.rates.chat = await getManagedChatRates();
  if (updatedBy !== undefined && updatedBy !== null && !mongoose.isValidObjectId(updatedBy)) throw invalidCreditArgument("updatedBy 不是有效用户 ID");
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw invalidCreditArgument("expectedVersion 必须是正整数且不可省略");
  const document = await BillingSettings.findOneAndUpdate(
    { key: BILLING_SETTINGS_KEY, version: expectedVersion },
    { $set: { ...validated, updatedBy: updatedBy || null, updatedAt: new Date() }, $inc: { version: 1 } },
    { new: true, runValidators: true, lean: true },
  );
  if (!document) {
    throw new CreditError("计费设置已被其他操作更新，请重新读取后再保存", { code: "BILLING_SETTINGS_VERSION_CONFLICT", statusCode: 409 });
  }
  return document;
}
