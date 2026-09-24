/**
 * RBAC. The matrix is data, and every endpoint declares the permission it
 * needs — never the role. Adding a role is then a change to one table here
 * rather than an audit of every handler.
 *
 * Reference: docs/04-api.md §5
 */

export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'workspace.read',
  'workspace.manage',
  'workspace.delete',
  'members.read',
  'members.manage',
  'team.read',
  'team.manage',
  'repository.read',
  'repository.manage',
  'analytics.read',
  /**
   * Team-level aggregates AND another member's individual score breakdown.
   * A MEMBER deliberately lacks this: they can read their own profile in full
   * and team aggregates, but not a colleague's components. That restriction is
   * product design, not just access control — it is what keeps the tool from
   * becoming the peer-comparison instrument §79 rejects.
   */
  'analytics.team',
  'insights.manage',
  'reports.create',
  'integrations.manage',
  'audit.read',
  'settings.retention',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  'workspace.read',
  'members.read',
  'team.read',
  'team.manage',
  'repository.read',
  'repository.manage',
  'analytics.read',
  'analytics.team',
  'insights.manage',
  'reports.create',
];

const MEMBER_PERMISSIONS: readonly Permission[] = [
  'workspace.read',
  'members.read',
  'team.read',
  'repository.read',
  'analytics.read',
  'reports.create',
];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'workspace.read',
  'members.read',
  'team.read',
  'repository.read',
  'analytics.read',
];

const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (p) => p !== 'workspace.delete',
);

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
  MEMBER: new Set(MEMBER_PERMISSIONS),
  VIEWER: new Set(VIEWER_PERMISSIONS),
};

export const can = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].has(permission);

/** Ordered most- to least-privileged, for "at least this role" comparisons. */
const RANK: Readonly<Record<Role, number>> = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export const outranks = (a: Role, b: Role): boolean => RANK[a] > RANK[b];
export const rankOf = (role: Role): number => RANK[role];
