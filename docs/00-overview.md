# 00 — System Overview

> **Status:** Design · **Audience:** anyone implementing or reviewing DevIntel
> **Read next:** [01-data-model.md](01-data-model.md)

---

## 1. What this system is

DevIntel turns raw software-development activity — commits, pull requests, reviews, issues —
into **explained, measurable, actionable** engineering insight.

The product thesis, stated as a pipeline:

```text
Git data → Data engineering → Analytics → Algorithms → Intelligence → Actionable insight
```

The architecture exists to defend that thesis. A conventional
`Frontend → CRUD API → Database` shape would satisfy the screens and fail the product, because
none of the interesting claims — "health fell 7 points *because* review latency rose 34%",
"knowledge in `payment-core` is concentrated in one person" — are CRUD reads. They are derived,
versioned, explainable computations over historical state.

### 1.1 Design constraints that follow from the thesis

| # | Constraint | Consequence |
|---|---|---|
| C1 | Every score must be explainable | Scoring functions return contribution breakdowns, never bare numbers ([03](03-algorithms.md)) |
| C2 | Dashboards must not recompute raw history | Pre-aggregated rollup tables are the read path ([01](01-data-model.md), [ADR-0001](adr/0001-metric-storage-shape.md)) |
| C3 | Measure systems, not people | Scores normalize against absolute targets, never against colleagues ([ADR-0003](adr/0003-absolute-vs-cohort-scoring.md)) |
| C4 | Ingestion is unreliable by nature | Every pipeline stage is idempotent and resumable ([ADR-0004](adr/0004-pipeline-idempotency.md)) |
| C5 | Data of one workspace must never leak into another | Tenant filter is injected structurally, not by convention ([ADR-0005](adr/0005-tenancy-enforcement.md)) |
| C6 | Algorithms are the portfolio centerpiece | They live in a package with zero I/O so they are unit-testable in isolation |

### 1.2 Explicit non-goals

Not a GitHub replacement, not an IDE, not a project-management tool, not an HR or performance-
review system, and not a public developer leaderboard. DevIntel measures **process and system
health**; it is not a surveillance instrument.

---

## 2. System context (C4 level 1)

```mermaid
flowchart TB
    person["Developer · Tech Lead ·<br/>Engineering Manager · Org Admin"]

    subgraph platform["DevIntel"]
        core["Analytics platform<br/>web · api · workers"]
    end

    gh["GitHub<br/>REST API + Webhooks"]
    gl["GitLab · Bitbucket<br/>(Phase 2)"]

    person -->|"dashboards, insights,<br/>reports"| platform
    platform -->|"OAuth · pull repos, commits,<br/>PRs, reviews, issues"| gh
    gh -->|"webhook events"| platform
    platform -.->|"same GitProvider interface"| gl
```

---

## 3. Containers (C4 level 2)

```mermaid
flowchart TB
    browser["Browser"]

    web["src/app<br/>Next.js · SSR marketing +<br/>client dashboards"]
    api["src/server/api<br/>Express · REST /api/v1"]
    worker["src/server/worker<br/>BullMQ consumers"]

    analytics["src/analytics<br/>pure functions · zero I/O"]
    providers["src/providers<br/>GitProvider: Seed | GitHub"]

    pg[("PostgreSQL 16<br/>domain · metrics · audit")]
    redis[("Redis 7<br/>queues · cache · rate limits")]
    ext["GitHub API"]

    browser --> web
    web -->|"HTTP"| api
    api --> pg
    api --> redis
    api -->|"enqueue jobs"| redis
    redis -->|"consume jobs"| worker
    worker --> pg
    worker --> providers
    worker --> analytics
    api --> analytics
    providers -->|"HTTPS"| ext
    ext -.->|"webhooks"| api
```

**Why the worker is a separate process.** Initial sync of a mid-sized organization is thousands
of paginated API calls under a rate limit. Running it inside a request would block, time out,
and lose progress on restart. The API only ever *enqueues*; workers do the long work and
checkpoint their progress ([02](02-pipeline.md)).

---

## 4. Repository layout

**A single package** — one `package.json` at the root, no workspaces. Next.js resolves
`src/app` natively, and the API and worker are additional entrypoints run through `tsx`.

