---
name: bullmq-workers
description: BullMQ library mechanics — queue and worker construction, job options, deterministic job ids, retries and backoff, rate limiting, flows, repeatable jobs, events, concurrency and shutdown. Use when wiring queues or workers, or debugging stuck, duplicated or lost jobs. For what our stages must guarantee, use pipeline-job.
---

# BullMQ

`/pipeline-job` covers *what our stages must guarantee*. This covers *how the library behaves*.

## Connections

```ts
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
```

`maxRetriesPerRequest: null` is **required** — BullMQ's blocking commands fail on the default,
and the symptom is a worker that silently stops consuming. Queues and workers get separate
connections; a worker's blocking read would otherwise stall the producer.

## Queue and job options

```ts
export const aggregateQueue = new Queue<AggregateJob>('aggregate', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
```

Set `removeOnComplete` deliberately. The default keeps every completed job forever, and on this
workload Redis memory grows until it evicts something that mattered.

## Deterministic job ids

```ts
await aggregateQueue.add(
  'aggregate',
  { workspaceId, subjectId, day },
  { jobId: `aggregate:${workspaceId}:${subjectId}:${day}` },
);
```

BullMQ ignores an add whose `jobId` already exists, which collapses a burst of webhooks on one
repository into one unit of work. Two caveats: the dedup only holds while the job is still in
Redis (so `removeOnComplete.age` sets the dedup window), and a `jobId` may not contain `:` in
some older versions — verify against the installed version before relying on the format.

## Workers

```ts
const worker = new Worker<AggregateJob>('aggregate', processor, {
  connection,
  concurrency: 8,
  limiter: { max: 100, duration: 1000 },
});
```

- `concurrency` is per worker process, not global.
- The processor must be `async` and must **throw** to fail. Returning a rejected value silently
  succeeds.
- Long jobs need `worker.extendLock()` or a lock duration above the expected runtime, or the job
  is considered stalled and re-run while still executing — a classic double-processing bug.

## Rate limiting per integration, not globally

```ts
new Worker('sync.resource', processor, {
  connection,
  limiter: { max: 10, duration: 1000, groupKey: 'integrationId' },
});
```

Without `groupKey`, one workspace exhausting its GitHub quota stalls every other workspace.

For a `429`, do not consume a retry attempt — reschedule explicitly:

```ts
if (err.status === 429) {
  await job.moveToDelayed(resetAt.getTime(), job.token);
  throw new DelayedError();          // tells BullMQ this is not a failure
}
```

## Flows for parent/child stages

```ts
await flowProducer.add({
  name: 'metric', queueName: 'metric', data: { ... },
  children: days.map((day) => ({ name: 'aggregate', queueName: 'aggregate', data: { day } })),
});
```

A flow parent runs only after all children succeed. Useful for "recompute these 90 days, then
compute the score once". Keep flow trees shallow — deep trees are hard to observe and to retry.

## Repeatable jobs

```ts
await syncQueue.add('incremental', { integrationId },
  { repeat: { pattern: '*/15 * * * *' }, jobId: `incremental:${integrationId}` });
```

Changing a repeat pattern creates a **new** repeatable entry; the old one keeps firing. Always
`removeRepeatable` with the previous options before re-adding, or schedule from a single place
that reconciles on boot.

## Observability

```ts
const events = new QueueEvents('aggregate', { connection });
events.on('failed', ({ jobId, failedReason }) => log.error({ jobId, failedReason }));
worker.on('error', (err) => log.error({ err }, 'worker error'));   // never let this be unhandled
```

Alert on: queue depth growth over 15 minutes, failed-set arrivals, and stalled counts. Record
duration and item count per stage as OpenTelemetry metrics.

## Shutdown

```ts
process.on('SIGTERM', async () => {
  await worker.close();      // waits for in-flight jobs
  await queue.close();
  await connection.quit();
});
```

`worker.close(true)` forces immediately and should only be used when the process must die now.

## Traps

- **Job data must be JSON-serializable.** No `Date` round-trip, no `BigInt`, no class instances —
  pass ISO strings and parse in the processor.
- **Keep payloads small.** Pass ids, not rows; the payload lives in Redis.
- **A stalled job is re-run.** Everything the processor does must therefore be idempotent — see
  `/pipeline-job`.
- **`attempts: 1` means no retry**, not one retry.

## Before finishing

- [ ] `maxRetriesPerRequest: null` on the connection
- [ ] `removeOnComplete` / `removeOnFail` set
- [ ] Deterministic `jobId`
- [ ] Rate limiter has a `groupKey` where one tenant could starve others
- [ ] 429 reschedules without consuming an attempt
- [ ] `worker.on('error')` handled; shutdown closes cleanly
- [ ] Payload is small and JSON-safe
