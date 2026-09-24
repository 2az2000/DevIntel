---
name: db-model
description: Change the Prisma schema — add or alter a model, column, index, enum or migration. Use for any database structure change. Enforces the workspaceId tenancy rule, index requirements, the units and timestamp conventions, and the recompute path when derived data is affected.
---

# Database model change

Reference: [docs/01-data-model.md](../../../docs/01-data-model.md),
[ADR-0005](../../../docs/adr/0005-tenancy-enforcement.md).

## Before adding a model, place it in a layer

| Layer | Written by | Mutability |
|---|---|---|
| Tenancy & identity | API | mutable |
| Integration | API + worker | mutable |
| Staging (`RawEvent`) | ingest | append + status flip |
| Domain | normalize | **upsert only** |
| Analytics | aggregate / metric / insight | **recomputable** |

If it belongs in the analytics layer, it must be rebuildable from the domain layer. That is what
makes fixing a formula a recompute rather than a data-loss event.

## Mandatory on every new model below the tenancy layer

```prisma
model Thing {
  id          String   @id @default(cuid())
  workspaceId String                        // ← required, FK, leading index
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}
```

`workspaceId` is not optional. `TENANT_SCOPED_MODELS` is derived from the Prisma DMMF, so a
model carrying this field is protected by the tenant client automatically — and a model missing
it is silently unprotected. The cross-tenant test sweeps every scoped model and will fail CI if
a new table is unreachable by it.

## Conventions

| Rule | Example |
|---|---|
| Provider ids are `String`, never numeric | `externalId String` |
| Durations are integer **minutes**, suffixed | `cycleTimeMinutes Int?` |
| Timestamps are `timestamptz` UTC, suffixed | `mergedAt DateTime?` |
| Natural key uniqueness on domain rows | `@@unique([repositoryId, number])` |
| Enums for closed sets, never free text | `state PullRequestState` |
| Arrays only for filter-only data | `labels String[]` + GIN index |

## Indexes — state the query each one serves

Every index needs a reason. Add:

- `(workspaceId, <time column>)` for anything queried by range
- The composite that serves the actual hot query, e.g.
  `(workspaceId, authorDeveloperId, authoredAt)`
- A **partial** index where the hot query filters a small subset:
  `@@index([workspaceId, repositoryId])` scoped `WHERE state = 'OPEN'` for open-PR counts
- GIN trigram for anything reachable from global search

Composite index column order follows the query's filter order, not alphabetical.

## Nulls carry meaning

`timeToFirstReviewMinutes IS NULL` means *not yet reviewed*, which is different from zero. When
adding a nullable derived column, document whether aggregates exclude it or treat it as
censored — and make the aggregate query match that decision.

## Migration

```bash
pnpm db:migrate     # prisma migrate dev --name <verb-noun>
```

- Never edit a migration that has been applied anywhere but your machine.
- Adding a non-null column to a populated table needs a default or a three-step migration.
- Renaming a column is `@map`, not a destructive rename, unless the table is empty.

## If the change affects derived data

Adding or altering anything the aggregate or metric stages read means existing rollups and
snapshots are now stale. Enqueue a recompute for the affected range — this is an ordinary job,
not an incident procedure ([docs/02-pipeline.md](../../../docs/02-pipeline.md) §9).

## Done when

- [ ] `workspaceId` present with FK and index, or the model is deliberately global
- [ ] Natural-key uniqueness for domain rows
- [ ] Every index has a stated query
- [ ] Units and timestamp conventions followed
- [ ] docs/01-data-model.md updated
- [ ] Migration generated and reviewed
- [ ] Cross-tenant isolation test passes with the new model included
- [ ] Recompute enqueued if derived data is affected
