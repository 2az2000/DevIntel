# 03 — Algorithms

> **Read first:** [02-pipeline.md](02-pipeline.md) · **Read next:** [04-api.md](04-api.md)
> **Decision behind this document:** [ADR-0003](adr/0003-absolute-vs-cohort-scoring.md)

This is the part of DevIntel that is not a CRUD application. Everything here lives in
`src/analytics` as pure functions with no I/O, no database access and no reference to the
system clock — the current time is a parameter. That is what makes each formula below testable
against fixtures with exact expected values.

---

## 1. Rules that constrain every algorithm

1. **A score is never a bare number.** Every scoring function returns its component breakdown.
2. **Volume is never a virtue.** Commit count is a *context* figure, displayed but unweighted.
   §25 of the PRD is a product principle and here it is a code constraint: no scoring component
   is monotonically increasing in raw output volume.
3. **Normalization is against absolute targets, never against colleagues.**
   ([ADR-0003](adr/0003-absolute-vs-cohort-scoring.md))
4. **Every formula declares its behaviour on missing data.** Nulls are censored observations,
   not zeros. A developer with no pull requests has *no* delivery score, not a delivery score of
   zero.
5. **Medians, not means.** One PR left open over a holiday moves a mean by hours and a median
   not at all.
6. **Weights are versioned data, not constants in a function body.** Changing them changes
   `version`, which triggers a recompute rather than a silent rewrite of history.

```ts
export interface ScoreResult {
  value: number;                 // 0–100, rounded to 2 decimals
  version: string;               // e.g. "dev-score@1.0.0"
  coverage: number;              // 0–1: share of components with sufficient data
  components: ScoreComponent[];
}

export interface ScoreComponent {
  key: string;
  raw: number | null;            // the measured value, in its natural unit
  unit: 'hours' | 'days' | 'ratio' | 'count' | 'lines';
  normalized: number | null;     // 0–100 after the curve
  weight: number;                // as applied, after redistribution
  contribution: number;          // normalized × weight
  status: 'ok' | 'insufficient_data';
}
```

When a component has insufficient data its weight is redistributed proportionally across the
remaining components and `coverage` drops. A score below `coverage = 0.6` is returned but the UI
renders it as provisional — a confident-looking 84 computed from two of six components is a lie
the interface should not tell.

---

## 2. Metric catalog

The closed set of `metricKey` values. Adding a metric means adding a key, never a migration.

| Key | Unit | Subjects | Polarity | Source |
|---|---|---|---|---|
| `commits` | count | dev, repo, team | context | `DeveloperDailyRollup` |
| `lines_changed` | lines | dev, repo | context | rollup |
| `prs_opened` | count | dev, repo, team | context | rollup |
| `prs_merged` | count | dev, repo, team | context | rollup |
| `prs_open_end` | count | repo, team | lower | rollup |
| `pr_merge_rate` | ratio | dev, repo, team | higher | `PullRequest` |
| `pr_cycle_time_median` | hours | dev, repo, team | **lower** | `PullRequest.cycleTimeMinutes` |
| `pr_time_to_first_review_median` | hours | dev, repo, team | **lower** | `PullRequest.timeToFirstReviewMinutes` |
| `pr_size_median` | lines | dev, repo | **lower** | `PullRequest` |
| `pr_review_rounds_median` | count | repo | **lower** | `PullRequest.reviewRounds` |
| `pr_reopen_rate` | ratio | repo | **lower** | `PullRequest.reopenCount` |
| `reviews_given` | count | dev, team | context | rollup |
| `reviews_received` | count | dev | context | rollup |
| `review_response_time_median` | hours | dev, repo, team | **lower** | `PullRequestReview` |
| `review_depth_median` | count | dev | higher | `PullRequestReview.commentCount` |
| `review_coverage` | ratio | repo, team | higher | merged PRs with ≥1 external review |
| `review_reciprocity` | ratio | dev | higher | `min(given,received)/max(given,received)` |
| `reviewer_diversity` | count | repo | higher | distinct reviewers |
| `review_load_gini` | ratio | team | **lower** | distribution of reviews given |
| `distinct_collaborators` | count | dev | higher | review graph degree |
| `active_days_ratio` | ratio | dev | higher | rollup |
| `activity_cv` | ratio | dev, team | **lower** | weekly activity dispersion |
| `repositories_active` | count | dev | higher | rollup |
| `contribution_recency` | days | dev | **lower** | `RepositoryContributor` |
| `active_contributors` | count | repo | higher | rollup |
| `commit_frequency` | count/week | repo | higher | rollup |
| `days_since_last_push` | days | repo | **lower** | `Repository.pushedAtRemote` |
| `stale_pr_ratio` | ratio | repo | **lower** | open PRs older than 14 d |
| `open_pr_age_median` | days | repo | **lower** | `PullRequest` |
| `issues_opened` / `issues_closed` | count | repo, team | context | rollup |
| `issue_close_rate` | ratio | dev, repo | higher | `Issue` |
| `issue_resolution_time_median` | days | dev, repo | **lower** | `Issue.resolutionTimeMinutes` |
| `stale_issue_ratio` | ratio | repo | **lower** | open issues older than 30 d |
| `bus_factor` | count | repo | higher | `RepositoryContributor` |
| `knowledge_concentration` | ratio | repo | **lower** | HHI of contribution shares |

