import type { CookieOptions, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '@shared/errors.js';
import { isProduction } from '@shared/env.js';
import { findValidSession, REFRESH_TTL_MS, revokeChain } from '../modules/auth/session.service.js';

export const SESSION_COOKIE = 'devintel_session';

/**
 * `httpOnly` so script cannot read it, `sameSite: lax` so it is not sent on
 * cross-site POSTs (the CSRF defence, together with the Origin check),
 * `secure` in production. Host-only — no `domain` — so a compromised subdomain
 * cannot receive it.
 */
export function sessionCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    expires: expiresAt,
    maxAge: REFRESH_TTL_MS,
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' });
}

/**
 * Populates `req.auth` when a valid session cookie is present. Does not reject:
 * routes declare their own requirement, so a public route can still see who is
 * calling.
 */
export const authenticate = (): RequestHandler => (req, _res, next) => {
  const cookies = req.cookies as Record<string, string> | undefined;
  const token = cookies?.[SESSION_COOKIE];

  if (!token) {
    next();
    return;
  }

  const now = new Date();

  void findValidSession(token, now)
    .then(async (session) => {
      if (!session) return;

      // A revoked token presented as a live session is the same signal as at
      // the refresh endpoint: kill the chain rather than merely ignoring it.
      if (session.reused) {
        await revokeChain(session.id, now);
        return;
      }

      req.auth = { userId: session.userId, sessionId: session.id };
    })
    .then(() => next())
    .catch(next);
};

/** Rejects when there is no authenticated user. */
export const requireAuth = (): RequestHandler => (req, _res, next) => {
  if (!req.auth) {
    next(new UnauthenticatedError());
    return;
  }
  next();
};

/**
 * CSRF: on any state-changing request, the Origin must match an allowed one.
 * `sameSite: lax` already blocks cross-site form POSTs; this covers the cases
 * it does not, and costs one header comparison.
 */
export const checkOrigin = (allowed: string): RequestHandler => (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.get('origin');
  // Same-origin requests from non-browser clients send no Origin at all.
  if (!origin || origin === allowed) {
    next();
    return;
  }

  next(new UnauthenticatedError('Cross-origin request rejected'));
};
