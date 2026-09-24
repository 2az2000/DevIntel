import { describe, expect, it } from 'vitest';
import { CURVES, applyCurve, normalize, type Curve, type CurveKey } from './normalize.js';

const LINEAR: Curve = [
  [0, 0],
  [10, 100],
];

describe('normalize', () => {
  it('returns the exact knot value at each knot', () => {
    for (const [x, y] of CURVES.pr_cycle_time_median) {
      expect(normalize(CURVES.pr_cycle_time_median, x)).toBe(y);
    }
  });

  it('clamps below the first knot and above the last', () => {
    expect(normalize(LINEAR, -50)).toBe(0);
    expect(normalize(LINEAR, 1_000)).toBe(100);
  });

  it('interpolates linearly between knots', () => {
    expect(normalize(LINEAR, 5)).toBe(50);
    expect(normalize(LINEAR, 2.5)).toBe(25);
  });

  /**
   * This is the worked example from docs/03-algorithms.md §3:
   *   100 + (9.5 - 4) / (12 - 4) * (80 - 100) = 86.25
   * If this number changes, the documentation is now wrong too.
   */
  it('reproduces the documented cycle-time example exactly', () => {
    expect(applyCurve('pr_cycle_time_median', 9.5)).toBe(86.25);
  });

  /**
   * `normalize` deliberately does not round — rounding happens once, at the
   * ScoreResult boundary. Curves whose knots are decimal fractions therefore
   * carry binary floating-point residue (0.9 on the merge-rate curve yields
   * 87.50000000000001), so these assert to 9 decimals rather than pretending
   * to exact equality. The documented values in docs/03-algorithms.md §4.1 are
   * these numbers.
   */
  it('reproduces the other documented worked values', () => {
    const cases: [CurveKey, number, number][] = [
      ['pr_merge_rate', 0.9, 87.5],
      ['distinct_collaborators', 6, 80],
      ['review_reciprocity', 0.7, 82.5],
      ['repositories_active', 4, 85],
      ['active_days_ratio', 0.68, 83],
      ['activity_cv', 0.55, 73.75],
      ['review_response_time_median', 5, 87.5],
      ['review_depth_median', 2.5, 80],
      ['issue_close_rate', 0.75, 85],
      ['issue_resolution_time_median', 3.2, 84],
      ['pr_size_median', 240, 81.666_666_67],
      ['contribution_recency', 1, 96.666_666_67],
    ];

    for (const [key, input, expected] of cases) {
      expect(applyCurve(key, input), `${key}(${input})`).toBeCloseTo(expected, 7);
    }
  });

  it('is monotonic between knots for a lower-is-better curve', () => {
    let previous = Infinity;
    for (let h = 0; h <= 200; h += 0.5) {
      const value = applyCurve('pr_cycle_time_median', h);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });

  /**
   * reviews_given_per_received is the one curve that must NOT be monotonic:
   * it peaks on a plateau and declines past 5.0, because absorbing five times
   * the review load you receive is a bottleneck, not excellence.
   */
  it('declines past the plateau on the review-load curve', () => {
    expect(applyCurve('reviews_given_per_received', 1.0)).toBe(100);
    expect(applyCurve('reviews_given_per_received', 2.5)).toBe(100);
    expect(applyCurve('reviews_given_per_received', 5.0)).toBe(80);
    expect(applyCurve('reviews_given_per_received', 6.0)).toBe(80); // clamped
  });

  it('keeps every curve inside 0..100 and ascending in x', () => {
    for (const [name, curve] of Object.entries(CURVES) as [CurveKey, Curve][]) {
      expect(curve.length, `${name} must have knots`).toBeGreaterThan(1);
      for (let i = 0; i < curve.length; i++) {
        const knot = curve[i]!;
        expect(knot[1], `${name} knot ${i} score`).toBeGreaterThanOrEqual(0);
        expect(knot[1], `${name} knot ${i} score`).toBeLessThanOrEqual(100);
        if (i > 0) {
          expect(knot[0], `${name} knots must ascend in x`).toBeGreaterThan(curve[i - 1]![0]);
        }
      }
    }
  });

  it('rejects a non-finite input rather than producing NaN', () => {
    expect(() => normalize(LINEAR, NaN)).toThrow();
    expect(() => normalize(LINEAR, Infinity)).toThrow();
  });
});
