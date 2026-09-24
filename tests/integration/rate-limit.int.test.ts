import { beforeEach, describe, expect, it } from 'vitest';
import { api, resetDatabase } from './helpers.js';

/**
 * The limiter is left enabled for the whole suite (helpers flush its counters
 * between tests). This file is where it is actually exercised, so "the limiter
 * works" is a tested claim rather than an assumption.
 */

beforeEach(async () => {
  await resetDatabase();
});

const password = 'correct-horse-battery-staple';

describe('rate limiting', () => {
  it('refuses registration past the per-IP window and says when to retry', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await api()
        .post('/api/v1/auth/register')
        .send({ email: `burst-${i}@example.test`, password });
      expect(res.status, `attempt ${i + 1} should succeed`).toBe(201);
    }

    const blocked = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'burst-6@example.test', password });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBe('900');
  });

  it('limits login attempts per email, not only per IP', async () => {
    await api().post('/api/v1/auth/register').send({ email: 'target@example.test', password });

    // Five wrong-password attempts against one account.
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'target@example.test', password: 'wrong-password-here' });
    }

    const blocked = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'target@example.test', password });

    // Refused even though the password is now correct — per-email limiting is
    // what stops a botnet spreading attempts across many IPs.
    expect(blocked.status).toBe(429);
  });
});
