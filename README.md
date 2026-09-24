# DevIntel — Developer Intelligence Platform

Turns raw software-development activity — commits, pull requests, reviews, issues — into
**explained, measurable, actionable** engineering insight.

```text
Git data → Data engineering → Analytics → Algorithms → Intelligence → Actionable insight
```

Not "GitHub statistics, but prettier". The claims this product makes — *health fell 7 points
because review latency rose 34%*, *knowledge in `payment-core` is concentrated in one person* —
are not CRUD reads. They are derived, versioned, explainable computations over historical state,
and the architecture exists to make them possible.

> **Status: design.** This repository currently contains the architecture documentation only.
> No application code has been written yet; implementation begins at milestone M0 in
> [docs/06-roadmap.md](docs/06-roadmap.md).

---

## The documents

Read in order for the full picture, or jump to what you need:

| Document | Answers |
|---|---|
| [00 — Overview](docs/00-overview.md) | What the system is, its containers, repo layout, stack, environments |
| [01 — Data Model](docs/01-data-model.md) | Every table, key and index; how tenants stay separate |
| [02 — Pipeline](docs/02-pipeline.md) | How provider data becomes metrics, and how it survives failure |
| [03 — Algorithms](docs/03-algorithms.md) | Every formula, weight, curve and threshold, with worked examples |
| [04 — API](docs/04-api.md) | REST surface, authentication, RBAC, error and pagination contracts |
| [05 — Frontend](docs/05-frontend.md) | Routes, design tokens, chart rules, responsiveness, accessibility |
| [06 — Roadmap](docs/06-roadmap.md) | Build order, and the MVP definition-of-done traceability table |

### Decision records

The five decisions where a real alternative existed and the choice shapes everything downstream:

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-metric-storage-shape.md) | Narrow history table **and** wide rollup tables, each for what it is good at |
| [0002](docs/adr/0002-developer-identity-resolution.md) | Three-layer identity — a commit's email and a PR's user id are not the same key |
| [0003](docs/adr/0003-absolute-vs-cohort-scoring.md) | Normalize against absolute targets, never against colleagues |
| [0004](docs/adr/0004-pipeline-idempotency.md) | Every stage idempotent — recompute and replace, never increment |
| [0005](docs/adr/0005-tenancy-enforcement.md) | Tenant filter injected structurally, so forgetting it is not possible |

---

## Where to start reading

**If you are implementing it** — [00 §4](docs/00-overview.md) for the layout,
[01](docs/01-data-model.md) for the schema, then [06 §1](docs/06-roadmap.md) for the build
order. M0 through M6 need no GitHub account.

**If you are evaluating the engineering** — [03](docs/03-algorithms.md) is the substance, and
[ADR-0003](docs/adr/0003-absolute-vs-cohort-scoring.md) is the decision the product's ethics
rest on.

**If you want the short version** — the five ADRs, in about ten minutes.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js · TypeScript · Tailwind · shadcn/ui · TanStack Query · ECharts · Framer Motion |
| Backend | Node.js · Express · TypeScript · Zod · Prisma |
| Data | PostgreSQL 16 · Redis 7 · BullMQ |
| Testing | Vitest · Supertest · Playwright |
| Observability | Pino · Sentry · OpenTelemetry |

Local infrastructure runs entirely in Docker (`postgres:16` on `5434`, `redis:7` on `6380`), and
`DATA_PROVIDER=seed` runs the whole system — sync, metrics, scores, insights, dashboards — with
no GitHub account and no network access.

---

## Principles that constrain the code

1. **Every score is explainable.** Scoring functions return their component breakdown; the
   explanation of a change is the diff of two breakdowns, never a hand-written sentence.
2. **Volume is never a virtue.** Commit count is displayed as context and weighted at zero.
3. **Measure systems, not people.** Absolute-target scoring, distributions rather than rankings,
   and no path for one member to read another's score breakdown.
4. **Algorithms perform no I/O.** `src/analytics` has no database, no network, no clock —
   which is what makes every formula testable against fixtures.
5. **Derived data is disposable.** Metrics, rollups, scores and insights are rebuildable from
   the domain layer, so fixing a formula is a recompute rather than a data-loss event.
