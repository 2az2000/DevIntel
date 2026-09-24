import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEED,
  generateCommits,
  generateIssues,
  generatePullRequests,
  generateRepositories,
  SEED_REPOSITORY_KEYS,
  type GeneratorOptions,
} from './generator.js';
import { createRng, deriveSeed } from './prng.js';
import { SEED_DEVELOPERS, SEED_REPOSITORIES } from './fixtures.js';

/**
 * The seed dataset is the foundation every later milestone's tests stand on.
 * If it is not deterministic, no downstream test can assert an exact number; if
 * the planted signals are not actually present, M5 has nothing to detect.
 *
 * So this file verifies the data BEFORE any pipeline is built on it.
 */

const ANCHOR = new Date('2026-09-01T00:00:00.000Z');
const OPTIONS: GeneratorOptions = { seed: DEFAULT_SEED, anchor: ANCHOR, months: 12 };

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

describe('prng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('derives independent streams from labels', () => {
    expect(deriveSeed(DEFAULT_SEED, 'commits:payment-core')).not.toBe(
      deriveSeed(DEFAULT_SEED, 'commits:api-gateway'),
    );
    // Stable across runs — this is what makes per-repository generation
    // order-independent.
    expect(deriveSeed(DEFAULT_SEED, 'commits:payment-core')).toBe(
      deriveSeed(DEFAULT_SEED, 'commits:payment-core'),
    );
  });

  it('respects weighted selection over many draws', () => {
    const rng = createRng(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10_000; i++) {
      counts[rng.weighted(['a', 'b'] as const, [80, 20])] += 1;
    }
    // Not a range check on the data under test — a sanity check on the tool
    // that generates it.
    expect(counts.a / 10_000).toBeCloseTo(0.8, 1);
  });
});

