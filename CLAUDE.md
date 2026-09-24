# CLAUDE.md — DevIntel

Engineering-analytics platform. Raw git activity → explained, versioned, actionable insight.

**Read [docs/](docs/) before designing anything.** This file is the *contract* for how code is
written; `docs/` is the *reasoning* behind it. When they disagree, `docs/` wins and this file
gets fixed.

Status: **M0 complete.** Next milestone M1 — see [ROADMAP.md](ROADMAP.md).

---

## Repository layout

**One package.** A single `package.json` at the root — no workspaces, no per-directory manifests.
Next.js finds `src/app` natively; the API and worker are extra entrypoints run through `tsx`.

```text
devintel/
├── package.json          ← the only one
├── next.config.ts  tsconfig.json  eslint.config.js  vitest.config.ts
├── prisma.config.ts      ← Prisma 7 keeps the connection URL here, not in the schema
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   └── generate-tenant-models.ts
├── src/
│   ├── app/              Next.js App Router
│   ├── components/       charts · dashboard · analytics · data · navigation · overlay · shared
│   ├── server/
│   │   ├── api/          Express — modules/, middleware/, app.ts, main.ts
│   │   └── worker/       BullMQ — queues.ts, main.ts
│   ├── analytics/        scoring · trends · anomaly · graph · rules   ← ZERO I/O
│   ├── db/               client, tenant extension, generated/
│   ├── providers/        GitProvider interface + Seed & GitHub impls   ← NO DB WRITES
│   └── shared/           brand · result · errors · env · metrics · time
└── docs/                 architecture documentation (source of truth)
```

**Path aliases** (tsconfig + vitest, keep them in sync):
`@/*` `@shared/*` `@db/*` `@analytics/*` `@providers/*` `@api/*` `@worker/*` `@components/*`,
plus the bare barrels `@shared` `@db` `@analytics` `@providers`.

**Import from the barrel, not the file.** `@db` exposes `tenantClient`; `@db/client` is the
unscoped Prisma client and is lint-banned outside `src/db`.

### The boundaries are the architecture

There is no workspace dependency graph, so the layer rules in `eslint.config.js` are the only
mechanical guarantee. Two things about them:

- **Order matters and the failure is silent.** In flat config a later object that sets the same
  rule *replaces* the earlier one. The general block comes first; each layer block comes after
  and restates everything it needs. Reversing that disables the stricter rule with no error.
- **Inline `eslint-disable` comments are inert** in `src/analytics`, `src/providers` and
  `src/db`. A genuine exception has to be made in `eslint.config.js`, where it shows up in a
  diff as an architectural change.

**A lint rule that has never failed has not been tested.** Before trusting a new boundary rule,
write a file that violates it and confirm the error.

---

## Nine rules that are not negotiable

Enforced by lint, types or CI. Breaking one is a bug, not a style preference.

1. **`src/analytics` performs no I/O.** No Prisma, no Redis, no `fetch`, no `Date.now()`, no
   `Math.random()` — the current time and any randomness are parameters. *(ESLint boundary 1)*
2. **`src/providers` never writes to the database.** It returns normalized `Raw*` DTOs.
   *(ESLint boundary 3)*
3. **Every query runs through the tenant client.** `@db/client` is import-banned outside
   `src/db`; handlers receive `tenantClient(workspaceId)`. *(ESLint boundary 2)*
4. **Controllers translate, services decide.** A controller containing an `if` about business
   meaning is a bug.
5. **Aggregation recomputes, never increments.** No `{ increment: 1 }` in any rollup path.
6. **Scores return `ScoreResult`, never a bare number.** value + version + coverage + components[].
7. **No raw hex in components.** Colors come from the tokens in `src/app/globals.css`.
8. **No `left`/`right` in CSS.** Logical properties only — RTL-capable from day one.
9. **Never a dual y-axis chart.** Two measures → two charts, or index both to 100 at t₀.

---

## Backend module shape (`src/server/api/modules/<name>/`)

Every module, without exception:

```text
routes.ts       path + method + zod schema + permission + handler binding. Nothing else.
controller.ts   HTTP in → service call → HTTP out. Parse and serialize only.
service.ts      business logic. No req/res, no SQL, no Prisma types in signatures.
repository.ts   Prisma queries only, taking the tenant client as a parameter.
dto.ts          zod schemas + inferred types. One schema per payload.
<name>.test.ts  co-located
```

```ts
router.get(
  '/workspaces/:workspaceId/teams/:teamId/analytics',
  requirePermission('analytics.team'),
  validate({ params: TeamParams, query: AnalyticsQuery }),
  teamController.analytics,
);
```

Layering: `Controller → Service → Repository → Database`. A layer never skips the one below it.

**Middleware order is the security model** — webhook routes mount *before* `express.json()`
(HMAC is over the raw body), and rate limiting precedes authentication.

