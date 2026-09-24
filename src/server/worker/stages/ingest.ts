import { createHash } from 'node:crypto';
import { systemClient } from '@db';
import type { Prisma } from '@db';
import { createSeedProvider } from '@providers';
import type { GitProvider, ProviderContext, RepoRef } from '@providers';
import { logger } from '../../api/logger.js';
import { getQueue } from '../queues.js';
import { jobId } from '../job-id.js';

/**
 * Ingestion — provider data into the `RawEvent` staging table.
 *
 * The only rule that matters here: **every stage must produce the same result
 * whether it runs once, twice, or is interrupted halfway and restarted.**
 * Provider APIs time out mid-page, webhooks arrive twice and out of order, and
 * workers are killed by deploys. A stage that is only correct on the happy path
 * silently produces wrong metrics — and a dashboard showing 340 commits instead
 * of 170 looks perfectly plausible, so nobody reports it.
 *
 * Two of the four mechanisms from ADR-0004 live in this file:
 *   1. Uniqueness on `(provider, eventType, externalId, contentHash)`.
 *   4. The cursor advances only AFTER a page is committed.
 *
 * Reference: docs/02-pipeline.md §5, ADR-0004
 */

export interface DiscoverJob {
  readonly workspaceId: string;
  readonly integrationId: string;
  readonly syncRunId: string;
}

export interface ResourceJob {
  readonly workspaceId: string;
  readonly integrationId: string;
  readonly syncRunId: string;
  readonly repositoryExternalId: string;
  readonly owner: string;
  readonly name: string;
  readonly resource: 'COMMITS' | 'PULL_REQUESTS' | 'REVIEWS' | 'ISSUES';
}

/** Cursors for the integration itself rather than one repository. */
const INTEGRATION_SCOPE = '';

// ── Staging writes ──────────────────────────────────────────────────────────

/**
 * A stable hash of the payload.
 *
 * `JSON.stringify` is not stable across key insertion order, so a re-fetch of
 * identical data could hash differently and be stored twice. Sorting keys makes
 * the hash a property of the CONTENT, which is what lets a genuine update
 * become a new row while a duplicate delivery collapses into the existing one.
 */
export function contentHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  // `JSON.stringify(undefined)` returns undefined, not a string — the one case
  // TypeScript's signature does not warn about.
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export interface StagedEvent {
  readonly eventType: string;
  readonly externalId: string;
  readonly payload: unknown;
}

/**
 * Writes a page of events, skipping any that are already staged.
 *
 * `createMany({ skipDuplicates: true })` does this in ONE statement against the
 * uniqueness index. The alternative — read, compare, insert — has a race
 * between the read and the insert, which under concurrent sync is exactly when
 * duplicates appear.
 */
export async function stageEvents(
  workspaceId: string,
  integrationId: string,
  provider: 'SEED' | 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GIT',
  events: readonly StagedEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
    workspaceId,
    integrationId,
    provider,
    eventType: e.eventType,
    externalId: e.externalId,
    contentHash: contentHash(e.payload),
    payload: e.payload as Prisma.InputJsonValue,
  }));

  const result = await systemClient().rawEvent.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

// ── Cursors ─────────────────────────────────────────────────────────────────

async function readCursor(
  integrationId: string,
  repositoryExternalId: string,
  resource: ResourceJob['resource'] | 'REPOSITORIES',
): Promise<{ cursor: string | null; since: Date | null }> {
  const row = await systemClient().syncCursor.findUnique({
    where: {
      integrationId_repositoryExternalId_resource: {
        integrationId,
        repositoryExternalId,
        resource,
      },
    },
    select: { cursor: true, since: true },
  });
  return { cursor: row?.cursor ?? null, since: row?.since ?? null };
}

/**
 * Advances the checkpoint.
 *
 * Called only after the page's rows are durably written. Advancing first would
 * turn a crash into permanent data loss — the page would be skipped forever,
 * with nothing to indicate it. Advancing after means a crash re-fetches at most
 * one page, and mechanism 1 makes that re-fetch a no-op.
 */
