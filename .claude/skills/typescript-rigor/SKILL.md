---
name: typescript-rigor
description: Type-driven design patterns for this codebase — discriminated unions, branded types, exhaustiveness, making illegal states unrepresentable, error handling without exceptions-as-control-flow. Use when designing a type, a module boundary, a domain model, or when tempted to reach for `any`, a type assertion, or an optional field that is only sometimes meaningful.
---

# TypeScript rigor

The goal is not "types compile". It is **the compiler rejects wrong programs**. Every rule below
exists because it converts a runtime bug into a build error.

## Make illegal states unrepresentable

The most common modeling mistake is a bag of optionals where only certain combinations are real.

```ts
// ✗ four booleans = 16 states, of which 4 are legal
interface SyncRun { running: boolean; failed: boolean; error?: string; finishedAt?: Date }

// ✓ four states, all legal, and `error` exists exactly where it means something
type SyncRun =
  | { status: 'queued' }
  | { status: 'running'; startedAt: Date; processed: number }
  | { status: 'succeeded'; startedAt: Date; finishedAt: Date; stats: SyncStats }
  | { status: 'failed'; startedAt: Date; finishedAt: Date; error: SyncError };
```

Ask of every optional field: *is there a state where this is required?* If yes, it belongs to a
union member, not to a `?`.

## Exhaustiveness — the compiler catches the case you forgot

```ts
function severityColor(s: Severity): ColorToken {
  switch (s) {
    case 'POSITIVE': return 'status-good';
    case 'INFO':     return 'accent';
    case 'WARNING':  return 'status-warning';
    case 'CRITICAL': return 'status-critical';
    default: return assertNever(s);      // adding a severity breaks the build here
  }
}
export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
```

Use `assertNever` in every switch over a union. Without it, a new enum member silently falls
through and ships.

## Branded types for ids and units

Every id in this system is a string, so every id is interchangeable — which is how a
`repositoryId` ends up in a `developerId` parameter.

```ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type WorkspaceId  = Brand<string, 'WorkspaceId'>;
export type DeveloperId  = Brand<string, 'DeveloperId'>;
export type Minutes      = Brand<number, 'Minutes'>;
export type Hours        = Brand<number, 'Hours'>;
```

`Minutes` and `Hours` matter as much as the ids: the analytics layer takes hours, the database
stores minutes, and mixing them silently produces a score that is wrong by 60×.

## Types flow from schemas, never in parallel

```ts
export const CreateTeamSchema = z.object({ name: z.string().min(1), slug: SlugSchema });
export type CreateTeamInput = z.infer<typeof CreateTeamSchema>;   // ✓ inferred
```

Never hand-write an interface that mirrors a zod schema. Two declarations of the same shape
drift; one declaration cannot.

## Errors: typed and exhaustive at the boundary

Domain code throws typed errors; the HTTP layer maps them. Never throw a bare `Error`, and never
use exceptions for expected outcomes that the caller must handle.

```ts
export class NotFoundError extends DomainError { readonly code = 'NOT_FOUND' as const; }
export class ConflictError extends DomainError { readonly code = 'CONFLICT' as const; }
```

For operations where failure is an ordinary outcome (parsing, provider calls), return a result
instead of throwing — the caller cannot forget to handle it:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

## Rules

- **`strict: true`** plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`. `arr[0]` is `T | undefined` and that is correct.
- **No `any`.** Use `unknown` and narrow. `any` disables checking for everything downstream.
- **No `as`** except after a runtime check, or in a `satisfies`-style const assertion. A type
  assertion is a promise to the compiler that you cannot keep.
- **`satisfies` over annotation** for config objects — keeps the literal types while checking
  the shape: `const CURVES = { ... } satisfies Record<MetricKey, Curve>`.
- **`readonly`** on arrays and object fields that are not mutated. Most of them are not.
- **No enums** — use `as const` objects with a derived union. TS enums have surprising
  nominal/numeric behaviour and do not tree-shake.
- **Function signatures take and return domain types**, never Prisma model types. Prisma types
  leaking upward couples the service layer to the schema.

## Before finishing

- [ ] No `any`, no unchecked `as`
- [ ] Every union switch ends in `assertNever`
- [ ] Optionals audited — none of them is "required in some states"
- [ ] Ids and durations branded
- [ ] Types inferred from zod, not duplicated
