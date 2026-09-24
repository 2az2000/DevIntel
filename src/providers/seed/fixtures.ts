/**
 * The cast and the repositories.
 *
 * Fixed data, not generated: the *shape* of the workspace is what makes the
 * dataset useful, and it needs to be reviewable. The generator turns these into
 * commits, pull requests and reviews.
 *
 * Two signals are planted here deliberately, because a pipeline that produces
 * no findings cannot be shown to work:
 *
 *   1. `payment-core` has ~62% of its contribution concentrated in one
 *      developer, which the bus-factor analysis must surface (M5).
 *   2. `frontend-platform` has a review-latency regression in the last 30 days,
 *      which trend and anomaly detection must surface (M5).
 *
 * Reference: docs/02-pipeline.md §4, ROADMAP M2
 */

export interface SeedDeveloper {
  readonly key: string;
  readonly login: string;
  readonly name: string;
  readonly email: string;
  readonly isBot: boolean;
  /** Relative volume of activity; 1.0 is an ordinary full-time contributor. */
  readonly intensity: number;
  /**
   * A second address the same person commits from — a laptop with a different
   * `git config`. Identity resolution must fold these into one Developer, and
   * without at least one in the dataset that code path is never exercised.
   */
  readonly altEmail?: string;
  /** Hours of the day this person tends to work, in the workspace timezone. */
  readonly activeHours: readonly [number, number];
}

export const SEED_DEVELOPERS: readonly SeedDeveloper[] = [
  { key: 'amir',    login: 'amir-rn',      name: 'Amir Rezaei',     email: 'amir@devintel.test',    isBot: false, intensity: 1.35, altEmail: 'amir.rezaei@personal.test', activeHours: [9, 19] },
  { key: 'sara',    login: 'sara-k',       name: 'Sara Karimi',     email: 'sara@devintel.test',    isBot: false, intensity: 1.20, activeHours: [8, 17] },
  { key: 'ali',     login: 'ali-m',        name: 'Ali Moradi',      email: 'ali@devintel.test',     isBot: false, intensity: 1.00, activeHours: [10, 20] },
  { key: 'nadia',   login: 'nadia-h',      name: 'Nadia Hosseini',  email: 'nadia@devintel.test',   isBot: false, intensity: 0.95, activeHours: [7, 16] },
  { key: 'reza',    login: 'reza-t',       name: 'Reza Tabrizi',    email: 'reza@devintel.test',    isBot: false, intensity: 0.85, activeHours: [11, 21] },
  { key: 'leila',   login: 'leila-s',      name: 'Leila Sadeghi',   email: 'leila@devintel.test',   isBot: false, intensity: 1.10, activeHours: [9, 18] },
  { key: 'kian',    login: 'kian-a',       name: 'Kian Ahmadi',     email: 'kian@devintel.test',    isBot: false, intensity: 0.70, activeHours: [13, 22] },
  { key: 'mina',    login: 'mina-r',       name: 'Mina Rahimi',     email: 'mina@devintel.test',    isBot: false, intensity: 0.90, activeHours: [8, 18] },
  { key: 'omid',    login: 'omid-b',       name: 'Omid Bahrami',    email: 'omid@devintel.test',    isBot: false, intensity: 0.60, activeHours: [10, 19] },
  { key: 'yasmin',  login: 'yasmin-n',     name: 'Yasmin Nouri',    email: 'yasmin@devintel.test',  isBot: false, intensity: 1.05, activeHours: [9, 17] },
  { key: 'daniel',  login: 'daniel-f',     name: 'Daniel Farahani', email: 'daniel@devintel.test',  isBot: false, intensity: 0.45, activeHours: [14, 23] },
  { key: 'parisa',  login: 'parisa-g',     name: 'Parisa Ghaderi',  email: 'parisa@devintel.test',  isBot: false, intensity: 0.80, activeHours: [8, 16] },

  // Bots. Excluded from every people-facing metric, still counted in
  // repository activity — a repository that only dependabot touches is not a
  // healthy repository, and the health score must be able to say so.
  { key: 'dependabot', login: 'dependabot[bot]', name: 'dependabot', email: 'dependabot@users.noreply.test', isBot: true, intensity: 0.90, activeHours: [3, 5] },
  { key: 'ci-bot',     login: 'devintel-ci[bot]', name: 'DevIntel CI', email: 'ci@devintel.test',           isBot: true, intensity: 0.55, activeHours: [0, 23] },
];

export interface SeedRepository {
  readonly key: string;
  readonly name: string;
  readonly primaryLanguage: string;
  readonly languages: Readonly<Record<string, number>>;
  readonly stars: number;
  /** Baseline commits per active weekday, before per-developer intensity. */
  readonly dailyCommits: number;
  /** Contribution weights by developer key. Normalized by the generator. */
  readonly contributors: Readonly<Record<string, number>>;
  /** Median hours from "ready for review" to the first review. */
  readonly baseReviewLatencyHours: number;
  readonly prsPerWeek: number;
  readonly issuesPerWeek: number;
  /**
   * Multiplies review latency during the last 30 days. 1 = no change.
   * This is the planted regression.
   */
  readonly recentLatencyMultiplier: number;
}

export const SEED_ORG = 'devintel-labs';

