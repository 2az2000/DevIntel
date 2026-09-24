import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '@shared/errors.js';
import type { TenantClient } from '@db';
import { created, noContent, ok } from '../../http.js';
import { h } from '../../middleware/error.js';
import { body, params, validate } from '../../middleware/validate.js';
import { requirePermission, dbOf, tenantOf } from '../../middleware/tenant.js';
import { audit } from '../../audit.js';
import { SlugSchema, WorkspaceParams } from '../workspaces/dto.js';

/**
 * Teams are small enough that routes, dto, service and controller live in one
 * file rather than five near-empty ones. The layering is still explicit — the
 * service functions below take a client and take no `req`.
 */

// ── dto ─────────────────────────────────────────────────────────────────────

const CreateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: SlugSchema,
    description: z.string().trim().max(500).optional(),
  })
  .strict();

const UpdateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

const TeamParams = WorkspaceParams.extend({ teamId: z.string().min(1) });
const TeamMemberParams = TeamParams.extend({ developerId: z.string().min(1) });
const AddMemberSchema = z.object({ developerId: z.string().min(1) }).strict();

type CreateTeamInput = z.infer<typeof CreateTeamSchema>;
type UpdateTeamInput = z.infer<typeof UpdateTeamSchema>;

// ── service ─────────────────────────────────────────────────────────────────

async function listTeams(db: TenantClient) {
  return db.team.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      createdAt: true,
      _count: { select: { members: true } },
    },
    orderBy: { name: 'asc' },
  });
}

