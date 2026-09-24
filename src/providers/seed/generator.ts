import { createRng, deriveSeed, type Rng } from './prng.js';
import {
  COMMIT_SUBJECTS,
  COMPONENTS,
  DORMANT_AFTER_DAYS,
  ISSUE_TITLES,
  LABELS,
  PR_TITLES,
  SEED_DEVELOPERS,
  SEED_ORG,
  SEED_REPOSITORIES,
  type SeedDeveloper,
  type SeedRepository,
} from './fixtures.js';
import type {
  RawActor,
  RawCommit,
  RawIssue,
  RawPullRequest,
  RawRepository,
  RawReview,
} from '../types.js';

/**
 * Turns the fixtures into twelve months of plausible activity.
 *
 * Two properties matter more than realism:
 *
 *   1. **Determinism.** Same `(seed, anchor)` gives byte-identical output on
 *      every machine and every run, so tests assert exact numbers rather than
 *      ranges. Every random value comes from a seeded stream; the clock is a
 *      parameter, never read.
 *   2. **Per-repository independence.** Each repository draws from a stream
 *      derived from its own key, so generating repository 6 without generating
 *      1–5 produces identical data. Ingest pages through repositories in
 *      arbitrary order and must not perturb anything.
 *
 * The generated history is a *bounded* set — roughly 30k commits across 8
 * repositories — so materializing one repository at a time is deliberate and
 * safe. A real provider must never do this; see `/algorithm-design`.
 */

export interface GeneratorOptions {
  readonly seed: number;
  /** The dataset's "today". History runs backwards from here. */
  readonly anchor: Date;
  readonly months: number;
}

export const DEFAULT_SEED = 20260101;
export const DEFAULT_MONTHS = 12;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const developerByKey = new Map(SEED_DEVELOPERS.map((d) => [d.key, d]));

// ── Actors ──────────────────────────────────────────────────────────────────

/**
 * A commit knows an email; a pull request knows a provider account. The same
 * person therefore arrives through two different keys, which is exactly the
 * situation ADR-0002's three-layer identity model exists for. The generator
 * reproduces it rather than smoothing it over.
 */
function commitActor(dev: SeedDeveloper, rng: Rng): RawActor {
  // Amir occasionally commits from a second machine with a different git config.
  const email = dev.altEmail && rng.bool(0.12) ? dev.altEmail : dev.email;
  return {
    providerUserId: null,
    login: null,
    email,
    name: dev.name,
    avatarUrl: null,
    isBot: dev.isBot,
  };
}

function accountActor(dev: SeedDeveloper): RawActor {
  return {
    providerUserId: `u_${dev.key}`,
    login: dev.login,
    email: dev.email,
    name: dev.name,
    avatarUrl: `https://avatars.devintel.test/${dev.login}.png`,
    isBot: dev.isBot,
  };
}

// ── Time ────────────────────────────────────────────────────────────────────

const startOfDayUtc = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** 0 = Sunday. */
const dayOfWeek = (d: Date): number => d.getUTCDay();

/**
 * Weekday rhythm. Not cosmetic: `active_days_ratio` and `activity_cv` measure
 * consistency, and a dataset with uniform seven-day activity would make every
 * consistency score identical and untestable.
 */
function dayVolumeFactor(date: Date, rng: Rng): number {
  const dow = dayOfWeek(date);
  if (dow === 5) return rng.normal(0.75, 0.15, 0.3, 1.1); // Friday winds down
  if (dow === 6) return rng.bool(0.75) ? 0 : rng.normal(0.2, 0.1, 0, 0.4); // Saturday
  if (dow === 0) return rng.bool(0.85) ? 0 : rng.normal(0.15, 0.1, 0, 0.35); // Sunday
  return rng.normal(1, 0.25, 0.35, 1.7);
}

function timeWithinWorkday(day: Date, dev: SeedDeveloper, rng: Rng): Date {
  const [from, to] = dev.activeHours;
  const hour = rng.int(from, to);
  const minute = rng.int(0, 59);
  const second = rng.int(0, 59);
  return new Date(day.getTime() + hour * HOUR_MS + minute * 60_000 + second * 1_000);
}

// ── Repositories ────────────────────────────────────────────────────────────

