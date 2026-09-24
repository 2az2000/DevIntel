import type { Job } from 'bullmq';
import { logger } from '../api/logger.js';
import type { QueueName } from './queues.js';
import { runDiscover, runResource, type DiscoverJob, type ResourceJob } from './stages/ingest.js';

/**
 * The stage registry.
 *
 * Every processor must be re-runnable: BullMQ re-runs a stalled job while the
 * original may still be executing, so a handler that is only correct once is a
 * latent corruption. Each stage states which of ADR-0004's four mechanisms it
 * relies on.
 */
export type Processor = (job: Job) => Promise<unknown>;

export const processors: Partial<Record<QueueName, Processor>> = {
  /** Mechanisms 1 (uniqueness) and 4 (cursor after commit). */
  'sync.discover': async (job) => {
    const data = job.data as DiscoverJob;
    logger.info({ jobId: job.id, integrationId: data.integrationId }, 'discover started');
    return runDiscover(data);
  },

  /** Mechanisms 1 and 4. */
  'sync.resource': async (job) => {
    const data = job.data as ResourceJob;
    logger.debug(
      { jobId: job.id, repo: data.repositoryExternalId, resource: data.resource },
      'resource sync started',
    );
    return runResource(data);
  },

  // normalize  → M3   (mechanism 2: upsert on a natural key)
  // aggregate  → M4   (mechanism 3: recompute-and-replace, never increment)
  // metric     → M4
  // insight    → M5
};