export const SEED_REPOSITORIES: readonly SeedRepository[] = [
  {
    key: 'payment-core',
    name: 'payment-core',
    primaryLanguage: 'TypeScript',
    languages: { TypeScript: 412_000, SQL: 38_000, Shell: 4_200 },
    stars: 64,
    dailyCommits: 6,
    // ── PLANTED SIGNAL 1 ──────────────────────────────────────────────────
    // Amir holds ~62% of contribution. Bus factor must flag this repository as
    // a knowledge-concentration risk. The exact share is asserted in a test.
    contributors: { amir: 62, sara: 24, ali: 8, 'ci-bot': 6 },
    baseReviewLatencyHours: 3.5,
    prsPerWeek: 5,
    issuesPerWeek: 3,
    recentLatencyMultiplier: 1,
  },
  {
    key: 'frontend-platform',
    name: 'frontend-platform',
    primaryLanguage: 'TypeScript',
    languages: { TypeScript: 588_000, CSS: 74_000, HTML: 12_000 },
    stars: 128,
    dailyCommits: 11,
    contributors: { leila: 22, yasmin: 20, nadia: 18, mina: 16, kian: 12, amir: 6, dependabot: 6 },
    baseReviewLatencyHours: 4,
    prsPerWeek: 9,
    issuesPerWeek: 6,
    // ── PLANTED SIGNAL 2 ──────────────────────────────────────────────────
    // Review latency roughly triples over the last 30 days. Trend detection
    // must classify this as DECLINING and the bottleneck rule must name this
    // repository.
    recentLatencyMultiplier: 3.1,
  },
  {
    key: 'api-gateway',
    name: 'api-gateway',
    primaryLanguage: 'Go',
    languages: { Go: 264_000, Dockerfile: 3_100 },
    stars: 91,
    dailyCommits: 7,
    contributors: { ali: 30, reza: 26, omid: 18, sara: 14, 'ci-bot': 12 },
    baseReviewLatencyHours: 2.5,
    prsPerWeek: 6,
    issuesPerWeek: 4,
    recentLatencyMultiplier: 1,
  },
  {
    key: 'data-pipeline',
    name: 'data-pipeline',
    primaryLanguage: 'Python',
    languages: { Python: 198_000, SQL: 42_000 },
    stars: 37,
    dailyCommits: 5,
    contributors: { nadia: 34, parisa: 28, mina: 20, daniel: 12, dependabot: 6 },
    baseReviewLatencyHours: 6,
    prsPerWeek: 4,
    issuesPerWeek: 5,
    recentLatencyMultiplier: 1,
  },
  {
    key: 'design-system',
    name: 'design-system',
    primaryLanguage: 'TypeScript',
    languages: { TypeScript: 156_000, CSS: 88_000 },
    stars: 212,
    dailyCommits: 4,
    contributors: { yasmin: 40, leila: 32, mina: 18, dependabot: 10 },
    baseReviewLatencyHours: 5,
    prsPerWeek: 3,
    issuesPerWeek: 2,
    recentLatencyMultiplier: 1,
  },
  {
    key: 'infra-terraform',
    name: 'infra-terraform',
    primaryLanguage: 'HCL',
    languages: { HCL: 74_000, Shell: 11_000 },
    stars: 12,
    dailyCommits: 2,
    contributors: { reza: 46, omid: 30, ali: 16, 'ci-bot': 8 },
    baseReviewLatencyHours: 8,
    prsPerWeek: 2,
    issuesPerWeek: 1,
    recentLatencyMultiplier: 1,
  },
  {
    key: 'mobile-client',
    name: 'mobile-client',
    primaryLanguage: 'Kotlin',
    languages: { Kotlin: 221_000, Swift: 96_000 },
    stars: 58,
    dailyCommits: 6,
    contributors: { kian: 34, daniel: 26, parisa: 22, amir: 10, dependabot: 8 },
    baseReviewLatencyHours: 7,
    prsPerWeek: 4,
    issuesPerWeek: 4,
    recentLatencyMultiplier: 1,
  },
  {
    // Deliberately near-dead: last push months ago, one contributor. Repository
    // health must score this poorly, and the staleness rules must fire. A
    // dataset where everything is healthy tests only half the code.
    key: 'legacy-reports',
    name: 'legacy-reports',
    primaryLanguage: 'Java',
    languages: { Java: 143_000 },
    stars: 4,
    dailyCommits: 1,
    contributors: { omid: 80, daniel: 20 },
    baseReviewLatencyHours: 30,
    prsPerWeek: 1,
    issuesPerWeek: 1,
    recentLatencyMultiplier: 1,
  },
];

/** Repositories stop receiving activity this many days before the anchor. */
export const DORMANT_AFTER_DAYS: Readonly<Record<string, number>> = {
  'legacy-reports': 115,
};

export const COMMIT_SUBJECTS: readonly string[] = [
  'fix null handling in %s',
  'add %s coverage',
  'refactor %s for readability',
  'bump %s dependency',
  'handle edge case in %s',
  'improve %s performance',
  'document %s behaviour',
  'remove dead code from %s',
  'tighten types around %s',
  'correct %s error message',
];

export const COMPONENTS: readonly string[] = [
  'the retry path', 'session handling', 'the parser', 'pagination', 'the cache layer',
  'metric rollups', 'the webhook route', 'token refresh', 'the query builder', 'date bucketing',
];

export const PR_TITLES: readonly string[] = [
  'Fix %s under concurrent load',
  'Add %s regression test',
  'Refactor %s',
  'Support %s in the public API',
  'Reduce allocations in %s',
  'Make %s idempotent',
  'Backfill %s',
  'Harden %s against malformed input',
];

export const ISSUE_TITLES: readonly string[] = [
  '%s returns a stale value',
  'Intermittent failure in %s',
  '%s should surface a clearer error',
  'Performance regression in %s',
  'Document %s',
  '%s breaks on empty input',
];

export const LABELS: readonly string[] = [
  'bug', 'enhancement', 'documentation', 'performance', 'good first issue', 'tech-debt', 'security',
];
