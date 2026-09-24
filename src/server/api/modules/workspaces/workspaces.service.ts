import { systemClient, type TenantClient } from '@db';
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@shared/errors.js';
import { outranks, type Role } from '@shared/permissions.js';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from './dto.js';

/**
 * Workspace and membership logic.
 *
 * Creating a workspace is the one operation that cannot use a tenant client —
 * the tenant does not exist yet — so it uses the system client explicitly.
 */

export async function create(userId: string, input: CreateWorkspaceInput, now: Date) {
  const db = systemClient();

  const taken = await db.workspace.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (taken) throw new ConflictError(`The slug "${input.slug}" is already taken`);

  return db.workspace.create({
    data: {
      name: input.name,
      slug: input.slug,
      timezone: input.timezone,
      ownerUserId: userId,
      members: { create: { userId, role: 'OWNER', joinedAt: now } },
    },
    select: { id: true, name: true, slug: true, timezone: true, retentionDays: true, createdAt: true },
  });
}

export async function listForUser(userId: string) {
  return systemClient().workspaceMember.findMany({
    where: { userId, workspace: { deletedAt: null } },
    select: {
      role: true,
      joinedAt: true,
      workspace: {
        select: { id: true, name: true, slug: true, timezone: true, retentionDays: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function get(db: TenantClient, workspaceId: string) {
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      weekStartsOn: true,
      retentionDays: true,
      createdAt: true,
      _count: { select: { members: true, teams: true, repositories: true } },
    },
  });
  if (!workspace) throw new NotFoundError('Workspace');
  return workspace;
}

export interface UpdateOutcome {
  readonly workspace: { id: string; name: string; timezone: string; retentionDays: number | null };
  /**
   * True when the timezone changed. Day bucketing is done in the workspace
   * timezone, so every rollup is now wrong and must be rebuilt — see
   * docs/02-pipeline.md §6. The caller enqueues that recompute.
   */
  readonly requiresRecompute: boolean;
}

export async function update(
  db: TenantClient,
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<UpdateOutcome> {
  const current = await db.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { timezone: true },
  });
  if (!current) throw new NotFoundError('Workspace');

  const workspace = await db.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
    },
    select: { id: true, name: true, timezone: true, retentionDays: true },
  });

  return {
    workspace,
    requiresRecompute: input.timezone !== undefined && input.timezone !== current.timezone,
  };
}

export async function softDelete(workspaceId: string, userId: string, now: Date) {
  const db = systemClient();
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerUserId: true, deletedAt: true },
  });

  if (!workspace || workspace.deletedAt !== null) throw new NotFoundError('Workspace');
  if (workspace.ownerUserId !== userId) throw new ForbiddenError('Only the owner can delete a workspace');

  await db.workspace.update({ where: { id: workspaceId }, data: { deletedAt: now } });
}

// ── Members ────────────────────────────────────────────────────────────────

export async function listMembers(db: TenantClient, workspaceId: string) {
  return db.workspaceMember.findMany({
    where: { workspaceId },
    select: {
      role: true,
      joinedAt: true,
      user: { select: { id: true, email: true, name: true, avatarUrl: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function invite(
  db: TenantClient,
  workspaceId: string,
  email: string,
  role: Exclude<Role, 'OWNER'>,
  now: Date,
) {
  // An invite for an address with no account is a real flow, but it needs
  // email delivery and a pending-invitation table. Until then the operation
  // states plainly what is missing rather than failing obscurely.
  const user = await systemClient().user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    throw new UnprocessableError(
      'That person does not have an account yet. Email invitations arrive in a later milestone.',
    );
  }

  const existing = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id },
    select: { id: true },
  });
  if (existing) throw new ConflictError('That person is already a member of this workspace');

  return db.workspaceMember.create({
    data: { workspaceId, userId: user.id, role, joinedAt: now },
    select: {
      role: true,
      joinedAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });
}

/**
 * Two rules protect the workspace from being locked out or hijacked:
 *   · Nobody may change the role of someone who outranks them.
 *   · The OWNER role is not assignable through this endpoint — transferring
 *     ownership is a separate, deliberate operation.
 */
export async function updateMemberRole(
  db: TenantClient,
  workspaceId: string,
  actorRole: Role,
  targetUserId: string,
  role: Exclude<Role, 'OWNER'>,
) {
  const target = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: targetUserId },
    select: { id: true, role: true },
  });
  if (!target) throw new NotFoundError('Member');

  if (target.role === 'OWNER') throw new ForbiddenError('The owner’s role cannot be changed here');
  if (!outranks(actorRole, target.role) && actorRole !== target.role) {
    throw new ForbiddenError('You cannot change the role of someone with more access than you');
  }

  return db.workspaceMember.update({
    where: { id: target.id },
    data: { role },
    select: { role: true, user: { select: { id: true, email: true } } },
  });
}

export async function removeMember(
  db: TenantClient,
  workspaceId: string,
  actorRole: Role,
  targetUserId: string,
) {
  const target = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: targetUserId },
    select: { id: true, role: true },
  });
  if (!target) throw new NotFoundError('Member');

  if (target.role === 'OWNER') throw new ForbiddenError('The owner cannot be removed');
  if (!outranks(actorRole, target.role)) {
    throw new ForbiddenError('You cannot remove someone with equal or more access than you');
  }

  await db.workspaceMember.delete({ where: { id: target.id } });
}