```text
devintel/
├── package.json              ← the only one
├── next.config.ts  tsconfig.json  eslint.config.js  vitest.config.ts
├── prisma.config.ts          ← Prisma 7 holds the connection URL here
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   └── generate-tenant-models.ts
├── src/
│   ├── app/                  Next.js App Router
│   ├── components/           charts · dashboard · analytics · data · navigation · overlay
│   ├── server/
│   │   ├── api/              Express + TypeScript, REST /api/v1
│   │   └── worker/           BullMQ consumers, one process, N queues
│   ├── analytics/            scoring · trends · anomaly · graph · insight rules
│   ├── db/                   Prisma client, tenant extension, generated client
│   ├── providers/            GitProvider interface + Seed & GitHub implementations
│   └── shared/               brand · result · errors · env · metrics · time
├── docs/                     this documentation set
└── docker-compose.yml        postgres:16 (:5434) + redis:7 (:6380)
```

Because there is no workspace dependency graph, **the boundaries in §5 are enforced entirely by
ESLint rules in `eslint.config.js`**. Those rules are the architecture, not decoration — the
layering has no other mechanical guarantee.

Path aliases (declared in `tsconfig.json` and mirrored in `vitest.config.ts`, which must be kept
in sync): `@/*` `@shared/*` `@db/*` `@analytics/*` `@providers/*` `@api/*` `@worker/*`
`@components/*`.

### 4.1 Backend module layout (`src/server/api`)

```text
src/server/api/
├── modules/                 one folder per bounded concern
│   ├── auth/                { routes, controller, service, repository, dto } per module
│   ├── users/
│   ├── workspaces/
│   ├── teams/
│   ├── repositories/
│   ├── developers/
│   ├── pull-requests/
│   ├── reviews/
│   ├── issues/
│   ├── analytics/
│   ├── insights/
│   ├── integrations/
│   ├── notifications/
│   └── reports/
├── middleware/              request-id · error · auth · tenant · rbac · validation · rate-limit
├── logger.ts
├── app.ts                   middleware chain + router composition
└── main.ts                  listen + graceful shutdown
```

Each module keeps the same internal shape:

```text
routes.ts       path + method + zod schema + handler binding, nothing else
controller.ts   HTTP in, HTTP out — parse, call service, serialize
service.ts      business logic and orchestration; no req/res, no SQL
repository.ts   Prisma queries only; no business rules
dto.ts          zod schemas + inferred request/response types
```

**Rule:** a controller that contains an `if` about business meaning is a bug. Controllers
translate protocol; services decide.

---

## 5. Dependency rules

```mermaid
flowchart LR
    web --> shared
    api --> analytics
    api --> db
    api --> shared
    worker --> analytics
    worker --> db
    worker --> providers
    worker --> shared
    analytics --> shared
    db --> shared
    providers --> shared
```

Two rules matter more than the rest:

1. **`src/analytics` imports nothing that performs I/O.** No Prisma, no Redis, no `fetch`,
   no `Date.now()`. Inputs are plain typed DTOs; the current time is passed in as a parameter.
   This is what makes the algorithms testable against fixtures and reproducible across machines.
2. **`src/providers` never writes to the database.** It returns normalized DTOs; the
   pipeline decides what to persist. That keeps GitHub-specific pagination and rate-limit logic
   from leaking into the domain.

Both rules are enforced mechanically (ESLint `no-restricted-imports` plus a `dependency-cruiser`
check in CI), because a rule that is only in a document is a rule that erodes.

---

## 6. Technology choices

| Layer | Choice | Why this one |
|---|---|---|
| Frontend | Next.js + TypeScript | SSR/SSG for public pages (§65 SEO), client rendering for dashboards |
| Styling | Tailwind + shadcn/ui | Token-driven, keeps the dark-first design system consistent |
| Server state | TanStack Query | Caching, background refetch, request dedup for analytics endpoints |
| Client state | Zustand | Small, non-server UI state only (filters, palette, drawer) |
| Charts | ECharts | Handles heatmaps, network graphs and large series that Recharts struggles with |
| Motion | Framer Motion (+ GSAP for hero) | Component-level transitions; GSAP only for the landing timeline |
| API | Express + TypeScript | Small surface, explicit middleware chain, no framework magic to explain |
| Validation | Zod | One schema drives runtime validation *and* the inferred TypeScript type |
| ORM | Prisma | Typed queries plus a client extension that enforces tenancy globally |
| Database | PostgreSQL 16 | Window functions, partial indexes, `generated` columns, JSONB staging |
| Cache / queue | Redis 7 + BullMQ | Retries, backoff, delayed jobs, per-queue concurrency, observable depth |
| Realtime | SSE | Sync progress is one-directional server→client; SSE avoids WebSocket overhead |
| Testing | Vitest · Supertest · Playwright | Unit (algorithms) · integration (API+DB) · E2E (journeys) |
| Observability | Pino · Sentry · OpenTelemetry | Structured logs, error tracking, request/job tracing |

