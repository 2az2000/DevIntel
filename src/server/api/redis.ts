import IORedis from 'ioredis';
import { env, isProduction } from '@shared/env.js';

/**
 * The API's own Redis connection, separate from the worker's. BullMQ workers
 * issue blocking reads; sharing a connection would stall request-path commands
 * behind them.
 */
const globalForRedis = globalThis as unknown as { __devintelRedis?: IORedis };

export const redis: IORedis =
  globalForRedis.__devintelRedis ?? new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

if (!isProduction) globalForRedis.__devintelRedis = redis;

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
