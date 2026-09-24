import { beforeEach, describe, expect, it } from 'vitest';
import { systemClient } from '@db';
import { runDiscover, runResource, type ResourceJob } from '@worker/stages/ingest.js';
import { createWorkspace, registerActor, resetDatabase, type Actor } from './helpers.js';

/**
 * Ingest.
 *
 * ADR-0004's claim is that every stage produces the same result whether it runs
 * once, twice, or is interrupted halfway and restarted. That is a claim about
 * behaviour under failure, and the only way to hold it honestly is to actually
 * fail — so these tests replay pages, rewind cursors and re-run whole stages,
 * then assert the database is byte-for-byte unchanged.
 *
 * A dashboard showing 340 commits instead of 170 looks perfectly plausible, so
 * nobody reports it. These tests are the thing that catches it.
 */

const ANCHOR = new Date('2026-09-01T00:00:00.000Z');
/** One month, not twelve: the real ingest path, a tenth of the runtime. */
const MONTHS = 1;

const RESOURCES: readonly ResourceJob['resource'][] = ['COMMITS', 'PULL_REQUESTS', 'ISSUES'];

let owner: Actor;
let workspaceId: string;
let integrationId: string;
let syncRunId: string;

async function setupIntegration(overrides?: { anchor?: Date; months?: number }): Promise<void> {
  const db = systemClient();

  const integration = await db.integration.create({
    data: {
      workspaceId,
      provider: 'SEED',
      externalAccountId: 'devintel-labs',
      accountLogin: 'devintel-labs',
      scopes: ['repo:read'],
      status: 'ACTIVE',
      providerMetadata: {
        seedAnchor: (overrides?.anchor ?? ANCHOR).toISOString(),
        seedMonths: overrides?.months ?? MONTHS,
      },
    },
    select: { id: true },
  });
  integrationId = integration.id;

  const run = await db.syncRun.create({
    data: { workspaceId, integrationId, kind: 'INITIAL', status: 'RUNNING', stats: {} },
    select: { id: true },
  });
  syncRunId = run.id;
}

/** Runs discovery plus every resource for every discovered repository. */
async function ingestEverything(): Promise<void> {
  await runDiscover({ workspaceId, integrationId, syncRunId });

  const repos = await systemClient().rawEvent.findMany({
    where: { workspaceId, eventType: 'repository' },
    select: { payload: true },
  });

  for (const row of repos) {
    const repo = row.payload as { externalId: string; owner: string; name: string };
    for (const resource of RESOURCES) {
      await runResource({
        workspaceId,
        integrationId,
        syncRunId,
        repositoryExternalId: repo.externalId,
        owner: repo.owner,
        name: repo.name,
        resource,
      });
    }
  }
}

/**
 * A fingerprint of every staged row.
 *
 * Comparing counts alone would pass if ingest deleted one row and inserted
 * another; comparing content hashes proves the rows are the same rows.
 */
async function snapshot(): Promise<{ count: number; digest: string }> {
  const rows = await systemClient().rawEvent.findMany({
    where: { workspaceId },
    select: { eventType: true, externalId: true, contentHash: true },
    orderBy: [{ eventType: 'asc' }, { externalId: 'asc' }, { contentHash: 'asc' }],
  });

  return {
    count: rows.length,
    digest: rows.map((r) => `${r.eventType}|${r.externalId}|${r.contentHash}`).join('\n'),
  };
}

beforeEach(async () => {
  await resetDatabase();
  owner = await registerActor('ingest-owner');
  workspaceId = await createWorkspace(owner, 'ingest-workspace');
  await setupIntegration();
});

