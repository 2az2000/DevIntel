---
name: testing-strategy
description: How to test this codebase — Vitest unit tests with exact-value fixtures, Supertest integration tests against a real Postgres, Playwright end-to-end journeys, determinism, and the two load-bearing tests that must never be skipped. Use when writing tests, deciding what level a test belongs at, or when a test is flaky.
---

# Testing

Reference: [docs/06-roadmap.md](../../../docs/06-roadmap.md) §4.

## Which level

| Test it here | When |
|---|---|
| **Unit** (Vitest, no I/O) | Anything in `src/analytics`; validators; pure helpers |
| **Integration** (Vitest + Supertest + real Postgres) | Endpoints, repository functions, pipeline stages |
| **E2E** (Playwright) | User journeys that cross the whole stack |

The bulk of the value is at the top. `src/analytics` is pure by construction, so its tests
are fast, deterministic and assert exact numbers — that is where the product's correctness
actually lives.

## Unit tests assert exact values, never ranges

```ts
it('computes the documented developer score', () => {
  const result = computeDeveloperScore(FIXTURE_D, WEIGHTS_V1);
  expect(result.value).toBe(84.58);
  expect(result.components).toHaveLength(6);
  expect(byKey(result, 'delivery').contribution).toBeCloseTo(21.46, 2);
});
```

The worked examples in docs/03-algorithms.md §4.1 and §5.1 are **literal test cases**. A range
assertion (`toBeGreaterThan(80)`) hides exactly the regression the test exists to catch.

Also cover, for every algorithm: behaviour at curve knots, clamping outside them, weight vectors
summing to 1.0, each component removed in turn (redistribution and `coverage`), and every guard
in the detector.

## Determinism

- Inject `now` — never `Date.now()` inside a tested function.
- `vi.setSystemTime()` for anything that legitimately reads the clock in the shell.
- Never `Math.random()`; the seed generator uses an explicit seeded PRNG.
- Sort before comparing collections, or assert with `toEqual` on a sorted projection.

A flaky test in this codebase is almost always one of: unfrozen time, unsorted query results, or
a shared database row between tests.

## Integration tests

```ts
const container = await new PostgreSqlContainer('postgres:16-alpine').start();
```

Testcontainers, migrations applied once per suite. Each test runs in a **transaction that rolls
back**, so tests share a schema but never share rows — which is what keeps them order-independent
and parallelizable.

Every endpoint test covers four things:

```ts
it('returns 403 for a role without the permission', ...)
it('returns 404 for a resource in another workspace', ...)   // 404, not 403
it('matches the response schema', ...)
it('rejects invalid input with VALIDATION_ERROR', ...)
```

## The two tests that must never be skipped

**1. Cross-tenant isolation.** Enumerates every model carrying `workspaceId` from the Prisma
DMMF, creates a row in workspace B, and asserts workspace A's client cannot read it. A new
unprotected table fails CI instead of shipping a data leak.

```ts
for (const model of TENANT_SCOPED_MODELS) {
  it(`isolates ${model}`, async () => {
    const row = await seedRowIn(workspaceB, model);
    expect(await tenantClient(workspaceA)[model].findUnique({ where: { id: row.id } })).toBeNull();
  });
}
```

**2. Seed signal detection.** The seed dataset plants a review-latency regression and a 62%
knowledge concentration. The test asserts the pipeline surfaces exactly those insights with the
expected magnitudes. Because the seed is fixed, any change to any formula either preserves the
result or fails with a specific number.

Both are the reason a formula change is safe to make.

## Pipeline stage tests

Idempotency is a test, not a claim:

```ts
it('produces identical state when run twice', async () => {
  await runStage(payload);
  const first = await snapshotDb();
  await runStage(payload);
  expect(await snapshotDb()).toEqual(first);
});
```

Also test: partial failure mid-batch leaves raw events `PENDING`; a duplicate webhook collapses;
out-of-order events converge to the same end state.

## E2E

One journey, covering the arc the product exists for:

```text
register → create workspace → connect provider → select repositories
        → sync completes → dashboard populated → developer profile
        → repository analytics → generate report
```

Plus `axe-core` on every top-level route in both themes, and a keyboard-only walkthrough.

Keep E2E few and meaningful. Use `data-testid` only where a semantic role or label cannot
identify the element — a test that queries by role also verifies accessibility.

## Traps

- **Testing implementation, not behaviour.** Asserting that a service called a repository method
  locks in the current structure and breaks on every refactor.
- **Mocking Prisma.** Integration tests use a real database; mocks hide exactly the SQL and
  constraint bugs worth catching.
- **Snapshot tests on computed numbers.** Update-on-fail defeats the purpose. Assert the number.
- **Shared mutable fixtures** across tests — build fresh per test, or roll back.

## Before finishing

- [ ] Right level for what is being verified
- [ ] Exact values, not ranges, for anything computed
- [ ] Time injected; no randomness; ordering explicit
- [ ] New tenant-scoped model included in the isolation sweep
- [ ] Idempotency asserted for a new pipeline stage
- [ ] `pnpm test` green with no `.only`, no skips
