# ADR-0004 — Pipeline idempotency

**Status:** Accepted · **Date:** 2026-08-31 · **Affects:** [02-pipeline.md](../02-pipeline.md)

## Context

The pipeline runs against inputs it does not control. Provider APIs time out mid-page and return
5xx under load. Webhooks are delivered more than once, out of order, and sometimes not at all.
Workers are killed by deploys, restarts and OOM. Incremental sync deliberately overlaps its
window ([02 §4.2](../02-pipeline.md)), so it re-reads records it has already seen.

A pipeline that is only correct when nothing goes wrong will silently produce wrong metrics —
and a wrong metric is worse than a missing one, because nobody notices. A dashboard showing 340
commits instead of 170 looks perfectly plausible.

## Options

**A — Transactional exactly-once semantics.** Distributed transactions across the provider, the
queue and the database. Not achievable in practice: the provider has no transaction to enlist,
and delivery guarantees end at the network boundary.

**B — At-least-once delivery with idempotent processing.** Accept duplicates as normal, and make
processing produce the same result regardless of how many times it runs.

**C — Deduplicate at the boundary only.** A seen-set of event ids at ingest, single processing
afterwards. Handles duplicate webhooks; does not handle a worker dying after a partial write.

## Decision

**Option B**, enforced by four mechanisms — one per stage boundary.

**1. Staging uniqueness.** `RawEvent` is unique on
`(provider, eventType, externalId, contentHash)`. A replayed webhook or a re-fetched page
collapses into the row that already exists. `contentHash` rather than `externalId` alone, so a
genuine *update* to a pull request is a new row while a duplicate delivery is not.

**2. Upsert-only normalization.** Every domain write is an upsert on a natural key —
`(repositoryId, sha)`, `(repositoryId, number)`. There is no code path that inserts a domain row
unconditionally.

**3. Recompute-and-replace aggregation.** Rollup cells are written as a full recomputation of
`(subject, day)` from the domain layer, never as `count = count + 1`. An increment applied twice
is silently wrong forever; a recomputation applied twice produces the identical row. This is the
single most important of the four, because it is the one where the naive implementation looks
correct and fails invisibly.

**4. Cursors advance after commit.** `SyncCursor` moves only once its page is durably written.
A crash re-fetches at most one page, and re-fetching is free because of (1) and (2).

Job ids are deterministic hashes of their payload, so BullMQ collapses duplicate work when a
burst of webhooks lands on the same repository in the same minute.

## Consequences

**Good.** Failures cost time, never correctness. Recompute becomes a first-class operation
rather than an incident procedure, which is what makes it safe to fix a formula and rebuild
history ([02 §9](../02-pipeline.md)). Webhook and polling paths can both be enabled without
double-counting, so webhooks give low latency while polling guarantees completeness.

**Cost.** Upserts are slower than inserts, and recomputing a cell costs more than incrementing
it. Both are bounded and small: a day's rollup for one subject is a query over hundreds of rows,
not millions. Storing raw payloads adds storage, capped by retention ([01 §9](../01-data-model.md)).

**Cost — ordering is not guaranteed.** A `pull_request.closed` webhook can arrive before the
`pull_request.opened` it belongs to. Handled by making normalization order-independent: PR
lifecycle fields are computed as a pure function of the PR's current review rows rather than as
incremental state transitions, so a late-arriving event produces the same end state.

**Accepted limitation.** Deletions at the provider are not detected by polling — a force-pushed
branch that removes commits leaves those commits in our database. Webhooks cover the common
cases; a periodic reconciliation job for tracked repositories is deferred to Phase 2 rather than
pretended to be solved.
