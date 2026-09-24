# ADR-0001 — Metric storage shape

**Status:** Accepted · **Date:** 2026-08-31 · **Affects:** [01-data-model.md §6](../01-data-model.md), [02-pipeline.md §6–7](../02-pipeline.md)

## Context

Two access patterns sit on top of the same numbers, and they want opposite things.

**Reading** is "give me 90 days of this dashboard for this subject" — many metrics, one subject,
one contiguous range, needed in under 200 ms, requested constantly.

**Analysis** is "give me the full history of `pr_cycle_time_median` for these 40 repositories" —
one metric, many subjects, long range, requested by trend and anomaly detection.

§36 of the PRD lists both `MetricSnapshot` and `DeveloperMetric` / `RepositoryMetric` /
`TeamMetric`, without resolving which is authoritative.

## Options

**A — Wide tables only.** One column per metric on a per-subject-per-day table. Reads are
trivially fast. But every new metric is a migration on a large table, trend detection needs a
different query per metric, and one query cannot span metrics generically — which makes the
interactive analytics explorer (§26) a switch statement over columns.

**B — Narrow table only.** `(subject, metricKey, period) → value`. Any metric queryable the same
way, new metrics are new rows. But a dashboard showing 12 metrics over 90 days becomes 1,080
rows pivoted at request time, on the hot path, for every load.

**C — Both, with a clear division of responsibility.**

## Decision

**Option C.**

- **`MetricSnapshot`** (narrow) is the **history**. Every trend, anomaly and comparison
  algorithm reads only this table. Adding a metric is a new `metricKey`, never a migration.
- **`*DailyRollup`** (wide) is the **read path**. Dashboards read it directly: one indexed range
  scan, no joins, no aggregation, no pivot.

Both are derived from the domain layer and both are rebuildable, so they cannot disagree in a
way a recompute will not fix.

## Consequences

**Good.** Dashboards hit their latency budget without caching heroics. Trend and anomaly
detection are metric-agnostic — one implementation serves all 35 keys in the catalog. The
analytics explorer is one endpoint rather than a family. New metrics require no schema change.

**Cost.** Both tables are written for the same numbers, roughly 15% more analytics storage, and
the metric stage must write both. The duplication is acceptable because both are disposable:
neither is a source of truth, and a discrepancy is repaired by re-running a job.

**Risk.** The two could drift if something wrote one without the other. Mitigated by writing
both inside a single transaction in the metric stage, and by a nightly consistency check that
samples rollup cells against recomputed snapshot values.

## Notes

Materialized views were considered for the rollups and rejected. `REFRESH MATERIALIZED VIEW` is
all-or-nothing, while the update pattern here is inherently incremental — a webhook touches one
repository on one day. Recomputing that single cell is cheap; refreshing a whole view is not.

This shape also keeps a future OLAP migration open. If `MetricSnapshot` outgrows Postgres, it is
already the narrow, append-mostly, time-keyed table that a columnar store expects, and nothing
above it reads it in a way that would break.
