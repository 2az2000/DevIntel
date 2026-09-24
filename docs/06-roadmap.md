# 06 — Roadmap and Definition of Done

> **Read first:** [00-overview.md](00-overview.md)

---

## 1. Build order

The sequence is chosen so that **the algorithms can be exercised before GitHub is connected**.
The seed provider ([02 §3](02-pipeline.md)) makes M2–M6 fully testable with no OAuth app, no
network and no rate limits, which removes the single largest source of stalled progress in a
project of this shape.

| # | Milestone | Delivers | Done when |
|---|---|---|---|
| **M0** | Foundation | pnpm workspace, `docker-compose.yml`, Prisma schema + first migration, shared config, CI | `pnpm test` and `pnpm build` pass on a clean clone |
| **M1** | Auth & workspace | Register, login, sessions with rotation, OAuth shell, workspace creation, members, RBAC middleware, tenant client | A second workspace's data is provably unreachable (integration test) |
| **M2** | Provider + ingest | `GitProvider` interface, `SeedProvider`, `RawEvent` staging, sync queues, `SyncRun` + SSE progress | 12 months of seed data ingest end to end; re-running changes nothing |
| **M3** | Normalize | Identity resolution, domain upserts, PR lifecycle materialization | Every domain table populated; replaying the batch is a no-op |
| **M4** | Metrics | Rollups, `MetricSnapshot`, `src/analytics` scoring with `ScoreResult` | [03 §4.1](03-algorithms.md)'s worked example passes as a unit test |
| **M5** | Intelligence | Trend, anomaly, bus factor, rule registry, `Insight` + notifications | The seed's two planted signals are detected with expected magnitudes |
| **M6** | Application UI | Dashboard, developer profile, repository analytics, team analytics, insights, command palette | A cold `pnpm dev` reaches a populated dashboard with seed data alone |
| **M7** | GitHub | OAuth, `GitHubProvider`, org/repo selection, incremental sync, webhooks | A real repository syncs and produces the same screens as the seed |
| **M8** | Hardening | Responsive pass, a11y pass, theming, observability, E2E, rate limits, audit | Every row of §2 below is checked |

M7 lands late deliberately. Building against a live API first means every algorithm bug arrives
tangled with a pagination bug, a rate-limit bug and an auth bug. With M2–M6 already green on
deterministic data, M7 has exactly one new failure surface: the provider itself.

---

## 2. MVP Definition of Done — traceability

Every checkbox from §85 of the PRD, mapped to where it is specified and what satisfies it. An
unmapped row would be a hole in the design; there are none.

