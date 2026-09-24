---
name: react-data-layer
description: Client data and state for the dashboard — TanStack Query key design, caching, invalidation, optimistic updates, SSE integration, URL state with nuqs, Zustand scope, and React Hook Form with shared Zod schemas. Use when fetching, mutating, caching or storing any client-side state.
---

# React data layer

Reference: [docs/05-frontend.md](../../../docs/05-frontend.md) §6.

## Which owner for which state

| State | Owner | Why |
|---|---|---|
| Anything from the API | TanStack Query | Caching, dedup, background refetch |
| Filters, range, tab, selected entity | **URL** via `nuqs` | A view must be shareable |
| Drawer open, palette open, sidebar collapsed | Zustand | Ephemeral, never shared |
| Form fields | React Hook Form | With the same Zod schema the API validates |

Putting server data in Zustand is the most common mistake — you reimplement caching,
invalidation and staleness badly. Putting filters in Zustand is the second: a tech lead must be
able to paste a link and have a colleague see the identical chart.

## Query keys

**Every key starts with the workspace id.** Without it, switching workspaces serves another
tenant's cached data — a correctness bug that looks like a caching bug.

```ts
export const qk = {
  all: (ws: WorkspaceId) => ['ws', ws] as const,
  repositories: (ws: WorkspaceId, f: RepoFilters) => [...qk.all(ws), 'repositories', f] as const,
  analytics: (ws: WorkspaceId, metric: MetricKey, f: AnalyticsFilters) =>
    [...qk.all(ws), 'analytics', metric, f] as const,
};
```

Keys are hierarchical so `invalidateQueries({ queryKey: qk.all(ws) })` clears one workspace and
nothing else. Filter objects go in the key — they are part of the identity of the result.

## Analytics queries

```ts
useQuery({
  queryKey: qk.analytics(ws, metric, filters),
  queryFn: ({ signal }) => api.analytics(ws, metric, filters, { signal }),
  staleTime: 60_000,
  placeholderData: keepPreviousData,     // ← dim the old chart, never flash a skeleton
});
```

`keepPreviousData` is not cosmetic: a skeleton flash on every filter change causes a layout jump
and makes the interface feel broken. Hold the previous render at reduced opacity instead.

Always forward `signal` so a superseded request is aborted rather than racing.

## Mutations and invalidation

```ts
useMutation({
  mutationFn: (input) => api.createTeam(ws, input),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: [...qk.all(ws), 'teams'] }),
});
```

Invalidate the narrowest key that covers what changed. Invalidating `qk.all(ws)` after every
mutation refetches the whole dashboard.

Optimistic updates only where the server outcome is predictable — marking a notification read,
acknowledging an insight. Never for anything the server computes (scores, insights): guessing a
derived value and being wrong is worse than a brief spinner.

```ts
onMutate: async (vars) => {
  await queryClient.cancelQueries({ queryKey: key });      // stop an in-flight refetch
  const prev = queryClient.getQueryData(key);
  queryClient.setQueryData(key, optimistic(prev, vars));
  return { prev };
},
onError: (_e, _v, ctx) => queryClient.setQueryData(key, ctx.prev),
onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
```

All four callbacks or none — a missing `onError` leaves the UI showing a change that never
happened.

## SSE into the cache

Sync progress and notifications push **into the Query cache**, not into component state, so every
subscriber updates at once:

```ts
useEffect(() => {
  const es = new EventSource(`/api/v1/workspaces/${ws}/sync-runs/${id}/stream`, { withCredentials: true });
  es.addEventListener('progress', (e) => {
    queryClient.setQueryData(qk.syncRun(ws, id), JSON.parse(e.data));
  });
  es.addEventListener('done', () => {
    queryClient.invalidateQueries({ queryKey: qk.all(ws) });   // fresh data landed
    es.close();
  });
  return () => es.close();                                     // mandatory
}, [ws, id]);
```

The cleanup is mandatory — without it, every navigation leaks a connection and the server holds
them open.

## URL state

```ts
const [period, setPeriod] = useQueryState('period', parseAsStringLiteral(PERIODS).withDefault('30d'));
```

Use `replace` semantics for filter changes so the back button does not walk through every tweak.
Parse and validate with the same enums the API uses — an unparseable URL falls back to the
default rather than crashing.

## Forms

```ts
const form = useForm<CreateTeamInput>({ resolver: zodResolver(CreateTeamSchema) });
```

The schema is imported from `src/shared`, so client and server enforce identical rules.
Map server `details[].path` back onto fields with `setError` so a server-side rejection lands on
the right input.

## Traps

- **`useEffect` fetching.** If you are writing one to load data, use `useQuery`.
- **Non-stable filter objects** in a key create a new key every render. Memoize, or build the
  key from primitives.
- **`enabled`** for dependent queries, not an early `return null` that breaks hook order.
- **`select`** to derive shape without re-rendering on unrelated fields.
- **Error and empty states are not optional.** Every list surface needs both, plus a retry.

## Before finishing

- [ ] Key starts with the workspace id
- [ ] `staleTime` and `placeholderData` set on analytics queries
- [ ] `signal` forwarded
- [ ] Invalidation is narrow and correct
- [ ] Filters in the URL, not a store
- [ ] Every EventSource has a cleanup
- [ ] Loading, empty and error states exist
