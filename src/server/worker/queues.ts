import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@shared/env.js';

/**
 * `maxRetriesPerRequest: null` is REQUIRED. BullMQ's blocking commands fail on
 * the default, and the symptom is a worker that silently stops consuming.
 */
export const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

/**
 * One queue per pipeline stage, because the stages have genuinely different
 * characteristics: ingest is rate-limited I/O, normalize is transactional,
 * aggregate and metric are CPU-bound and parallel-safe.
 *
 * Reference: docs/02-pipeline.md §2
 */
export const QUEUE_NAMES = [
  'sync.discover',
  'sync.resource',
  'normalize',
  'aggregate',
  'metric',
  'insight',
  'report',
  'maintenance',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

interface QueueSettings {
  readonly concurrency: number;
  readonly attempts: number;
  readonly backoffMs: number;
}

export const QUEUE_SETTINGS: Record<QueueName, QueueSettings> = {
  'sync.discover': { concurrency: 2, attempts: 3, backoffMs: 5_000 },
  'sync.resource': { concurrency: 4, attempts: 5, backoffMs: 10_000 },
  normalize: { concurrency: 8, attempts: 5, backoffMs: 2_000 },
  aggregate: { concurrency: 8, attempts: 3, backoffMs: 5_000 },
  metric: { concurrency: 4, attempts: 3, backoffMs: 5_000 },
  insight: { concurrency: 2, attempts: 3, backoffMs: 10_000 },
  report: { concurrency: 2, attempts: 2, backoffMs: 30_000 },
  maintenance: { concurrency: 1, attempts: 1, backoffMs: 0 },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const settings = QUEUE_SETTINGS[name];
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: settings.attempts,
      backoff: { type: 'exponential', delay: settings.backoffMs },
      // Deliberate: the default keeps every completed job forever, and on this
      // workload Redis grows until it evicts something that mattered. This also
      // sets the deduplication window for deterministic job ids.
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  });

  queues.set(name, queue);
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  await connection.quit();
}


// Re-exported so callers have one import for queue concerns.
export { jobId } from './job-id.js';
