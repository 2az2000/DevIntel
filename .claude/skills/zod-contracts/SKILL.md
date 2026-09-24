---
name: zod-contracts
description: Schema-first contracts with Zod — request/response validation, type inference, transforms, discriminated unions, environment validation, error mapping and OpenAPI generation. Use when defining any payload, config, provider DTO or form, and whenever tempted to hand-write a TypeScript interface for data crossing a boundary.
---

# Zod contracts

One schema per payload. It is the runtime validator, the source of the TypeScript type, and the
OpenAPI fragment — three artifacts that can never drift apart because they are one artifact.

## The rule

```ts
export const CreateTeamSchema = z.object({
  name: z.string().trim().min(1).max(64),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens').max(64),
});
export type CreateTeamInput = z.infer<typeof CreateTeamSchema>;
```

Never hand-write an interface that mirrors a schema. If you find yourself typing the same shape
twice, one of them is already wrong.

## Where schemas live

| Kind | Location |
|---|---|
| Request params / query / body | `src/server/api/modules/<name>/dto.ts` |
| Shared domain shapes | `src/shared/schemas/` |
| Provider DTOs (`Raw*`) | `src/providers/schemas/` |
| Environment | `src/shared/env.ts` |

Provider payloads get parsed through a schema at the boundary. GitHub's response is untrusted
input shaped by someone else's API version, and parsing it once at entry is what stops a
missing field from surfacing three stages later as a `NaN` in a metric.

## Strict by default

```ts
const Schema = z.object({ ... }).strict();   // unknown keys → error
```

Use `.strict()` on request bodies so a typo'd field is a 400 rather than a silently ignored
setting. Use the default (strip) on provider payloads, where extra fields are normal.

## Coercion at the edge only

Query strings are strings. Coerce there, never deeper:

```ts
export const PaginationSchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
```

`z.coerce.number()` on `"abc"` yields `NaN` and *passes* unless you add `.int()` or
`.finite()`. Always constrain a coerced number.

## Discriminated unions for variant payloads

```ts
export const ReportRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('developer'),  developerId: z.string(),  period: PeriodSchema }),
  z.object({ type: z.literal('repository'), repositoryId: z.string(), period: PeriodSchema }),
  z.object({ type: z.literal('team'),       teamId: z.string(),       period: PeriodSchema }),
]);
```

`discriminatedUnion` gives precise errors and fast parsing; a plain `union` reports every branch's
failure and is unusable in an error message.

## Cross-field rules with `superRefine`

```ts
export const AnalyticsQuerySchema = z.object({
  period: z.enum(['7d','30d','90d','6m','1y','all','custom']),
  from: z.coerce.date().optional(),
  to:   z.coerce.date().optional(),
}).superRefine((v, ctx) => {
  if (v.period === 'custom' && (!v.from || !v.to))
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'from and to are required when period is custom' });
  if (v.from && v.to && v.from > v.to)
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
});
```

Put the `path` on the field the user must fix — the frontend maps issues to inputs by path.

## Branded output for ids

```ts
export const WorkspaceIdSchema = z.string().cuid2().transform((s) => s as WorkspaceId);
```

Validation and branding in one step, so a parsed id cannot be passed where a different id is
expected.

## Environment: validate at boot, exit on failure

```ts
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().length(64),      // 32 bytes hex
  DATA_PROVIDER: z.enum(['seed', 'github']).default('seed'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', z.treeifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;
```

A service that starts with a missing secret and fails at 3 a.m. is worse than one that refuses
to start.

## Error mapping

The validation middleware converts a `ZodError` into the standard envelope:

```ts
details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
```

Write messages that tell the user what to do — `"period must be one of 7d, 30d, 90d, 6m, 1y, all"`,
not `"Invalid enum value"`.

## Traps

- **`.optional()` vs `.nullable()` vs `.default()`** are three different contracts. Pick
  deliberately; `exactOptionalPropertyTypes` will hold you to it.
- **`z.date()` does not parse strings.** JSON has no date type — use `z.coerce.date()`.
- **`.transform()` makes input and output types differ.** Use `z.input<>` for what callers send
  and `z.infer<>` for what handlers receive.
- **Do not reuse a request schema as a response schema.** They diverge (ids, timestamps,
  computed fields), and coupling them makes both awkward.

## Before finishing

- [ ] Type inferred, not duplicated
- [ ] Request bodies `.strict()`
- [ ] Coerced numbers constrained
- [ ] Cross-field rules carry a `path`
- [ ] Messages say what to do
- [ ] Provider payloads parsed at the boundary
