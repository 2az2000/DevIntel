import { systemClient } from '@db';
import { generateToken, hashToken } from '@shared/crypto.js';
import { UnauthenticatedError } from '@shared/errors.js';

/**
 * Session management.
 *
 * Opaque tokens, not JWTs. The system needs immediate revocation — logout
 * everywhere, role change, reuse detection — which a stateless token cannot
 * provide without a revocation list, at which point the statelessness is gone
 * and the complexity is not.
 *
 * Sessions are global rather than tenant-scoped, so they use the system client.
 *
 * Reference: docs/04-api.md §4.1
 */

export const ACCESS_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly sessionId: string;
}

export interface SessionContext {
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

export async function issueSession(
  userId: string,
  now: Date,
  ctx: SessionContext,
  rotatedFromId?: string,
): Promise<IssuedSession> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

  const session = await systemClient().session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      kind: 'refresh',
      expiresAt,
      ...(rotatedFromId ? { rotatedFromId } : {}),
      ...(ctx.ip ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
    },
    select: { id: true },
  });

  return { token, expiresAt, sessionId: session.id };
}

export async function findValidSession(token: string, now: Date) {
  const session = await systemClient().session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      rotatedFromId: true,
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return { ...session, reused: true as const };
  if (session.expiresAt <= now) return null;

  return { ...session, reused: false as const };
}

/**
 * Revokes an entire rotation chain.
 *
 * This is the standard defence against a stolen refresh token: the thief's use
 * and the victim's use are indistinguishable individually, but the *second* use
 * of an already-rotated token proves one of them happened. Both parties are
 * logged out, which is the correct outcome — the alternative is leaving the
 * attacker with a working session.
 */
export async function revokeChain(sessionId: string, now: Date): Promise<number> {
  const db = systemClient();
  const seen = new Set<string>();
  let frontier = [sessionId];

  // Walk forward through rotations. Bounded by the chain length, and `seen`
  // guards against a cycle that a corrupt row could otherwise turn into a hang.
  while (frontier.length > 0) {
    frontier.forEach((id) => seen.add(id));
    const children = await db.session.findMany({
      where: { rotatedFromId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !seen.has(id));
  }

  // Walk backwards to the root, so revoking a leaf kills the ancestors too.
  let cursor: string | null = sessionId;
  while (cursor) {
    const parent: { rotatedFromId: string | null } | null = await db.session.findUnique({
      where: { id: cursor },
      select: { rotatedFromId: true },
    });
    cursor = parent?.rotatedFromId ?? null;
    if (cursor && !seen.has(cursor)) seen.add(cursor);
    else cursor = null;
  }

  const result = await db.session.updateMany({
    where: { id: { in: [...seen] }, revokedAt: null },
    data: { revokedAt: now },
  });

  return result.count;
}

export async function revokeSession(sessionId: string, now: Date): Promise<void> {
  await systemClient().session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function revokeAllForUser(userId: string, now: Date): Promise<number> {
  const result = await systemClient().session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count;
}

export async function listSessions(userId: string, now: Date) {
  return systemClient().session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function requireSession(token: string | undefined): string {
  if (!token) throw new UnauthenticatedError('No session cookie');
  return token;
}
