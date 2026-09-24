---
name: api-module
description: Create or modify a backend module in src/server/api — routes, controller, service, repository, dto, tests. Use whenever adding an endpoint, a resource, or business logic to the API, or when changing an existing module's behaviour. Enforces the layering contract, tenancy, RBAC, zod validation and the response envelope.
---

# Backend module

Reference: [docs/04-api.md](../../../docs/04-api.md). Layering rules: [CLAUDE.md](../../../CLAUDE.md).

## The shape — every module, no exceptions

```text
src/server/api/modules/<name>/
├── routes.ts          path + method + permission + zod schema + handler binding
├── controller.ts      HTTP in → service → HTTP out
├── service.ts         business logic
├── repository.ts      Prisma queries
├── dto.ts             zod schemas + inferred types
└── <name>.test.ts
```

Each file has one job. The failure mode this prevents is business logic drifting into
controllers, where it cannot be tested without HTTP and cannot be reused by the worker.

## Procedure

**1. Decide the resource path.** Workspace-scoped resources are always
`/api/v1/workspaces/:workspaceId/…`. Tenancy in the URL is what makes it checkable by
middleware and visible in logs. Non-scoped routes are only `auth`, `webhooks`, and
`workspaces` itself.

**2. Write `dto.ts` first.** One zod schema per payload; the TypeScript type is inferred, never
declared separately.

```ts
export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(64),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(64),
});
export type CreateTeamInput = z.infer<typeof CreateTeamSchema>;
```

Reuse the shared filter schema for analytics-style queries rather than re-declaring
`period` / `from` / `to` / `granularity` per route.

**3. Write `repository.ts`.** Prisma calls only. Takes the tenant client as a parameter — never
imports `prisma` directly. No business rules, no formatting, no defaults that encode policy.

**4. Write `service.ts`.** Business logic. Signature takes plain inputs and returns plain
domain objects; no `req`, no `res`, no Prisma types leaking into the signature. Throws typed
domain errors (`NotFoundError`, `ConflictError`, `UnprocessableError`) — never raw `Error`.

**5. Write `controller.ts`.** Parse → call service → serialize. If you are writing an `if` that
decides something about the business, it belongs in the service.

**6. Wire `routes.ts`.** Every route declares its permission explicitly.

```ts
router.post(
  '/workspaces/:workspaceId/teams',
  requirePermission('team.manage'),
  validate({ params: WorkspaceParams, body: CreateTeamSchema }),
  teamController.create,
);
```

**7. Tests.** Supertest, covering four things per endpoint:
status and response shape · the permission boundary (a role that lacks it gets 403) ·
cross-tenant isolation (workspace A's session cannot reach workspace B's row) · the error path.

## Rules that are easy to get wrong

- **A resource in another workspace returns 404, not 403.** A 403 confirms the row exists and
  turns the id space into an enumeration oracle.
- **Long work returns 202 with a job id**, never a completed result. Sync and report generation
  are queued ([docs/02-pipeline.md](../../../docs/02-pipeline.md)).
- **Pagination is cursor-based.** Offset pagination on continuously-written tables silently
  skips and duplicates rows.
- **Analytics endpoints read rollups and snapshots.** No endpoint aggregates raw history at
  request time.
- **Never return provider tokens** under any shape, including nested in an integration object.
- Unknown keys are stripped by zod, never passed through to Prisma.

## Done when

- [ ] Five files exist and each stays inside its job
- [ ] Permission declared on every route; the matrix in docs/04-api.md §5 covers it
- [ ] Response uses the standard envelope (`data` / `pagination` / `meta.requestId`)
- [ ] Errors map to the documented code table
- [ ] Cross-tenant test written and passing
- [ ] `pnpm typecheck lint test` clean
