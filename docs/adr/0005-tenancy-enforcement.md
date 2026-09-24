# ADR-0005 — Tenancy enforcement

**Status:** Accepted · **Date:** 2026-08-31 · **Affects:** [01-data-model.md §8](../01-data-model.md), [04-api.md](../04-api.md)

## Context

§76 of the PRD states the requirement plainly: *no query may run without tenant context*. The
failure it guards against is the worst one a multi-tenant analytics product can have — one
company seeing another company's engineering data.

The realistic threat is not a malicious developer. It is a single forgotten `where` clause in
one of several hundred queries, written eighteen months from now, in a hurry, by someone who has
not read this document.

## Options

**A — Convention.** Every repository function takes `workspaceId` and remembers to filter. Zero
infrastructure; relies on perfect discipline across the lifetime of the codebase. One omission
is a breach.

**B — Postgres row-level security.** The database enforces isolation with policies on
`current_setting('app.workspace_id')`. Strongest guarantee — even raw SQL is covered. But Prisma
uses a connection pool, so the session variable must be set on every checkout, and getting that
wrong under pooling is a subtle, silent failure. Policies also apply to migrations and to
background jobs that legitimately span tenants.

**C — Database-per-tenant.** Absolute isolation, and untenable operationally at 10,000
organizations (§75): 10,000 migration runs, 10,000 connection pools.

**D — A Prisma client extension that injects the filter.**

## Decision

**Option D as the primary mechanism, with Option B as a later hardening step.**

```ts
export const tenantClient = (workspaceId: string) =>
  prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query, operation }) {
          if (!TENANT_SCOPED_MODELS.has(model)) return query(args);
          if (READ_OPS.has(operation))   args.where = { ...args.where, workspaceId };
          if (CREATE_OPS.has(operation)) args.data  = { ...args.data,  workspaceId };
          return query(args);
        },
      },
    },
  });
```

Four supporting rules make it trustworthy rather than merely present:

1. **Handlers never see an unscoped client.** Middleware constructs the tenant client from the
   validated `:workspaceId` path parameter and the caller's membership, before any handler runs.
   The raw `prisma` export is lint-banned outside `src/db`.
2. **The scoped-model set is derived, not maintained.** `TENANT_SCOPED_MODELS` is computed from
   the Prisma DMMF: any model with a `workspaceId` field is covered automatically. A new table
   is protected the moment it is created, not when someone remembers to register it.
3. **Tenancy is in the URL.** `/api/v1/workspaces/:workspaceId/…` makes the tenant explicit,
   checkable by middleware, and visible in every log line ([04 §1](../04-api.md)).
4. **A test enumerates every scoped model** and asserts that a query issued in workspace A
   cannot read a row created in workspace B. Adding an unprotected table fails CI.

## Consequences

**Good.** The default is safe: a developer who forgets the filter still gets a filtered query.
Isolation is a structural property rather than a code-review convention, which is what makes it
survive team growth. Workers use the same mechanism, so background jobs are covered by the same
guarantee as requests.

**Cost — raw SQL bypasses extensions.** Some analytics queries need window functions Prisma
cannot express. `$queryRaw` is therefore restricted to a reviewed allowlist in one directory,
where every query takes `workspaceId` as its first bound parameter, and a lint rule blocks
`$queryRaw` everywhere else. This is the weakest point in the design and it is deliberately made
small, visible, and reviewed.

**Cost — legitimate cross-tenant operations need an escape hatch.** Platform administration,
migrations and the retention job must span workspaces. They use an explicitly named
`systemClient()` whose every call site is audited, rather than an implicit ability to omit the
filter.

**Deferred.** Postgres RLS as defence in depth, once connection-level workspace context is
proven safe under the pool. It would cover the raw-SQL gap, which is the reason to keep it on
the roadmap rather than treating this decision as finished.
