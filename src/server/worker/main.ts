import 'dotenv/config';
import { Worker } from 'bullmq';
import { env } from '@shared/env.js';
import { disconnect } from '@db';
import { logger } from '../api/logger.js';
import { QUEUE_NAMES, QUEUE_SETTINGS, closeQueues, connection } from './queues.js';
import { processors } from './processors.js';

const workers = QUEUE_NAMES.map((name) => {
  const worker = new Worker(
    name,
    async (job) => {
      const processor = processors[name];
      if (!processor) {
        throw new Error(`No processor registered for queue "${name}" (see ROADMAP.md)`);
      }
      return processor(job);
    },
    { connection, concurrency: QUEUE_SETTINGS[name].concurrency },
  );

  // An unhandled 'error' event on a Worker crashes the process in Node.
  worker.on('error', (err) => logger.error({ err, queue: name }, 'worker error'));
  worker.on('failed', (job, err) =>
    logger.error({ err, queue: name, jobId: job?.id }, 'job failed'),
  );

  return worker;
});

logger.info(
  { queues: QUEUE_NAMES.length, provider: env.DATA_PROVIDER },
  'worker started',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down worker');
  // close() waits for in-flight jobs rather than abandoning them mid-transaction.
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  await disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
