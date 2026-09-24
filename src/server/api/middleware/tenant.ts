import type { RequestHandler } from 'express';
import { systemClient, tenantClient, type TenantClient } from '@db';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@shared/errors.js';
import { can, type Permission, type Role } from '@shared/permissions.js';
import { paramString } from './validate.js';

/**
 * Resolves `:workspaceId` into a membership and a scoped client.
 *
 * Runs BEFORE any handler, so no handler can reach an unscoped client — the
 * filter is injected rather than remembered. See ADR-0005.
 */
export const resolveTenant = (): RequestHandler => (req, _res, next) => {
  const workspaceId = paramString(req, 'workspaceId');

  if (!workspaceId) {
    next(new NotFoundError('Workspace'));
    return;
  }
  if (!req.auth) {
    next(new UnauthenticatedError());
    return;
  }

  const userId = req.auth.userId;

  void systemClient()
    .workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true, workspace: { select: { id: true, deletedAt: true } } },
    })
    .then((membership) => {
      // A workspace the caller is not a member of returns 404, never 403.
      // A 403 would confirm the workspace exists and turn the id space into an
      // enumeration oracle. Same for a soft-deleted workspace.
      if (!membership || membership.workspace.deletedAt !== null) {
        next(new NotFoundError('Workspace'));
        return;
      }

      req.tenant = { workspaceId, role: membership.role };
      req.db = tenantClient(workspaceId);
      next();
    })
    .catch(next);
};

/**
 * Every endpoint declares the permission it needs, never the role. Adding a
 * role becomes a change to the matrix in @shared/permissions rather than an
 * audit of every handler.
 */
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.tenant) {
      next(new NotFoundError('Workspace'));
      return;
    }
    if (!can(req.tenant.role, permission)) {
      next(new ForbiddenError(`This action requires the "${permission}" permission`));
      return;
    }
    next();
  };

/** Narrowing helpers so controllers do not repeat the non-null assertions. */
export function tenantOf(req: { tenant?: { workspaceId: string; role: Role } }): {
  workspaceId: string;
  role: Role;
} {
  if (!req.tenant) throw new NotFoundError('Workspace');
  return req.tenant;
}

export function dbOf(req: { db?: TenantClient }): TenantClient {
  if (!req.db) throw new NotFoundError('Workspace');
  return req.db;
}

export function userIdOf(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth.userId;
}
