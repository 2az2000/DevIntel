# ROADMAP

The execution plan. [docs/](docs/) says *what* and *why*; this file says *in what order*, *with
what acceptance criteria*, and *what actually happened*.

**Every phase ends with a completion report written into this file** — what shipped, what was
deferred and why, and what the next phase inherits. A phase is not done until its report is
written.

## Status legend

`⬜ not started` · `🟦 in progress` · `✅ complete` · `⚠️ complete with deferrals` · `⛔ blocked`

## Overview

| Phase | Name | Needs GitHub? | Status |
|---|---|---|---|
| M0 | Foundation | ❌ | ⚠️ |
| M1 | Auth & workspace | ❌ | ⚠️ |
| M2 | Provider & ingest | ❌ | ⬜ |
| M3 | Normalize | ❌ | ⬜ |
| M4 | Metrics & scoring | ❌ | ⬜ |
| M5 | Intelligence | ❌ | ⬜ |
| M6 | Application UI | ❌ | ⬜ |
| M7 | GitHub integration | ✅ | ⬜ |
| M8 | Hardening | — | ⬜ |
| P2 | Phase 2 | — | ⬜ |
| P3 | Phase 3 | — | ⬜ |

M0–M6 run entirely on `DATA_PROVIDER=seed`: no GitHub account, no network, no rate limits. M7
lands late on purpose — with the algorithms already green on deterministic data, the GitHub
milestone has exactly one new failure surface instead of four tangled ones.

---

# M0 — Foundation ⚠️

**Goal.** A clean clone installs, typechecks, tests and builds. Nothing works yet; everything is
in place to build.

### Scope

