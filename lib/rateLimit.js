/** 单实例常驻服务使用的内存限流器。 */

const rateLimitMap = new Map();

// Clean up expired entries periodically
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
const MAX_ENTRIES = 10000; // 最大条目数，超过时强制清理
let lastCleanup = Date.now();

function cleanup(force = false) {
  const now = Date.now();
  
  // 强制清理：超过最大条目数时
  if (!force && rateLimitMap.size < MAX_ENTRIES && now - lastCleanup < CLEANUP_INTERVAL) {
    return;
  }

  lastCleanup = now;

  for (const [key, data] of rateLimitMap.entries()) {
    // 到达窗口结束时间就应立即清理
    if (data.resetTime <= now) {
      rateLimitMap.delete(key);
    }
  }

  // 强制清理后仍超限时，按最早过期优先淘汰
  if (rateLimitMap.size > MAX_ENTRIES) {
    const overflow = rateLimitMap.size - MAX_ENTRIES;
    const entries = Array.from(rateLimitMap.entries())
      .sort((a, b) => a[1].resetTime - b[1].resetTime);
    for (let i = 0; i < overflow; i++) {
      rateLimitMap.delete(entries[i][0]);
    }
  }
}

/**
 * Rate limit function
 * @param {string} key - Unique identifier (e.g., IP + endpoint)
 * @param {Object} options - Rate limit options
 * @param {number} options.limit - Max requests per window
 * @param {number} options.windowMs - Time window in milliseconds
 * @returns {{ success: boolean, remaining: number, resetTime: number }}
 */
export function rateLimit(key, { limit = 5, windowMs = 60 * 1000 } = {}) {
  // 如果条目数超过阈值，强制清理
  const forceCleanup = rateLimitMap.size >= MAX_ENTRIES;
  cleanup(forceCleanup);

  const now = Date.now();
  const data = rateLimitMap.get(key);

  if (!data || now > data.resetTime) {
    // Start new window
    const resetTime = now + windowMs;
    rateLimitMap.set(key, { count: 1, resetTime });
    return { success: true, remaining: limit - 1, resetTime };
  }

  if (data.count >= limit) {
    // Rate limit exceeded
    return { success: false, remaining: 0, resetTime: data.resetTime };
  }

  // Increment count
  data.count++;
  return { success: true, remaining: limit - data.count, resetTime: data.resetTime };
}

/**
 * Get client IP from request headers
 * @param {Request} req - The request object
 * @returns {string} - The client IP address
 */
export function getClientIP(req) {
  const firstIp = (value) => {
    if (!value || typeof value !== 'string') return null;
    const ip = value.split(',')[0]?.trim();
    return ip || null;
  };

  return firstIp(req.headers.get('x-forwarded-for')) || 'unknown';
}