"Polarity" drives trend classification: a 20% rise in `pr_cycle_time_median` is a *decline*,
a 20% rise in `review_coverage` is an *improvement*. Encoding polarity in the catalog instead of
in each call site is what stops that class of bug entirely.

---

## 3. Normalization

Every raw metric reaches 0–100 through a **piecewise-linear curve against an absolute target**.

```ts
export function normalize(points: readonly [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}
```

Piecewise-linear rather than a sigmoid or a log curve for one reason: **a support engineer must
be able to explain any number on the screen**. "24 hours to first review scores 40, and 8 hours
scores 75" is a sentence anyone can check. A logistic curve with a tuned midpoint and steepness
is not.

### 3.1 The curve table

Targets come from the DORA/SPACE consensus on healthy engineering flow, deliberately set so a
well-run team lands in the 80s rather than at 100 — a scale where everyone scores 97 measures
nothing.

| Curve | Points `(raw → score)` |
|---|---|
| `pr_cycle_time_median` (h) | 4→100 · 12→80 · 24→60 · 72→30 · 168→0 |
| `pr_time_to_first_review_median` (h) | 2→100 · 8→75 · 24→40 · 72→10 · 168→0 |
| `review_response_time_median` (h) | 2→100 · 8→75 · 24→40 · 72→10 · 168→0 |
| `pr_merge_rate` | 0.5→0 · 0.7→50 · 0.85→80 · 0.95→95 · 1.0→100 |
| `pr_size_median` (lines) | 50→100 · 200→85 · 500→60 · 1000→30 · 2000→0 |
| `pr_review_rounds_median` | 1→100 · 2→85 · 3→65 · 5→30 · 8→0 |
| `review_coverage` | 0→0 · 0.5→45 · 0.8→80 · 0.95→95 · 1.0→100 |
| `review_reciprocity` | 0→0 · 0.3→40 · 0.6→75 · 0.8→90 · 1.0→100 |
| `review_depth_median` | 0→0 · 1→50 · 2→75 · 4→95 · 8→100 |
| `reviews_given_per_received` | 0→0 · 0.5→60 · 0.8→88 · 1.0→100 · 2.5→100 · 5.0→80 |
| `distinct_collaborators` | 0→0 · 2→40 · 5→75 · 8→90 · 12→100 |
| `active_days_ratio` | 0→0 · 0.3→40 · 0.5→65 · 0.7→85 · 0.9→100 |
| `activity_cv` | 0.2→100 · 0.4→85 · 0.6→70 · 1.0→40 · 1.5→0 |
| `repositories_active` | 1→40 · 2→60 · 4→85 · 6→95 · 10→100 |
| `contribution_recency` (d) | 0→100 · 3→90 · 7→70 · 14→40 · 30→0 |
| `commit_frequency` (/week) | 0→0 · 3→50 · 10→80 · 25→95 · 50→100 |
| `active_contributors` | 1→30 · 2→55 · 4→80 · 8→95 · 15→100 |
| `days_since_last_push` | 1→100 · 7→85 · 30→50 · 90→15 · 180→0 |
| `stale_pr_ratio` | 0→100 · 0.1→85 · 0.25→60 · 0.5→25 · 1.0→0 |
| `open_pr_age_median` (d) | 1→100 · 3→85 · 7→65 · 14→35 · 30→0 |
| `issue_close_rate` | 0→0 · 0.3→35 · 0.6→70 · 0.8→90 · 1.0→100 |
| `issue_resolution_time_median` (d) | 1→100 · 3→85 · 7→65 · 14→40 · 30→0 |
| `stale_issue_ratio` | 0→100 · 0.15→80 · 0.35→55 · 0.6→25 · 1.0→0 |
| `bus_factor` | 1→20 · 2→55 · 3→75 · 5→92 · 8→100 |