describe('staging', () => {
  it('populates RawEvent from the provider', async () => {
    await ingestEverything();

    const counts = await systemClient().rawEvent.groupBy({
      by: ['eventType'],
      where: { workspaceId },
      _count: { _all: true },
    });
    const of = (t: string) => counts.find((c) => c.eventType === t)?._count._all ?? 0;

    expect(of('repository')).toBe(8);
    expect(of('commit')).toBeGreaterThan(300);
    expect(of('pull_request')).toBeGreaterThan(50);
    expect(of('pull_request_review')).toBeGreaterThan(50);
    expect(of('issue')).toBeGreaterThan(20);
  });

  it('stages reviews alongside their pull request, never orphaned', async () => {
    await ingestEverything();
    const db = systemClient();

    const prIds = new Set(
      (
        await db.rawEvent.findMany({
          where: { workspaceId, eventType: 'pull_request' },
          select: { payload: true },
        })
      ).map((r) => (r.payload as { externalId: string }).externalId),
    );

    const reviews = await db.rawEvent.findMany({
      where: { workspaceId, eventType: 'pull_request_review' },
      select: { payload: true },
    });

    // Normalize must never meet a review whose pull request is missing.
    for (const r of reviews) {
      const parent = (r.payload as { pullRequestExternalId: string }).pullRequestExternalId;
      expect(prIds.has(parent), `review for missing PR ${parent}`).toBe(true);
    }
  });

  it('records the provider and integration on every row', async () => {
    await ingestEverything();
    const rows = await systemClient().rawEvent.findMany({
      where: { workspaceId },
      select: { provider: true, integrationId: true, status: true },
      take: 50,
    });

    for (const row of rows) {
      expect(row.provider).toBe('SEED');
      expect(row.integrationId).toBe(integrationId);
      // Nothing has consumed them yet; normalize flips this in M3.
      expect(row.status).toBe('PENDING');
    }
  });
});

describe('idempotency — mechanism 1, uniqueness on content', () => {
  it('changes nothing when the whole ingest runs twice', async () => {
    await ingestEverything();
    const first = await snapshot();

    await ingestEverything();
    const second = await snapshot();

    expect(second.count).toBe(first.count);
    expect(second.digest).toBe(first.digest);
  });

  it('changes nothing when run three times', async () => {
    await ingestEverything();
    await ingestEverything();
    const before = await snapshot();

    await ingestEverything();

    // Not merely "no growth" — the same rows.
    expect(await snapshot()).toEqual(before);
  });

  it('collapses a replayed page into the existing rows', async () => {
    await ingestEverything();
    const before = await snapshot();

    // Rewind one repository's cursor to the very beginning and re-run it. This
    // is what a crash mid-resource looks like on restart.
    await systemClient().syncCursor.updateMany({
      where: { integrationId, repositoryExternalId: 'r_payment-core', resource: 'COMMITS' },
      data: { cursor: null, since: null, status: 'RUNNING' },
    });

    await runResource({
      workspaceId,
      integrationId,
      syncRunId,
      repositoryExternalId: 'r_payment-core',
      owner: 'devintel-labs',
      name: 'payment-core',
      resource: 'COMMITS',
    });

    expect(await snapshot()).toEqual(before);
  });
});

