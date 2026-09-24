---
name: algorithm-design
description: How to approach algorithmic and data-processing work in this codebase — choosing the shape of a computation, complexity and memory budgets, numerical stability, streaming versus materializing, functional core with imperative shell. Use before writing any non-trivial computation, aggregation, graph traversal or statistical routine, and when a query or job is slow.
---

# Algorithm design

This project's value is in its computations. The rules below are about getting them *right* and
*explainable*, in that order, before getting them fast.

## 1. Functional core, imperative shell

Every computation splits in two:

```text
shell   load inputs (I/O) → call core → persist outputs (I/O)
core    pure function: DTO in, result out
```

The core is where the thinking lives and it must be pure — no database, no clock, no network.
The shell is boring on purpose. When a bug appears, this split tells you immediately whether it
is a data problem or a logic problem, which is most of the debugging.

```ts
const inputs = await loadMetricInputs(ws, subject, period);   // shell
const score  = computeDeveloperScore(inputs, WEIGHTS);        // core — pure
await upsertScoreSnapshot({ ...score, subject, period });     // shell
```

## 2. Decide where the work happens — SQL, or code?

| Do it in SQL | Do it in TypeScript |
|---|---|
| Filtering, grouping, counting, percentiles over many rows | Anything with branching business meaning |
| Anything that would otherwise transfer thousands of rows | Anything that must be unit-tested without a database |
| Window functions over an ordered series | Anything reusable by the API *and* the worker |

The dividing line is **volume vs. explainability**. Reducing 200k commits to 90 daily counts is
SQL's job. Turning those 90 counts into a score is the analytics package's job — because that is
the part someone will ask you to justify.

## 3. State the complexity and the input size

Before writing a loop, answer: *how large is n in production?*

| Computation | n | Budget |
|---|---|---|
| Daily rollup for one subject | hundreds of rows | O(n), one pass |
| Score for one subject | ~15 metrics | trivial |
| Trend over a series | ≤ 730 periods | O(n) |
| Anomaly with rolling median | ≤ 28-period window | O(n log w) |
| Collaboration graph for a workspace | ≤ 200 nodes, ≤ 5k edges | O(V+E) |
| Bus factor per repository | ≤ 200 contributors | O(n log n) for the sort |

An O(n²) over 200 contributors is fine. The same shape over commits is not. **Nested loop over
anything unbounded is the bug** — the Gini coefficient's naive `Σᵢ Σⱼ |xᵢ − xⱼ|` is O(n²); use
the sorted-index formula, which is O(n log n).

## 4. Never load an unbounded set into memory

Provider pagination yields pages, and the pipeline processes pages. Anywhere you are tempted to
write `const all = await getAll()`, ask what happens on a repository with 400k commits.

```ts
for await (const page of provider.listCommits(ctx, repo, { since })) {
  await persist(page.items);        // bounded memory, resumable, checkpointable
}
```

The same applies to database reads: cursor-paginate, or aggregate in SQL.

## 5. Numerical care

- **Medians, not means**, for every duration. One PR open over a holiday moves a mean by hours
  and a median not at all.
- **Robust statistics for outlier detection.** Mean + σ is self-defeating: the spike inflates
  the σ it is tested against. Rolling median + MAD does not have this property.
- **Integer minutes for durations.** Floats accumulate error across sums and comparisons.
- **Guard every division.** Zero denominators appear constantly here — no PRs, no reviews, a
  metric that is 0 every day. Decide explicitly: `null` (no data) or a defined fallback. Never
  `NaN` reaching the database.
- **Percentages need a baseline floor.** 0 → 3 is not +300%; below a per-metric floor, report an
  absolute delta.
- **Round once, at the edge.** Compute in full precision, round only when persisting or
  rendering. Rounding intermediates makes component contributions fail to sum to the total.

## 6. Determinism

Same inputs must give byte-identical outputs on every machine and every run.

- No `Date.now()` inside the core — pass `now` as a parameter.
- No `Math.random()` — the seed generator uses an explicit seeded PRNG.
- No dependence on object key order or unsorted query results. If order matters, `ORDER BY` it.
- Sort with an explicit comparator and a tiebreaker; `Array.sort` is not stable across engines
  for large arrays without one.

This is what allows tests to assert exact numbers, which is the strongest guarantee in the
codebase.

## 7. Make it explainable before making it fast

An optimization that turns a computation into something nobody can justify has destroyed the
product's value. Piecewise-linear curves are chosen over sigmoids for exactly this reason.

If a computation must be optimized: measure first, state the before/after, and keep the naive
version as the test oracle.

## Before finishing

- [ ] Core is pure; shell does the I/O
- [ ] Input size stated, complexity acceptable at that size
- [ ] No unbounded materialization
- [ ] Every division guarded; no `NaN` path
- [ ] Deterministic — no clock, no randomness, no implicit ordering
- [ ] A worked example exists that a human can check by hand