async function getTeam(db: TenantClient, teamId: string) {
  const team = await db.team.findFirst({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      createdAt: true,
      members: {
        select: {
          joinedAt: true,
          developer: {
            select: { id: true, displayName: true, avatarUrl: true, primaryEmail: true, isBot: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });
  if (!team) throw new NotFoundError('Team');
  return team;
}

/**
 * `workspaceId` is passed explicitly even though the tenant extension injects
 * it — Prisma's types require it, and the extension overwrites whatever is
 * supplied with the caller's tenant. So the type system forces the field and
 * the runtime guarantees it is the right one.
 */
async function createTeam(db: TenantClient, workspaceId: string, input: CreateTeamInput) {
  const taken = await db.team.findFirst({ where: { slug: input.slug }, select: { id: true } });
  if (taken) throw new ConflictError(`A team with the slug "${input.slug}" already exists`);

  return db.team.create({
    data: {
      workspaceId,
      name: input.name,
      slug: input.slug,
      ...(input.description ? { description: input.description } : {}),
    },
    select: { id: true, name: true, slug: true, description: true, createdAt: true },
  });
}

async function updateTeam(db: TenantClient, teamId: string, input: UpdateTeamInput) {
  const existing = await db.team.findFirst({ where: { id: teamId }, select: { id: true } });
  if (!existing) throw new NotFoundError('Team');

  return db.team.update({
    where: { id: teamId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    select: { id: true, name: true, slug: true, description: true },
  });
}

async function deleteTeam(db: TenantClient, teamId: string) {
  const existing = await db.team.findFirst({ where: { id: teamId }, select: { id: true } });
  if (!existing) throw new NotFoundError('Team');
  await db.team.delete({ where: { id: teamId } });
}

/**
 * Membership references a Developer, not a User — activity attaches to
 * developers, and requiring a platform account would make team metrics
 * incomplete on day one. See docs/01-data-model.md §2.7.
 */
async function addMember(
  db: TenantClient,
  workspaceId: string,
  teamId: string,
  developerId: string,
  now: Date,
) {
  const [team, developer] = await Promise.all([
    db.team.findFirst({ where: { id: teamId }, select: { id: true } }),
    db.developer.findFirst({ where: { id: developerId }, select: { id: true, displayName: true } }),
  ]);
  if (!team) throw new NotFoundError('Team');
  if (!developer) throw new NotFoundError('Developer');

  const existing = await db.teamMember.findFirst({
    where: { teamId, developerId },
    select: { id: true },
  });
  if (existing) throw new ConflictError('That developer is already on this team');

  return db.teamMember.create({
    data: { workspaceId, teamId, developerId, joinedAt: now },
    select: { joinedAt: true, developer: { select: { id: true, displayName: true } } },
  });
}

async function removeMember(db: TenantClient, teamId: string, developerId: string) {
  const member = await db.teamMember.findFirst({
    where: { teamId, developerId },
    select: { id: true },
  });
  if (!member) throw new NotFoundError('Team member');
  await db.teamMember.delete({ where: { id: member.id } });
}

// ── controller ──────────────────────────────────────────────────────────────

const list = async (req: Request, res: Response): Promise<void> => {
  ok(req, res, { teams: await listTeams(dbOf(req)) });
};

const detail = async (req: Request, res: Response): Promise<void> => {
  const { teamId } = params<{ teamId: string }>(req);
  ok(req, res, { team: await getTeam(dbOf(req), teamId) });
};

const create = async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = tenantOf(req);
  const team = await createTeam(dbOf(req), workspaceId, body<CreateTeamInput>(req));
  await audit(req, {
    workspaceId,
    action: 'team.created',
    resourceType: 'Team',
    resourceId: team.id,
    metadata: { slug: team.slug },
  });
  created(req, res, { team });
};

const update = async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = tenantOf(req);
  const { teamId } = params<{ teamId: string }>(req);
  const team = await updateTeam(dbOf(req), teamId, body<UpdateTeamInput>(req));
  await audit(req, { workspaceId, action: 'team.updated', resourceType: 'Team', resourceId: teamId });
  ok(req, res, { team });
};

const remove = async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = tenantOf(req);
  const { teamId } = params<{ teamId: string }>(req);
  await deleteTeam(dbOf(req), teamId);
  await audit(req, { workspaceId, action: 'team.deleted', resourceType: 'Team', resourceId: teamId });
  noContent(res);
};

const addTeamMember = async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = tenantOf(req);
  const { teamId } = params<{ teamId: string }>(req);
  const { developerId } = body<{ developerId: string }>(req);

  const member = await addMember(dbOf(req), workspaceId, teamId, developerId, new Date());

  await audit(req, {
    workspaceId,
    action: 'team.member_added',
    resourceType: 'TeamMember',
    resourceId: developerId,
    metadata: { teamId },
  });

  created(req, res, { member });
};

const removeTeamMember = async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = tenantOf(req);
  const { teamId, developerId } = params<{ teamId: string; developerId: string }>(req);

  await removeMember(dbOf(req), teamId, developerId);

  await audit(req, {
    workspaceId,
    action: 'team.member_removed',
    resourceType: 'TeamMember',
    resourceId: developerId,
    metadata: { teamId },
  });

  noContent(res);
};

// ── routes ──────────────────────────────────────────────────────────────────

export function teamRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', requirePermission('team.read'), h(list));
  router.post(
    '/',
    requirePermission('team.manage'),
    validate({ body: CreateTeamSchema }),
    h(create),
  );

  router.get('/:teamId', requirePermission('team.read'), validate({ params: TeamParams }), h(detail));
  router.patch(
    '/:teamId',
    requirePermission('team.manage'),
    validate({ params: TeamParams, body: UpdateTeamSchema }),
    h(update),
  );
  router.delete(
    '/:teamId',
    requirePermission('team.manage'),
    validate({ params: TeamParams }),
    h(remove),
  );

  router.post(
    '/:teamId/members',
    requirePermission('team.manage'),
    validate({ params: TeamParams, body: AddMemberSchema }),
    h(addTeamMember),
  );
  router.delete(
    '/:teamId/members/:developerId',
    requirePermission('team.manage'),
    validate({ params: TeamMemberParams }),
    h(removeTeamMember),
  );

  return router;
}
