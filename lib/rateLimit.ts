/**
 * Best-effort in-memory rate limiting for the public demo.
 *
 * Two gates: a per-IP window (stops one visitor hammering) and a global daily
 * cap (bounds total model calls). On serverless each instance keeps its own
 * counters, so this blunts casual abuse but is NOT a hard distributed guarantee.
 * The real money ceiling is a monthly budget limit set on the API key in the
 * Anthropic Console. For a hard app-level cap, back these counters with a shared
 * store (Vercel KV / Upstash Redis) instead of the in-memory maps below.
 *
 * Tunable via env: RATE_LIMIT_PER_MIN (default 5), DAILY_REQUEST_CAP (default 500).
 */
const PER_IP_MAX = Number(process.env.RATE_LIMIT_PER_MIN ?? 5); // requests / minute / IP
const PER_IP_WINDOW_MS = 60_000;
const DAILY_CAP = Number(process.env.DAILY_REQUEST_CAP ?? 500); // total admitted requests / day

type Window = { count: number; resetAt: number };
const ipWindows = new Map<string, Window>();
let dayCount = 0;
let dayResetAt = 0;

export type RateLimitResult = { ok: true } | { ok: false; error: string; retryAfter: number };

/** Best-guess client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();

  // Global daily cap — reset on the day boundary.
  if (now >= dayResetAt) {
    dayCount = 0;
    dayResetAt = now + 86_400_000;
  }
  if (dayCount >= DAILY_CAP) {
    return {
      ok: false,
      error: 'This demo has reached its daily request limit. Please try again tomorrow.',
      retryAfter: Math.ceil((dayResetAt - now) / 1000),
    };
  }

  // Per-IP fixed window.
  const w = ipWindows.get(ip);
  if (w && now < w.resetAt) {
    if (w.count >= PER_IP_MAX) {
      return {
        ok: false,
        error: 'Too many requests — give it a few seconds and try again.',
        retryAfter: Math.ceil((w.resetAt - now) / 1000),
      };
    }
    w.count++;
  } else {
    ipWindows.set(ip, { count: 1, resetAt: now + PER_IP_WINDOW_MS });
  }

  // Bound memory: drop expired windows if the map grows large.
  if (ipWindows.size > 5000) {
    for (const [k, v] of ipWindows) if (now >= v.resetAt) ipWindows.delete(k);
  }

  dayCount++; // only admitted (non-rejected) requests count toward the daily cap
  return { ok: true };
}
