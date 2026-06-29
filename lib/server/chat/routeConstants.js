/**
 * 各 API route 共享的常量配置
 *
 * 将原本分散在 openai/anthropic/google/bytedance/fusion 等
 * route 中重复定义的常量统一到此处管理。
 */

/** 聊天接口默认速率限制（每分钟 30 次） */
export const CHAT_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 60 * 1000 });

/** 请求体最大字节数（2 MB） */
export const MAX_REQUEST_BYTES = 2_000_000;

/** SSE 首包填充，用于绕过某些代理/CDN 的缓冲策略 */
export const SSE_PADDING = " ".repeat(2048);

/** SSE 心跳间隔（毫秒） */
export const HEARTBEAT_INTERVAL_MS = 15_000;