async function writeCursor(
  workspaceId: string,
  integrationId: string,
  repositoryExternalId: string,
  resource: ResourceJob['resource'] | 'REPOSITORIES',
  cursor: string | null,
  since: Date | null,
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED',
  now: Date,
  error?: string,
): Promise<void> {
  const key = {
    integrationId_repositoryExternalId_resource: { integrationId, repositoryExternalId, resource },
  };

  await systemClient().syncCursor.upsert({
    where: key,
    create: {
      workspaceId,
      integrationId,
      repositoryExternalId,
      resource,
      cursor,
      since,
      status,
      lastSyncedAt: status === 'SUCCEEDED' ? now : null,
      lastError: error ?? null,
    },
    update: {
      cursor,
      ...(since ? { since } : {}),
      status,
      ...(status === 'SUCCEEDED' ? { lastSyncedAt: now } : {}),
      lastError: error ?? null,
    },
  });
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface SyncStats {
  readonly repositories: number;
  readonly commits: number;
  readonly pullRequests: number;
  readonly reviews: number;
  readonly issues: number;
  readonly pending: number;
}

const EMPTY_STATS: SyncStats = {
  repositories: 0,
  commits: 0,
  pullRequests: 0,
  reviews: 0,
  issues: 0,
  pending: 0,
};

/**
 * Progress is recomputed from `RawEvent` counts rather than incremented.
 *
 * An incremented counter is wrong forever after one retry; a recomputed one is
 * correct after any number of them. Same reasoning as mechanism 3 in the
 * aggregate stage — it applies to progress reporting too.
 */
async function refreshStats(syncRunId: string, workspaceId: string, pending: number): Promise<SyncStats> {
  const db = systemClient();

  const counts = await db.rawEvent.groupBy({
    by: ['eventType'],
    where: { workspaceId },
    _count: { _all: true },
  });

  const of = (type: string): number =>
    counts.find((c) => c.eventType === type)?._count._all ?? 0;

  const stats: SyncStats = {
    repositories: of('repository'),
    commits: of('commit'),
    pullRequests: of('pull_request'),
    reviews: of('pull_request_review'),
    issues: of('issue'),
    pending,
  };

  await db.syncRun.update({
    where: { id: syncRunId },
    data: { stats: stats as unknown as Prisma.InputJsonObject },
  });

  return stats;
}

// ── Provider wiring ─────────────────────────────────────────────────────────

/**
 * The seed dataset's "today", pinned per integration.
 *
 * Defaulting to `new Date()` would make every run generate slightly different
 * data — different timestamps, different payload hashes — so re-running the
 * sync would append a second copy of history rather than being a no-op. Pinning
 * it is what makes ADR-0004's mechanism 1 actually hold for this provider.
 */
interface SeedSettings {
  readonly anchor: Date | null;
  /**
   * How much history to generate. Twelve months is the product default; tests
   * pin it to one so a suite that exercises the real ingest path does not pay
   * twenty seconds per case.
   */
  readonly months: number | null;
}

function seedSettingsOf(metadata: unknown): SeedSettings {
  if (!metadata || typeof metadata !== 'object') return { anchor: null, months: null };

  const { seedAnchor, seedMonths } = metadata as { seedAnchor?: unknown; seedMonths?: unknown };

  const anchor = typeof seedAnchor === 'string' ? new Date(seedAnchor) : null;
  const months =
    typeof seedMonths === 'number' && Number.isFinite(seedMonths) && seedMonths > 0
      ? seedMonths
      : null;

  return {
    anchor: anchor && !Number.isNaN(anchor.getTime()) ? anchor : null,
    months,
  };
}

function providerFor(kind: string, settings: SeedSettings): GitProvider {
  if (kind === 'SEED') {
    return createSeedProvider({
      ...(settings.anchor ? { anchor: settings.anchor } : {}),
      ...(settings.months ? { months: settings.months } : {}),
    });
  }
  throw new Error(`Provider ${kind} is not available until M7`);
}

async function contextFor(integrationId: string): Promise<{
  ctx: ProviderContext;
  provider: GitProvider;
  providerKind: 'SEED' | 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GIT';
  workspaceId: string;
}> {
  const integration = await systemClient().integration.findUniqueOrThrow({
    where: { id: integrationId },
    select: {
      workspaceId: true,
      provider: true,
      accountLogin: true,
      providerMetadata: true,
      // The token is decrypted at the call site in M7. The seed provider needs
      // none, and a token must never be logged or serialized.
    },
  });

  const settings = seedSettingsOf(integration.providerMetadata);
  const backfillSince = new Date(
    (settings.anchor ?? new Date()).getTime() - (settings.months ?? 12) * 30 * 86_400_000,
  );

  return {
    provider: providerFor(integration.provider, settings),
    providerKind: integration.provider,
    workspaceId: integration.workspaceId,
    ctx: {
      accessToken: '',
      accountLogin: integration.accountLogin,
      backfillSince,
    },
  };
}

// ── sync.discover ───────────────────────────────────────────────────────────

/**
 * Lists repositories, stages them, and fans out one `sync.resource` job per
 * repository per resource.
 *
 * Fan-out happens at the END, once the listing is durable, so a crash during
 * discovery cannot leave resource jobs pointing at repositories that were never
 * staged.
 */
export async function runDiscover(job: DiscoverJob): Promise<SyncStats> {
  const { ctx, provider, providerKind, workspaceId } = await contextFor(job.integrationId);
  const now = new Date();

  const { cursor } = await readCursor(job.integrationId, INTEGRATION_SCOPE, 'REPOSITORIES');
  await writeCursor(
    workspaceId,
    job.integrationId,
    INTEGRATION_SCOPE,
    'REPOSITORIES',
    cursor,
    null,
    'RUNNING',
    now,
  );

  const repos: RepoRef[] = [];

  for await (const page of provider.listRepositories(ctx)) {
    await stageEvents(
      workspaceId,
      job.integrationId,
      providerKind,
      page.items.map((repo) => ({
        eventType: 'repository',
        externalId: repo.externalId,
        payload: repo,
      })),
    );

    for (const repo of page.items) {
      repos.push({ owner: repo.owner, name: repo.name, externalId: repo.externalId });
    }

    // Only now, with the page durably written.
    await writeCursor(
      workspaceId,
      job.integrationId,
      INTEGRATION_SCOPE,
      'REPOSITORIES',
      page.cursor,
      null,
      page.cursor ? 'RUNNING' : 'SUCCEEDED',
      new Date(),
    );
  }

  const resources: ResourceJob['resource'][] = ['COMMITS', 'PULL_REQUESTS', 'ISSUES'];
  const queue = getQueue('sync.resource');

  for (const repo of repos) {
    for (const resource of resources) {
      const payload: ResourceJob = {
        workspaceId,
        integrationId: job.integrationId,
        syncRunId: job.syncRunId,
        repositoryExternalId: repo.externalId,
        owner: repo.owner,
        name: repo.name,
        resource,
      };

      await queue.add('resource', payload, {
        jobId: jobId('sync', job.integrationId, repo.externalId, resource),
      });
    }
  }

  logger.info(
    { integrationId: job.integrationId, repositories: repos.length, jobs: repos.length * resources.length },
    'discover complete',
  );

  return refreshStats(job.syncRunId, workspaceId, repos.length * resources.length);
}

// ── sync.resource ───────────────────────────────────────────────────────────

export async function runResource(job: ResourceJob): Promise<SyncStats> {
  const { ctx, provider, providerKind, workspaceId } = await contextFor(job.integrationId);
  const repo: RepoRef = {
    owner: job.owner,
    name: job.name,
    externalId: job.repositoryExternalId,
  };

  const { cursor, since } = await readCursor(
    job.integrationId,
    job.repositoryExternalId,
    job.resource,
  );

  const markRunning = () =>
    writeCursor(
      workspaceId,
      job.integrationId,
      job.repositoryExternalId,
      job.resource,
      cursor,
      since,
      'RUNNING',
      new Date(),
    );

  await markRunning();

  try {
    switch (job.resource) {
      case 'COMMITS':
        await ingestCommits(job, workspaceId, providerKind, provider, ctx, repo, cursor, since);
        break;
      case 'PULL_REQUESTS':
        await ingestPullRequests(job, workspaceId, providerKind, provider, ctx, repo, cursor, since);
        break;
      case 'ISSUES':
        await ingestIssues(job, workspaceId, providerKind, provider, ctx, repo, cursor, since);
        break;
      case 'REVIEWS':
        // Reviews are fetched per pull request, inside the PULL_REQUESTS pass —
        // there is no standalone listing for them.
        break;
    }
  } catch (err) {
    await writeCursor(
      workspaceId,
      job.integrationId,
      job.repositoryExternalId,
      job.resource,
      cursor,
      since,
      'FAILED',
      new Date(),
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }

  return refreshStats(job.syncRunId, workspaceId, 0);
}

async function ingestCommits(
  job: ResourceJob,
  workspaceId: string,
  providerKind: 'SEED' | 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GIT',
  provider: GitProvider,
  ctx: ProviderContext,
  repo: RepoRef,
  cursor: string | null,
  since: Date | null,
): Promise<void> {
  let high = since;

  for await (const page of provider.listCommits(ctx, repo, {
    ...(since ? { since } : {}),
    ...(cursor ? { cursor } : {}),
  })) {
    await stageEvents(
      workspaceId,
      job.integrationId,
      providerKind,
      page.items.map((c) => ({
        eventType: 'commit',
        externalId: `${repo.externalId}:${c.sha}`,
        payload: { repositoryExternalId: repo.externalId, ...c },
      })),
    );

    for (const c of page.items) {
      if (!high || c.authoredAt > high) high = c.authoredAt;
    }

    await writeCursor(
      workspaceId,
      job.integrationId,
      repo.externalId,
      'COMMITS',
      page.cursor,
      high,
      page.cursor ? 'RUNNING' : 'SUCCEEDED',
      new Date(),
    );
  }
}

async function ingestPullRequests(
  job: ResourceJob,
  workspaceId: string,
  providerKind: 'SEED' | 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GIT',
  provider: GitProvider,
  ctx: ProviderContext,
  repo: RepoRef,
  cursor: string | null,
  since: Date | null,
): Promise<void> {
  let high = since;

  for await (const page of provider.listPullRequests(ctx, repo, {
    ...(since ? { since } : {}),
    ...(cursor ? { cursor } : {}),
  })) {
    await stageEvents(
      workspaceId,
      job.integrationId,
      providerKind,
      page.items.map((pr) => ({
        eventType: 'pull_request',
        externalId: `${repo.externalId}:${pr.externalId}`,
        payload: { repositoryExternalId: repo.externalId, ...pr },
      })),
    );

    // Reviews belong to a pull request and are fetched with it. Doing this in
    // the same page keeps a PR and its reviews staged together, so normalize
    // never sees a review whose pull request is missing.
    for (const pr of page.items) {
      const reviews = [];
      for await (const reviewPage of provider.listReviews(ctx, repo, pr.number)) {
        reviews.push(...reviewPage.items);
      }

      if (reviews.length > 0) {
        await stageEvents(
          workspaceId,
          job.integrationId,
          providerKind,
          reviews.map((r) => ({
            eventType: 'pull_request_review',
            externalId: `${repo.externalId}:${r.externalId}`,
            payload: {
              repositoryExternalId: repo.externalId,
              pullRequestExternalId: pr.externalId,
              ...r,
            },
          })),
        );
      }

      const updated = pr.updatedAt ?? pr.createdAt;
      if (!high || updated > high) high = updated;
    }

    await writeCursor(
      workspaceId,
      job.integrationId,
      repo.externalId,
      'PULL_REQUESTS',
      page.cursor,
      high,
      page.cursor ? 'RUNNING' : 'SUCCEEDED',
      new Date(),
    );
  }
}

async function ingestIssues(
  job: ResourceJob,
  workspaceId: string,
  providerKind: 'SEED' | 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GIT',
  provider: GitProvider,
  ctx: ProviderContext,
  repo: RepoRef,
  cursor: string | null,
  since: Date | null,
): Promise<void> {
  let high = since;

  for await (const page of provider.listIssues(ctx, repo, {
    ...(since ? { since } : {}),
    ...(cursor ? { cursor } : {}),
  })) {
    await stageEvents(
      workspaceId,
      job.integrationId,
      providerKind,
      page.items.map((i) => ({
        eventType: 'issue',
        externalId: `${repo.externalId}:${i.externalId}`,
        payload: { repositoryExternalId: repo.externalId, ...i },
      })),
    );

    for (const i of page.items) {
      if (!high || i.createdAt > high) high = i.createdAt;
    }

    await writeCursor(
      workspaceId,
      job.integrationId,
      repo.externalId,
      'ISSUES',
      page.cursor,
      high,
      page.cursor ? 'RUNNING' : 'SUCCEEDED',
      new Date(),
    );
  }
}

// ── Sync runs ───────────────────────────────────────────────────────────────

export async function startSyncRun(
  workspaceId: string,
  integrationId: string,
  kind: 'INITIAL' | 'INCREMENTAL' | 'BACKFILL',
): Promise<string> {
  const run = await systemClient().syncRun.create({
    data: {
      workspaceId,
      integrationId,
      kind,
      status: 'RUNNING',
      stats: EMPTY_STATS as unknown as Prisma.InputJsonObject,
    },
    select: { id: true },
  });

  await getQueue('sync.discover').add(
    'discover',
    { workspaceId, integrationId, syncRunId: run.id } satisfies DiscoverJob,
    { jobId: jobId('discover', run.id) },
  );

  return run.id;
}

export async function finishSyncRun(
  syncRunId: string,
  status: 'SUCCEEDED' | 'FAILED',
  error?: string,
): Promise<void> {
  await systemClient().syncRun.update({
    where: { id: syncRunId },
    data: { status, finishedAt: new Date(), ...(error ? { error } : {}) },
  });
}
