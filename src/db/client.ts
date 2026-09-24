import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';
import { env, isProduction } from '@shared/env.js';

/**
 * The unscoped client.
 *
 * This module is the ONLY place allowed to construct or export it — an ESLint
 * boundary rule blocks importing `@db/client` from anywhere else. Everything
 * above receives a tenant-scoped client from `tenant.ts`, so forgetting the
 * workspace filter is not something a handler can do. See ADR-0005.
 */

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const createClient = (): PrismaClient =>
  new PrismaClient({
    adapter,
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

// Next.js dev server and tsx watch both re-evaluate modules on change; without
// this the process accumulates connection pools until Postgres refuses more.
const globalForPrisma = globalThis as unknown as { __devintelPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__devintelPrisma ?? createClient();

if (!isProduction) globalForPrisma.__devintelPrisma = prisma;

/**
 * For platform administration, migrations and the retention job — operations
 * that legitimately span workspaces. Named explicitly so every call site is
 * greppable and reviewable, rather than leaving an implicit ability to omit
 * the tenant filter.
 */
export const systemClient = (): PrismaClient => prisma;

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
