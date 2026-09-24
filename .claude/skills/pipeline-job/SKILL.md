---
name: pipeline-job
description: Add or change a BullMQ queue, worker, sync stage or webhook handler. Use for anything touching ingestion, normalization, aggregation, metric computation, insight generation, recompute or background processing. Enforces the four idempotency mechanisms so a replay or a mid-batch crash cannot corrupt metrics.
---

# Pipeline job

Reference: [docs/02-pipeline.md](../../../docs/02-pipeline.md),
[ADR-0004](../../../docs/adr/0004-pipeline-idempotency.md).

## The one rule

> Every stage must produce the same result whether it runs once, twice, or is interrupted
> halfway and restarted.

Provider APIs time out mid-page. Webhooks are delivered more than once and out of order. Workers
are killed by deploys. Incremental sync deliberately overlaps its window. A stage that is only
correct on the happy path silently produces wrong metrics — and a dashboard showing 340 commits
instead of 170 looks perfectly plausible, so nobody reports it.

## The four mechanisms — know which one your job relies on

| # | Mechanism | Where |
|---|---|---|
| 1 | Uniqueness on `(provider, eventType, externalId, contentHash)` | `RawEvent` insert |
| 2 | Upsert on a natural key, never a bare insert | normalize |
| 3 | **Recompute-and-replace, never increment** | aggregate |
| 4 | Cursor advances only after the page is committed | ingest |

Number 3 is the one that looks correct when written wrongly. `count = count + 1` applied twice
is silently wrong forever; recomputing the cell from the domain layer is identical every time.

## Adding a job

**1. Pick or create the queue.** Concurrency, attempts and backoff are per queue and live in one
config table — see docs/02-pipeline.md §2. Stages are separate queues because they have
different characteristics: ingest is rate-limited I/O, normalize is transactional, aggregate is
CPU-bound and parallel-safe.

**2. Give the job a deterministic id.** Hash the payload —
`aggregate:{workspaceId}:{subjectId}:{day}` — so a burst of webhooks on one repository in one
minute collapses into one unit of work.

**3. Make the handler re-runnable.** Before writing it, answer: *what happens if this runs twice
with the same payload?* If the answer is not "identical result", restructure it.

**4. Rate limits are per integration, not global.** One workspace exhausting its GitHub quota
must not stall every other workspace. A `429` reschedules at `X-RateLimit-Reset` and does not
consume a retry attempt.

**5. Enqueue downstream work at the end**, collecting the `(subject, day)` pairs the job
touched. Never chain by calling the next stage's function directly — that loses the retry
boundary.

**6. Record progress** in `SyncRun.stats` if the job is user-visible; the SSE stream reads it.

## Webhooks

1. **Verify the HMAC over the raw body before parsing.** Signature verification runs on the raw
   buffer; a JSON parser must not touch it first.
2. **Store and return 202 in under 50 ms.** Processing inside the request is how one slow query
   turns into a flood of provider retries.
3. Redeliveries collapse on the `RawEvent` uniqueness key — no seen-set needed.

Webhooks reduce latency; they are never the only path. The 15-minute incremental sync remains
the guarantee of completeness, because deliveries get dropped.

## Ordering

Events arrive out of order — `pull_request.closed` can precede `pull_request.opened`. Handle
this by making normalization **order-independent**: PR lifecycle fields are computed as a pure
function of the PR's current review rows, not as incremental state transitions.

## Failure semantics to preserve

| Failure | Required behaviour |
|---|---|
| Provider 5xx / timeout | Retry with backoff, cursor unmoved |
| Provider 429 | Reschedule at reset, no attempt consumed |
| Token expired | `Integration.status = TOKEN_EXPIRED`, pause, notify |
| Worker killed mid-page | At most one page re-fetched |
| Malformed payload | Mark that `RawEvent` FAILED, continue the batch |
| Insight rule throws | Skip that rule, still emit the others |

## Done when

- [ ] Handler is provably re-runnable — state which of the four mechanisms it uses
- [ ] Deterministic job id
- [ ] No `increment` in any aggregate path
- [ ] Cursor advanced after commit, not before
- [ ] Downstream enqueue, not a direct call
- [ ] Test: run the job twice on the same payload, assert identical database state
