import 'dotenv/config';
import { systemClient, disconnect } from '../index.js';
import { hashPassword } from '../../server/api/modules/auth/password.js';
import { SEED_ORG } from '@providers';
import { runDiscover, runResource, type ResourceJob } from '../../server/worker/stages/ingest.js';
import { logger } from '../../server/api/logger.js';

/**
 * `pnpm db:seed` — a workspace with twelve months of activity, from nothing.
 *
 * This runs the ingest stages DIRECTLY rather than through BullMQ. Two reasons:
 * a first-time contributor should not need Redis and a running worker to see
 * the product work, and the seed becomes a straight-line script whose failure
 * points at one thing. The stages are the same functions the worker calls, so
 * this exercises the real pipeline, not a parallel implementation.
 *
 * Idempotent: run it as many times as you like. Uniqueness on
 * `(provider, eventType, externalId, contentHash)` makes a re-run a no-op.
 */

const OWNER_EMAIL = 'owner@devintel.test';
const OWNER_PASSWORD = 'correct-horse-battery-staple';
const WORKSPACE_SLUG = 'devintel-labs';

async function main(): Promise<void> {
  const db = systemClient();
  const started = Date.now();

  // ── Owner ────────────────────────────────────────────────────────────────
  const user = await db.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      name: 'Seed Owner',
      passwordHash: await hashPassword(OWNER_PASSWORD),
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  // ── Workspace ────────────────────────────────────────────────────────────
  const existing = await db.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { id: true },
  });

  const workspace = existing
    ? await db.workspace.update({
        where: { id: existing.id },
        data: { deletedAt: null },
        select: { id: true },
      })
    : await db.workspace.create({
        data: {
          name: 'DevIntel Labs',
          slug: WORKSPACE_SLUG,
          ownerUserId: user.id,
          timezone: 'UTC',
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
        select: { id: true },
      });

  // ── Integration ──────────────────────────────────────────────────────────
  //
  // The anchor is pinned on first creation and never changed. Re-seeding a
  // week later must reproduce the SAME twelve months, or the uniqueness key
  // sees different payloads and stages a second copy of history.
  //
  // Truncated to midnight UTC so the value is readable and so two machines
  // seeding the same day from a shared database agree.
  const anchor = new Date();
  anchor.setUTCHours(0, 0, 0, 0);

  const integration = await db.integration.upsert({
    where: {
      workspaceId_provider_externalAccountId: {
        workspaceId: workspace.id,
        provider: 'SEED',
        externalAccountId: SEED_ORG,
      },
    },
    // Deliberately NOT updating providerMetadata: an existing integration keeps
    // the anchor it was created with.
    update: { status: 'ACTIVE' },
    create: {
      workspaceId: workspace.id,
      provider: 'SEED',
      externalAccountId: SEED_ORG,
      accountLogin: SEED_ORG,
      scopes: ['repo:read'],
      status: 'ACTIVE',
      providerMetadata: { seedAnchor: anchor.toISOString() },
    },
    select: { id: true, providerMetadata: true },
  });

  const pinned = (integration.providerMetadata as { seedAnchor?: string }).seedAnchor;
  logger.info({ seedAnchor: pinned }, 'dataset anchor');

  const run = await db.syncRun.create({
    data: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      kind: 'INITIAL',
      status: 'RUNNING',
      stats: {},
    },
    select: { id: true },
  });

  // ── Ingest ───────────────────────────────────────────────────────────────
  logger.info({ workspace: WORKSPACE_SLUG }, 'discovering repositories');

  await runDiscover({
    workspaceId: workspace.id,
    integrationId: integration.id,
    syncRunId: run.id,
  });

  const repositories = await db.rawEvent.findMany({
    where: { workspaceId: workspace.id, eventType: 'repository' },
    select: { payload: true },
  });

  const resources: ResourceJob['resource'][] = ['COMMITS', 'PULL_REQUESTS', 'ISSUES'];

  for (const row of repositories) {
    const repo = row.payload as { externalId: string; owner: string; name: string };

    for (const resource of resources) {
      await runResource({
        workspaceId: workspace.id,
        integrationId: integration.id,
        syncRunId: run.id,
        repositoryExternalId: repo.externalId,
        owner: repo.owner,
        name: repo.name,
        resource,
      });
    }

    logger.info({ repository: repo.name }, 'ingested');
  }

  await db.syncRun.update({
    where: { id: run.id },
    data: { status: 'SUCCEEDED', finishedAt: new Date() },
  });

  // ── Report ───────────────────────────────────────────────────────────────
  const counts = await db.rawEvent.groupBy({
    by: ['eventType'],
    where: { workspaceId: workspace.id },
    _count: { _all: true },
  });

  const summary = Object.fromEntries(counts.map((c) => [c.eventType, c._count._all]));

  logger.info(
    { seconds: ((Date.now() - started) / 1000).toFixed(1), ...summary },
    'seed complete',
  );

  console.warn(
    [
      '',
      '  Workspace : ' + WORKSPACE_SLUG,
      '  Sign in   : ' + OWNER_EMAIL + ' / ' + OWNER_PASSWORD,
      '',
      '  Staged events:',
      ...Object.entries(summary).map(([k, v]) => `    ${k.padEnd(22)} ${String(v).padStart(7)}`),
      '',
      '  Domain rows (repositories, commits, pull requests) arrive in M3,',
      '  when the normalize stage turns these raw events into them.',
      '',
    ].join('\n'),
  );
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(() => void disconnect());
