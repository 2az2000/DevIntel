import { Router } from 'express';
import { h } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission, resolveTenant } from '../../middleware/tenant.js';
import {
  CreateWorkspaceSchema,
  InviteMemberSchema,
  MemberParams,
  UpdateMemberSchema,
  UpdateWorkspaceSchema,
  WorkspaceParams,
} from './dto.js';
import * as controller from './workspaces.controller.js';

/**
 * Routes that are NOT workspace-scoped (list, create) come first — they cannot
 * run `resolveTenant`, because there is no tenant yet.
 */
export function workspaceRoutes(): Router {
  const router = Router();

  router.use(requireAuth());

  router.get('/', h(controller.list));
  router.post('/', validate({ body: CreateWorkspaceSchema }), h(controller.create));

  // Everything below is scoped: resolveTenant attaches the membership and the
  // tenant-scoped client before any handler runs.
  const scoped = Router({ mergeParams: true });
  scoped.use(validate({ params: WorkspaceParams }), resolveTenant());

  scoped.get('/', requirePermission('workspace.read'), h(controller.get));
  scoped.patch(
    '/',
    requirePermission('workspace.manage'),
    validate({ body: UpdateWorkspaceSchema }),
    h(controller.update),
  );
  scoped.delete('/', requirePermission('workspace.delete'), h(controller.remove));

  scoped.get('/members', requirePermission('members.read'), h(controller.listMembers));
  scoped.post(
    '/members/invite',
    requirePermission('members.manage'),
    validate({ body: InviteMemberSchema }),
    h(controller.invite),
  );
  scoped.patch(
    '/members/:userId',
    requirePermission('members.manage'),
    validate({ params: MemberParams, body: UpdateMemberSchema }),
    h(controller.updateMember),
  );
  scoped.delete(
    '/members/:userId',
    requirePermission('members.manage'),
    validate({ params: MemberParams }),
    h(controller.removeMember),
  );

  router.use('/:workspaceId', scoped);

  return router;
}
