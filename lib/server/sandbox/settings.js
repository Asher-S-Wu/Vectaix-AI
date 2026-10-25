import dbConnect from '@/lib/db';
import PlatformSettings from '@/models/PlatformSettings';
import { encryptSecret, decryptSecret } from '@/lib/server/security/secrets.mjs';
import { DEFAULT_SANDBOX_SETTINGS } from './config';

const SECRET_CONTEXT = 'platform:sandbox';
export function sandboxError(message, status = 400) {
  return Object.assign(new Error(message), { status, publicMessage: true });
}

export function validateSandboxSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw sandboxError('沙盒设置格式无效');
  if (typeof input.enabled !== 'boolean') throw sandboxError('请选择沙盒启用状态');
  const environmentId = String(input.environmentId || '').trim();
  if ((input.enabled || environmentId) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(environmentId)) throw sandboxError('请填写有效的 Railway 环境 ID');
  const timeoutSeconds = Number(input.timeoutSeconds);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 300) throw sandboxError('单次执行时限需为 10 至 300 秒');
  const cpu = Number(input.cpu), memoryGB = Number(input.memoryGB);
  if (!Number.isFinite(cpu) || cpu < 0.5 || cpu > 4) throw sandboxError('CPU 请设置为 0.5 至 4 vCPU');
  if (!Number.isFinite(memoryGB) || memoryGB < 0.5 || memoryGB > 8) throw sandboxError('内存请设置为 0.5 至 8 GB');
  if (typeof input.setupCommand !== 'string' || input.setupCommand.length > 8000) throw sandboxError('初始化命令最多 8000 字符');
  return { enabled: input.enabled, environmentId, timeoutSeconds, cpu, memoryGB, setupCommand: input.setupCommand.trim() };
}

async function readConfig() {
  await dbConnect();
  const settings = await PlatformSettings.findById('platform').select('sandboxConfig').lean();
  return settings?.sandboxConfig || null;
}

function publicConfig(config) {
  if (!config) return { ...DEFAULT_SANDBOX_SETTINGS, hasApiKey: false };
  return { enabled: config.enabled, environmentId: config.environmentId, timeoutSeconds: config.timeoutSeconds, cpu: config.cpu, memoryGB: config.memoryGB, setupCommand: config.setupCommand, hasApiKey: Boolean(config.encryptedApiKey) };
}

export async function getAdminSandboxSettings() {
  return { config: publicConfig(await readConfig()) };
}

export async function saveAdminSandboxSettings(input, userId) {
  const config = validateSandboxSettings(input);
  const previous = await readConfig();
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey)) throw sandboxError('API Key 格式无效');
  if (apiKey) config.encryptedApiKey = encryptSecret(apiKey, SECRET_CONTEXT);
  else if (!input.clearApiKey && previous?.encryptedApiKey) config.encryptedApiKey = previous.encryptedApiKey;
  if (config.enabled && !config.encryptedApiKey) throw sandboxError('启用沙盒前请填写 Railway API Token');
  await PlatformSettings.updateOne({ _id: 'platform' }, { $set: { sandboxConfig: config, updatedBy: userId } }, { upsert: true });
  return { config: publicConfig(config) };
}

export async function getSandboxConnection() {
  const config = await readConfig();
  if (!config?.enabled || !config.encryptedApiKey) return null;
  return { apiKey: decryptSecret(config.encryptedApiKey, SECRET_CONTEXT), environmentId: config.environmentId, timeoutSeconds: config.timeoutSeconds, cpu: config.cpu, memoryGB: config.memoryGB, setupCommand: config.setupCommand };
}
