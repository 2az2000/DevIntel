import { beforeEach, describe, expect, it } from 'vitest';
import { systemClient } from '@db';
import { api, registerActor, resetDatabase } from './helpers.js';

beforeEach(async () => {
  await resetDatabase();
});

const password = 'correct-horse-battery-staple';

const cookieOf = (res: { headers: Record<string, unknown> }): string => {
  const raw = res.headers['set-cookie'];
  if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : '';
  return typeof raw === 'string' ? raw : '';
};

describe('registration and login', () => {
  it('registers, sets a session cookie, and never returns the password hash', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.test', password, name: 'New' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('new@example.test');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = cookieOf(res);
    expect(cookie).toContain('devintel_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('stores a hash of the session token, never the token itself', async () => {
    const actor = await registerActor();
    const token = /devintel_session=([^;]+)/.exec(actor.cookie)?.[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const sessions = await systemClient().session.findMany({ select: { tokenHash: true } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
    // A database leak must not yield usable sessions.
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a duplicate email with CONFLICT', async () => {
    await api().post('/api/v1/auth/register').send({ email: 'dup@example.test', password });
    const res = await api().post('/api/v1/auth/register').send({ email: 'dup@example.test', password });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a short password with a field-level message', async () => {
    const res = await api().post('/api/v1/auth/register').send({ email: 'x@example.test', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('password');
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.test', password, role: 'OWNER' });

    expect(res.status).toBe(400);
  });

  it('gives the same response for a wrong password and an unknown account', async () => {
    await api().post('/api/v1/auth/register').send({ email: 'real@example.test', password });

    const wrongPassword = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'real@example.test', password: 'wrong-password-entirely' });

    const unknownAccount = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.test', password });

    // Distinguishable responses would enumerate which addresses have accounts.
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
  });

  it('logs in with correct credentials', async () => {
    await api().post('/api/v1/auth/register').send({ email: 'login@example.test', password });
    const res = await api().post('/api/v1/auth/login').send({ email: 'login@example.test', password });

    expect(res.status).toBe(200);
    expect(cookieOf(res)).toContain('devintel_session=');
  });
});

describe('session rotation and reuse detection', () => {
  it('issues a new token on refresh and revokes the old one', async () => {
    const actor = await registerActor();

    const refreshed = await api().post('/api/v1/auth/refresh').set('Cookie', actor.cookie);
    expect(refreshed.status).toBe(200);

    const newCookie = cookieOf(refreshed);
    expect(newCookie).not.toBe(actor.cookie);

    const sessions = await systemClient().session.findMany({
      select: { revokedAt: true, rotatedFromId: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.revokedAt).not.toBeNull();
    expect(sessions[1]!.rotatedFromId).not.toBeNull();
  });

  /**
   * The core of the defence: a thief's use and the victim's use are
   * indistinguishable individually, but the SECOND use of an already-rotated
   * token proves one of them happened, so the whole chain dies.
   */
  it('revokes the entire chain when a rotated token is replayed', async () => {
    const actor = await registerActor();

    const first = await api().post('/api/v1/auth/refresh').set('Cookie', actor.cookie);
    const secondCookie = cookieOf(first);

    // Replay the original, already-rotated cookie.
    const replay = await api().post('/api/v1/auth/refresh').set('Cookie', actor.cookie);
    expect(replay.status).toBe(401);

    const live = await systemClient().session.count({ where: { revokedAt: null } });
    expect(live).toBe(0);

    // The token issued to the legitimate holder is dead too — correct, because
    // we cannot tell which party was the attacker.
    const afterRevocation = await api().get('/api/v1/auth/me').set('Cookie', secondCookie);
    expect(afterRevocation.status).toBe(401);
  });

  it('logs out the current session only', async () => {
    const actor = await registerActor();
    const second = await api().post('/api/v1/auth/login').send({ email: actor.email, password });

    await api().post('/api/v1/auth/logout').set('Cookie', actor.cookie);

    expect((await api().get('/api/v1/auth/me').set('Cookie', actor.cookie)).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set('Cookie', cookieOf(second))).status).toBe(200);
  });

  it('logs out everywhere', async () => {
    const actor = await registerActor();
    const second = await api().post('/api/v1/auth/login').send({ email: actor.email, password });

    const res = await api().post('/api/v1/auth/logout-all').set('Cookie', actor.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBeGreaterThanOrEqual(2);

    expect((await api().get('/api/v1/auth/me').set('Cookie', cookieOf(second))).status).toBe(401);
  });
});

describe('authentication requirements', () => {
  it('rejects /me without a session', async () => {
    const res = await api().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the user and their memberships', async () => {
    const actor = await registerActor();
    const res = await api().get('/api/v1/auth/me').set('Cookie', actor.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(actor.email);
    expect(res.body.data.workspaces).toEqual([]);
  });

  it('carries a requestId on every response', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.body.meta.requestId).toMatch(/^req_/);
    expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
  });
});
