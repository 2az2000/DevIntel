# ADR-0003 — Absolute targets, not cohort percentiles

**Status:** Accepted · **Date:** 2026-08-31 · **Affects:** [03-algorithms.md §3](../03-algorithms.md)

## Context

Raw metrics have incompatible units — hours, ratios, counts, lines — and must reach a common
0–100 scale before they can be weighted into a score. How that normalization is defined decides
what the score *means*, and therefore what the product is.

## Options

**A — Cohort percentile.** Rank the subject against its peers in the workspace; the percentile
is the score. Self-calibrating, needs no tuning, adapts to any team.

**B — Absolute target curves.** Map each raw value through a documented piecewise-linear curve
against a fixed target: `timeToFirstReview ≤2 h → 100`, `24 h → 40`, `≥72 h → 0`.

**C — Statistical normalization** (z-score or min-max over the cohort). A variant of A with the
same properties and less interpretability.

## Decision

**Option B — absolute target curves**, tabulated in [03 §3.1](../03-algorithms.md).

## Rationale

Three reasons, in order of weight.

**1. Cohort scoring makes every number a comparison between colleagues.** That is precisely what
§79 ("Measure systems, not people") and §19 ("the product must not say Amir is better than Ali")
forbid. Under Option A the sentence "your collaboration score is 62" *means* "you are in the
38th percentile of your teammates", whatever the interface says on top of it. The product would
become a peer-ranking tool by construction, and no amount of careful UI copy could undo that —
the number itself would carry the comparison.

**2. Cohort scores are unstable for reasons that have nothing to do with the person.** They are
zero-sum: one person's good week mechanically lowers everyone else's score. Someone joining or
leaving shifts every number in the workspace. A chart would show movement where no behaviour
changed — and a metric that moves without a cause teaches users to ignore it.

**3. Cohort scores cannot be compared across anything.** Not between workspaces, not against a
target, not against the same team last quarter. "We improved" becomes unanswerable, which
defeats the historical analytics the product exists to provide (§G5).

Absolute curves invert all three properties. A score means the same thing in January and in
June, a team can genuinely improve together, and every value is explainable in one sentence:
*"24 hours to first review scores 40; 8 hours scores 75."*

## Consequences

**Good.** Scores are stable, comparable across time and teams, and explainable to a skeptical
engineer — which is the audience. Improvement is not zero-sum. The product's privacy stance is
enforced by arithmetic rather than by interface wording.

**Cost — the curves must be chosen, and they encode a judgement.** Targets are drawn from the
DORA/SPACE consensus on healthy delivery flow and deliberately calibrated so a well-run team
lands in the 80s rather than at 100; a scale where everyone scores 97 measures nothing. Each
curve is documented with its reasoning, and the whole table is versioned, so a disagreement is a
reviewable change rather than an argument about a hidden constant.

**Cost — context is not automatic.** A team doing genuinely complex work with legitimately long
cycle times will score lower than a team shipping small changes. Mitigations: curves are
configurable per workspace (§43 requires configurable weights), and the UI leads with **trend**
rather than absolute level, because "improving" is the actionable fact and "84" is not.

**Risk — a curve encodes an opinion as though it were a measurement.** Mitigated by making every
curve visible in the product: a score's tooltip shows the raw value, the curve knots either side
of it, and the resulting normalized number. A user who disagrees can see exactly what they
disagree with, which is a better outcome than a defensible number nobody can inspect.
