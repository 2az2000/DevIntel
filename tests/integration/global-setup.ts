import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Integration tests run against a real Postgres — the same container as
 * development, but a separate database.
 *
 * Mocking Prisma would hide exactly the SQL, constraint and tenancy bugs these
 * tests exist to catch, so there are no mocks here.
 */

const ADMIN_URL = 'postgresql://devintel:devintel@localhost:5434/postgres';
export const TEST_DATABASE_URL = 'postgresql://devintel:devintel@localhost:5434/devintel_test';

export default async function setup(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();

  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      'devintel_test',
    ]);
    if (existing.rowCount === 0) {
      // Identifier is a literal, not interpolated user input.
      await admin.query('CREATE DATABASE devintel_test');
    }
  } finally {
    await admin.end();
  }

  // `migrate deploy` rather than `migrate dev`: deploy applies the committed
  // migrations exactly and never prompts or generates a new one, which is what
  // a test database wants.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
