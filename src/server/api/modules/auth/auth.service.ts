import { systemClient } from '@db';
import { ConflictError, UnauthenticatedError } from '@shared/errors.js';
import { hashPassword, verifyPassword, burnPasswordTime } from './password.js';
import {
  findValidSession,
  issueSession,
  revokeChain,
  revokeSession,
  type IssuedSession,
  type SessionContext,
} from './session.service.js';
import type { LoginInput, RegisterInput } from './dto.js';

/**
 * Authentication business logic. No req/res here — the controller translates
 * HTTP, this decides.
 */

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface AuthResult {
  readonly user: AuthenticatedUser;
  readonly session: IssuedSession;
}

export async function register(
  input: RegisterInput,
  now: Date,
  ctx: SessionContext,
): Promise<AuthResult> {
  const db = systemClient();

  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new ConflictError('An account with this email already exists');

  const user = await db.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      ...(input.name ? { name: input.name } : {}),
      lastLoginAt: now,
    },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });

  return { user, session: await issueSession(user.id, now, ctx) };
}

export async function login(
  input: LoginInput,
  now: Date,
  ctx: SessionContext,
): Promise<AuthResult> {
  const db = systemClient();

  const user = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true, avatarUrl: true, passwordHash: true },
  });

  // Same work and the same message whether the account exists, has no password
  // (OAuth-only), or the password is wrong. Three different truths, one
  // response — otherwise the endpoint enumerates accounts.
  if (!user?.passwordHash) {
    await burnPasswordTime(input.password);
    throw new UnauthenticatedError('Incorrect email or password');
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new UnauthenticatedError('Incorrect email or password');
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });

  return {
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    session: await issueSession(user.id, now, ctx),
  };
}

export interface RefreshOutcome {
  readonly session: IssuedSession;
  readonly userId: string;
  /** True when a rotated token was replayed and the chain was revoked. */
  readonly reuseDetected: boolean;
}

/**
 * Rotation with reuse detection.
 *
 * Every refresh issues a new token and revokes the old one. Presenting an
 * already-revoked token means either a thief is using a stolen copy or the
 * legitimate holder is replaying — indistinguishable, so the whole chain dies.
 */
export async function refresh(
  token: string,
  now: Date,
  ctx: SessionContext,
): Promise<RefreshOutcome> {
  const session = await findValidSession(token, now);
  if (!session) throw new UnauthenticatedError('Session expired or invalid');

  if (session.reused) {
    await revokeChain(session.id, now);
    throw new UnauthenticatedError('Session reuse detected; all sessions revoked');
  }

  await revokeSession(session.id, now);
  const issued = await issueSession(session.userId, now, ctx, session.id);

  return { session: issued, userId: session.userId, reuseDetected: false };
}

export async function currentUser(userId: string): Promise<AuthenticatedUser | null> {
  return systemClient().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });
}

export async function memberships(userId: string) {
  return systemClient().workspaceMember.findMany({
    where: { userId },
    select: {
      role: true,
      joinedAt: true,
      workspace: { select: { id: true, name: true, slug: true, timezone: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });
}