describe('resumability — mechanism 4, cursor after commit', () => {
  it('leaves every cursor SUCCEEDED after a clean run', async () => {
    await ingestEverything();

    const cursors = await systemClient().syncCursor.findMany({
      where: { integrationId },
      select: { resource: true, status: true, cursor: true },
    });

    // 8 repositories x 3 resources, plus the repository listing itself.
    expect(cursors).toHaveLength(25);
    for (const c of cursors) {
      expect(c.status, `${c.resource} did not finish`).toBe('SUCCEEDED');
      // A finished resource has no page left to fetch.
      expect(c.cursor).toBeNull();
    }
  });

  it('resumes from a mid-stream cursor and still reaches every row', async () => {
    const db = systemClient();
    const repo = { externalId: 'r_frontend-platform', owner: 'devintel-labs', name: 'frontend-platform' };

    await runDiscover({ workspaceId, integrationId, syncRunId });
    await runResource({ workspaceId, integrationId, syncRunId, repositoryExternalId: repo.externalId, owner: repo.owner, name: repo.name, resource: 'COMMITS' });

    const complete = await db.rawEvent.count({ where: { workspaceId, eventType: 'commit' } });
    expect(complete).toBeGreaterThan(100);

    // Simulate a worker killed after the second page: drop everything the run
    // produced, then restart from the cursor that page had committed.
    await db.rawEvent.deleteMany({ where: { workspaceId, eventType: 'commit' } });
    await db.syncCursor.updateMany({
      where: { integrationId, repositoryExternalId: repo.externalId, resource: 'COMMITS' },
      data: { cursor: '200', status: 'RUNNING' },
    });

    await runResource({ workspaceId, integrationId, syncRunId, repositoryExternalId: repo.externalId, owner: repo.owner, name: repo.name, resource: 'COMMITS' });

    const afterResume = await db.rawEvent.count({ where: { workspaceId, eventType: 'commit' } });

    // Resumed at offset 200, so the first 200 are not re-fetched — the cursor
    // is a promise that everything before it is already durable.
    expect(afterResume).toBe(complete - 200);

    const cursor = await db.syncCursor.findFirstOrThrow({
      where: { integrationId, repositoryExternalId: repo.externalId, resource: 'COMMITS' },
      select: { status: true, cursor: true },
    });
    expect(cursor.status).toBe('SUCCEEDED');
    expect(cursor.cursor).toBeNull();
  });

  it('marks a cursor FAILED with the reason when a resource throws', async () => {
    await runDiscover({ workspaceId, integrationId, syncRunId });

    await expect(
      runResource({
        workspaceId,
        integrationId,
        syncRunId,
        repositoryExternalId: 'r_does-not-exist',
        owner: 'devintel-labs',
        name: 'does-not-exist',
        resource: 'COMMITS',
      }),
    ).rejects.toThrow(/Unknown repository/);

    const cursor = await systemClient().syncCursor.findFirstOrThrow({
      where: { integrationId, repositoryExternalId: 'r_does-not-exist', resource: 'COMMITS' },
      select: { status: true, lastError: true, lastSyncedAt: true },
    });

    expect(cursor.status).toBe('FAILED');
    expect(cursor.lastError).toMatch(/Unknown repository/);
    // A failed run must not claim it synced.
    expect(cursor.lastSyncedAt).toBeNull();
  });

  it('keys cursors in provider space, so they exist before any domain row does', async () => {
    await runDiscover({ workspaceId, integrationId, syncRunId });

    const cursor = await systemClient().syncCursor.findFirstOrThrow({
      where: { integrationId, resource: 'REPOSITORIES' },
      select: { repositoryExternalId: true, repositoryId: true, status: true },
    });

    // The empty string means "the integration itself", and repositoryId stays
    // null until normalize creates the row in M3. Keying on the foreign key
    // would make sync depend on its own output.
    expect(cursor.repositoryExternalId).toBe('');
    expect(cursor.repositoryId).toBeNull();
    expect(cursor.status).toBe('SUCCEEDED');
    expect(await systemClient().repository.count()).toBe(0);
  });
});

describe('the pinned anchor', () => {
  it('produces identical data on a later run, because the anchor does not move', async () => {
    await ingestEverything();
    const first = await snapshot();

    // A second sync days later reads the SAME pinned anchor.
    await ingestEverything();

    expect(await snapshot()).toEqual(first);
  });

  it('would produce different data with a different anchor — which is why it is pinned', async () => {
    await ingestEverything();
    const pinned = await snapshot();

    await systemClient().integration.update({
      where: { id: integrationId },
      data: {
        providerMetadata: {
          seedAnchor: new Date('2026-08-01T00:00:00.000Z').toISOString(),
          seedMonths: MONTHS,
        },
      },
    });

    await ingestEverything();
    const after = await snapshot();

    // Proof that the pin is load-bearing: without it, every run would append a
    // second copy of history instead of being a no-op.
    expect(after.count).toBeGreaterThan(pinned.count);
  });
});

describe('progress reporting', () => {
  it('recomputes stats rather than incrementing them', async () => {
    await ingestEverything();

    const first = await systemClient().syncRun.findUniqueOrThrow({
      where: { id: syncRunId },
      select: { stats: true },
    });

    await ingestEverything();

    const second = await systemClient().syncRun.findUniqueOrThrow({
      where: { id: syncRunId },
      select: { stats: true },
    });

    // An incremented counter would now read double. A recomputed one is
    // correct after any number of retries.
    expect(second.stats).toEqual(first.stats);
  });

  it('reports counts that match the staged rows', async () => {
    await ingestEverything();

    const run = await systemClient().syncRun.findUniqueOrThrow({
      where: { id: syncRunId },
      select: { stats: true },
    });
    const stats = run.stats as Record<string, number>;

    const actual = await systemClient().rawEvent.count({
      where: { workspaceId, eventType: 'commit' },
    });
    expect(stats.commits).toBe(actual);
    expect(stats.repositories).toBe(8);
  });
});

describe('tenant isolation', () => {
  it('stages into the calling workspace only', async () => {
    const other = await registerActor('other-owner');
    const otherWorkspaceId = await createWorkspace(other, 'other-workspace');

    await ingestEverything();

    const leaked = await systemClient().rawEvent.count({
      where: { workspaceId: otherWorkspaceId },
    });
    expect(leaked).toBe(0);
  });
});