---

## Frontend shape

```text
src/app/(marketing)/          SSG + ISR — public, indexed
src/app/(auth)/               SSR — session-dependent
src/app/(app)/[workspace]/    client-rendered, server shell for layout + skeletons
```

| State | Owner |
|---|---|
| Server data | TanStack Query, key **starts with the workspace id** |
| Filters, range, tab | `nuqs` → URL search params (views must be shareable) |
| Ephemeral UI | Zustand |
| Forms | React Hook Form + the same zod schema the API uses |

Charts are always wrapped in `<Chart>`; it applies tokens. Individual charts never set colors.

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `pull-request.service.ts` |
| Types / interfaces | PascalCase, no `I` prefix | `ScoreResult` |
| Zod schemas | PascalCase + `Schema` | `AnalyticsQuerySchema` |
| DB models | PascalCase singular | `PullRequest` |
| DB columns | camelCase in Prisma, snake_case in Postgres | `timeToFirstReviewMinutes` |
| Metric keys | snake_case, in the catalog | `pr_cycle_time_median` |
| Queues | dot-namespaced | `sync.resource` |
| Insight rule ids | kebab-case | `review-latency-regression` |
| CSS tokens | `--role-variant` | `--surface-2`, `--status-warning` |
| Durations in DB | integer **minutes**, suffix `Minutes` | `cycleTimeMinutes` |
| Timestamps | `timestamptz`, UTC, suffix `At` | `mergedAt` |
| Unit tests | `*.test.ts` | runs in the `unit` project |
| Integration tests | `*.int.test.ts` | runs in the `integration` project |

Provider ids are always `externalId String` — never numeric.

---

## Commands

```bash
pnpm dev            # web + api + worker together
pnpm dev:web        # next dev            (:3000)
pnpm dev:api        # tsx watch express   (:4000)
pnpm dev:worker     # tsx watch bullmq

pnpm db:up          # docker compose: postgres :5434, redis :6380
pnpm db:migrate     # prisma migrate dev
pnpm db:generate    # prisma generate + regenerate the tenant-model list
pnpm db:seed        # deterministic 12-month dataset (M2)

pnpm verify         # lint + typecheck + test — run this before saying "done"
pnpm test / test:int / e2e
```

> **`pnpm db:generate` after every schema change.** It regenerates
> `src/db/tenant-models.generated.ts`, which is what makes tenancy coverage automatic. CI fails
> if that file is stale.

Ports are deliberately non-default (`5434`, `6380`) so this project cannot collide with another
one on the same machine.

---

## Testing expectations

- Every algorithm in `src/analytics` has a fixture test with **exact expected values** — the
  worked examples in [docs/03-algorithms.md](docs/03-algorithms.md) are literal test cases.
- Every endpoint has a Supertest test covering status, schema, permission boundary, and
  **cross-tenant isolation**.
- Two tests are load-bearing beyond their own scope and must never be skipped: the
  tenant-isolation sweep over every scoped model, and the seed-signal test asserting the pipeline
  surfaces the two planted signals.

---

## Before you write code

| Task | Read first | Use skill |
|---|---|---|
| New API endpoint or module | [docs/04-api.md](docs/04-api.md) | `/api-module`, `/express-server` |
| New or changed algorithm | [docs/03-algorithms.md](docs/03-algorithms.md) | `/analytics-function`, `/algorithm-design` |
| New metric, end to end | [docs/03-algorithms.md](docs/03-algorithms.md) §2 | `/add-metric` |
| Queue, worker, sync stage | [docs/02-pipeline.md](docs/02-pipeline.md) | `/pipeline-job`, `/bullmq-workers` |
| Prisma model or query | [docs/01-data-model.md](docs/01-data-model.md) | `/db-model`, `/prisma-postgres` |
| Page, component or chart | [docs/05-frontend.md](docs/05-frontend.md) | `/ui-surface`, `/nextjs-app-router`, `/echarts-charts` |
| Any payload or schema | — | `/zod-contracts` |
| Type or module design | — | `/typescript-rigor` |
| Writing tests | — | `/testing-strategy` |

---

## Product principles that constrain the code

- **Volume is never a virtue.** `commits` and `lines_changed` are displayed as context and
  weighted at **zero** in every score. A metric that changes behaviour without improving
  outcomes is worse than no metric.
- **Measure systems, not people.** Scores normalize against absolute targets, never against
  colleagues. Repository- and team-scoped insight templates may not name an individual, and a
  `MEMBER` cannot read another member's score breakdown.
- **Derived data is disposable.** Rollups, snapshots, scores and insights rebuild from the
  domain layer. Fixing a formula is a recompute, not an incident.
- **Failures cost time, never correctness.** Every pipeline stage is idempotent.
