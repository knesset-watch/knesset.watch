/**
 * Minimal DB Rate Limiter
 * A simple in-memory rate limiter for serverless environments.
 */

const tracker = new Map<string, { count: number; lastReset: number }>();

export interface RateLimitConfig {
  limit: number;      
  windowMs: number;   
}

export function rateLimit(request: Request, config: RateLimitConfig = { limit: 10, windowMs: 60000 }) {
  // Use Vercel's trusted 'x-real-ip' to prevent header-spoofing
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';
  const now = Date.now();
  const userData = tracker.get(ip) || { count: 0, lastReset: now };

  // Reset window if expired
  if (now - userData.lastReset > config.windowMs) {
    userData.count = 0;
    userData.lastReset = now;
  }

  userData.count++;
  tracker.set(ip, userData);

  return {
    isLimited: userData.count > config.limit,
    remaining: Math.max(0, config.limit - userData.count),
    resetIn: config.windowMs - (now - userData.lastReset)
  };
}

/**
 * Auth specific slow-down
 * Adds a physical delay to failed auth attempts to thwart automated scripts.
 */
export async function authDelay(ms: number = 2000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
