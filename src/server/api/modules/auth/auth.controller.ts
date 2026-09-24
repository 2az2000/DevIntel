import type { Request, Response } from 'express';
import { created, noContent, ok } from '../../http.js';
import { body, params } from '../../middleware/validate.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  setSessionCookie,
} from '../../middleware/authenticate.js';
import { userIdOf } from '../../middleware/tenant.js';
import * as authService from './auth.service.js';
import * as sessions from './session.service.js';
import type { LoginInput, RegisterInput } from './dto.js';

/**
 * HTTP in, service call, HTTP out. No business branching lives here.
 */

const sessionContext = (req: Request) => ({
  ...(req.ip ? { ip: req.ip } : {}),
  ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
});

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(body<RegisterInput>(req), new Date(), sessionContext(req));
  setSessionCookie(res, result.session.token, result.session.expiresAt);
  created(req, res, { user: result.user });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(body<LoginInput>(req), new Date(), sessionContext(req));
  setSessionCookie(res, result.session.token, result.session.expiresAt);
  ok(req, res, { user: result.user });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const cookies = req.cookies as Record<string, string> | undefined;
  const token = sessions.requireSession(cookies?.[SESSION_COOKIE]);

  const result = await authService.refresh(token, new Date(), sessionContext(req));
  setSessionCookie(res, result.session.token, result.session.expiresAt);
  ok(req, res, { refreshed: true });
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (req.auth) await sessions.revokeSession(req.auth.sessionId, new Date());
  clearSessionCookie(res);
  noContent(res);
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  const revoked = await sessions.revokeAllForUser(userIdOf(req), new Date());
  clearSessionCookie(res);
  ok(req, res, { revoked });
}

export async function me(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req);
  const [user, workspaces] = await Promise.all([
    authService.currentUser(userId),
    authService.memberships(userId),
  ]);
  ok(req, res, { user, workspaces });
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const items = await sessions.listSessions(userIdOf(req), new Date());
  ok(req, res, { sessions: items, current: req.auth?.sessionId ?? null });
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const userId = userIdOf(req);

  // Scoped to the caller's own sessions: revoking by id alone would let anyone
  // log anyone else out.
  const owned = await sessions.listSessions(userId, new Date());
  if (!owned.some((s) => s.id === id)) {
    noContent(res); // 404-equivalent: never confirm another user's session id
    return;
  }

  await sessions.revokeSession(id, new Date());
  noContent(res);
}