| # | §85 requirement | Specified in | Satisfied by | Milestone |
|---|---|---|---|---|
| 1 | User can register / sign in | [04 §4](04-api.md) | `/api/v1/auth/*`, Argon2id, session rotation + reuse detection | M1 |
| 2 | Create a workspace | [01 §2.3](01-data-model.md), [04 §6.1](04-api.md) | `Workspace`, `WorkspaceMember`, `POST /workspaces` | M1 |
| 3 | Connect GitHub | [02 §4.1](02-pipeline.md), [04 §6.2](04-api.md) | OAuth flow, `Integration` with encrypted tokens | M7 |
| 4 | Select repositories | [01 §5.1](01-data-model.md), [04 §6.2](04-api.md) | `Repository.syncEnabled`, `POST …/repositories` | M7 |
| 5 | Initial sync runs | [02 §4.1](02-pipeline.md) | `sync.discover` → `sync.resource`, `SyncRun`, SSE progress | M2 / M7 |
| 6 | Commits ingested | [01 §5.2](01-data-model.md) | `Commit`, unique `(repositoryId, sha)` | M2–M3 |
| 7 | Pull requests ingested | [01 §5.3](01-data-model.md) | `PullRequest` + materialized lifecycle columns | M2–M3 |
| 8 | Reviews ingested | [01 §5.4](01-data-model.md) | `PullRequestReview` | M2–M3 |
| 9 | Data normalized | [02 §5](02-pipeline.md) | Identity resolution, upserts, derived timings | M3 |
| 10 | Metrics computed | [03 §2–§6](03-algorithms.md) | Rollups → `MetricSnapshot` → `ScoreSnapshot` | M4 |
| 11 | Dashboard displayed | [05 §2](05-frontend.md) | KPI cards, health score, timeline, heatmap, insights | M6 |
| 12 | Developer profile | [05 §2](05-frontend.md), [04 §6.3](04-api.md) | Overview, activity, skills, repositories | M6 |
| 13 | Repository analytics | [03 §5](03-algorithms.md), [04 §6.3](04-api.md) | Health score with components, PR metrics, contributors | M6 |
| 14 | Team analytics | [03 §6](03-algorithms.md) | Team health, flow, review responsiveness, load balance | M6 |
| 15 | Trends computed | [03 §7](03-algorithms.md) | `TrendResult` with direction, confidence, OLS slope | M5 |
| 16 | Rule-based insights | [03 §10](03-algorithms.md) | 15-rule registry, deduped, positive rules included | M5 |
| 17 | Background sync | [02 §2, §4.2](02-pipeline.md) | BullMQ queues, 15-minute incremental sync, `SyncCursor` | M2 / M7 |
| 18 | Webhook processing | [02 §4.3](02-pipeline.md) | HMAC verify → `RawEvent` → 202 → queue | M7 |
| 19 | Secure auth & authz | [04 §4, §5, §7](04-api.md), [ADR-0005](adr/0005-tenancy-enforcement.md) | RBAC matrix, tenant client extension, token encryption | M1 / M8 |
| 20 | Unit / integration / E2E tests | [03 §11](03-algorithms.md), [04 §9](04-api.md), §3 below | Vitest, Supertest, Playwright | M0 → M8 |
| 21 | Logging & error tracking | [00 §9](00-overview.md), [02 §10](02-pipeline.md) | Pino structured logs, Sentry, OpenTelemetry traces | M8 |
| 22 | Fully responsive UI | [05 §8](05-frontend.md) | Breakpoint behaviour table, scrollable charts, card tables | M6 / M8 |
| 23 | Dark / light theme | [05 §3.4](05-frontend.md) | Three-scope theming, both palettes validated | M6 |
| 24 | Accessibility | [05 §10](05-frontend.md) | Keyboard, ARIA, contrast, reduced motion, chart table views | M8 |

---

## 3. MVP metric coverage

Every metric §69 requires, traced to its key, its source and its formula.

**Developer**

| §69 metric | `metricKey` | Source | Formula |
|---|---|---|---|
| Commits | `commits` | `DeveloperDailyRollup` | Count (context only — unweighted, [03 §4](03-algorithms.md)) |
| Pull requests | `prs_opened`, `prs_merged` | rollup | Count |
| Reviews | `reviews_given`, `reviews_received` | rollup | Count |
| Active repositories | `repositories_active` | rollup | Distinct repositories in window |
| Activity trend | — | `MetricSnapshot` | `TrendResult` ([03 §7](03-algorithms.md)) |

**Repository**

| §69 metric | `metricKey` | Source | Formula |
|---|---|---|---|
| Commits | `commits` | `RepositoryDailyRollup` | Count |
| Contributors | `active_contributors` | rollup | Distinct authors in window |
| Pull requests | `prs_opened`, `prs_merged`, `prs_open_end` | rollup | Count |
| Open issues | `stale_issue_ratio`, open count | `Issue` | Count + age ratio |
| PR cycle time | `pr_cycle_time_median` | `PullRequest.cycleTimeMinutes` | `percentile_cont(0.5)` |

**Team**

| §69 metric | `metricKey` | Source | Formula |
|---|---|---|---|
| Activity | `commits`, `prs_merged` | `TeamDailyRollup` | Count |
| PR throughput | `prs_merged` | rollup | Count per period |
| Review time | `review_response_time_median` | `PullRequestReview` | Median |
| Collaboration | `review_load_gini`, `distinct_collaborators` | review graph | Gini + graph degree ([03 §6](03-algorithms.md)) |

