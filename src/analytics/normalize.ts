/**
 * Normalization: raw metric → 0–100.
 *
 * Piecewise-linear against an ABSOLUTE target, never a cohort percentile.
 * Cohort scoring would make every number a comparison between colleagues,
 * which is what "measure systems, not people" forbids — and it is zero-sum, so
 * one person's good week mechanically lowers everyone else's score.
 * See ADR-0003.
 *
 * Piecewise-linear rather than a sigmoid for one reason: a support engineer
 * must be able to explain any number on the screen in a single sentence.
 * "24 hours to first review scores 40, and 8 hours scores 75" is checkable.
 */

/** `[raw, score]` knots, ascending by raw. */
export type Curve = readonly (readonly [number, number])[];

export function normalize(curve: Curve, x: number): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (!first || !last) throw new Error('normalize: curve must have at least one knot');

  if (!Number.isFinite(x)) throw new Error(`normalize: x must be finite, received ${x}`);

  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];

  for (let i = 1; i < curve.length; i++) {
    const lo = curve[i - 1]!;
    const hi = curve[i]!;
    if (x <= hi[0]) {
      const span = hi[0] - lo[0];
      // Guarded: a duplicated knot would otherwise divide by zero.
      if (span === 0) return hi[1];
      return lo[1] + ((x - lo[0]) / span) * (hi[1] - lo[1]);
    }
  }

  return last[1];
}

/**
 * The curve table. Targets follow the DORA/SPACE consensus on healthy delivery
 * flow, deliberately calibrated so a well-run team lands in the 80s — a scale
 * where everyone scores 97 measures nothing.
 *
 * Every curve here is documented with its reasoning in
 * docs/03-algorithms.md §3.1. Changing one is a documentation change too.
 */
export const CURVES = {
  // ── Flow · hours, lower is better ────────────────────────────────────────
  pr_cycle_time_median: [[4, 100], [12, 80], [24, 60], [72, 30], [168, 0]],
  pr_time_to_first_review_median: [[2, 100], [8, 75], [24, 40], [72, 10], [168, 0]],
  review_response_time_median: [[2, 100], [8, 75], [24, 40], [72, 10], [168, 0]],

  pr_merge_rate: [[0.5, 0], [0.7, 50], [0.85, 80], [0.95, 95], [1.0, 100]],
  pr_size_median: [[50, 100], [200, 85], [500, 60], [1000, 30], [2000, 0]],
  pr_review_rounds_median: [[1, 100], [2, 85], [3, 65], [5, 30], [8, 0]],

  // ── Review ───────────────────────────────────────────────────────────────
  review_coverage: [[0, 0], [0.5, 45], [0.8, 80], [0.95, 95], [1.0, 100]],
  review_reciprocity: [[0, 0], [0.3, 40], [0.6, 75], [0.8, 90], [1.0, 100]],
  review_depth_median: [[0, 0], [1, 50], [2, 75], [4, 95], [8, 100]],

  /**
   * The only non-monotonic curve, and deliberately so: it plateaus from 1.0 to
   * 2.5 and DECLINES past 5.0. Someone absorbing five times the review load
   * they receive is not excelling — they are a bottleneck and a burnout risk.
   * This curve is what makes "review workload is concentrated" computable.
   */
  reviews_given_per_received: [[0, 0], [0.5, 60], [0.8, 88], [1.0, 100], [2.5, 100], [5.0, 80]],

  // ── Collaboration & rhythm ───────────────────────────────────────────────
  distinct_collaborators: [[0, 0], [2, 40], [5, 75], [8, 90], [12, 100]],
  active_days_ratio: [[0, 0], [0.3, 40], [0.5, 65], [0.7, 85], [0.9, 100]],
  activity_cv: [[0.2, 100], [0.4, 85], [0.6, 70], [1.0, 40], [1.5, 0]],
  repositories_active: [[1, 40], [2, 60], [4, 85], [6, 95], [10, 100]],
  contribution_recency: [[0, 100], [3, 90], [7, 70], [14, 40], [30, 0]],

  // ── Repository health ────────────────────────────────────────────────────
  commit_frequency: [[0, 0], [3, 50], [10, 80], [25, 95], [50, 100]],
  active_contributors: [[1, 30], [2, 55], [4, 80], [8, 95], [15, 100]],
  days_since_last_push: [[1, 100], [7, 85], [30, 50], [90, 15], [180, 0]],
  stale_pr_ratio: [[0, 100], [0.1, 85], [0.25, 60], [0.5, 25], [1.0, 0]],
  open_pr_age_median: [[1, 100], [3, 85], [7, 65], [14, 35], [30, 0]],

  // ── Issues ───────────────────────────────────────────────────────────────
  issue_close_rate: [[0, 0], [0.3, 35], [0.6, 70], [0.8, 90], [1.0, 100]],
  issue_resolution_time_median: [[1, 100], [3, 85], [7, 65], [14, 40], [30, 0]],
  stale_issue_ratio: [[0, 100], [0.15, 80], [0.35, 55], [0.6, 25], [1.0, 0]],

  // ── Knowledge distribution ───────────────────────────────────────────────
  bus_factor: [[1, 20], [2, 55], [3, 75], [5, 92], [8, 100]],
} as const satisfies Record<string, Curve>;

export type CurveKey = keyof typeof CURVES;

export const applyCurve = (key: CurveKey, x: number): number => normalize(CURVES[key], x);