- [x] Single-package repo (**not** a pnpm workspace — see the report), `src/` layout
- [x] `docker-compose.yml` — `postgres:16` on `5434`, `redis:7` on `6380`, both with healthchecks
- [x] TS config (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint flat config, Vitest projects
- [x] Boundary lint rules: no `prisma` outside `src/db`; no I/O, clock or randomness in `src/analytics`; no DB writes in `src/providers`
- [x] `src/shared` — env schema, branded ids and units, `Result`, typed errors, metric catalog, time utils
- [x] `src/db` — **full Prisma schema** ([docs/01](docs/01-data-model.md)), tenant client extension, migrations
- [x] `src/analytics` — `normalize()`, the curve table, `ScoreResult` types, first tests
- [x] `src/providers` — `GitProvider` interface and `Raw*` DTOs (no implementation)
- [x] `src/server/api` — Express bootstrap, middleware chain, health route, error mapper
- [x] `src/server/worker` — BullMQ bootstrap, queue registry, graceful shutdown
- [x] `src/app` — Next.js App Router shell, design tokens, three-state theme mechanism
- [x] `.env.example`, `.env`, `.gitignore`, `.npmrc`
- [x] CI: install → generate → migrate → lint → typecheck → test → build

### Acceptance

```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build   # all green
pnpm db:up && pnpm db:migrate                                            # schema applies
```

Plus: `normalize()` unit tests pass with exact values; a lint error is produced by importing
`prisma` from `src/server/api`.

### Completion report — 2026-09-04

**Status:** ⚠️ complete with deferrals

**Shipped.**

| Area | What exists |
|---|---|
| Repo | Single `package.json`; `src/` layout; path aliases in `tsconfig.json` + `vitest.config.ts` |
| Infra | `docker-compose.yml` — Postgres 16 on **5434**, Redis 7 on **6380**, both healthy |
| Schema | `prisma/schema.prisma` — **28 models, 20 enums**, 2 migrations applied |
| Tenancy | `tenantClient()` extension; `src/db/tenant-models.generated.ts` derived from the schema — **24 scoped, 4 global** |
| Analytics | `normalize()` + the 24-curve table + `ScoreResult` / `TrendResult` / `Anomaly` contracts |
| Providers | `GitProvider` interface and every `Raw*` DTO; the registry throws, pointing at M2/M7 |
| API | Express 5 app, ordered middleware chain, `requestId`, Pino with redaction, error mapper, `/api/v1/health` |
| Worker | 8 queues with per-queue concurrency/attempts/backoff, `maxRetriesPerRequest: null`, graceful shutdown |
| Web | Next 16 App Router shell, full token set, three-state theming, Tailwind 4 |
| CI | `.github/workflows/ci.yml` with Postgres + Redis services, running on seed data |

**Verified.**

```text
pnpm lint          clean (0 errors, 0 warnings)
pnpm typecheck     clean
pnpm test          9 passed / 9  (unit project)
next build         compiled, 2 static routes
prisma migrate     2 migrations applied to a live Postgres 16
API smoke test     GET /api/v1/health → 200 {"status":"ok","provider":"seed"}
                   GET /api/v1/nope   → 404 with the documented error envelope
boundary probe     3 deliberate violations written and confirmed to fail:
                     analytics → @db (value AND type-only) · Date.now() · Math.random()
                     providers → @db
                     server    → @db/client (unscoped)
                   plus: an eslint-disable comment confirmed inert in those layers
```

> **Correction.** The first version of this report claimed "boundary rules active" on the
> strength of a clean lint run. That was wrong, and the probe above is why the claim is now
> backed by evidence rather than by absence of errors. See "Defects found and fixed" below.

**Decisions taken during the milestone.**

1. **Single package instead of a pnpm workspace** (owner's call). Consequence: the layer
   boundaries have no dependency-graph backing, so they rest solely on three ESLint rule groups
   in `eslint.config.js`. Those rules are now load-bearing — weakening one weakens the
   architecture.
2. **Postgres on 5434, not 5433.** Port 5433 was already held by another project's container on
   this machine.
3. **`@node-rs/argon2` instead of `argon2`.** Prebuilt binaries, no native toolchain on Windows.
4. **TypeScript pinned to 6.0.x.** TS 7.0.2 is released but `typescript-eslint` still requires
   `<6.1.0`; taking 7 would have disabled all typed linting, the boundary rules included.
5. **Prisma 7 moved the datasource URL** out of `schema.prisma` into `prisma.config.ts`, and the
   client now needs a driver adapter (`@prisma/adapter-pg`).
6. **`Prisma.dmmf` no longer exists in Prisma 7**, so the tenant-scoped model list is generated
   from the schema by `scripts/generate-tenant-models.ts` rather than read from an internal
   runtime field. ADR-0005's "derived, never hand-maintained" requirement is preserved, and CI
   fails if the generated file is stale.
7. **A schema hole that generator found:** `TeamMember` and `SyncCursor` carried no
   `workspaceId`, so both would have been silently unprotected. Both now carry it — exactly the
   class of gap the derivation exists to expose.

**Defects found and fixed after the first report.**

Writing a deliberate violation to test the rules exposed three real problems:

1. **The analytics purity rule was dead.** In ESLint flat config, a later object that sets the
   same rule **replaces** the earlier setting rather than merging with it. The general
   `no-restricted-imports` block was declared after the analytics block and applied to
   `src/**`, so it silently overrode the stricter rule for every file in `src/analytics`. Fixed
   by ordering general → specific, with each layer restating everything it needs. The config now
   carries a comment saying so, because the failure mode is invisible.
2. **Patterns did not match this codebase's import style.** A pattern of `@db/client` does not
   match `@db/client.js`, and every import here carries an explicit `.js` extension. Patterns
   now end in `*`.
3. **Two real violations in M0's own code**, caught the moment the rules worked: `main.ts` in
   both the API and the worker imported `disconnect` from `@db/client.js` directly. Legitimate
   need, wrong door — both now import from the `@db` barrel. Bare `@db` / `@shared` /
   `@analytics` / `@providers` aliases were added so the barrel is the natural import.

The lesson generalizes: **a lint rule that has never failed has not been tested.** Any future
boundary rule gets a deliberate violation written against it before it is trusted.

**Deferred.**

- **`dependency-cruiser` was evaluated and deliberately not adopted.** ESLint catches direct
  violations, which is how they actually occur; the residual gap is a *transitive* chain
  (`analytics → shared/x → db`), which no rule here can see. With `src/analytics` at three files
  the risk is theoretical, and the tool reads existing code, so adopting it later costs nothing.
  **Revisit when `src/analytics` passes ~10 files (M4), or when the first helper is shared
  between the analytics and db layers.**
- **The integration test project is configured but empty.** The cross-tenant isolation sweep
  needs Testcontainers and fixtures; it lands in M1, where there is real data to isolate.
  `pnpm test:int` currently passes vacuously — do not read that as coverage.
- **`pnpm approve-builds`** — Prisma's postinstall is still unapproved by pnpm. Engines download
  on demand and both `generate` and `migrate` work, so this is cosmetic; revisit if a clean-clone
  install ever fails.
- **Playwright not installed.** No UI to test until M6.

**Known gaps — do not assume these work.**

- No authentication, no authorization, no tenant middleware wired into any route.
- `createProvider()` throws by design; there is no data source until M2.
- The worker starts and connects, but every queue has **no processor** — a job would fail.
- The web app is a placeholder page, not the dashboard.
- The `unit` project covers `src/analytics` only.

**M1 inherits.** A live schema with tenancy enforced at the client level; a derived scoped-model
list for the isolation sweep to iterate; typed errors and the response envelope; a middleware
chain with both load-bearing orderings already correct; and `pnpm verify` as a single gate.

---

# M1 — Auth & workspace ⚠️

**Goal.** A person can register, sign in, create a workspace, invite members, and provably
cannot see another workspace's data.

### Scope

- `modules/auth` — register, login (Argon2id), logout, logout-all, refresh with rotation and
  **reuse detection**, `GET /me`, session list and revoke
- OAuth shell — `/auth/oauth/:provider` + callback, signed single-use `state` cookie, account
  linking. GitHub credentials not required yet; the seed path skips it
- `modules/workspaces` — create, read, update (name, timezone, retention), members, invite,
  role change, remove
- `modules/teams` — CRUD, membership by `developerId`
- Middleware: `authenticate`, `resolveTenant`, `requirePermission`, `validate`, `rateLimit`
- Tenant client extension wired end to end, `TENANT_SCOPED_MODELS` derived from the DMMF
- `AuditLog` writes on every workspace, member, team and settings mutation

### Acceptance

- The **cross-tenant isolation sweep** passes over every scoped model
- The RBAC matrix in [docs/04 §5](docs/04-api.md) is enforced; a role without a permission gets 403
- A resource in another workspace returns **404**, not 403
- Reusing a rotated refresh token revokes the chain and writes an audit row
- Login is rate-limited per IP *and* per email, constant-time on unknown accounts

### Completion report — 2026-09-04

**Status:** ⚠️ complete with deferrals

**Shipped.**

| Area | What exists |
|---|---|
| Sessions | Opaque tokens, SHA-256 hashed at rest, rotation on every refresh, **reuse detection revoking the whole chain**, logout / logout-all, session list and revoke |
| Passwords | Argon2id (19 MiB / t=2 / p=1) via `@node-rs/argon2`; constant-time miss path so login cannot enumerate accounts |
| Middleware | `requestId` · `validate` · `rateLimit` · `authenticate` · `checkOrigin` · `resolveTenant` · `requirePermission` |
| RBAC | 16 permissions × 5 roles as data in `@shared/permissions`; every route declares a permission, never a role |
| Tenancy | `resolveTenant` attaches a scoped client before any handler runs; foreign workspaces return **404, not 403** |
| Workspaces | Create, read, update (name / timezone / retention), soft delete, members list, invite, role change, remove |
| Teams | Full CRUD plus membership by `developerId` |
| Audit | Append-only rows on workspace, member and team mutations, with actor, IP, user agent and metadata |
| Crypto | `src/shared/crypto.ts` — token hashing, AES-256-GCM for provider tokens (ready for M7), constant-time compare |
| Tests | Integration suite on a real Postgres + Redis: **38 tests across 4 files** |

**Verified.**

```text
pnpm lint          clean
pnpm typecheck     clean
pnpm test          9 passed / 9    (unit)
pnpm test:int      38 passed / 38  (integration, real Postgres + Redis)
```

The integration suite covers, specifically:

```text
tenant-isolation   9 tests · the sweep over all 24 scoped models, findUnique
                   rewrite, update/delete refusal, create-stamping, 404-not-403
auth              14 tests · registration, duplicate, weak password, unknown
                   field, account-enumeration parity, rotation, REUSE DETECTION,
                   logout / logout-all, token stored only as a hash
rbac              13 tests · every role against every gated route, owner
                   protection, rank comparison, audit rows, timezone recompute flag
rate-limit         2 tests · per-IP window and the per-email login limiter
```

**Decisions taken during the milestone.**

1. **Opaque session tokens, not JWTs.** The product needs immediate revocation — logout
   everywhere, role change, reuse detection — which a stateless token cannot give without a
   revocation list, at which point the statelessness is gone and the complexity is not.
2. **Reuse detection revokes the victim too.** When an already-rotated token is replayed, the
   legitimate holder is logged out along with the attacker. That is correct: the two are
   indistinguishable, and the alternative leaves the attacker with a working session.
3. **Password rules are length-only** (≥12 characters). Character-class requirements push people
   toward `Password1!` and measurably do not improve real-world strength.
4. **The rate limiter fails open.** If Redis is unavailable the request proceeds and a warning is
   logged — a limiter that is itself down must not lock everyone out of the product.
5. **`workspaceId` is passed explicitly on tenant-scoped creates.** Prisma's types require it and
   the extension overwrites whatever is supplied, so the type system forces the field and the
   runtime guarantees it is the right one. Belt and braces, verified by a test that passes the
   *wrong* workspace id and asserts the row lands in the right one.
6. **Tests keep the rate limiter enabled** and flush its Redis counters between cases. A limiter
   the tests switch off is a limiter nothing verifies; `rate-limit.int.test.ts` exercises it
   directly instead.

**Defects found by the tests.**

- The first version of the isolation sweep asserted that workspace A sees *no* rows. That is
  wrong — A legitimately owns its own audit trail and membership — and worse, it would have
  passed vacuously against empty tables. The assertion is now "every row A can see belongs to
  A", which is the actual invariant.

**Deferred.**

- **OAuth is not implemented.** The provider sign-in flow, the signed single-use `state` cookie
  and account linking are specified in docs/04 §4.2 but land with M7, where a real GitHub app
  exists to test against. Nothing in M2–M6 needs them.
- **Email invitations.** Inviting an address with no account returns `422` with an explicit
  message rather than failing obscurely; it needs email delivery and a pending-invitation table.
- **Recompute on timezone change is flagged, not enqueued.** The response carries
  `recomputeQueued: true` and an audit row records it, but there is no `aggregate` queue
  processor until M4. The flag is honest about intent; the work happens in M4.
- **Ownership transfer.** `OWNER` is deliberately not assignable through the member-role
  endpoint. A dedicated transfer operation is not built.

**Known gaps — do not assume these work.**

- No repositories, developers or metrics exist yet, so team membership can only reference
  developers created directly in the database. M2 populates them.
- `analytics.team` is enforced by the matrix but no analytics endpoint consumes it yet.
- Sessions have no "current device" marker in the list beyond the id comparison.

**M2 inherits.** Working authentication and workspaces; a tenant-scoped client available on
every request as `req.db`; the audit helper; a proven isolation sweep that any new model joins
automatically; and an integration harness (`tests/integration/helpers.ts`) that resets Postgres
and Redis between tests.

---

# M2 — Provider & ingest ⬜

**Goal.** Twelve months of deterministic seed data flow into `RawEvent` through the real
ingestion path, resumably, with live progress.

### Scope

- `GitProvider` interface implemented by `SeedProvider`: seeded PRNG, 8 repositories,
  14 developers (2 bots), weekday/weekend rhythm
- **Two planted signals**: a review-latency regression in one repository over the last 30 days,
  and ~62% knowledge concentration in `payment-core`
- Queues: `sync.discover`, `sync.resource` with per-integration rate limiting and deterministic
  job ids
- `RawEvent` staging with the `(provider, eventType, externalId, contentHash)` uniqueness key
- `SyncCursor` advanced only after a page commits; `SyncRun` with `stats`
- SSE progress endpoint
- Seed CLI: `pnpm db:seed`

### Acceptance

- A full seed ingest completes and populates `RawEvent`
- **Re-running the ingest changes no row** (assert a database snapshot before and after)
- Killing the worker mid-run and restarting resumes from the cursor, losing at most one page
- Progress frames arrive over SSE

### Completion report

_Not started._

---

# M3 — Normalize ⬜

**Goal.** Raw events become domain rows, with identities resolved and PR lifecycle timings
materialized.

### Scope

- Identity resolution: `PROVIDER_USER` → `EMAIL` → inferred link → unclaimed developer; bot
  detection; `confidence` recorded
- Developer merge and un-merge (`mergedIntoId`), enqueuing a recompute
- Upserts for `Repository`, `Commit`, `PullRequest`, `PullRequestReview`, `Issue`
- PR timing materialization — self-reviews excluded, draft time excluded, computed as a **pure
  function of current review rows** so late events converge
- `normalize` queue, batch transaction, `(subject, day)` collection → enqueue `aggregate`

### Acceptance

- Every domain table populated from seed
- Replaying a batch produces identical state
- Out-of-order events (`closed` before `opened`) converge to the same end state
- A developer committing under two emails resolves to one `Developer`
- Bots are flagged and excluded from people metrics but counted in repository activity

### Completion report

_Not started._

---

# M4 — Metrics & scoring ⬜

**Goal.** Rollups, snapshots and explainable scores.

### Scope

- `aggregate` stage → `*DailyRollup` + `RepositoryContributor`, **recompute-and-replace**, day
  buckets in the workspace timezone
- `metric` stage → `MetricSnapshot` at DAY, derived WEEK/MONTH, with `sampleSize`
- `src/analytics`: the full curve table, `computeDeveloperScore`, `computeRepositoryHealth`,
  `computeTeamHealth`, each returning `ScoreResult` with `components[]` and `version`
- `ScoreSnapshot` persistence including the component breakdown
- Weight config as versioned data; a version change enqueues a recompute
- Read endpoints: `/analytics/summary`, `/analytics/timeseries`

### Acceptance

- **The worked example in [docs/03 §4.1](docs/03-algorithms.md) passes as a unit test at 84.58**
- The repository-health example in §5.1 reproduces −5.93 with the documented component deltas
- Every weight vector sums to 1.0
- Removing a component redistributes weight and lowers `coverage`
- Running `aggregate` twice yields identical rows
- `/analytics/timeseries` serves any catalog key without metric-specific code

### Completion report

_Not started._

---

# M5 — Intelligence ⬜

**Goal.** The system explains itself.

### Scope

- Trend: period-over-period with polarity, CV-based volatility, OLS slope and confidence
- Anomaly: rolling median + MAD, all four guards (min history, `MAD=0`, low counts, direction)
- Graph: collaboration edges from reviews, contribution shares, HHI, bus factor
- Insight rule registry — the 15 rules in [docs/03 §10](docs/03-algorithms.md), each a pure
  `evaluate(ctx)`, deduped on `(ruleId, subject, periodStart)`
- Template rendering from `evidence`; repository/team templates may not name an individual
- `Notification` fan-out; insight acknowledge/resolve endpoints

### Acceptance

- **The seed-signal test passes**: the planted review-latency regression and the 62%
  concentration are both surfaced with expected magnitudes
- The 147-commit anomaly case is flagged; the `MAD=0` and low-count cases are not
- Positive insights fire on the same machinery as warnings
- Re-running the insight stage creates no duplicate rows

### Completion report

_Not started._

---

# M6 — Application UI ⬜

**Goal.** A cold `pnpm dev` reaches a populated dashboard using seed data alone.

### Scope

- Onboarding: create workspace → connect → select repositories → live sync progress
- Dashboard: KPI cards with deltas, developer health gauge with component bars, activity
  timeline, contribution heatmap, insight feed
- Developer profile: overview, activity, skills, repositories
- Repository: overview, health with components, PR analytics, contributors, bus factor
- Teams: health, flow, review responsiveness, review-load distribution
- Analytics explorer: metric × dimension × range × filters
- Insights, notifications, command palette (⌘K), global search
- `<Chart>` wrapper, `DataTable`, `FilterBar`, `DateRangePicker`, empty/error/skeleton states

### Acceptance

- Every chart obeys the rules in [docs/05 §4.3](docs/05-frontend.md) — no dual axis, fixed slot
  order, legend for ≥2 series, table view present
- Filters live in the URL and a pasted link reproduces the view
- Both themes correct; no color defined only inside a media block
- Refetch dims the previous render rather than flashing a skeleton

### Completion report

_Not started._

---

# M7 — GitHub integration ⬜

**Goal.** A real repository produces the same screens as the seed.

### Scope

- GitHub OAuth app, token exchange, AES-256-GCM encryption at rest
- `GitHubProvider` implementing `GitProvider`: pagination, conditional requests, rate-limit
  handling, 12-month default backfill
- Organization and repository selection UI
- Incremental sync every 15 minutes with a 5-minute overlap window
- Webhooks: raw-body HMAC verify → `RawEvent` → 202 in under 50 ms; `push`, `pull_request`,
  `pull_request_review`, `issues`, `issue_comment`, `repository`, `member`
- Token expiry → `Integration.status`, sync paused, user notified

### Acceptance

- A real repository syncs end to end and renders identically to seed data
- A replayed webhook delivery changes nothing
- A `429` reschedules at reset without consuming a retry attempt
- An invalid signature is rejected before the payload is parsed
- Killing the worker mid-sync loses at most one page

### Completion report

_Not started._

---

# M8 — Hardening ⬜

**Goal.** Every row of the §85 definition of done is checked.

### Scope

- Responsive pass across all breakpoints ([docs/05 §8](docs/05-frontend.md))
- Accessibility: keyboard, focus, ARIA, contrast in both themes, reduced motion, chart table
  views; `axe-core` on every route
- Observability: Pino structured logs with correlation ids, Sentry, OpenTelemetry traces across
  request → job; queue-depth and sync-lag alerts
- Rate limits, security headers, CSRF origin check, audit coverage review
- Performance: dashboard < 2 s, API p95 < 500 ms, search < 300 ms, bundle < 200 KB gzipped
- E2E journey + a11y suite green
- OpenAPI generated from the Zod schemas at `/api/v1/docs`

### Acceptance

The traceability table in [docs/06 §2](docs/06-roadmap.md) — all 24 rows verified, not assumed.

### Completion report

_Not started._

---

# P2 — Phase 2 ⬜

GitLab provider · advanced analytics explorer · anomaly surfacing in the UI · repository health
page · bus factor page · reports with PDF/CSV export · real-time metric updates · data-retention
controls · provider-side deletion reconciliation (the accepted gap in
[ADR-0004](docs/adr/0004-pipeline-idempotency.md)).

Each item fits without core rework — see [docs/06 §5](docs/06-roadmap.md).

# P3 — Phase 3 ⬜

AI narration over computed insights (the LLM narrates `evidence`, never queries the database) ·
natural-language analytics mapped onto the existing timeseries contract · semantic search ·
career intelligence over long-range monthly snapshots · Slack, Jira, Linear, Bitbucket.

---

## How to write a completion report

At the end of a phase, replace its `Completion report` block with:

```markdown
### Completion report — <date>

**Status:** ✅ complete | ⚠️ complete with deferrals

**Shipped.** What exists and works, with the files or modules that hold it.

**Verified.** The commands run and their result — not "tests pass" but which suite, how many.

**Deferred.** What was in scope and did not land, why, and where it moved to.

**Known gaps.** What a reader should not assume works.

**Next phase inherits.** Concrete handoff: what M<n+1> can now rely on.
```

A report that says only "done" is not a report. The deferrals section is the one that matters
six weeks later.