The `reviews_given_per_received` curve is the only non-monotonic one, and intentionally: it
peaks on a plateau from 1.0 to 2.5 and *declines* beyond 5.0. Someone absorbing five times the
review load they receive is not excelling, they are a bottleneck and a burnout risk — §19's
"review workload is concentrated among 2 team members" is the insight this curve exists to make
computable.

---

## 4. Developer Score

Weights from §24 of the PRD. `version = "dev-score@1.0.0"`.

```text
Developer Score
├── 25%  Delivery            work reaching a finished state
├── 20%  Collaboration       breadth and reciprocity of interaction
├── 20%  Consistency         sustainability of the work rhythm
├── 15%  Code Review         contribution to others' work
├── 10%  Repository Contribution
└── 10%  Issue Resolution
```

| Component | Sub-metric | Sub-weight |
|---|---|---|
| **Delivery** (25%) | `pr_cycle_time_median` | 40% |
| | `pr_merge_rate` | 40% |
| | `pr_size_median` | 20% |
| **Collaboration** (20%) | `distinct_collaborators` | 40% |
| | `review_reciprocity` | 35% |
| | `repositories_active` | 25% |
| **Consistency** (20%) | `active_days_ratio` | 60% |
| | `activity_cv` | 40% |
| **Code Review** (15%) | `review_response_time_median` | 45% |
| | `reviews_given_per_received` | 30% |
| | `review_depth_median` | 25% |
| **Repository Contribution** (10%) | `repositories_active` | 60% |
| | `contribution_recency` | 40% |
| **Issue Resolution** (10%) | `issue_close_rate` | 50% |
| | `issue_resolution_time_median` | 50% |

Note what is absent: `commits` and `lines_changed` appear nowhere. They are shown on the profile
as context and carry zero weight, because a score that rises with commit count teaches people to
split commits, and a metric that changes behaviour without improving outcomes is worse than no
metric at all.

### 4.1 Worked example

Developer **D**, 30-day window, 22 weekdays.

| Component | Sub-metric | Raw | Normalized | Sub-w | Component |
|---|---|---|---|---|---|
| Delivery | cycle time | 9.5 h | 86.25 | 0.40 | |
| | merge rate | 0.90 | 87.50 | 0.40 | |
| | PR size | 240 lines | 81.67 | 0.20 | **85.83** |
| Collaboration | collaborators | 6 | 80.00 | 0.40 | |
| | reciprocity | 0.70 | 82.50 | 0.35 | |
| | repos active | 4 | 85.00 | 0.25 | **82.13** |
| Consistency | active days | 0.68 | 83.00 | 0.60 | |
| | activity CV | 0.55 | 73.75 | 0.40 | **79.30** |
| Code Review | response time | 5.0 h | 87.50 | 0.45 | |
| | given/received | 1.10 | 100.00 | 0.30 | |
| | review depth | 2.5 | 80.00 | 0.25 | **89.38** |
| Repo contribution | repos active | 4 | 85.00 | 0.60 | |
| | recency | 1 d | 96.67 | 0.40 | **89.67** |
| Issue resolution | close rate | 0.75 | 85.00 | 0.50 | |
| | resolution time | 3.2 d | 84.00 | 0.50 | **84.50** |

Checking one cell by hand: cycle time 9.5 h sits between the curve points 4→100 and 12→80, so
`100 + (9.5 − 4)/(12 − 4) × (80 − 100) = 100 − 13.75 = 86.25`.

