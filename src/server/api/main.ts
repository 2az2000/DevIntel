import 'dotenv/config';
import { env } from '@shared/env.js';
import { disconnect } from '@db';
import { createApp } from './app.js';
import { logger } from './logger.js';

const app = createApp();

const server = app.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, provider: env.DATA_PROVIDER, env: env.NODE_ENV },
    'api listening',
  );
});

/**
 * Without a graceful shutdown a deploy kills in-flight work mid-transaction.
 * The pipeline is idempotent so it recovers — but recovery costs a re-fetch
 * that a clean stop avoids.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.close();
  await disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
