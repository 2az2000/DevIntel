import type {
  GitProvider,
  ListOptions,
  Page,
  ProviderContext,
  RawCommit,
  RawEnvelope,
  RawIssue,
  RawPullRequest,
  RawRepository,
  RawReview,
  RepoRef,
  WebhookVerification,
} from '../types.js';
import {
  DEFAULT_MONTHS,
  DEFAULT_SEED,
  generateCommits,
  generateIssues,
  generatePullRequests,
  generateRepositories,
  type GeneratorOptions,
} from './generator.js';

/**
 * `GitProvider` over the generated dataset.
 *
 * This is not a mock. It goes through the same interface, the same pagination,
 * the same cursors and the same ingest stage as GitHub will — which is the
 * point: M2 through M6 exercise the real pipeline end to end with no network,
 * no account and no rate limits, so when M7 adds GitHub there is exactly one
 * new thing that can be wrong.
 *
 * Determinism comes from `(seed, anchor)`. The anchor is a constructor
 * parameter rather than `new Date()` so a test can pin the dataset's "today"
 * and assert exact values.
 */

export interface SeedProviderOptions {
  readonly seed?: number;
  /** The dataset's "today". Defaults to the real clock. */
  readonly anchor?: Date;
  readonly months?: number;
  /** Items per page. Small on purpose — resumability is only tested if the
   *  data actually spans many pages. */
  readonly pageSize?: number;
  /** Artificial latency per page, for exercising progress reporting. */
  readonly delayMs?: number;
}

const DEFAULT_PAGE_SIZE = 100;

export class SeedProvider implements GitProvider {
  readonly kind = 'seed' as const;

  private readonly options: GeneratorOptions;
  private readonly pageSize: number;
  private readonly delayMs: number;

  /** Generated data is memoized per repository — the same page must not be
   *  regenerated on every request, and regeneration must be free of side
   *  effects anyway. */
  private readonly commitCache = new Map<string, readonly RawCommit[]>();
  private readonly prCache = new Map<
    string,
    { pullRequests: readonly RawPullRequest[]; reviews: ReadonlyMap<number, readonly RawReview[]> }
  >();
  private readonly issueCache = new Map<string, readonly RawIssue[]>();

  constructor(options: SeedProviderOptions = {}) {
    this.options = {
      seed: options.seed ?? DEFAULT_SEED,
      anchor: options.anchor ?? new Date(),
      months: options.months ?? DEFAULT_MONTHS,
    };
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.delayMs = options.delayMs ?? 0;
  }

  // ── Listing ───────────────────────────────────────────────────────────────

  async *listRepositories(_ctx: ProviderContext): AsyncIterable<Page<RawRepository>> {
    yield* this.paginate(generateRepositories(this.options), undefined);
  }

  async *listCommits(
    _ctx: ProviderContext,
    repo: RepoRef,
    opts: ListOptions,
  ): AsyncIterable<Page<RawCommit>> {
    const all = this.commits(repo);
    const filtered = opts.since ? all.filter((c) => c.authoredAt > opts.since!) : all;
    yield* this.paginate(filtered, opts.cursor, opts.pageSize);
  }

  async *listPullRequests(
    _ctx: ProviderContext,
    repo: RepoRef,
    opts: ListOptions,
  ): AsyncIterable<Page<RawPullRequest>> {
    const { pullRequests } = this.pulls(repo);
    // Filtered on `updatedAt`, matching how a real provider's incremental sync
    // works: a pull request opened months ago but reviewed today must come back.
    const filtered = opts.since
      ? pullRequests.filter((p) => (p.updatedAt ?? p.createdAt) > opts.since!)
      : pullRequests;
    yield* this.paginate(filtered, opts.cursor, opts.pageSize);
  }

  async *listReviews(
    _ctx: ProviderContext,
    repo: RepoRef,
    pullRequestNumber: number,
  ): AsyncIterable<Page<RawReview>> {
    const { reviews } = this.pulls(repo);
    yield* this.paginate(reviews.get(pullRequestNumber) ?? [], undefined);
  }

  async *listIssues(
    _ctx: ProviderContext,
    repo: RepoRef,
    opts: ListOptions,
  ): AsyncIterable<Page<RawIssue>> {
    const all = this.issues(repo);
    const filtered = opts.since ? all.filter((i) => i.createdAt > opts.since!) : all;
    yield* this.paginate(filtered, opts.cursor, opts.pageSize);
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  verifyWebhook(): WebhookVerification {
    // The seed provider has no upstream, so it can never receive a genuine
    // delivery. Returning `valid: false` rather than throwing keeps the webhook
    // route's shape identical in both modes.
    return { valid: false, eventType: null, deliveryId: null };
  }

  parseWebhook(): readonly RawEnvelope[] {
    return [];
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private repoKey(repo: RepoRef): string {
    return repo.externalId.startsWith('r_') ? repo.externalId.slice(2) : repo.name;
  }

  private commits(repo: RepoRef): readonly RawCommit[] {
    const key = this.repoKey(repo);
    let cached = this.commitCache.get(key);
    if (!cached) {
      cached = generateCommits(key, this.options);
      this.commitCache.set(key, cached);
    }
    return cached;
  }

  private pulls(repo: RepoRef) {
    const key = this.repoKey(repo);
    let cached = this.prCache.get(key);
    if (!cached) {
      cached = generatePullRequests(key, this.options);
      this.prCache.set(key, cached);
    }
    return cached;
  }

  private issues(repo: RepoRef): readonly RawIssue[] {
    const key = this.repoKey(repo);
    let cached = this.issueCache.get(key);
    if (!cached) {
      cached = generateIssues(key, this.options);
      this.issueCache.set(key, cached);
    }
    return cached;
  }

  /**
   * Offset cursors are correct HERE and only here: the generated dataset is
   * immutable for a given `(seed, anchor)`, so a page boundary cannot shift
   * under a reader. A real provider gets an opaque cursor, which is why the
   * interface types it as `string | null` rather than a number.
   */
  private async *paginate<T>(
    items: readonly T[],
    cursor: string | undefined,
    pageSize?: number,
  ): AsyncIterable<Page<T>> {
    const size = pageSize ?? this.pageSize;
    let offset = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    // An empty result still yields one empty page, so a caller always observes
    // at least one iteration and can record a completed cursor.
    do {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));

      const slice = items.slice(offset, offset + size);
      offset += slice.length;
      const done = offset >= items.length;

      yield { items: slice, cursor: done ? null : String(offset) };

      if (done) return;
    } while (offset < items.length);
  }
}

export function createSeedProvider(options?: SeedProviderOptions): SeedProvider {
  return new SeedProvider(options);
}