| Component | Score | Weight | Contribution |
|---|---|---|---|
| Delivery | 85.83 | 0.25 | 21.46 |
| Collaboration | 82.13 | 0.20 | 16.43 |
| Consistency | 79.30 | 0.20 | 15.86 |
| Code Review | 89.38 | 0.15 | 13.41 |
| Repository Contribution | 89.67 | 0.10 | 8.97 |
| Issue Resolution | 84.50 | 0.10 | 8.45 |
| | | | **84.58** |

**Developer Score = 84.58**, and the weakest contributor is Consistency, driven by an activity
CV of 0.55. That last sentence is generated from the component array, not written by hand.

---

## 5. Repository Health

Weights from §15. `version = "repo-health@1.0.0"`.

| Component | Weight | Sub-metrics (sub-weight) |
|---|---|---|
| **Activity** | 30% | `commit_frequency` (40) · `active_contributors` (35) · `days_since_last_push` (25) |
| **Maintenance** | 20% | `stale_pr_ratio` (40) · `open_pr_age_median` (35) · `pr_review_rounds_median` (25) |
| **Collaboration** | 20% | `review_coverage` (45) · `reviewer_diversity` (30) · `bus_factor` (25) |
| **Delivery** | 15% | `pr_cycle_time_median` (60) · `pr_merge_rate` (40) |
| **Issue Health** | 15% | `issue_close_rate` (40) · `issue_resolution_time_median` (35) · `stale_issue_ratio` (25) |

### 5.1 Worked example — turning a drop into an explanation

`frontend-platform`, week 32 → week 33.

| Component | W32 | W33 | Weight | Contrib W32 | Contrib W33 | Δ |
|---|---|---|---|---|---|---|
| Activity | 91.00 | 91.00 | 0.30 | 27.30 | 27.30 | 0.00 |
| Maintenance | 88.00 | 82.00 | 0.20 | 17.60 | 16.40 | −1.20 |
| Collaboration | 94.00 | 86.00 | 0.20 | 18.80 | 17.20 | −1.60 |
| Delivery | 89.90 | 69.05 | 0.15 | 13.49 | 10.36 | −3.13 |
| Issue Health | 85.00 | 85.00 | 0.15 | 12.75 | 12.75 | 0.00 |
| **Total** | | | | **89.94** | **84.01** | **−5.93** |

Delivery's own arithmetic, so the chain is checkable end to end:

```text
W32:  cycle time 9.0 h → 87.50   merge rate 0.94 → 93.50
      0.60 × 87.50 + 0.40 × 93.50 = 52.50 + 37.40 = 89.90
W33:  cycle time 26.0 h → 58.75  merge rate 0.88 → 84.50
      0.60 × 58.75 + 0.40 × 84.50 = 35.25 + 33.80 = 69.05
```

Sorting the Δ column produces the insight text mechanically:

> **Repository health fell 5.9 points** (89.9 → 84.0). The largest driver is **Delivery**
> (−3.1 of −5.9, 53%): median PR cycle time rose from 9.0 h to 26.0 h. Collaboration contributed
> −1.6 as review coverage fell from 94% to 86%.

No hand-written explanation exists anywhere in that output. It is `components[]` sorted by Δ,
rendered through a template — which is precisely what §15's "the score must be explainable"
requires.

---

## 6. Team Health

Weights chosen to describe the *system*, not to average the people in it — averaging individual
scores would make a team look healthy while one person carries it.

| Component | Weight | Sub-metrics |
|---|---|---|
| **Flow** | 30% | `pr_cycle_time_median`, `pr_time_to_first_review_median` |
| **Review responsiveness** | 25% | `review_response_time_median`, `review_coverage` |
| **Collaboration balance** | 20% | `review_load_gini`, `distinct_collaborators` (team mean) |
| **Throughput stability** | 15% | `activity_cv` of weekly `prs_merged` |
| **Work in progress** | 10% | `prs_open_end` per active developer |

`review_load_gini` is the Gini coefficient of reviews given across team members:

```text
G = Σᵢ Σⱼ |xᵢ − xⱼ| / (2n² x̄)      0 = perfectly even, 1 = one person does everything
```

Above 0.55 it produces §19's insight — *"review workload is concentrated among 2 team members"* —
naming the distribution, never ranking the individuals.

---

## 7. Trend detection

