// In-memory, per-user rate limits: a cost guard for the public demo, which spends Prakhar's OpenAI
// key. One process only. Counts reset on restart, which is fine for a single Railway instance.
import { HttpError } from './errors.js';

/** Sliding window: at most `limit` takes per `windowMs` per key. */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  return {
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { ok: true };
    },
  };
}

/** Middleware, after requireUser: 429 RATE_LIMITED with Retry-After. */
export function rateLimit(limiter, what) {
  return (req, res, next) => {
    const r = limiter.take(req.userId);
    if (r.ok) return next();
    res.set('Retry-After', String(r.retryAfterSeconds));
    return next(new HttpError(429, 'RATE_LIMITED', `Too many ${what}. Try again in ${r.retryAfterSeconds} seconds.`));
  };
}
