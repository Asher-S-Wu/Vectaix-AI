export const CHAT_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 60 * 1000 });

/** 媒体聊天请求体最大字节数（2 MB） */
export const MAX_REQUEST_BYTES = 2_000_000;

/** 文本聊天及会话写入请求体最大字节数（12 MiB） */
export const TEXT_CHAT_MAX_REQUEST_BYTES = 12_582_912;

/** SSE 首包填充，用于绕过某些代理/CDN 的缓冲策略 */
export const SSE_PADDING = " ".repeat(2048);

export const HEARTBEAT_INTERVAL_MS = 15_000;
