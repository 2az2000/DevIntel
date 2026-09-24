/**
 * The metric catalog.
 *
 * Adding a metric is a new entry here, never a migration — the narrow
 * MetricSnapshot table stores any key the same way (ADR-0001).
 *
 * `polarity` is the field that earns its place: it tells trend detection
 * whether a 20% rise is an improvement or a regression. Encoding it once here
 * rather than at each call site eliminates that class of bug entirely.
 *
 * Reference: docs/03-algorithms.md §2
 */

export const SUBJECT_TYPES = ['DEVELOPER', 'REPOSITORY', 'TEAM', 'WORKSPACE'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const GRANULARITIES = ['DAY', 'WEEK', 'MONTH'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export type MetricUnit = 'count' | 'ratio' | 'hours' | 'days' | 'lines' | 'per_week';

/**
 * `higher` — more is better · `lower` — less is better ·
 * `context` — displayed, never scored. Commit counts live here on purpose:
 * a score that rises with commit count teaches people to split commits.
 */
export type Polarity = 'higher' | 'lower' | 'context';

export interface MetricDefinition {
  readonly unit: MetricUnit;
  readonly subjects: readonly SubjectType[];
  readonly polarity: Polarity;
  readonly source: string;
  /** Below this many observations the value is not trustworthy on its own. */
  readonly minSampleSize: number;
  /** For percentage changes: below this baseline, report an absolute delta. */
  readonly percentFloor?: number;
}

const DEV_REPO_TEAM = ['DEVELOPER', 'REPOSITORY', 'TEAM'] as const;

export const METRICS = {
  // ── Volume · context only, never weighted ────────────────────────────────
  commits: { unit: 'count', subjects: DEV_REPO_TEAM, polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 5 },
  lines_changed: { unit: 'lines', subjects: ['DEVELOPER', 'REPOSITORY'], polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 100 },
  prs_opened: { unit: 'count', subjects: DEV_REPO_TEAM, polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 3 },
  prs_merged: { unit: 'count', subjects: DEV_REPO_TEAM, polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 3 },
  issues_opened: { unit: 'count', subjects: ['REPOSITORY', 'TEAM'], polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 3 },
  issues_closed: { unit: 'count', subjects: ['REPOSITORY', 'TEAM'], polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 3 },
  reviews_given: { unit: 'count', subjects: ['DEVELOPER', 'TEAM'], polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 3 },
  reviews_received: { unit: 'count', subjects: ['DEVELOPER'], polarity: 'context', source: 'DailyRollup', minSampleSize: 1, percentFloor: 3 },

  // ── Flow ─────────────────────────────────────────────────────────────────
  prs_open_end: { unit: 'count', subjects: ['REPOSITORY', 'TEAM'], polarity: 'lower', source: 'DailyRollup', minSampleSize: 1, percentFloor: 5 },
  pr_merge_rate: { unit: 'ratio', subjects: DEV_REPO_TEAM, polarity: 'higher', source: 'PullRequest', minSampleSize: 5 },
  pr_cycle_time_median: { unit: 'hours', subjects: DEV_REPO_TEAM, polarity: 'lower', source: 'PullRequest.cycleTimeMinutes', minSampleSize: 5 },
  pr_time_to_first_review_median: { unit: 'hours', subjects: DEV_REPO_TEAM, polarity: 'lower', source: 'PullRequest.timeToFirstReviewMinutes', minSampleSize: 5 },
  pr_size_median: { unit: 'lines', subjects: ['DEVELOPER', 'REPOSITORY'], polarity: 'lower', source: 'PullRequest', minSampleSize: 5 },
  pr_review_rounds_median: { unit: 'count', subjects: ['REPOSITORY'], polarity: 'lower', source: 'PullRequest.reviewRounds', minSampleSize: 5 },
  pr_reopen_rate: { unit: 'ratio', subjects: ['REPOSITORY'], polarity: 'lower', source: 'PullRequest.reopenCount', minSampleSize: 10 },
  open_pr_age_median: { unit: 'days', subjects: ['REPOSITORY'], polarity: 'lower', source: 'PullRequest', minSampleSize: 3 },
  stale_pr_ratio: { unit: 'ratio', subjects: ['REPOSITORY'], polarity: 'lower', source: 'PullRequest', minSampleSize: 5 },

  // ── Review ───────────────────────────────────────────────────────────────
  review_response_time_median: { unit: 'hours', subjects: DEV_REPO_TEAM, polarity: 'lower', source: 'PullRequestReview', minSampleSize: 5 },
  review_depth_median: { unit: 'count', subjects: ['DEVELOPER'], polarity: 'higher', source: 'PullRequestReview.commentCount', minSampleSize: 5 },
  review_coverage: { unit: 'ratio', subjects: ['REPOSITORY', 'TEAM'], polarity: 'higher', source: 'PullRequest + reviews', minSampleSize: 5 },
  review_reciprocity: { unit: 'ratio', subjects: ['DEVELOPER'], polarity: 'higher', source: 'DailyRollup', minSampleSize: 5 },
  reviewer_diversity: { unit: 'count', subjects: ['REPOSITORY'], polarity: 'higher', source: 'PullRequestReview', minSampleSize: 5 },
  review_load_gini: { unit: 'ratio', subjects: ['TEAM'], polarity: 'lower', source: 'PullRequestReview', minSampleSize: 4 },

  // ── Collaboration & rhythm ───────────────────────────────────────────────
  distinct_collaborators: { unit: 'count', subjects: ['DEVELOPER'], polarity: 'higher', source: 'review graph', minSampleSize: 1 },
  active_days_ratio: { unit: 'ratio', subjects: ['DEVELOPER'], polarity: 'higher', source: 'DailyRollup', minSampleSize: 5 },
  activity_cv: { unit: 'ratio', subjects: ['DEVELOPER', 'TEAM'], polarity: 'lower', source: 'DailyRollup', minSampleSize: 4 },
  repositories_active: { unit: 'count', subjects: ['DEVELOPER'], polarity: 'higher', source: 'DailyRollup', minSampleSize: 1 },
  contribution_recency: { unit: 'days', subjects: ['DEVELOPER'], polarity: 'lower', source: 'RepositoryContributor', minSampleSize: 1 },

  // ── Repository health ────────────────────────────────────────────────────
  active_contributors: { unit: 'count', subjects: ['REPOSITORY'], polarity: 'higher', source: 'DailyRollup', minSampleSize: 1 },
  commit_frequency: { unit: 'per_week', subjects: ['REPOSITORY'], polarity: 'higher', source: 'DailyRollup', minSampleSize: 1 },
  days_since_last_push: { unit: 'days', subjects: ['REPOSITORY'], polarity: 'lower', source: 'Repository.pushedAtRemote', minSampleSize: 1 },

  // ── Issues ───────────────────────────────────────────────────────────────
  issue_close_rate: { unit: 'ratio', subjects: ['DEVELOPER', 'REPOSITORY'], polarity: 'higher', source: 'Issue', minSampleSize: 5 },
  issue_resolution_time_median: { unit: 'days', subjects: ['DEVELOPER', 'REPOSITORY'], polarity: 'lower', source: 'Issue.resolutionTimeMinutes', minSampleSize: 5 },
  stale_issue_ratio: { unit: 'ratio', subjects: ['REPOSITORY'], polarity: 'lower', source: 'Issue', minSampleSize: 5 },

  // ── Knowledge distribution ───────────────────────────────────────────────
  bus_factor: { unit: 'count', subjects: ['REPOSITORY'], polarity: 'higher', source: 'RepositoryContributor', minSampleSize: 2 },
  knowledge_concentration: { unit: 'ratio', subjects: ['REPOSITORY'], polarity: 'lower', source: 'RepositoryContributor', minSampleSize: 2 },
} as const satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRICS;

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export const metricDefinition = (key: MetricKey): MetricDefinition => METRICS[key];

export const isScored = (key: MetricKey): boolean => METRICS[key].polarity !== 'context';

export function metricsForSubject(subject: SubjectType): MetricKey[] {
  return METRIC_KEYS.filter((k) => (METRICS[k].subjects as readonly SubjectType[]).includes(subject));
}