export function generateRepositories(options: GeneratorOptions): RawRepository[] {
  const start = new Date(options.anchor.getTime() - options.months * 30 * DAY_MS);

  return SEED_REPOSITORIES.map((repo, index) => {
    const rng = createRng(deriveSeed(options.seed, `repo:${repo.key}`));
    const dormantDays = DORMANT_AFTER_DAYS[repo.key] ?? 0;

    return {
      externalId: `r_${repo.key}`,
      owner: SEED_ORG,
      name: repo.name,
      fullName: `${SEED_ORG}/${repo.name}`,
      defaultBranch: 'main',
      isPrivate: index % 3 === 0,
      isArchived: false,
      isFork: false,
      primaryLanguage: repo.primaryLanguage,
      languages: repo.languages,
      stars: repo.stars,
      forks: Math.floor(repo.stars / rng.int(4, 9)),
      openIssuesCount: rng.int(2, 18),
      createdAt: new Date(start.getTime() - rng.int(200, 900) * DAY_MS),
      pushedAt: new Date(options.anchor.getTime() - dormantDays * DAY_MS),
    } satisfies RawRepository;
  });
}

// ── Contribution weighting ──────────────────────────────────────────────────

interface Weighted {
  readonly devs: readonly SeedDeveloper[];
  readonly weights: readonly number[];
}

function contributorsOf(repo: SeedRepository): Weighted {
  const entries = Object.entries(repo.contributors);
  const devs: SeedDeveloper[] = [];
  const weights: number[] = [];

  for (const [key, weight] of entries) {
    const dev = developerByKey.get(key);
    if (!dev) throw new Error(`Unknown developer "${key}" in repository "${repo.key}"`);
    // Contribution share is the fixture's weight scaled by how active the
    // person is overall, so intensity shows up in the data rather than only in
    // the fixture comments.
    devs.push(dev);
    weights.push(weight * dev.intensity);
  }

  return { devs, weights };
}

// ── Commits ─────────────────────────────────────────────────────────────────

export function generateCommits(repoKey: string, options: GeneratorOptions): RawCommit[] {
  const repo = SEED_REPOSITORIES.find((r) => r.key === repoKey);
  if (!repo) throw new Error(`Unknown repository "${repoKey}"`);

  const rng = createRng(deriveSeed(options.seed, `commits:${repo.key}`));
  const { devs, weights } = contributorsOf(repo);
  const dormantDays = DORMANT_AFTER_DAYS[repo.key] ?? 0;

  const totalDays = options.months * 30;
  const commits: RawCommit[] = [];
  let counter = 0;

  for (let dayOffset = totalDays; dayOffset >= dormantDays; dayOffset--) {
    const day = startOfDayUtc(new Date(options.anchor.getTime() - dayOffset * DAY_MS));
    const factor = dayVolumeFactor(day, rng);
    if (factor === 0) continue;

    const count = Math.round(repo.dailyCommits * factor);
    for (let i = 0; i < count; i++) {
      const dev = rng.weighted(devs, weights);
      const authoredAt = timeWithinWorkday(day, dev, rng);

      // The anchor is a moment, not a day boundary: on the final day the work
      // day runs past "now". Dropping those keeps the dataset a strict history
      // — a commit dated in the future would make every trend window wrong.
      if (authoredAt.getTime() > options.anchor.getTime()) continue;

      const subject = rng.pick(COMMIT_SUBJECTS).replace('%s', rng.pick(COMPONENTS));

      const additions = Math.round(rng.normal(48, 60, 1, 900));
      const deletions = Math.round(rng.normal(21, 34, 0, 600));

      counter += 1;
      commits.push({
        sha: sha(`${repo.key}:${counter}:${authoredAt.getTime()}`),
        author: commitActor(dev, rng),
        committer: commitActor(dev, rng),
        authoredAt,
        // Committed a little after authored — a rebase or a delayed push.
        committedAt: new Date(
          Math.min(options.anchor.getTime(), authoredAt.getTime() + rng.int(0, 90) * 60_000),
        ),
        message: `${subject}\n\nGenerated by the DevIntel seed provider.`,
        additions,
        deletions,
        changedFiles: Math.max(1, Math.round((additions + deletions) / rng.int(18, 70))),
        parentCount: rng.bool(0.06) ? 2 : 1,
      });
    }
  }

  // Ascending by time, so paging is stable and resumable.
  commits.sort((a, b) => a.authoredAt.getTime() - b.authoredAt.getTime());
  return commits;
}

