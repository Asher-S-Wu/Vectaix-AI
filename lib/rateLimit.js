/** 单实例常驻服务使用的内存限流器。 */

const rateLimitMap = new Map();

const CLEANUP_INTERVAL = 60 * 1000;
const MAX_ENTRIES = 10000;
let lastCleanup = Date.now();

function cleanup(force = false) {
  const now = Date.now();
  
  if (!force && rateLimitMap.size < MAX_ENTRIES && now - lastCleanup < CLEANUP_INTERVAL) {
    return;
  }

  lastCleanup = now;

  for (const [key, data] of rateLimitMap.entries()) {
    if (data.resetTime <= now) {
      rateLimitMap.delete(key);
    }
  }

  if (rateLimitMap.size > MAX_ENTRIES) {
    const overflow = rateLimitMap.size - MAX_ENTRIES;
    const entries = Array.from(rateLimitMap.entries())
      .sort((a, b) => a[1].resetTime - b[1].resetTime);
    for (let i = 0; i < overflow; i++) {
      rateLimitMap.delete(entries[i][0]);
    }
  }
}

export function rateLimit(key, { limit = 5, windowMs = 60 * 1000 } = {}) {
  const forceCleanup = rateLimitMap.size >= MAX_ENTRIES;
  cleanup(forceCleanup);

  const now = Date.now();
  const data = rateLimitMap.get(key);

  if (!data || now > data.resetTime) {
    const resetTime = now + windowMs;
    rateLimitMap.set(key, { count: 1, resetTime });
    return { success: true, remaining: limit - 1, resetTime };
  }

  if (data.count >= limit) {
    return { success: false, remaining: 0, resetTime: data.resetTime };
  }

  data.count++;
  return { success: true, remaining: limit - data.count, resetTime: data.resetTime };
}

export function getClientIP(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