```ts
export type TrendDirection =
  | 'improving' | 'declining' | 'stable' | 'volatile' | 'insufficient_data';

export interface TrendResult {
  direction: TrendDirection;
  changePercent: number | null;
  current: number; previous: number;
  cv: number;                   // coefficient of variation across the series
  slope: number | null;         // per-period, from OLS over ≥6 periods
  confidence: 'low' | 'medium' | 'high';
}
```

Algorithm:

```text
1. Load the last 2N periods of the metric from MetricSnapshot.
2. If periods < 4 or Σ sampleSize < 5      → insufficient_data
3. current  = aggregate(last N)
   previous = aggregate(previous N)
4. changePercent = (current − previous) / |previous|
5. cv = stddev(series) / |mean(series)|
6. if cv > 0.40                            → volatile
   else if |changePercent| < 0.05          → stable
   else improving/declining, resolved by the metric's polarity
7. With ≥6 periods, fit OLS. If the slope agrees in sign with changePercent
   and R² ≥ 0.5 → confidence = 'high'      (§22 "improved consistently over 5 weeks")
```

Two guards earn their place. **The volatile class comes before the direction test**, because a
series like `[4, 22, 3, 19, 5, 21]` has a real period-over-period change and no real trend;
calling it "improving" would be a confident statement about noise. And **`previous ≈ 0` is
special-cased** — 0 → 3 open PRs is not a 300% regression, it is a small absolute change, so
below a per-metric floor the result is reported as an absolute delta instead of a percentage.

---

## 8. Anomaly detection

§45 of the PRD proposes mean and standard deviation. That is the one place the PRD's suggested
method is replaced, and the reason is structural rather than stylistic.

**Mean-based detection is self-defeating on this data.** A spike of 147 commits in a series
whose normal range is 10–30 raises both the mean *and* the standard deviation it is being tested
against. With 30 days of history, a single 147 lifts σ enough that the point itself lands near
2.5σ — under the threshold. The method hides exactly the anomalies it exists to find.

Rolling **median + MAD** (median absolute deviation) does not have this property: the median and
the MAD both ignore the outlier entirely.

```text
window   = last 28 periods, excluding the point under test
med      = median(window)
MAD      = median(|xᵢ − med|)
z_robust = 0.6745 × (x − med) / MAD          -- 0.6745 makes MAD comparable to σ
flag if |z_robust| > 3.5
```

Guards, each covering a real failure mode:

| Guard | Rule | Reason |
|---|---|---|
| Minimum history | ≥14 periods with data | A repository tracked for four days has no normal |
| `MAD = 0` | Fall back to IQR; if that is 0 too, require an absolute deviation floor | A metric that is 0 every day makes any 1 an infinite z |
| Low counts | Skip when `med < 3` for count metrics | 1 → 4 is 300% and means nothing |
| Direction | Only flag the harmful direction for polarized metrics | A sudden *drop* in cycle time is good news, not an alert |

**Worked example.** `commits`, workspace history median 18/day, MAD 5.

```text
z = 0.6745 × (147 − 18) / 5 = 0.6745 × 25.8 = 17.4      →  17.4 ≫ 3.5   flagged
```

For `pr_cycle_time_median` with a normal band of 2–10 h (median 6, MAD 2) and a current value of
46 h: `z = 0.6745 × 40 / 2 = 13.5` → flagged, and because the metric's polarity is *lower is
better*, it is flagged as a warning rather than as a neutral observation.

Phase 3 can add Isolation Forest or a seasonal decomposition; the interface
(`detectAnomalies(series, options) → Anomaly[]`) does not change, so that is a swap and not a
refactor.

---

## 9. Graph analysis and bus factor

The collaboration graph is built from reviews, which is the only edge in git data that
genuinely means "these two people worked together":

```text
nodes  Developer, Repository
edges  reviewed(A → B, weight = review count)
       contributed(Developer → Repository, weight = commits + PRs)
```

**Knowledge concentration** per repository, over a 180-day window:

```text
shareᵢ = contributionᵢ / Σ contribution
         where contribution = 0.5·commits + 0.3·prsMerged + 0.2·reviewsGiven

HHI        = Σ shareᵢ²                              0 → dispersed, 1 → one person
bus_factor = min k such that Σ (top k shares) ≥ 0.5
```

Commits are weighted highest but not exclusively: someone who reviews every PR in a repository
without writing much also holds its knowledge, and a pure commit-share model would score them at
zero and overstate the risk.