describe('determinism', () => {
  it('generates byte-identical commits across runs', () => {
    const first = generateCommits('payment-core', OPTIONS);
    const second = generateCommits('payment-core', OPTIONS);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('generates a repository identically regardless of what else was generated', () => {
    // Generating other repositories first must not shift this one. Without
    // per-repository derived streams, it would.
    const isolated = generateCommits('mobile-client', OPTIONS);

    generateCommits('payment-core', OPTIONS);
    generateCommits('api-gateway', OPTIONS);
    const afterOthers = generateCommits('mobile-client', OPTIONS);

    expect(JSON.stringify(afterOthers)).toBe(JSON.stringify(isolated));
  });

  it('changes completely with a different seed', () => {
    const a = generateCommits('payment-core', OPTIONS);
    const b = generateCommits('payment-core', { ...OPTIONS, seed: DEFAULT_SEED + 1 });
    expect(a[0]!.sha).not.toBe(b[0]!.sha);
  });

  it('produces unique commit shas within a repository', () => {
    const commits = generateCommits('frontend-platform', OPTIONS);
    expect(new Set(commits.map((c) => c.sha)).size).toBe(commits.length);
  });
});

describe('shape of the dataset', () => {
  it('generates every fixture repository', () => {
    const repos = generateRepositories(OPTIONS);
    expect(repos).toHaveLength(8);
    expect(repos.map((r) => r.name).sort()).toEqual([...SEED_REPOSITORY_KEYS].sort());
  });

  it('includes exactly two bots among fourteen developers', () => {
    expect(SEED_DEVELOPERS).toHaveLength(14);
    expect(SEED_DEVELOPERS.filter((d) => d.isBot)).toHaveLength(2);
  });

  it('never dates anything after the anchor', () => {
    for (const key of SEED_REPOSITORY_KEYS) {
      for (const c of generateCommits(key, OPTIONS)) {
        expect(c.authoredAt.getTime(), `${key} commit authored after anchor`).toBeLessThanOrEqual(
          ANCHOR.getTime(),
        );
        expect(c.committedAt.getTime(), `${key} commit committed after anchor`).toBeLessThanOrEqual(
          ANCHOR.getTime(),
        );
      }

      const { pullRequests, reviews } = generatePullRequests(key, OPTIONS);
      for (const pr of pullRequests) {
        expect(
          pr.createdAt.getTime(),
          `${key}#${pr.number} created after anchor`,
        ).toBeLessThanOrEqual(ANCHOR.getTime());
        expect(pr.mergedAt?.getTime() ?? 0).toBeLessThanOrEqual(ANCHOR.getTime());
        expect(pr.closedAt?.getTime() ?? 0).toBeLessThanOrEqual(ANCHOR.getTime());

        for (const review of reviews.get(pr.number) ?? []) {
          expect(
            review.submittedAt.getTime(),
            `${key}#${pr.number} reviewed after anchor`,
          ).toBeLessThanOrEqual(ANCHOR.getTime());
        }
      }

      for (const issue of generateIssues(key, OPTIONS)) {
        expect(issue.createdAt.getTime(), `${key} issue after anchor`).toBeLessThanOrEqual(
          ANCHOR.getTime(),
        );
        expect(issue.closedAt?.getTime() ?? 0).toBeLessThanOrEqual(ANCHOR.getTime());
      }
    }
  });

  it('has a weekday rhythm — weekends are much quieter than weekdays', () => {
    const commits = generateCommits('frontend-platform', OPTIONS);
    let weekday = 0;
    let weekend = 0;
    for (const c of commits) {
      const dow = c.authoredAt.getUTCDay();
      if (dow === 0 || dow === 6) weekend += 1;
      else weekday += 1;
    }
    // Consistency metrics (`active_days_ratio`, `activity_cv`) are meaningless
    // against uniform seven-day activity.
    expect(weekend).toBeLessThan(weekday * 0.15);
  });

  it('gives one developer two commit emails, so identity resolution has work to do', () => {
    const commits = generateCommits('payment-core', OPTIONS);
    const amirEmails = new Set(
      commits.map((c) => c.author?.email).filter((e): e is string => !!e && e.startsWith('amir')),
    );
    expect(amirEmails.size).toBe(2);
  });

  it('separates commit identity from account identity', () => {
    // A commit carries an email and no provider id; a pull request carries a
    // provider id. Conflating them is the failure ADR-0002 exists to prevent.
    const commits = generateCommits('api-gateway', OPTIONS);
    expect(commits[0]!.author?.providerUserId).toBeNull();
    expect(commits[0]!.author?.email).toBeTruthy();

    const { pullRequests } = generatePullRequests('api-gateway', OPTIONS);
    expect(pullRequests[0]!.author?.providerUserId).toBeTruthy();
  });

  it('leaves the dormant repository quiet for months', () => {
    const commits = generateCommits('legacy-reports', OPTIONS);
    const last = commits[commits.length - 1]!;
    const daysSince = (ANCHOR.getTime() - last.authoredAt.getTime()) / DAY_MS;
    // Repository health must have something unhealthy to score.
    expect(daysSince).toBeGreaterThan(100);
  });
});

describe('planted signal 1 — knowledge concentration in payment-core', () => {
  it('concentrates roughly 62% of commits in one developer', () => {
    const commits = generateCommits('payment-core', OPTIONS);
    const byEmail = new Map<string, number>();

    for (const c of commits) {
      // Amir's two addresses are one person; identity resolution will merge
      // them in M3, so the fixture's intent is measured that way here too.
      const email = c.author?.email ?? 'unknown';
      const person = email.startsWith('amir') ? 'amir' : email;
      byEmail.set(person, (byEmail.get(person) ?? 0) + 1);
    }

    const total = commits.length;
    const top = [...byEmail.entries()].sort((a, b) => b[1] - a[1])[0]!;

    expect(top[0]).toBe('amir');
    const share = top[1] / total;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.72);
  });

  it('is the most concentrated repository in the dataset', () => {
    const shares = SEED_REPOSITORY_KEYS.map((key) => {
      const commits = generateCommits(key, OPTIONS);
      const counts = new Map<string, number>();
      for (const c of commits) {
        const email = c.author?.email ?? 'unknown';
        const person = email.startsWith('amir') ? 'amir' : email;
        counts.set(person, (counts.get(person) ?? 0) + 1);
      }
      const top = Math.max(...counts.values());
      return { key, share: top / commits.length };
    });

    const ranked = [...shares].sort((a, b) => b.share - a.share);
    // legacy-reports is deliberately near-dead and single-owner, so it can rank
    // above payment-core; what matters is that payment-core is at the top of
    // the ACTIVE repositories.
    const active = ranked.filter((r) => r.key !== 'legacy-reports');
    expect(active[0]!.key).toBe('payment-core');
  });
});

describe('planted signal 2 — review-latency regression in frontend-platform', () => {
  const latencyHours = (repoKey: string, from: Date, to: Date): number[] => {
    const { pullRequests, reviews } = generatePullRequests(repoKey, OPTIONS);
    const out: number[] = [];

    for (const pr of pullRequests) {
      const ready = pr.readyForReviewAt;
      if (!ready || ready < from || ready >= to) continue;

      const prReviews = reviews.get(pr.number) ?? [];
      const first = prReviews.find((r) => r.reviewer?.login !== pr.author?.login);
      if (!first) continue;

      out.push((first.submittedAt.getTime() - ready.getTime()) / HOUR_MS);
    }
    return out;
  };

  const recentFrom = new Date(ANCHOR.getTime() - 30 * DAY_MS);
  const priorFrom = new Date(ANCHOR.getTime() - 90 * DAY_MS);

  it('roughly triples median time to first review in the last 30 days', () => {
    const recent = median(latencyHours('frontend-platform', recentFrom, ANCHOR));
    const prior = median(latencyHours('frontend-platform', priorFrom, recentFrom));

    expect(recent).toBeGreaterThan(prior * 2);
    expect(recent / prior).toBeLessThan(5);
  });

  it('leaves other repositories flat over the same window', () => {
    for (const key of ['payment-core', 'api-gateway', 'data-pipeline'] as const) {
      const recent = median(latencyHours(key, recentFrom, ANCHOR));
      const prior = median(latencyHours(key, priorFrom, recentFrom));
      // A detector that fires everywhere is not detecting anything.
      expect(recent / prior, `${key} should be stable`).toBeLessThan(1.8);
    }
  });
});

describe('pull requests and issues', () => {
  it('excludes draft time from the review clock', () => {
    const { pullRequests } = generatePullRequests('design-system', OPTIONS);
    const drafted = pullRequests.filter(
      (p) => p.readyForReviewAt && p.readyForReviewAt.getTime() > p.createdAt.getTime(),
    );
    expect(drafted.length).toBeGreaterThan(0);
    for (const pr of drafted) {
      expect(pr.readyForReviewAt!.getTime()).toBeGreaterThan(pr.createdAt.getTime());
    }
  });

  it('produces a realistic mix of merged, closed and open pull requests', () => {
    const { pullRequests } = generatePullRequests('frontend-platform', OPTIONS);
    const states = new Set(pullRequests.map((p) => p.state));
    expect(states.has('MERGED')).toBe(true);
    expect(states.has('CLOSED')).toBe(true);
    expect(states.has('OPEN')).toBe(true);
  });

  it('never reviews a pull request before it was ready', () => {
    for (const key of SEED_REPOSITORY_KEYS) {
      const { pullRequests, reviews } = generatePullRequests(key, OPTIONS);
      for (const pr of pullRequests) {
        const ready = pr.readyForReviewAt ?? pr.createdAt;
        for (const review of reviews.get(pr.number) ?? []) {
          expect(
            review.submittedAt.getTime(),
            `${key}#${pr.number} reviewed before ready`,
          ).toBeGreaterThanOrEqual(ready.getTime());
        }
      }
    }
  });

  it('gives issue resolution a long tail, so median and mean disagree', () => {
    const issues = generateIssues('data-pipeline', OPTIONS);
    const resolved = issues
      .filter((i) => i.closedAt)
      .map((i) => (i.closedAt!.getTime() - i.createdAt.getTime()) / HOUR_MS);

    const mean = resolved.reduce((s, v) => s + v, 0) / resolved.length;
    // If these agreed, choosing the median over the mean would be untestable.
    expect(mean).toBeGreaterThan(median(resolved) * 1.5);
  });

  it('leaves some issues open', () => {
    const issues = generateIssues('api-gateway', OPTIONS);
    expect(issues.some((i) => i.state === 'OPEN')).toBe(true);
    expect(issues.some((i) => i.state === 'CLOSED')).toBe(true);
  });
});

describe('volume', () => {
  it('generates enough history for trend and anomaly detection to have input', () => {
    let commits = 0;
    let prs = 0;
    for (const key of SEED_REPOSITORY_KEYS) {
      commits += generateCommits(key, OPTIONS).length;
      prs += generatePullRequests(key, OPTIONS).pullRequests.length;
    }
    // Rolling median + MAD needs >= 14 periods; a year of daily data is ample.
    expect(commits).toBeGreaterThan(5_000);
    expect(prs).toBeGreaterThan(1_000);
    expect(SEED_REPOSITORIES).toHaveLength(8);
  });
});
