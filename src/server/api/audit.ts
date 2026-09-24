import type { Request } from 'express';
import type { Prisma} from '@db';
import { systemClient } from '@db';
import { logger } from './logger.js';

/**
 * Audit log. Append-only — no update or delete path exists in the API.
 *
 * Every mutation of a workspace, member, team, integration, permission or
 * retention setting writes a row. Reference: docs/01-data-model.md §7.
 */

export interface AuditEntry {
  readonly workspaceId: string;
  readonly actorUserId?: string | undefined;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | undefined;
  /** Prisma's JSON input type, so no cast is needed at the write site. */
  readonly metadata?: Prisma.InputJsonObject;
}

export async function audit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    await systemClient().auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorUserId: entry.actorUserId ?? req.auth?.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        metadata: entry.metadata ?? {},
      },
    });
  } catch (err) {
    // A failed audit write must not fail the user's operation, but it must be
    // loud: a silently missing audit trail is worse than a noisy one.
    logger.error({ err, entry }, 'audit write failed');
  }
}
