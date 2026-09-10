import { stopTasksForSettings } from './stopTasks';
import { closeBrowser } from '@/lib/server/browser/service';
import UserSettings from "@/models/UserSettings";
import {
  bindStoredFiles,
  buildStoredFileUrl,
  deleteStoredFileDocument,
  findOwnedStoredFile,
} from "@/lib/server/storage/service";
import { normalizeFileId } from "@/lib/shared/fileIds";
import { validatePreferences, DEFAULT_ASSISTANT, DEFAULT_APPEARANCE, DEFAULT_PERMISSIONS } from '@/lib/shared/preferences.mjs';

const MAX_PROMPT_NAME_LENGTH = 50;
const MAX_PROMPT_CONTENT_LENGTH = 10000;
const MAX_CHAT_SYSTEM_PROMPT_LENGTH = 10000;

function validatePromptFields({ name, content }, { requirePromptId = false, promptId } = {}) {
  if (requirePromptId && !promptId) throw new Error("promptId, name and content are required");
  if (!name || !content) throw new Error("Name and content are required");
  if (typeof name !== "string" || name.length > MAX_PROMPT_NAME_LENGTH) {
    throw new Error(`Name must be a string and cannot exceed ${MAX_PROMPT_NAME_LENGTH} characters`);
  }
  if (typeof content !== "string" || content.length > MAX_PROMPT_CONTENT_LENGTH) {
    throw new Error(`Content must be a string and cannot exceed ${MAX_PROMPT_CONTENT_LENGTH} characters`);
  }
}

function serializeSettings(settings) {
  const item = typeof settings?.toObject === "function" ? settings.toObject() : settings;
  return {
    ...item,
    avatar: item?.avatarFileId ? buildStoredFileUrl(item.avatarFileId) : null,
  };
}

function normalizeChatSystemPrompt(chatSystemPrompt) {
  if (chatSystemPrompt === undefined) return undefined;
  if (chatSystemPrompt === null) return "";
  if (typeof chatSystemPrompt !== "string") throw new Error("chatSystemPrompt must be a string");
  if (chatSystemPrompt.length > MAX_CHAT_SYSTEM_PROMPT_LENGTH) {
    throw new Error(`chatSystemPrompt cannot exceed ${MAX_CHAT_SYSTEM_PROMPT_LENGTH} characters`);
  }
  return chatSystemPrompt;
}

function validateChatMediaSettings(value) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 20000) {
    throw new Error("创作设置无效");
  }
  const allowed = new Set(["image", "audio", "video", "enhancement"]);
  if (Object.keys(value).some(key => !allowed.has(key) || !value[key] || typeof value[key] !== "object" || Array.isArray(value[key]))) {
    throw new Error("创作设置无效");
  }
}

function normalizeNickname(nickname) {
  if (nickname === undefined) return undefined;
  if (nickname === null) return "";
  if (typeof nickname !== "string") throw new Error("nickname must be a string");
  if (nickname.length > 50) throw new Error("nickname cannot exceed 50 characters");
  return nickname;
}

export async function getUserSettings(userId) {
  const settings = await UserSettings.findOne({ userId });
  if (!settings) {
    return serializeSettings({
      systemPrompts: [],
      avatarFileId: null,
      nickname: "",
      chatSystemPrompt: "",
      chatMediaSettings: {},
      assistant: { ...DEFAULT_ASSISTANT },
      appearance: { ...DEFAULT_APPEARANCE },
      permissions: { ...DEFAULT_PERMISSIONS },
    });
  }
  return serializeSettings(settings);
}

async function ensureSettingsDocument(userId) {
  let settings = await UserSettings.findOne({ userId });
  if (!settings) {
    settings = await UserSettings.create({
      userId,
      systemPrompts: [],
      avatarFileId: null,
      nickname: "",
      chatSystemPrompt: "",
      chatMediaSettings: {},
    });
  }
  return settings;
}

export async function addUserPrompt(userId, { name, content }) {
  validatePromptFields({ name, content });
  const settings = await ensureSettingsDocument(userId);
  settings.systemPrompts = Array.isArray(settings.systemPrompts)
    ? [...settings.systemPrompts, { name, content }]
    : [{ name, content }];
  settings.updatedAt = Date.now();
  await settings.save();
  return serializeSettings(settings);
}

