---
name: add-metric
description: Add a new metric end to end — catalog key, source query, rollup column, snapshot write, normalization curve, API exposure and UI surface. Use when someone asks for a new measurement, statistic, KPI or chart that does not exist yet. Walks the full vertical slice so a metric never lands half-wired.
---

# Add a metric, end to end

Reference: [docs/03-algorithms.md](../../../docs/03-algorithms.md) §2,
[docs/01-data-model.md](../../../docs/01-data-model.md) §6.

A metric touches six layers. Half-wired metrics are the most common way this kind of system
rots: a key exists, nothing writes it, and a chart silently renders zeros.

## Order of work

**1. Catalog entry** — `src/shared/metrics.ts`

```ts
pr_time_to_first_review_median: {
  unit: 'hours',
  subjects: ['DEVELOPER', 'REPOSITORY', 'TEAM'],
  polarity: 'lower',            // 'higher' | 'lower' | 'context'
  source: 'PullRequest.timeToFirstReviewMinutes',
}
```

`polarity` matters more than it looks: it is what tells trend detection whether a 20% rise is an
improvement or a regression. Encode it here, never at the call site.

Add the same row to the table in docs/03-algorithms.md §2.

**2. Decide: does it need a new source column?**
If the value cannot be derived from existing domain columns, stop and use `/db-model` first.
Prefer materializing a duration at normalize time over computing it at read time.

**3. Aggregate stage** — write the daily value.
Add the column to the relevant `*DailyRollup` and compute it in the aggregate job. The cell is a
**full recomputation** of `(subject, day)` — never an increment. Medians use
`percentile_cont(0.5)`, and state explicitly whether nulls are excluded.

**4. Metric stage** — write `MetricSnapshot` rows for `DAY`, then derive `WEEK` and `MONTH`.
Set `sampleSize` — it is what stops a median over two observations from being treated as
trustworthy downstream.

**5. Normalization curve** — only if the metric feeds a score.
Add the piecewise-linear curve to docs/03-algorithms.md §3.1 **with its reasoning**, and to the
`CURVES` constant. Calibrate so a well-run team lands in the 80s; a scale where everyone scores
97 measures nothing.

**6. API** — usually nothing to write.
`GET /analytics/timeseries?metric=…` already serves any catalog key. Only add an endpoint if the
metric needs a shape the generic one cannot express.

**7. UI** — add it to the metric picker. Charts read the catalog for unit, polarity and label,
so a correctly-registered metric needs no chart-specific code.

**8. Backfill** — enqueue a `metric` recompute for the range you want populated. Without this
the metric exists but has no history, and its first trend reads as insufficient data.

## Traps

- **A metric with no `sampleSize`** produces confident nonsense on thin data.
- **A metric added to the catalog but not to the aggregate job** renders as zeros, not as an
  error. Check the rollup writes before wiring the UI.
- **Percentages with a near-zero baseline.** 0 → 3 open PRs is not a 300% regression. Give the
  metric an absolute floor in the trend config.
- **Counting bots.** People-facing metrics filter `Developer.isBot`; repository activity metrics
  do not.

## Done when

- [ ] Catalog entry with unit, subjects, polarity, source
- [ ] docs/03-algorithms.md §2 row added
- [ ] Rollup column + aggregate computation (recompute, not increment)
- [ ] `MetricSnapshot` written at DAY/WEEK/MONTH with `sampleSize`
- [ ] Curve added and documented, if it feeds a score
- [ ] Backfill job enqueued
- [ ] Test asserting the metric's value on the seed dataset
