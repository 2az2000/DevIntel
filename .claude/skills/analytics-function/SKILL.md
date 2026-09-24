---
name: analytics-function
description: Add or change an algorithm in src/analytics — a score, normalization curve, trend classifier, anomaly detector, graph measure or insight rule. Use whenever engineering scoring, weights, thresholds, or any computed metric logic. Enforces zero-I/O purity, the ScoreResult contract, weight versioning and exact-value fixture tests.
---

# Analytics function

Reference: [docs/03-algorithms.md](../../../docs/03-algorithms.md).

This package is the reason the project exists. Everything here is a **pure function**.

## Purity — the constraint everything else depends on

No Prisma, no Redis, no `fetch`, no file access, and **no `Date.now()`** — the current time is
a parameter. Inputs are plain typed DTOs; outputs are plain results.

This is not stylistic. It is what allows every formula to be tested against fixtures with exact
expected values, and it is what keeps the algorithms reusable by both the API and the worker
without a database in the loop.

```ts
// correct
export function computeDeveloperScore(
  inputs: DeveloperScoreInputs,
  weights: ScoreWeights,
): ScoreResult

// wrong — reaches for I/O and the clock
export async function computeDeveloperScore(developerId: string): Promise<number>
```

## The score contract

Never return a bare number.

```ts
interface ScoreResult {
  value: number;        // 0–100, 2 decimals
  version: string;      // e.g. "dev-score@1.0.0" — persisted with the snapshot
  coverage: number;     // 0–1, share of components with sufficient data
  components: Array<{
    key: string;
    raw: number | null;
    unit: 'hours' | 'days' | 'ratio' | 'count' | 'lines';
    normalized: number | null;
    weight: number;     // as applied, after redistribution
    contribution: number;
    status: 'ok' | 'insufficient_data';
  }>;
}
```

The diff of two `ScoreResult`s **is** the explanation of a change. Never hand-write an
explanation string — sort the component deltas and render a template.

## Rules

1. **Normalize against absolute targets, never against a cohort.** Cohort percentiles turn every
   score into a comparison between colleagues and make it zero-sum. See
   [ADR-0003](../../../docs/adr/0003-absolute-vs-cohort-scoring.md).
2. **No component is monotonically increasing in raw output volume.** Commit count and lines
   changed are context, weighted zero.
3. **Nulls are censored observations, not zeros.** A developer with no PRs has *no* delivery
   score. Redistribute the weight and lower `coverage`.
4. **Medians, not means.** One PR left open over a holiday moves a mean by hours.
5. **Weights are versioned data.** Changing a weight changes `version` and triggers a recompute;
   it never silently rewrites history.
6. **Encode polarity in the metric catalog**, not at the call site — a rise in
   `pr_cycle_time_median` is a decline, a rise in `review_coverage` is an improvement.
7. **Robust statistics for anomalies.** Rolling median + MAD, not mean + σ: a spike inflates the
   very σ it is tested against and hides itself.

## Guards every detector needs

| Guard | Rule |
|---|---|
| Minimum history | ≥14 periods before flagging anything |
| `MAD = 0` | Fall back to IQR, then an absolute deviation floor |
| Low counts | Skip when the median is < 3 for count metrics |
| Direction | Only flag the harmful direction for polarized metrics |
| Near-zero baseline | Report an absolute delta, not a percentage |

## Adding a curve

Add to the table in docs/03-algorithms.md §3.1 **with its justification**, then to the
`CURVES` constant. Piecewise-linear only — a support engineer must be able to explain any number
on screen in one sentence.

## Tests — exact values, never ranges

```ts
it('computes the documented developer score', () => {
  expect(computeDeveloperScore(FIXTURE_D, WEIGHTS_V1).value).toBe(84.58);
});
```

The worked examples in docs/03-algorithms.md §4.1 and §5.1 are literal test cases. Also cover:
monotonicity between curve knots, clamping outside them, exact values at knots, weight vectors
summing to 1.0, each component removed in turn, and the anomaly guard cases.

## Done when

- [ ] Function is pure — grep the diff for `prisma`, `redis`, `fetch`, `Date.now`
- [ ] Returns `ScoreResult` / `TrendResult` / `Anomaly[]` / `InsightDraft`
- [ ] `version` bumped if weights or curves changed, and a recompute path noted
- [ ] docs/03-algorithms.md updated — catalog row, curve row, or rule row
- [ ] Fixture test with exact expected numbers
- [ ] Seed-signal test still passes
