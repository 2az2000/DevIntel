import type { Request, RequestHandler } from 'express';
import { RateLimitedError } from '@shared/errors.js';
import { redis } from '../redis.js';

/**
 * Sliding-window rate limiting in Redis.
 *
 * Mounted BEFORE authentication, so credential stuffing costs the attacker
 * before it costs the database.
 *
 * Reference: docs/04-api.md §7.1
 */

export interface RateLimitOptions {
  /** Window length in seconds. */
  readonly windowSeconds: number;
  readonly max: number;
  /** Namespace, so two limiters never share a bucket. */
  readonly bucket: string;
  /** Defaults to user id when authenticated, IP otherwise. */
  readonly keyFn?: (req: Request) => string | null;
}

const defaultKey = (req: Request): string => req.auth?.userId ?? req.ip ?? 'unknown';

/**
 * A sorted set per key: members are timestamps, expired entries are trimmed on
 * each call. More accurate than a fixed window, which lets 2× the limit through
 * at a window boundary.
 */
export async function consume(
  bucket: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const redisKey = `rl:${bucket}:${key}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const pipeline = redis.multi();
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  pipeline.zadd(redisKey, now, `${now}-${Math.random().toString(36).slice(2, 10)}`);
  pipeline.zcard(redisKey);
  pipeline.expire(redisKey, windowSeconds);

  const results = await pipeline.exec();
  const countEntry = results?.[2];
  const count = typeof countEntry?.[1] === 'number' ? countEntry[1] : 0;

  return {
    allowed: count <= max,
    retryAfter: windowSeconds,
  };
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const keyFn = options.keyFn ?? defaultKey;

  return (req, res, next) => {
    const key = keyFn(req);
    if (key === null) {
      next();
      return;
    }

    void consume(options.bucket, key, options.max, options.windowSeconds)
      .then(({ allowed, retryAfter }) => {
        if (allowed) {
          next();
          return;
        }
        res.setHeader('Retry-After', String(retryAfter));
        next(new RateLimitedError('Too many requests', retryAfter));
      })
      .catch((err: unknown) => {
        // Redis being down must not lock everyone out of the product. The
        // failure is logged and the request proceeds — availability wins over
        // a limiter that is itself unavailable.
        req.log.warn({ err }, 'rate limiter unavailable, allowing request');
        next();
      });
  };
}

/**
 * Login is limited per IP *and* per email. Per-IP alone lets an attacker spread
 * attempts across a botnet against one account; per-email alone lets one IP
 * spray many accounts.
 */
export const loginLimiter = (): RequestHandler => {
  const byIp = rateLimit({ bucket: 'login:ip', max: 5, windowSeconds: 900 });
  const byEmail = rateLimit({
    bucket: 'login:email',
    max: 5,
    windowSeconds: 900,
    keyFn: (req) => {
      const parsed: unknown = req.body;
      if (parsed && typeof parsed === 'object' && 'email' in parsed) {
        const email = (parsed).email;
        if (typeof email === 'string') return email.trim().toLowerCase();
      }
      return null;
    },
  });

  return (req, res, next) => {
    byIp(req, res, (err) => (err ? next(err) : byEmail(req, res, next)));
  };
};
