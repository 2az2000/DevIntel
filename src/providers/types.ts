/**
 * The provider abstraction.
 *
 * Everything above this layer is written against `GitProvider`. GitHub is one
 * implementation; the deterministic seed generator is another; GitLab is a
 * third, added in Phase 2 without touching any pipeline stage.
 *
 * Three properties of this interface carry the design:
 *   1. It yields PAGES, not arrays — a provider must never materialize an
 *      organization's whole commit history, and the cursor is what the ingest
 *      stage checkpoints.
 *   2. It returns `Raw*` DTOs, not database rows — GitHub's field names never
 *      reach the domain model.
 *   3. It performs NO WRITES — it cannot corrupt state, which makes SeedProvider
 *      a drop-in and makes both implementations trivially testable.
 *
 * Reference: docs/02-pipeline.md §3
 */

export type ProviderKind = 'github' | 'gitlab' | 'seed';

export interface ProviderContext {
  /** Decrypted at the call site; never logged, never serialized. */
  readonly accessToken: string;
  readonly accountLogin: string;
  /** Bounds the first sync — unbounded history is hours of paging for data
   *  almost nobody looks at. */
  readonly backfillSince: Date;
}

export interface RepoRef {
  readonly owner: string;
  readonly name: string;
  readonly externalId: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** null means this was the last page. */
  readonly cursor: string | null;
  readonly rateLimit?: { readonly remaining: number; readonly resetAt: Date };
}

export interface ListOptions {
  readonly since?: Date;
  readonly cursor?: string;
  readonly pageSize?: number;
}

// ── Raw DTOs ────────────────────────────────────────────────────────────────
// Provider-shaped data, normalized in the next stage. An actor may carry a
// provider id, an email, or both — which is precisely why identity resolution
// is a three-layer model. See ADR-0002.

export interface RawActor {
  readonly providerUserId: string | null;
  readonly login: string | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly isBot: boolean;
}

export interface RawRepository {
  readonly externalId: string;
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly isPrivate: boolean;
  readonly isArchived: boolean;
  readonly isFork: boolean;
  readonly primaryLanguage: string | null;
  readonly languages: Readonly<Record<string, number>>;
  readonly stars: number;
  readonly forks: number;
  readonly openIssuesCount: number;
  readonly createdAt: Date;
  readonly pushedAt: Date | null;
}

export interface RawCommit {
  readonly sha: string;
  readonly author: RawActor | null;
  readonly committer: RawActor | null;
  /** The metric timestamp — rebases rewrite `committedAt`. */
  readonly authoredAt: Date;
  readonly committedAt: Date;
  readonly message: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly parentCount: number;
}

export interface RawPullRequest {
  readonly externalId: string;
  readonly number: number;
  readonly title: string;
  readonly state: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly isDraft: boolean;
  readonly author: RawActor | null;
  readonly mergedBy: RawActor | null;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly commitCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date | null;
  /** Draft → ready transition. The review clock starts here, not at creation. */
  readonly readyForReviewAt: Date | null;
  readonly mergedAt: Date | null;
  readonly closedAt: Date | null;
}

export interface RawReview {
  readonly externalId: string;
  readonly pullRequestNumber: number;
  readonly reviewer: RawActor | null;
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  readonly submittedAt: Date;
  readonly commentCount: number;
}

export interface RawIssue {
  readonly externalId: string;
  readonly number: number;
  readonly title: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly author: RawActor | null;
  readonly assignee: RawActor | null;
  readonly labels: readonly string[];
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

export interface WebhookVerification {
  readonly valid: boolean;
  readonly eventType: string | null;
  readonly deliveryId: string | null;
}

export interface RawEnvelope {
  readonly eventType: string;
  readonly externalId: string;
  readonly payload: unknown;
}

export interface GitProvider {
  readonly kind: ProviderKind;

  listRepositories(ctx: ProviderContext): AsyncIterable<Page<RawRepository>>;
  listCommits(ctx: ProviderContext, repo: RepoRef, opts: ListOptions): AsyncIterable<Page<RawCommit>>;
  listPullRequests(ctx: ProviderContext, repo: RepoRef, opts: ListOptions): AsyncIterable<Page<RawPullRequest>>;
  listReviews(ctx: ProviderContext, repo: RepoRef, pullRequestNumber: number): AsyncIterable<Page<RawReview>>;
  listIssues(ctx: ProviderContext, repo: RepoRef, opts: ListOptions): AsyncIterable<Page<RawIssue>>;

  verifyWebhook(headers: Readonly<Record<string, string | undefined>>, rawBody: Buffer): WebhookVerification;
  parseWebhook(eventType: string, payload: unknown): readonly RawEnvelope[];
}
