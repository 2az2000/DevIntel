import type { Request, Response } from 'express';
import { created, noContent, ok } from '../../http.js';
import { body, params } from '../../middleware/validate.js';
import { dbOf, tenantOf, userIdOf } from '../../middleware/tenant.js';
import { audit } from '../../audit.js';
import * as service from './workspaces.service.js';
import type {
  CreateWorkspaceInput,
  InviteMemberInput,
  UpdateMemberInput,
  UpdateWorkspaceInput,
} from './dto.js';

export async function list(req: Request, res: Response): Promise<void> {
  ok(req, res, { workspaces: await service.listForUser(userIdOf(req)) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const workspace = await service.create(userIdOf(req), body<CreateWorkspaceInput>(req), new Date());
  await audit(req, {
    workspaceId: workspace.id,
    action: 'workspace.created',
    resourceType: 'Workspace',
    resourceId: workspace.id,
    metadata: { slug: workspace.slug },
  });
  created(req, res, { workspace });
}

export async function get(req: Request, res: Response): Promise<void> {
  const { workspaceId, role } = tenantOf(req);
  ok(req, res, { workspace: await service.get(dbOf(req), workspaceId), role });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { workspaceId } = tenantOf(req);
  const input = body<UpdateWorkspaceInput>(req);

  const result = await service.update(dbOf(req), workspaceId, input);

  await audit(req, {
    workspaceId,
    action: 'workspace.updated',
    resourceType: 'Workspace',
    resourceId: workspaceId,
    metadata: { fields: Object.keys(input), requiresRecompute: result.requiresRecompute },
  });

  ok(req, res, {
    workspace: result.workspace,
    // Surfaced rather than hidden: changing the timezone invalidates every
    // rollup, and the caller deserves to know a rebuild is pending.
    recomputeQueued: result.requiresRecompute,
  });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { workspaceId } = tenantOf(req);
  await service.softDelete(workspaceId, userIdOf(req), new Date());
  await audit(req, {
    workspaceId,
    action: 'workspace.deleted',
    resourceType: 'Workspace',
    resourceId: workspaceId,
  });
  noContent(res);
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  const { workspaceId } = tenantOf(req);
  ok(req, res, { members: await service.listMembers(dbOf(req), workspaceId) });
}

export async function invite(req: Request, res: Response): Promise<void> {
  const { workspaceId } = tenantOf(req);
  const input = body<InviteMemberInput>(req);

  const member = await service.invite(dbOf(req), workspaceId, input.email, input.role, new Date());

  await audit(req, {
    workspaceId,
    action: 'member.invited',
    resourceType: 'WorkspaceMember',
    resourceId: member.user.id,
    metadata: { role: input.role },
  });

  created(req, res, { member });
}

export async function updateMember(req: Request, res: Response): Promise<void> {
  const { workspaceId, role: actorRole } = tenantOf(req);
  const { userId } = params<{ userId: string }>(req);
  const { role } = body<UpdateMemberInput>(req);

  const member = await service.updateMemberRole(dbOf(req), workspaceId, actorRole, userId, role);

  await audit(req, {
    workspaceId,
    action: 'member.role_changed',
    resourceType: 'WorkspaceMember',
    resourceId: userId,
    metadata: { role },
  });

  ok(req, res, { member });
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  const { workspaceId, role: actorRole } = tenantOf(req);
  const { userId } = params<{ userId: string }>(req);

  await service.removeMember(dbOf(req), workspaceId, actorRole, userId);

  await audit(req, {
    workspaceId,
    action: 'member.removed',
    resourceType: 'WorkspaceMember',
    resourceId: userId,
  });

  noContent(res);
}