**Deliberately deferred:** ClickHouse or a dedicated OLAP store. Postgres with correct indexes
and rollup tables carries the MVP comfortably; introducing a second datastore before it is
needed is complexity without payoff. The narrow-history table design ([ADR-0001](adr/0001-metric-storage-shape.md))
keeps that migration open.

---

## 7. Local infrastructure

Nothing is installed on the host. Postgres and Redis run in Docker on non-default ports so they
cannot collide with anything already on the machine.

```yaml
# docker-compose.yml  (specification — written during implementation)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: devintel
      POSTGRES_PASSWORD: devintel
      POSTGRES_DB: devintel
    ports: ["5434:5432"]
    volumes: ["devintel-pg:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U devintel"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6380:6379"]
    volumes: ["devintel-redis:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

volumes:
  devintel-pg:
  devintel-redis:
```

### 7.1 Configuration

Every process validates its environment through a Zod schema at boot and **exits on failure**.
A service that starts with a missing secret and fails at 3 a.m. is worse than one that refuses
to start.

```text
DATABASE_URL           postgresql://devintel:devintel@localhost:5434/devintel
REDIS_URL              redis://localhost:6380
SESSION_SECRET         ≥32 bytes
TOKEN_ENCRYPTION_KEY   32-byte key, AES-256-GCM, for provider OAuth tokens at rest
GITHUB_CLIENT_ID       (empty in seed mode)
GITHUB_CLIENT_SECRET
GITHUB_WEBHOOK_SECRET
DATA_PROVIDER          seed | github        ← selects the GitProvider implementation
LOG_LEVEL              debug | info | warn | error
```

`DATA_PROVIDER=seed` is the default for local development, which means the whole system —
sync, metrics, dashboards, insights — runs end to end with no GitHub account and no network.

---

## 8. Environments

| Environment | Web | API + Worker | Postgres | Redis | Provider |
|---|---|---|---|---|---|
| Local | `next dev` | `tsx watch` | Docker | Docker | `seed` |
| CI | build only | Vitest + Supertest | service container | service container | `seed` |
| Staging | Vercel | Railway/Fly | managed | managed | `github` |
| Production | Vercel | Railway/Fly | managed + PITR | managed | `github` |

CI runs entirely on seed data, so the full pipeline and every algorithm assertion execute on
each push without a GitHub token and without rate limits.

---

## 9. Cross-cutting concerns

**Security.** Provider OAuth tokens are encrypted at rest (AES-256-GCM) and never returned by
any endpoint. Sessions are `httpOnly` + `Secure` + `SameSite=Lax` cookies with rotation on
refresh. Webhooks verify HMAC signatures before the payload is parsed. Full treatment in
[04-api.md §7](04-api.md).

**Observability.** Every request and job carries a correlation id through logs and traces. The
metrics that get alerted on are queue depth, job failure rate, sync lag, webhook processing
time, and API p95 — the things that silently degrade before users notice stale dashboards.

**Auditing.** Every mutation of a workspace, team, integration, permission or retention setting
writes an `AuditLog` row: actor, action, resource, timestamp, IP, metadata.

---

## 10. Performance targets

| Path | Target | How it is met |
|---|---|---|
| Dashboard first load | < 2 s | Reads pre-computed rollups; no aggregation at request time |
| API p95 | < 500 ms | Indexed reads, no N+1, cursor pagination |
| Cached analytics | < 200 ms | Redis, keyed by `workspace:metric:subject:range:version` |
| Global search | < 300 ms | Postgres trigram + GIN indexes, capped result sets |

These are design budgets, not measurements. They are re-validated against real data during
implementation.

---

## 11. Document map

| Document | Answers |
|---|---|
| [01-data-model.md](01-data-model.md) | What is stored, how it is keyed and indexed, how tenants stay separate |
| [02-pipeline.md](02-pipeline.md) | How raw provider data becomes metrics and insights, and how it survives failure |
| [03-algorithms.md](03-algorithms.md) | Every formula, weight, threshold and normalization curve, with worked examples |
| [04-api.md](04-api.md) | The REST surface, authentication, RBAC, error and pagination contracts |
| [05-frontend.md](05-frontend.md) | Routes, design tokens, component inventory, responsiveness, accessibility |
| [06-roadmap.md](06-roadmap.md) | Delivery order and the traceability table for the MVP definition of done |
| [adr/](adr/) | The five decisions with real alternatives, and why each was chosen |
