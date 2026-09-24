/**
 * The database layer's public surface.
 *
 * Note what is NOT re-exported: the unscoped `prisma` client. It lives in
 * `./client.js` and an ESLint rule blocks importing that path from outside
 * `src/db`. Callers get `tenantClient(workspaceId)` instead.
 */
export { tenantClient, TENANT_SCOPED_MODELS, type TenantClient } from './tenant.js';
export { disconnect, systemClient } from './client.js';

export { Prisma } from './generated/client.js';
export type * from './generated/models.js';
export * from './generated/enums.js';
