import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '@api/app.js';
import { redis } from '@api/redis.js';
import { systemClient } from '@db';
import { TENANT_SCOPED_MODEL_NAMES, GLOBAL_MODEL_NAMES } from '@db/tenant-models.generated.js';

/**
 * Shared fixtures for the integration suite.
 *
 * Every test starts from an empty database rather than sharing rows, which is
 * what keeps the suite order-independent — a shared mutable fixture is the most
 * common source of a flaky integration test.
 */

let app: Express | undefined;

export function testApp(): Express {
  app ??= createApp();
  return app;
}

/** snake_case table names, derived from the same generated list the tenant
 *  client uses, so a new model is truncated without anyone updating this. */
const TABLES = [...TENANT_SCOPED_MODEL_NAMES, ...GLOBAL_MODEL_NAMES]
  .map((m) => m.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
  .map((m) => pluralize(m));

function pluralize(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch')) return `${name}es`;
  return `${name}s`;
}

export async function resetDatabase(): Promise<void> {
  const db = systemClient();
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  // One statement, so foreign keys never block the order of deletion.
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  // Rate-limit counters live in Redis and are per-IP, so without this every
  // test after the fifth registration would be refused. The limiter is
  // deliberately left ENABLED — a limiter that tests switch off is a limiter
  // nothing verifies. rate-limit.int.test.ts exercises it directly.
  // REDIS_URL points at database 15 for tests, so this touches nothing else.
  await redis.flushdb();
}

// ── Actors ──────────────────────────────────────────────────────────────────

export interface Actor {
  readonly email: string;
  readonly userId: string;
  /** The raw Set-Cookie value, replayed on subsequent requests. */
  readonly cookie: string;
}

let counter = 0;

export async function registerActor(name = 'user'): Promise<Actor> {
  counter += 1;
  const email = `${name}-${counter}@example.test`;

  const res = await request(testApp())
    .post('/api/v1/auth/register')
    .send({ email, password: 'correct-horse-battery-staple', name });

  if (res.status !== 201) {
    throw new Error(`registerActor failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? (raw[0] ?? '') : String(raw ?? '');

  const userId = await systemClient()
    .user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    .then((u) => u.id);

  return { email, userId, cookie };
}

export async function createWorkspace(actor: Actor, slug: string): Promise<string> {
  const res = await request(testApp())
    .post('/api/v1/workspaces')
    .set('Cookie', actor.cookie)
    .send({ name: slug, slug });

  if (res.status !== 201) {
    throw new Error(`createWorkspace failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.workspace.id as string;
}

/** Adds an existing actor to a workspace with a given role. */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER',
): Promise<void> {
  await systemClient().workspaceMember.create({
    data: { workspaceId, userId, role },
  });
}

export const api = () => request(testApp());