---

## 4. Test strategy

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | Every formula in [03](03-algorithms.md); curves; trend; anomaly; bus factor; rules; identity resolution; validators |
| Integration | Vitest + Supertest + Testcontainers | Every endpoint: status, schema, permission boundary, **cross-tenant isolation**; pipeline stages against a real Postgres |
| Contract | Zod ↔ OpenAPI | Generated spec matches the validators by construction ([04 §9](04-api.md)) |
| E2E | Playwright | Register → create workspace → connect provider → select repositories → sync → dashboard → developer profile → repository analytics → generate report |
| A11y | axe-core in Playwright | Every top-level route, both themes |
| Determinism | Vitest | The seed dataset produces byte-identical metrics on repeated runs |

Two tests are load-bearing beyond their own scope:

- **Cross-tenant isolation** enumerates every model carrying `workspaceId` and asserts workspace
  A cannot read workspace B. Adding an unprotected table fails CI rather than shipping a leak.
- **Seed signal detection** asserts the planted review-latency regression and 62% knowledge
  concentration are surfaced with expected magnitudes. Any change to any formula in [03](03-algorithms.md)
  either preserves that result or fails with a specific number.

---

## 5. Phase 2 (§70)

Added without changing the core:

| Feature | Why it fits without rework |
|---|---|
| GitLab | A third `GitProvider` implementation; no stage changes ([02 §3](02-pipeline.md)) |
| Advanced analytics explorer | Already one endpoint over the narrow snapshot table ([04 §6.4](04-api.md)) |
| Anomaly detection surfaced in UI | Engine exists from M5; this is presentation |
| Repository health | Formula defined in [03 §5](03-algorithms.md); MVP computes it |
| Bus factor | Formula defined in [03 §9](03-algorithms.md) |
| Reports + PDF export | `Report` table and queue exist; adds a renderer |
| Real-time updates | SSE channel exists for sync; extends to metrics |
| Data retention controls | `Workspace.retentionDays` and the nightly job exist ([01 §9](01-data-model.md)) |

## 6. Phase 3 (§71)

| Feature | Depends on |
|---|---|
| AI-generated insight narration | Deterministic `Insight` + `evidence` — the LLM narrates computed facts, never queries the database (§72 of the PRD) |
| Natural-language analytics | Intent → the existing `/analytics/timeseries` contract, never generated SQL |
| Semantic search | An additional backend behind the existing search route |
| Career intelligence | Long-range `MetricSnapshot` history at `MONTH` granularity, retained past retention by design |
| Slack / Jira / Linear | New integration types alongside `GitProvider` |
| Bitbucket | Another `GitProvider` |

The ordering principle from §72 of the PRD holds: the deterministic engine is built first, and
AI is layered on top of processed data. An LLM given direct database access produces confident
numbers nobody can verify — which is the opposite of what this product claims to be.

---

## 7. Known risks

| Risk | Mitigation |
|---|---|
| GitHub rate limits make initial sync slow on large orgs | 12-month default backfill window, per-integration limiter, resumable cursors, visible progress |
| Identity resolution mis-merges two people | Merges are reversible (`mergedIntoId`), never destructive; `confidence` recorded per identity |
| Scoring weights feel wrong once real data arrives | Weights are versioned data; a change is a recompute, and history keeps its original version |
| Rollup drift after a bug fix | Recompute is a first-class operation, not an incident procedure ([02 §9](02-pipeline.md)) |
| Metric volume outgrows Postgres | Time-leading indexes and no cross-period FKs make monthly partitioning a later step, not a rewrite |
| The product drifts toward surveillance | Absolute-target scoring, distribution-not-ranking UI, `MEMBER` cannot read another member's breakdown ([04 §5](04-api.md)) |
