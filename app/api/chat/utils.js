import { normalizeFileId } from '@/lib/shared/fileIds';

/**
 * 共用工具函数 - Gemini 和 Claude API 都会使用
 */

// ── 节假日 & 节气缓存（每天只请求一次外部 API） ──
let _holidayCache = { date: '', holiday: null, festival: null };

function getTodayDateString() {
    try {
        const formatter = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric', month: '2-digit', day: '2-digit',
        });
        const parts = formatter.formatToParts(new Date());
        const map = {};
        for (const p of parts) map[p.type] = p.value;
        return `${map.year}-${map.month}-${map.day}`;
    } catch {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
}

async function fetchHolidayInfo(dateStr) {
    try {
        const res = await fetch(`https://timor.tech/api/holiday/info/${dateStr}`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.code !== 0) return null;
        return data;
    } catch {
        return null;
    }
}

async function fetchFestivalInfo(dateStr) {
    try {
        const res = await fetch(`https://festival.wifilu.com/festival.php?format=json&date=${dateStr}`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function getHolidayAndFestival() {
    const today = getTodayDateString();
    if (_holidayCache.date === today) {
        return { holiday: _holidayCache.holiday, festival: _holidayCache.festival };
    }
    const [holiday, festival] = await Promise.all([
        fetchHolidayInfo(today),
        fetchFestivalInfo(today),
    ]);
    _holidayCache = { date: today, holiday, festival };
    return { holiday, festival };
}

function buildHolidayText(holiday, festival) {
    const lines = [];

    // 来自 timor.tech：日期类型 & 节假日信息
    if (holiday) {
        const typeMap = { 0: '工作日', 1: '周末', 2: '节日', 3: '调休' };
        const t = holiday.type;
        if (t) {
            const weekMap = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
            lines.push(`今日类型：${typeMap[t.type] ?? '未知'}（${weekMap[t.week] ?? t.name ?? ''}）`);
        }
        const h = holiday.holiday;
        if (h) {
            if (h.holiday) {
                lines.push(`今日是法定节假日「${h.name}」（${h.wage}倍工资）`);
            } else {
                lines.push(`今日是「${h.name}」（调休，${h.target ? `为${h.target}补班` : '补班日'}）`);
            }
        }
    }

    // 来自 festival.wifilu.com：农历 & 节气/传统节日
    if (festival) {
        if (festival.lunar_year && festival.lunar_month && festival.lunar_day) {
            lines.push(`农历：${festival.lunar_year}年${festival.lunar_month}${festival.lunar_day}`);
        }
        if (festival.solar_term) {
            lines.push(`节气：${festival.solar_term}`);
        }
        if (festival.festival) {
            lines.push(`节日：${festival.festival}`);
        }
    }

    return lines.length > 0 ? lines.join('；') : '';
}

const MAX_STORED_MESSAGES = 500;
const MAX_STORED_MESSAGE_CHARS = 20000;
const MAX_STORED_PART_TEXT_CHARS = 10000;
const MAX_STORED_PARTS_PER_MESSAGE = 20;
const MAX_STORED_MESSAGE_ID_CHARS = 128;
const MAX_STORED_TOTAL_TEXT_CHARS = 1_000_000;

function createValidationError(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

export function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

export function generateMessageId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return `msg_${Date.now()}_${rand}`;
}

export function getStoredPartsFromMessage(msg, { includeThoughtSignature = false } = {}) {
    if (!msg || typeof msg !== 'object') return null;

    if (Array.isArray(msg.parts) && msg.parts.length > 0) {
        const normalizedParts = msg.parts
            .filter((part) => part && typeof part === 'object')
            .map((part) => {
                const out = {};
                if (isNonEmptyString(part.text)) out.text = part.text;
                if (part.thought === true) out.thought = true;
                if (part?.inlineData && typeof part.inlineData === 'object') {
                    const fileId = normalizeFileId(part.inlineData.fileId);
                    const url = part.inlineData.url;
                    const mimeType = part.inlineData.mimeType;
                    if (fileId && isNonEmptyString(url)) {
                        out.inlineData = {
                            fileId,
                            url,
                            mimeType: isNonEmptyString(mimeType) ? mimeType : 'image/jpeg',
                        };
                    }
                }
                if (part?.fileData && typeof part.fileData === 'object') {
                    const fileId = normalizeFileId(part.fileData.fileId);
                    const url = part.fileData.url;
                    const name = part.fileData.name;
                    const mimeType = part.fileData.mimeType;
                    const extension = part.fileData.extension;
                    const category = part.fileData.category;
                    const size = Number(part.fileData.size);
                    if (fileId && isNonEmptyString(url) && isNonEmptyString(name) && isNonEmptyString(mimeType) && isNonEmptyString(extension) && isNonEmptyString(category) && Number.isFinite(size) && size >= 0) {
                        out.fileData = {
                            fileId,
                            url,
                            name,
                            mimeType,
                            size,
                            extension,
                            category,
                        };
                    }
                }
                if (includeThoughtSignature && isNonEmptyString(part.thoughtSignature)) out.thoughtSignature = part.thoughtSignature;
                return out;
            })
            .filter((part) => Object.keys(part).length > 0);
        if (normalizedParts.length > 0) return normalizedParts;
    }

    const fallbackParts = [];
    if (isNonEmptyString(msg.content)) {
        fallbackParts.push({ text: msg.content });
    }

    return fallbackParts.length > 0 ? fallbackParts : null;
}

function sanitizeStoredMessage(msg) {
    if (!msg || typeof msg !== 'object') return null;
    if (msg.role !== 'user' && msg.role !== 'model') return null;
    const normalizedParts = getStoredPartsFromMessage(msg);
    if (!normalizedParts || normalizedParts.length === 0) return null;
    const out = {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : '',
        type: typeof msg.type === 'string' ? msg.type : 'parts',
    };
    if (isNonEmptyString(msg.id) && msg.id.length <= 128) out.id = msg.id;
    if (isNonEmptyString(msg.thought)) out.thought = msg.thought;
    if (Array.isArray(msg.citations) && msg.citations.length > 0) out.citations = msg.citations;
    if (Array.isArray(msg.tools) && msg.tools.length > 0) out.tools = msg.tools;
    if (Array.isArray(msg.thinkingTimeline) && msg.thinkingTimeline.length > 0) out.thinkingTimeline = msg.thinkingTimeline;
    if (Number.isFinite(msg.searchContextTokens) && msg.searchContextTokens > 0) out.searchContextTokens = Math.max(0, Math.floor(msg.searchContextTokens));
    if (msg.providerState && typeof msg.providerState === 'object') out.providerState = msg.providerState;
    out.parts = normalizedParts;
    return out;
}

export function sanitizeStoredMessagesStrict(messages) {
    if (!Array.isArray(messages)) {
        throw createValidationError("messages must be an array");
    }
    if (messages.length > MAX_STORED_MESSAGES) {
        throw createValidationError(`messages too many (max ${MAX_STORED_MESSAGES})`);
    }

    let totalTextChars = 0;
    const sanitized = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const normalized = sanitizeStoredMessage(msg);
        if (!normalized) {
            throw createValidationError(`messages[${i}] invalid`);
        }

        if (normalized.id && normalized.id.length > MAX_STORED_MESSAGE_ID_CHARS) {
            throw createValidationError(`messages[${i}].id too long`);
        }

        if (normalized.content.length > MAX_STORED_MESSAGE_CHARS) {
            throw createValidationError(`messages[${i}].content too long`);
        }

        if (normalized.thought && normalized.thought.length > MAX_STORED_MESSAGE_CHARS) {
            throw createValidationError(`messages[${i}].thought too long`);
        }

        if (!Array.isArray(normalized.parts) || normalized.parts.length === 0) {
            throw createValidationError(`messages[${i}].parts required`);
        }

        if (normalized.parts.length > MAX_STORED_PARTS_PER_MESSAGE) {
            throw createValidationError(`messages[${i}].parts too many`);
        }

        for (let pi = 0; pi < normalized.parts.length; pi++) {
            const part = normalized.parts[pi];
            if (typeof part?.text === "string") {
                if (part.text.length > MAX_STORED_PART_TEXT_CHARS) {
                    throw createValidationError(`messages[${i}].parts[${pi}].text too long`);
                }
                totalTextChars += part.text.length;
            }

            if (part?.inlineData?.url) {
                if (!normalizeFileId(part.inlineData.fileId)) {
                    throw createValidationError(`messages[${i}].parts[${pi}].image invalid`);
                }
            }
            if (part?.fileData?.url) {
                if (!normalizeFileId(part.fileData.fileId)) {
                    throw createValidationError(`messages[${i}].parts[${pi}].file invalid`);
                }
                if (!isNonEmptyString(part.fileData.name) || part.fileData.name.length > 200) {
                    throw createValidationError(`messages[${i}].parts[${pi}].file name invalid`);
                }
                if (!isNonEmptyString(part.fileData.mimeType) || part.fileData.mimeType.length > 128) {
                    throw createValidationError(`messages[${i}].parts[${pi}].file mimeType invalid`);
                }
                if (!isNonEmptyString(part.fileData.extension) || part.fileData.extension.length > 32) {
                    throw createValidationError(`messages[${i}].parts[${pi}].file extension invalid`);
                }
                if (!isNonEmptyString(part.fileData.category) || part.fileData.category.length > 32) {
                    throw createValidationError(`messages[${i}].parts[${pi}].file category invalid`);
                }
                if (!Number.isFinite(Number(part.fileData.size)) || Number(part.fileData.size) < 0) {
                    throw createValidationError(`messages[${i}].parts[${pi}].file size invalid`);
                }
            }
        }

        totalTextChars += normalized.content.length;
        if (normalized.thought) totalTextChars += normalized.thought.length;
        if (totalTextChars > MAX_STORED_TOTAL_TEXT_CHARS) {
            throw createValidationError("messages total text too large");
        }

        sanitized.push(normalized);
    }

    return sanitized;
}

export async function injectCurrentTimeSystemReminder(systemText) {
    if (typeof systemText !== 'string') return systemText;
    if (systemText.includes("<system-reminder>")) return systemText;

    let timeText = "";
    try {
        const formatter = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const parts = formatter.formatToParts(new Date());
        const map = {};
        for (const p of parts) map[p.type] = p.value;
        timeText = `${map.year}-${map.month}-${map.day}`;
    } catch {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        timeText = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // 获取节假日 & 节气信息（带缓存，每天只请求一次外部 API）
    let holidayLine = '';
    try {
        const { holiday, festival } = await getHolidayAndFestival();
        holidayLine = buildHolidayText(holiday, festival);
    } catch { /* 获取失败不影响主流程 */ }

    let reminderContent = `当前日期：${timeText}（时区：Asia/Shanghai）。你必须以此为准进行判断与回答，不要把现在当成 2024 年。`;
    if (holidayLine) {
        reminderContent += `\n${holidayLine}`;
    }

    const reminder = `\n\n<system-reminder>\n${reminderContent}\n</system-reminder>`;
    return `${systemText}${reminder}`;
}

/**
 * 服务端估算文本的 token 数量
 * 中文字符 ~1.5 token，ASCII ~0.25 token/字符，其他 ~0.5 token/字符
 */
export function estimateTokens(text) {
    if (!text || typeof text !== 'string' || text.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) {
            total += 1.5;
        } else if (c >= 0x3000 && c <= 0x303F) {
            total += 1;
        } else if (c >= 0xFF00 && c <= 0xFFEF) {
            total += 1;
        } else if (c <= 0x7F) {
            total += 0.25;
        } else {
            total += 0.5;
        }
    }
    return Math.max(1, Math.ceil(total));
}
