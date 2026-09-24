---
name: prisma-postgres
description: Prisma and PostgreSQL query patterns for this codebase — avoiding N+1, transactions, upserts, cursor pagination, bulk writes, index-aware queries, safe raw SQL, and the tenant client extension. Use whenever writing a repository function or a migration, or when a query is slow or returns surprising results.
---

# Prisma & Postgres

Reference: [docs/01-data-model.md](../../../docs/01-data-model.md).

## The tenant client is not optional

```ts
// ✗ lint-banned outside src/db
import { prisma } from '@devintel/db';

// ✓ every repository function takes the scoped client
export function findTeams(db: TenantClient) {
  return db.team.findMany({ orderBy: { name: 'asc' } });   // workspaceId injected
}
```

The extension injects `where.workspaceId` on reads and `data.workspaceId` on creates. Two
consequences to remember: **`$queryRaw` bypasses it entirely** (see below), and a `findMany`
with a manual `workspaceId` is redundant, not wrong.

## N+1 — the default failure mode

```ts
// ✗ one query per repository
const repos = await db.repository.findMany();
for (const r of repos) {
  r.contributors = await db.repositoryContributor.findMany({ where: { repositoryId: r.id } });
}

// ✓ one query
const repos = await db.repository.findMany({
  include: { contributors: { orderBy: { commits: 'desc' }, take: 10 } },
});
```

Rule: **no `await` inside a loop over database rows.** If you need per-row data, use `include`,
or fetch the set with `where: { id: { in: ids } }` and group in memory.

`include` on a list endpoint is itself a cost — only include what the response returns, and use
`select` to avoid pulling large columns (`RawEvent.payload`, `Commit.message`).

## Upserts are the normalization primitive

```ts
await db.commit.upsert({
  where:  { repositoryId_sha: { repositoryId, sha } },   // the natural key
  create: { ...data },
  update: { ...mutableFields },                          // never the natural key
});
```

For batches, `createMany({ skipDuplicates: true })` is far faster when you genuinely only need
insert-if-absent. When existing rows must be updated too, chunk `upsert` calls inside a
transaction (500–1000 rows per chunk) rather than one giant transaction.

## Transactions

```ts
await db.$transaction(async (tx) => {
  await tx.metricSnapshot.createMany({ data: snapshots });
  await tx.scoreSnapshot.upsert({ /* … */ });
}, { timeout: 30_000 });
```

- Wrap writes that must agree — the metric stage writes `MetricSnapshot` **and** the rollup in
  one transaction, because a partial write is how the two shapes drift apart.
- Keep transactions short. Never call a provider API or await a queue inside one.
- Interactive transactions hold a connection; a long one under load exhausts the pool.

## Cursor pagination, always

```ts
const rows = await db.commit.findMany({
  take: limit + 1,
  ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  orderBy: [{ authoredAt: 'desc' }, { id: 'desc' }],   // tiebreaker is mandatory
});
```

Offset pagination on continuously-written tables skips and duplicates rows as data shifts. The
`id` tiebreaker is required — without it, rows sharing a timestamp paginate non-deterministically.

## Write queries your indexes can serve

Composite index column order must match the query's filter order. `(workspaceId,
authorDeveloperId, authoredAt)` serves workspace + author + range; it does **not** efficiently
serve a filter on author alone.

- Range filters go last in a composite index.
- A partial index is the right answer when the hot query targets a small subset — open PRs are a
  few percent of the table.
- `ILIKE '%term%'` cannot use a b-tree. Global search uses a GIN trigram index.

When something is slow, get the real plan before changing anything:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

A sequential scan on a large table, or `Rows Removed by Filter` in the thousands, names the
missing index.

## Aggregation belongs in SQL

```ts
await db.$queryRaw<Row[]>`
  SELECT date_trunc('day', c.authored_at AT TIME ZONE ${tz})::date AS day,
         count(*)::int AS commits
  FROM commits c
  WHERE c.workspace_id = ${workspaceId}    -- ALWAYS first, always a bound parameter
    AND c.authored_at >= ${from}
  GROUP BY 1`;
```

`$queryRaw` rules, because it bypasses the tenant extension:

1. Only in the reviewed `src/db/analytics/` directory — lint-banned elsewhere.
2. `workspaceId` is the **first bound parameter** of every query.
3. Template literals only. Never string concatenation, never `$queryRawUnsafe`.
4. Explicit `::int` / `::float8` casts — Postgres `count()` returns `bigint`, which arrives as
   `BigInt` and breaks JSON serialization.

## Traps

- **`Decimal` is not `number`.** `numeric` columns come back as `Prisma.Decimal`; convert
  explicitly at the boundary.
- **`updateMany` returns a count, not rows.** Use it for bulk state flips only.
- **`findFirst` without `orderBy` is non-deterministic.**
- **Nulls sort last by default** in Postgres `DESC`; specify `NULLS LAST` when it matters.
- **Connection pool** — the worker and API each need their own `connection_limit`; the default
  saturates fast under concurrent jobs.

## Before finishing

- [ ] Takes the tenant client, no direct `prisma` import
- [ ] No `await` inside a row loop
- [ ] Writes that must agree are in one transaction
- [ ] Pagination is cursor-based with a tiebreaker
- [ ] An index serves the query's filter order
- [ ] Any raw SQL is in the allowlisted directory with `workspaceId` bound first
