---
name: nextjs-app-router
description: Next.js App Router mechanics for this app — server versus client components, the route-group rendering strategy, layouts, streaming and Suspense, route handlers, metadata and SEO, dynamic imports and bundle discipline. Use when adding a route, moving a boundary, or debugging hydration, caching or bundle-size problems.
---

# Next.js App Router

Reference: [docs/05-frontend.md](../../../docs/05-frontend.md).

## Rendering strategy is per route group, not global

| Group | Mode | Why |
|---|---|---|
| `(marketing)` | SSG + ISR | Public, indexable, cacheable at the edge |
| `(auth)` | SSR | Session-dependent, never cached |
| `(app)/[workspace]` | Client, with a server shell | Filter-driven, private, no SEO value |

The dashboard is deliberately **not** server-rendered per request: its content is a function of
filters that change constantly, so SSR would produce a render that is stale before it paints
while removing the client cache that makes filter changes feel instant. The server component
renders layout, navigation and skeletons; data arrives through TanStack Query.

## The server/client boundary

Server components are the default. `'use client'` marks a **boundary**, not a file — everything
imported below it joins the client bundle.

```text
layout.tsx            server — shell, nav, providers wrapper
  └─ Providers.tsx    'use client' — QueryClient, theme, toaster
       └─ page.tsx    children passed through stay server-rendered
```

Rules:

- Push `'use client'` as far down the tree as possible. A `'use client'` in a layout drags the
  whole subtree into the bundle.
- Server components may render client components. A client component **cannot** import a server
  component — pass it as `children` instead.
- Props crossing the boundary must be serializable: no functions, no `Date` (send ISO strings),
  no class instances.
- Never import anything touching `process.env` secrets, Prisma or `node:` modules into a client
  component. Only `NEXT_PUBLIC_*` reaches the browser.

## Streaming with Suspense

```tsx
export default function Page() {
  return (
    <>
      <DashboardHeader />
      <Suspense fallback={<KpiSkeleton />}><KpiRow /></Suspense>
      <Suspense fallback={<ChartSkeleton />}><TrendChart /></Suspense>
    </>
  );
}
```

Skeletons must match the final layout's dimensions, or the page jumps when data arrives. Every
route also needs `loading.tsx` and `error.tsx`; `error.tsx` is a client component and receives a
`reset()` — use it, an error boundary with no recovery is a dead end.

## Route handlers

`app/api/*` route handlers are for **Next-local** concerns only: OAuth callback redirects,
health checks, and anything needing a cookie the browser will not send cross-origin. All domain
endpoints live in `src/server/api`. Do not grow a second API here.

```ts
export const dynamic = 'force-dynamic';   // anything session-dependent
```

## Caching

Next caches aggressively by default and the failure mode is a stale private page. Be explicit:

- `(app)` pages: `export const dynamic = 'force-dynamic'` on the layout.
- `(marketing)` pages: `export const revalidate = 3600`.
- `fetch` in server components: state `cache: 'no-store'` or `next: { revalidate: n }` — never
  rely on the default.

## Metadata

```ts
export const metadata: Metadata = { title: 'Pricing — DevIntel', description: '…' };
export async function generateMetadata({ params }): Promise<Metadata> { /* dynamic */ }
```

Marketing routes need title, description, canonical and OpenGraph. Private `(app)` routes need
only a title.

## Bundle discipline

```ts
const NetworkGraph = dynamic(() => import('@/components/charts/NetworkGraph'), {
  ssr: false, loading: () => <ChartSkeleton />,
});
```

ECharts, the force-directed graph and the report renderer are dynamically imported so the
dashboard's first paint never pays for the analytics explorer. Budget: **< 200 KB gzipped** for
the app shell, enforced in CI. Check with `ANALYZE=true pnpm build` before adding a dependency.

## Navigation and params

- `useSearchParams()` requires a Suspense boundary, or the whole route opts into dynamic
  rendering.
- Filter state lives in search params via `nuqs`, not in a store — a view must be shareable.
- `router.replace` for filter changes (no history spam), `router.push` for real navigation.

## Traps

- **Hydration mismatch** from `Date`, `Math.random()` or `localStorage` during render. Read
  browser-only state in `useEffect`, and guard every storage access in `try/catch` — it throws
  in some contexts.
- **`params` and `searchParams` are async** in current versions; await them.
- **`redirect()` throws** — do not call it inside a `try` that swallows errors.
- **Middleware runs on the edge runtime**: no Node APIs, no Prisma.

## Before finishing

- [ ] `'use client'` is at the lowest possible boundary
- [ ] Nothing secret or Node-only crossed into a client component
- [ ] Caching stated explicitly for the route
- [ ] `loading.tsx` and `error.tsx` present; skeletons match final dimensions
- [ ] Heavy components dynamically imported
- [ ] No hydration warning in the console
