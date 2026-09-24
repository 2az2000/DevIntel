import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Kept in sync with `paths` in tsconfig.json. */
const alias = {
  '@shared': r('./src/shared'),
  '@analytics': r('./src/analytics'),
  '@providers': r('./src/providers'),
  '@api': r('./src/server/api'),
  '@worker': r('./src/server/worker'),
  '@components': r('./src/components'),
  '@db': r('./src/db'),
  '@': r('./src'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        // Pure unit tests. No database, no network, no containers.
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
          environment: 'node',
        },
      },
      {
        // Integration: a real Postgres and a real Redis. Mocking Prisma would
        // hide exactly the SQL, constraint and tenancy bugs these exist to find.
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['./tests/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Each file truncates the whole database, so files cannot run
          // concurrently against the same one.
          fileParallelism: false,
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: 'postgresql://devintel:devintel@localhost:5434/devintel_test',
            // Redis database 15, so tests never disturb development rate limits.
            REDIS_URL: 'redis://localhost:6380/15',
            SESSION_SECRET: 'integration-test-secret-at-least-32-chars',
            TOKEN_ENCRYPTION_KEY:
              '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            DATA_PROVIDER: 'seed',
            LOG_LEVEL: 'error',
            WEB_ORIGIN: 'http://localhost:3000',
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/analytics/**', 'src/shared/**'],
      thresholds: { lines: 80, functions: 80, branches: 75 },
    },
  },
});
