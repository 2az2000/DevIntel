import { beforeEach, describe, expect, it } from 'vitest';
import { systemClient } from '@db';
import { ROLE_PERMISSIONS, type Role } from '@shared/permissions.js';
import { addMember, api, createWorkspace, registerActor, resetDatabase, type Actor } from './helpers.js';

/**
 * The RBAC matrix in @shared/permissions is data; these tests assert the API
 * actually honours it, and that the audit trail records what happened.
 */

let owner: Actor;
let workspaceId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await registerActor('owner');
  workspaceId = await createWorkspace(owner, 'acme');
});

async function actorWithRole(role: Exclude<Role, 'OWNER'>): Promise<Actor> {
  const actor = await registerActor(role.toLowerCase());
  await addMember(workspaceId, actor.userId, role);
  return actor;
}

describe('role permissions', () => {
  it('lets every role read the workspace', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const actor = await actorWithRole(role);
      const res = await api().get(`/api/v1/workspaces/${workspaceId}`).set('Cookie', actor.cookie);
      expect(res.status, `${role} should read`).toBe(200);
      expect(res.body.data.role).toBe(role);
    }
  });

  it('refuses workspace.manage below ADMIN', async () => {
    for (const role of ['MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const actor = await actorWithRole(role);
      const res = await api()
        .patch(`/api/v1/workspaces/${workspaceId}`)
        .set('Cookie', actor.cookie)
        .send({ name: 'Renamed' });

      expect(res.status, `${role} must not manage`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('allows workspace.manage for ADMIN and OWNER', async () => {
    const admin = await actorWithRole('ADMIN');

    for (const actor of [owner, admin]) {
      const res = await api()
        .patch(`/api/v1/workspaces/${workspaceId}`)
        .set('Cookie', actor.cookie)
        .send({ name: 'Renamed' });
      expect(res.status).toBe(200);
    }
  });

  it('reserves workspace.delete for the OWNER alone', async () => {
    const admin = await actorWithRole('ADMIN');

    const byAdmin = await api()
      .delete(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', admin.cookie);
    expect(byAdmin.status).toBe(403);

    const byOwner = await api()
      .delete(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', owner.cookie);
    expect(byOwner.status).toBe(204);
  });

  it('lets MANAGER create teams but not MEMBER or VIEWER', async () => {
    const manager = await actorWithRole('MANAGER');
    const member = await actorWithRole('MEMBER');

    const allowed = await api()
      .post(`/api/v1/workspaces/${workspaceId}/teams`)
      .set('Cookie', manager.cookie)
      .send({ name: 'Frontend', slug: 'frontend' });
    expect(allowed.status).toBe(201);

    const refused = await api()
      .post(`/api/v1/workspaces/${workspaceId}/teams`)
      .set('Cookie', member.cookie)
      .send({ name: 'Backend', slug: 'backend' });
    expect(refused.status).toBe(403);
  });

  /**
   * §79: a MEMBER may read their own profile and team aggregates, but not a
   * colleague's score breakdown. That is what `analytics.team` gates.
   */
  it('withholds analytics.team from MEMBER and VIEWER', () => {
    expect(ROLE_PERMISSIONS.MEMBER.has('analytics.team')).toBe(false);
    expect(ROLE_PERMISSIONS.VIEWER.has('analytics.team')).toBe(false);
    expect(ROLE_PERMISSIONS.MANAGER.has('analytics.team')).toBe(true);
  });
});

describe('membership management', () => {
  it('refuses to change the owner’s role', async () => {
    const admin = await actorWithRole('ADMIN');

    const res = await api()
      .patch(`/api/v1/workspaces/${workspaceId}/members/${owner.userId}`)
      .set('Cookie', admin.cookie)
      .send({ role: 'VIEWER' });

    expect(res.status).toBe(403);
  });

  it('refuses to remove the owner', async () => {
    const admin = await actorWithRole('ADMIN');

    const res = await api()
      .delete(`/api/v1/workspaces/${workspaceId}/members/${owner.userId}`)
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(403);
  });

  it('will not let a manager remove an admin', async () => {
    const admin = await actorWithRole('ADMIN');
    const manager = await actorWithRole('MANAGER');

    const res = await api()
      .delete(`/api/v1/workspaces/${workspaceId}/members/${admin.userId}`)
      .set('Cookie', manager.cookie);

    // MANAGER lacks members.manage entirely, so this is a permission refusal
    // before the rank comparison is even reached.
    expect(res.status).toBe(403);
  });

  it('lets an admin change a member’s role and audits it', async () => {
    const admin = await actorWithRole('ADMIN');
    const member = await actorWithRole('MEMBER');

    const res = await api()
      .patch(`/api/v1/workspaces/${workspaceId}/members/${member.userId}`)
      .set('Cookie', admin.cookie)
      .send({ role: 'MANAGER' });

    expect(res.status).toBe(200);
    expect(res.body.data.member.role).toBe('MANAGER');

    const entry = await systemClient().auditLog.findFirst({
      where: { workspaceId, action: 'member.role_changed' },
      select: { actorUserId: true, resourceId: true, metadata: true },
    });
    expect(entry?.actorUserId).toBe(admin.userId);
    expect(entry?.resourceId).toBe(member.userId);
    expect(entry?.metadata).toMatchObject({ role: 'MANAGER' });
  });
});

describe('audit trail', () => {
  it('records workspace creation and updates', async () => {
    await api()
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', owner.cookie)
      .send({ timezone: 'Asia/Tehran' });

    const actions = await systemClient()
      .auditLog.findMany({ where: { workspaceId }, select: { action: true } })
      .then((rows) => rows.map((r) => r.action));

    expect(actions).toContain('workspace.created');
    expect(actions).toContain('workspace.updated');
  });

  it('flags that a timezone change requires a rollup recompute', async () => {
    const res = await api()
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', owner.cookie)
      .send({ timezone: 'Asia/Tehran' });

    // Day bucketing happens in the workspace timezone, so every existing
    // rollup is now wrong. Surfacing this is what stops it being silent.
    expect(res.body.data.recomputeQueued).toBe(true);
  });

  it('does not flag a recompute when the timezone is unchanged', async () => {
    const res = await api()
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Renamed only' });

    expect(res.body.data.recomputeQueued).toBe(false);
  });

  it('rejects an unknown timezone', async () => {
    const res = await api()
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set('Cookie', owner.cookie)
      .send({ timezone: 'Mars/Olympus_Mons' });

    expect(res.status).toBe(400);
  });
});