/** A 40-hex string derived from the input. Not cryptographic — an identifier. */
function sha(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + input.charCodeAt(i) * (i + 1), 0x85ebca6b) >>> 0;
  }
  let out = '';
  let state = (h1 ^ h2) >>> 0;
  while (out.length < 40) {
    state = Math.imul(state ^ (state >>> 13), 0x5bd1e995) >>> 0;
    out += state.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

// ── Pull requests and reviews ───────────────────────────────────────────────

export interface GeneratedPullRequests {
  readonly pullRequests: readonly RawPullRequest[];
  /** Keyed by pull request number. */
  readonly reviews: ReadonlyMap<number, readonly RawReview[]>;
}

export function generatePullRequests(
  repoKey: string,
  options: GeneratorOptions,
): GeneratedPullRequests {
  const repo = SEED_REPOSITORIES.find((r) => r.key === repoKey);
  if (!repo) throw new Error(`Unknown repository "${repoKey}"`);

  const rng = createRng(deriveSeed(options.seed, `prs:${repo.key}`));
  const { devs, weights } = contributorsOf(repo);
  const humans = devs.filter((d) => !d.isBot);
  const dormantDays = DORMANT_AFTER_DAYS[repo.key] ?? 0;

  const totalDays = options.months * 30;
  const pullRequests: RawPullRequest[] = [];
  const reviews = new Map<number, RawReview[]>();
  let number = 0;

  for (let dayOffset = totalDays; dayOffset >= dormantDays; dayOffset -= 7) {
    const weekStart = startOfDayUtc(new Date(options.anchor.getTime() - dayOffset * DAY_MS));
    const count = Math.max(0, Math.round(rng.normal(repo.prsPerWeek, repo.prsPerWeek / 3, 0, repo.prsPerWeek * 2)));

    for (let i = 0; i < count; i++) {
      number += 1;

      const author = rng.weighted(devs, weights);
      const createdAt = timeWithinWorkday(
        new Date(weekStart.getTime() + rng.int(0, 6) * DAY_MS),
        author,
        rng,
      );
      if (createdAt.getTime() > options.anchor.getTime()) continue;

      const isDraft = rng.bool(0.18);
      // The review clock starts at ready-for-review, not at creation. Charging
      // a team for time a PR spent in draft would make the metric meaningless.
      const readyForReviewAt = isDraft
        ? new Date(createdAt.getTime() + rng.int(2, 40) * HOUR_MS)
        : createdAt;

      const daysAgo = (options.anchor.getTime() - readyForReviewAt.getTime()) / DAY_MS;
      const latencyMultiplier = daysAgo <= 30 ? repo.recentLatencyMultiplier : 1;

      const additions = Math.round(rng.normal(180, 220, 4, 2400));
      const deletions = Math.round(rng.normal(70, 110, 0, 1400));

      // Large pull requests genuinely wait longer for a reviewer. Encoding the
      // relationship means "PR size correlates with review latency" is a real
      // finding in this dataset, not an artefact.
      const sizePenalty = 1 + Math.min(1.5, (additions + deletions) / 1400);

      const reviewers = humans.filter((d) => d.key !== author.key);
      const abandoned = rng.bool(0.07);
      const stillOpen = daysAgo < 4 ? rng.bool(0.55) : rng.bool(0.04);

      const prReviews: RawReview[] = [];
      let firstReviewAt: Date | null = null;
      let approvedAt: Date | null = null;

      if (reviewers.length > 0 && !abandoned) {
        const latencyHours =
          repo.baseReviewLatencyHours *
          latencyMultiplier *
          sizePenalty *
          rng.normal(1, 0.45, 0.2, 3.2);

        firstReviewAt = new Date(readyForReviewAt.getTime() + latencyHours * HOUR_MS);

        const rounds = rng.weighted([1, 2, 3], [62, 28, 10]);
        let cursor = firstReviewAt;

        for (let round = 0; round < rounds; round++) {
          const reviewer = rng.pick(reviewers);
          const last = round === rounds - 1;
          const state = last ? 'APPROVED' : rng.weighted(['CHANGES_REQUESTED', 'COMMENTED'], [70, 30]);

          prReviews.push({
            externalId: `rv_${repo.key}_${number}_${round}`,
            pullRequestNumber: number,
            reviewer: accountActor(reviewer),
            state: state as RawReview['state'],
            submittedAt: cursor,
            commentCount: rng.int(0, 9),
          });

          if (last) approvedAt = cursor;
          cursor = new Date(cursor.getTime() + rng.normal(6, 5, 0.5, 40) * HOUR_MS);
        }
      }

      const mergedAt =
        !stillOpen && !abandoned && approvedAt
          ? new Date(approvedAt.getTime() + rng.normal(2.5, 2.5, 0.1, 30) * HOUR_MS)
          : null;

      const closedAt = abandoned
        ? new Date(readyForReviewAt.getTime() + rng.int(24, 400) * HOUR_MS)
        : mergedAt;

      // Anything dated after the anchor has not happened yet.
      const withinHistory = (d: Date | null): Date | null =>
        d && d.getTime() <= options.anchor.getTime() ? d : null;

      const finalMergedAt = withinHistory(mergedAt);
      const finalClosedAt = withinHistory(closedAt);

      const state: RawPullRequest['state'] = finalMergedAt
        ? 'MERGED'
        : abandoned && finalClosedAt
          ? 'CLOSED'
          : 'OPEN';

      reviews.set(
        number,
        prReviews.filter((r) => r.submittedAt.getTime() <= options.anchor.getTime()),
      );

      pullRequests.push({
        externalId: `pr_${repo.key}_${number}`,
        number,
        title: rng.pick(PR_TITLES).replace('%s', rng.pick(COMPONENTS)),
        state,
        isDraft: isDraft && readyForReviewAt.getTime() > options.anchor.getTime(),
        author: accountActor(author),
        mergedBy: finalMergedAt ? accountActor(rng.pick(reviewers.length ? reviewers : [author])) : null,
        baseBranch: 'main',
        headBranch: `${rng.pick(['feat', 'fix', 'chore'])}/${repo.key}-${number}`,
        additions,
        deletions,
        changedFiles: Math.max(1, Math.round((additions + deletions) / rng.int(25, 90))),
        commitCount: rng.int(1, 14),
        createdAt,
        updatedAt: finalClosedAt ?? firstReviewAt ?? createdAt,
        readyForReviewAt: readyForReviewAt.getTime() <= options.anchor.getTime() ? readyForReviewAt : null,
        mergedAt: finalMergedAt,
        closedAt: finalClosedAt,
      });
    }
  }

  return { pullRequests, reviews };
}

// ── Issues ──────────────────────────────────────────────────────────────────

export function generateIssues(repoKey: string, options: GeneratorOptions): RawIssue[] {
  const repo = SEED_REPOSITORIES.find((r) => r.key === repoKey);
  if (!repo) throw new Error(`Unknown repository "${repoKey}"`);

  const rng = createRng(deriveSeed(options.seed, `issues:${repo.key}`));
  const { devs, weights } = contributorsOf(repo);
  const humans = devs.filter((d) => !d.isBot);
  const dormantDays = DORMANT_AFTER_DAYS[repo.key] ?? 0;

  const totalDays = options.months * 30;
  const issues: RawIssue[] = [];
  let number = 0;

  for (let dayOffset = totalDays; dayOffset >= dormantDays; dayOffset -= 7) {
    const weekStart = startOfDayUtc(new Date(options.anchor.getTime() - dayOffset * DAY_MS));
    const count = Math.max(0, Math.round(rng.normal(repo.issuesPerWeek, repo.issuesPerWeek / 2, 0, repo.issuesPerWeek * 2)));

    for (let i = 0; i < count; i++) {
      number += 1;

      const author = rng.weighted(devs, weights);
      const createdAt = timeWithinWorkday(
        new Date(weekStart.getTime() + rng.int(0, 6) * DAY_MS),
        author,
        rng,
      );
      if (createdAt.getTime() > options.anchor.getTime()) continue;

      // Long tail: most issues close in days, some linger for months. A normal
      // distribution here would make the median and the mean agree, which is
      // precisely the case where choosing the median stops mattering.
      const resolutionHours = rng.bool(0.72)
        ? rng.normal(38, 40, 1, 240)
        : rng.normal(600, 500, 200, 2600);

      const closedCandidate = new Date(createdAt.getTime() + resolutionHours * HOUR_MS);
      const closedAt = closedCandidate.getTime() <= options.anchor.getTime() ? closedCandidate : null;

      issues.push({
        externalId: `i_${repo.key}_${number}`,
        number,
        title: rng.pick(ISSUE_TITLES).replace('%s', rng.pick(COMPONENTS)),
        state: closedAt ? 'CLOSED' : 'OPEN',
        author: accountActor(author),
        assignee: rng.bool(0.6) && humans.length > 0 ? accountActor(rng.pick(humans)) : null,
        labels: rng.shuffle(LABELS).slice(0, rng.int(0, 3)),
        createdAt,
        closedAt,
      });
    }
  }

  return issues;
}

export const SEED_REPOSITORY_KEYS = SEED_REPOSITORIES.map((r) => r.key);