| HHI | Bus factor | Classification |
|---|---|---|
| ≥ 0.50 | 1 | **Critical** — single point of knowledge failure |
| 0.30–0.50 | 1–2 | **High** |
| 0.18–0.30 | 2–3 | **Moderate** |
| < 0.18 | ≥ 3 | **Healthy** |

Applied to the PRD's own example — Amir 62%, Sara 24%, others 14% —
`HHI = 0.62² + 0.24² + ... ≈ 0.44`, bus factor 1, classification **High**, and the generated
insight is:

> Knowledge in `payment-core` is concentrated: one contributor accounts for 62% of activity over
> the last 180 days. Bus factor is 1.

Note the phrasing. The subject of the sentence is the repository, not the person. §79's
"measure systems, not people" is enforced at the template level: subject templates for
repository- and team-scoped insights are not permitted to name an individual.

---

## 10. Insight rules

| Rule id | Fires when | Severity | Subject |
|---|---|---|---|
| `review-latency-regression` | `pr_time_to_first_review_median` ↑ ≥25% over 14 d, ≥5 PRs | WARNING | repo, team |
| `review-latency-improvement` | same metric ↓ ≥20%, confidence high | POSITIVE | repo, team |
| `pr-accumulation` | `prs_open_end` ↑ ≥50% and ≥10 absolute over 10 d | WARNING | repo, team |
| `cycle-time-regression` | `pr_cycle_time_median` ↑ ≥30% over 30 d | WARNING | repo, dev |
| `cycle-time-improvement` | ↓ ≥20% with high confidence over ≥5 periods | POSITIVE | repo, dev, team |
| `review-load-concentration` | `review_load_gini` > 0.55 with ≥4 active members | WARNING | team |
| `knowledge-concentration` | HHI ≥ 0.30 and bus factor ≤ 2 | WARNING | repo |
| `knowledge-concentration-critical` | HHI ≥ 0.50 and bus factor = 1 | CRITICAL | repo |
| `stale-pr-buildup` | `stale_pr_ratio` > 0.25 with ≥5 open PRs | WARNING | repo |
| `review-coverage-drop` | `review_coverage` < 0.7 having been ≥0.85 | WARNING | repo |
| `repository-dormant` | `days_since_last_push` > 60 on a tracked repo | INFO | repo |
| `activity-anomaly` | any anomaly with \|z\| > 3.5 in the harmful direction | INFO/WARNING | any |
| `health-drop` | health score ↓ ≥5 points period over period | WARNING | repo, team |
| `consistency-risk` | `activity_cv` > 1.0 over 8 weeks | INFO | dev |
| `sustained-overload` | `reviews_given_per_received` > 4 for 3 consecutive weeks | WARNING | dev |

Two properties of this registry matter as much as the thresholds themselves.

**Every rule states a magnitude and a minimum sample.** `≥25%` alone would fire on a repository
with three pull requests, where the median is meaningless. The sample floor is what separates an
insight from a coincidence.

**Positive rules exist.** A system that only ever reports problems trains people to close it.
`review-latency-improvement` and `cycle-time-improvement` fire on the same machinery as the
warnings and are, deliberately, no harder to trigger.

---

## 11. Testing

| Layer | Method |
|---|---|
| `normalize` | Property tests: monotonic between points, clamped outside, exact at knots |
| Each score | Fixture in, exact `ScoreResult` out — the §4.1 and §5.1 tables **are** test cases |
| Weight integrity | Assert every weight vector sums to 1.0 |
| Missing data | Each component removed in turn; assert redistribution and `coverage` |
| Trend | Synthetic series: monotonic, flat, noisy, near-zero baseline, short |
| Anomaly | The 147-commit case; MAD = 0; low-count; benign-direction cases |
| Bus factor | The 62/24/14 distribution; uniform; two-person; single-contributor |
| Rules | Fabricated histories at threshold − ε and + ε |
| End to end | Seed dataset ([01 §10](01-data-model.md)) must produce its two planted signals |

That last row is the strongest guarantee in the system: the seed generator plants a review-latency
regression and a 62% knowledge concentration, and the test asserts that the pipeline surfaces
exactly those two insights with the expected magnitudes. Because the seed is fixed, any change to
any formula in this document either preserves that result or fails CI with a specific number.
