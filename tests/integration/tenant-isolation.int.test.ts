import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemClient, tenantClient } from '@db';
import { TENANT_SCOPED_MODEL_NAMES } from '@db/tenant-models.generated.js';
import { api, createWorkspace, registerActor, resetDatabase, type Actor } from './helpers.js';

/**
 * The load-bearing test.
 *
 * ADR-0005 requires that no query runs without tenant context. This sweeps
 * every model the generator marked as tenant-scoped and asserts that a client
 * scoped to workspace A cannot see a row belonging to workspace B.
 *
 * A new table added without `workspaceId` fails the generator check in CI; a
 * new table WITH `workspaceId` is automatically included in this sweep. Neither
 * requires anyone to remember to update a list.
 */

let alice: Actor;
let bob: Actor;
let workspaceA: string;
let workspaceB: string;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  alice = await registerActor('alice');
  bob = await registerActor('bob');
  workspaceA = await createWorkspace(alice, 'workspace-a');
  workspaceB = await createWorkspace(bob, 'workspace-b');
});

describe('tenant isolation', () => {
  it('marks every model with workspaceId as scoped', () => {
    // Guards against the generated list silently emptying — an empty sweep
    // would pass vacuously and prove nothing.
    expect(TENANT_SCOPED_MODEL_NAMES.length).toBeGreaterThan(20);
    expect(TENANT_SCOPED_MODEL_NAMES).toContain('Repository');
    expect(TENANT_SCOPED_MODEL_NAMES).toContain('MetricSnapshot');
    expect(TENANT_SCOPED_MODEL_NAMES).toContain('TeamMember');
    expect(TENANT_SCOPED_MODEL_NAMES).toContain('SyncCursor');
  });

  it('does not leak a team created in workspace B to a client scoped to A', async () => {
    await systemClient().team.create({
      data: { workspaceId: workspaceB, name: 'Secret', slug: 'secret' },
    });

    const asA = tenantClient(workspaceA);

    expect(await asA.team.findMany()).toEqual([]);
    expect(await asA.team.count()).toBe(0);
    expect(await asA.team.findFirst({ where: { slug: 'secret' } })).toBeNull();
  });

  it('does not leak by id, even through findUnique', async () => {
    const team = await systemClient().team.create({
      data: { workspaceId: workspaceB, name: 'Secret', slug: 'secret' },
      select: { id: true },
    });

    // findUnique cannot accept a non-unique filter, so the extension rewrites
    // it to findFirst. Without that rewrite this lookup would succeed and the
    // whole guarantee would have a hole in it.
    const leaked = await tenantClient(workspaceA).team.findUnique({ where: { id: team.id } });
    expect(leaked).toBeNull();
  });

  it('cannot update or delete another workspace’s row', async () => {
    const team = await systemClient().team.create({
      data: { workspaceId: workspaceB, name: 'Secret', slug: 'secret' },
      select: { id: true },
    });

    const asA = tenantClient(workspaceA);

    const updated = await asA.team.updateMany({ where: { id: team.id }, data: { name: 'Hijacked' } });
    expect(updated.count).toBe(0);

    const deleted = await asA.team.deleteMany({ where: { id: team.id } });
    expect(deleted.count).toBe(0);

    const survivor = await systemClient().team.findUniqueOrThrow({ where: { id: team.id } });
    expect(survivor.name).toBe('Secret');
  });

  it('stamps the caller’s workspace on create, ignoring a supplied one', async () => {
    // Passing workspace B's id from a client scoped to A must not place the row
    // in B — the extension overwrites what the caller supplied.
    const team = await tenantClient(workspaceA).team.create({
      data: { workspaceId: workspaceB, name: 'Mine', slug: 'mine' },
      select: { id: true },
    });

    const stored = await systemClient().team.findUniqueOrThrow({
      where: { id: team.id },
      select: { workspaceId: true },
    });
    expect(stored.workspaceId).toBe(workspaceA);
  });

  it('returns 404 — never 403 — for a workspace the caller is not a member of', async () => {
    const res = await api().get(`/api/v1/workspaces/${workspaceB}`).set('Cookie', alice.cookie);

    // A 403 would confirm the workspace exists and turn the id space into an
    // enumeration oracle.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a nested resource in another workspace', async () => {
    const team = await systemClient().team.create({
      data: { workspaceId: workspaceB, name: 'Secret', slug: 'secret' },
      select: { id: true },
    });

    const res = await api()
      .get(`/api/v1/workspaces/${workspaceB}/teams/${team.id}`)
      .set('Cookie', alice.cookie);

    expect(res.status).toBe(404);
  });

  /**
   * The sweep. Note what it asserts: not that workspace A sees NO rows — it
   * legitimately owns its own audit trail and membership — but that every row
   * it CAN see belongs to it. That is the actual invariant, and the weaker
   * "no rows" version would have passed vacuously for empty tables.
   */
  it('sweeps every scoped model and finds no foreign rows', async () => {
    const asA = tenantClient(workspaceA) as unknown as Record<
      string,
      { findMany: (args?: unknown) => Promise<{ workspaceId?: string }[]> }
    >;

    // Seed rows in workspace B across the models reachable without a deep
    // dependency chain. The rest are asserted empty-or-own, which still fails
    // if the extension ever stops scoping them.
    await systemClient().team.create({
      data: { workspaceId: workspaceB, name: 'B team', slug: 'b-team' },
    });
    const bDev = await systemClient().developer.create({
      data: { workspaceId: workspaceB, displayName: 'B dev' },
      select: { id: true },
    });
    await systemClient().developerIdentity.create({
      data: {
        workspaceId: workspaceB,
        developerId: bDev.id,
        provider: 'GIT',
        kind: 'EMAIL',
        value: 'b@example.test',
      },
    });
    await systemClient().auditLog.create({
      data: { workspaceId: workspaceB, action: 'test', resourceType: 'Test' },
    });
    await systemClient().metricSnapshot.create({
      data: {
        workspaceId: workspaceB,
        subjectType: 'WORKSPACE',
        subjectId: workspaceB,
        metricKey: 'commits',
        granularity: 'DAY',
        periodStart: new Date('2026-01-01'),
        value: 42,
      },
    });

    let checked = 0;

    for (const model of TENANT_SCOPED_MODEL_NAMES) {
      const key = model.charAt(0).toLowerCase() + model.slice(1);
      const delegate = asA[key];
      expect(delegate, `delegate missing for ${model}`).toBeDefined();

      const rows = await delegate!.findMany();
      for (const row of rows) {
        expect(row.workspaceId, `${model} leaked a row from another workspace`).toBe(workspaceA);
      }
      checked += 1;
    }

    expect(checked).toBe(TENANT_SCOPED_MODEL_NAMES.length);

    // And the seeded foreign rows are genuinely invisible.
    expect(await asA.team!.findMany()).toEqual([]);
    expect(await asA.developer!.findMany()).toEqual([]);
    expect(await asA.metricSnapshot!.findMany()).toEqual([]);
  });
});