export async function deleteUserPrompt(userId, promptId) {
  const settings = await UserSettings.findOne({ userId });
  if (!settings) throw new Error("Settings not found");
  const targetPrompt = settings.systemPrompts.find((prompt) => prompt._id.toString() === promptId);
  if (!targetPrompt) throw new Error("Prompt not found");
  settings.systemPrompts = settings.systemPrompts.filter((prompt) => prompt._id.toString() !== promptId);
  settings.updatedAt = Date.now();
  await settings.save();
  return serializeSettings(settings);
}

export async function updateUserProfileSettings(userId, body = {}) {
  const { avatarFileId, chatSystemPrompt, chatMediaSettings, nickname } = body;
  const preferences = validatePreferences(body);
  validateChatMediaSettings(chatMediaSettings);
  const normalizedChatSystemPrompt = normalizeChatSystemPrompt(chatSystemPrompt);
  const normalizedNickname = normalizeNickname(nickname);
  if (avatarFileId === undefined && normalizedChatSystemPrompt === undefined && normalizedNickname === undefined && chatMediaSettings === undefined && !Object.keys(preferences).length) {
    throw new Error("No settings to update");
  }

  const settings = await ensureSettingsDocument(userId);
  if (preferences.assistant?.avatarFileId) {
    const image = await findOwnedStoredFile({ userId, fileId: preferences.assistant.avatarFileId });
    if (!image || image.category !== 'image' || image.kind !== 'avatar') throw new Error('助手头像不存在或无权访问');
    await bindStoredFiles({ userId, fileIds: [image.fileId], ownerType: 'avatar', ownerId: userId });
  }
  const previousAssistantAvatar = preferences.assistant?.avatarFileId !== undefined && settings.assistant.avatarFileId !== preferences.assistant.avatarFileId ? settings.assistant.avatarFileId : null;
  for (const [key, value] of Object.entries(preferences)) settings[key] = { ...settings[key], ...value };
  let previousAvatar = null;
  if (avatarFileId !== undefined) {
    const normalized = avatarFileId === null ? null : normalizeFileId(avatarFileId);
    if (avatarFileId !== null && !normalized) throw new Error("头像文件无效");
    if (normalized) {
      const file = await findOwnedStoredFile({ userId, fileId: normalized });
      if (!file || file.category !== "image" || file.kind !== "avatar") {
        throw new Error("头像文件不存在或无权访问");
      }
      await bindStoredFiles({ userId, fileIds: [normalized], ownerType: "avatar", ownerId: userId });
    }
    if (settings.avatarFileId && settings.avatarFileId !== normalized) {
      previousAvatar = await findOwnedStoredFile({ userId, fileId: settings.avatarFileId });
    }
    settings.avatarFileId = normalized;
  }
  if (normalizedChatSystemPrompt !== undefined) settings.chatSystemPrompt = normalizedChatSystemPrompt;
  if (normalizedNickname !== undefined) settings.nickname = normalizedNickname;
  if (chatMediaSettings !== undefined) settings.chatMediaSettings = chatMediaSettings;

  settings.updatedAt = Date.now();
  await settings.save();
  if (previousAssistantAvatar && previousAssistantAvatar !== settings.avatarFileId) {
    const file = await findOwnedStoredFile({userId,fileId:previousAssistantAvatar});
    if (file) await deleteStoredFileDocument(file);
  }
  if (previousAvatar && settings.assistant.avatarFileId !== previousAvatar.fileId) await deleteStoredFileDocument(previousAvatar);
  if (preferences.permissions && Object.values(preferences.permissions).includes(false)) await stopTasksForSettings(userId);
  if (preferences.permissions?.browser === false) await closeBrowser(userId);
  return serializeSettings(settings);
}

export async function updateUserPrompt(userId, { promptId, name, content }) {
  validatePromptFields({ name, content }, { requirePromptId: true, promptId });
  const settings = await UserSettings.findOne({ userId });
  if (!settings) throw new Error("Settings not found");
  const prompt = settings.systemPrompts?.id?.(promptId);
  if (!prompt) throw new Error("Prompt not found");
  prompt.name = String(name);
  prompt.content = String(content);
  settings.updatedAt = Date.now();
  await settings.save();
  return serializeSettings(settings);
}
