# 05 — Frontend

> **Read first:** [04-api.md](04-api.md) · **Read next:** [06-roadmap.md](06-roadmap.md)

---

## 1. Rendering strategy

Next.js App Router, with the rendering mode chosen per route group rather than globally:

| Route group | Mode | Why |
|---|---|---|
| `(marketing)` — landing, features, pricing, docs | **SSG** + ISR | Public, indexable, cacheable at the edge (§65) |
| `(auth)` — login, register, OAuth callbacks | **SSR** | Session-dependent, never cached |
| `(app)` — dashboard and everything behind it | **Client**, with a server shell | Private, filter-driven, no SEO value; TanStack Query owns the data |

The dashboard is not server-rendered per request. Its content is a function of user-chosen
filters and time ranges that change constantly, so SSR would produce a render that is stale
before it paints while removing the client cache that makes filter changes feel instant. The
server shell renders layout, navigation and skeletons; data arrives client-side and is cached.

---

## 2. Route map

```text
app/
├── (marketing)/
│   ├── page.tsx                     landing (§67)
│   ├── features/  pricing/  docs/
│
├── (auth)/
│   ├── login/  register/  forgot-password/
│   └── oauth/[provider]/callback/
│
├── (onboarding)/
│   ├── workspace/new/               create workspace
│   ├── connect/                     choose provider
│   ├── connect/[provider]/select/   organization + repository picker
│   └── sync/[syncRunId]/            live progress (SSE)
│
└── (app)/[workspace]/
    ├── layout.tsx                   sidebar · command palette · notifications
    ├── page.tsx                     Dashboard
    ├── developers/  developers/[id]/{overview,activity,skills,repositories}/
    ├── teams/       teams/[id]/
    ├── repositories/ repositories/[id]/{overview,pull-requests,contributors,health}/
    ├── pull-requests/ pull-requests/[id]/
    ├── reviews/  commits/  issues/
    ├── analytics/                   interactive explorer (§26)
    ├── insights/
    ├── activity/
    ├── reports/  reports/[id]/
    ├── integrations/
    ├── settings/{general,members,teams,retention,appearance}/
    └── admin/{audit,billing,security}/
```

`[workspace]` is a slug segment, so tenancy is visible in the browser URL exactly as it is in
the API path ([04 §1](04-api.md)) — switching workspaces is a navigation, not hidden state, and
a copied link lands the recipient in the right tenant.

---

## 3. Design tokens

Every value below is a CSS custom property. No component writes a raw hex, and §50's rule that
colors carry meaning is enforced by naming tokens for their **role**, never their hue.

### 3.1 Surfaces and ink

Dark-first: the dark values are the designed ones, the light values their deliberate
counterpart rather than an inversion.

| Role | Dark | Light |
|---|---|---|
| `--plane` (page) | `#0a0b0d` | `#f7f7f8` |
| `--surface-1` (card, chart) | `#101215` | `#fbfbfc` |
| `--surface-2` (raised, popover) | `#171a1f` | `#ffffff` |
| `--surface-inset` (well, input) | `#0d0f12` | `#f1f1f3` |
| `--text-primary` | `#f5f6f7` | `#0b0c0e` |
| `--text-secondary` | `#a8adb6` | `#52545a` |
| `--text-muted` (axis, meta) | `#6f747d` | `#7c7f86` |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(11,12,14,0.10)` |
| `--grid` (hairline) | `#1c1f24` | `#e6e6e9` |
| `--axis` | `#2a2e35` | `#c9cace` |

### 3.2 Semantic status (§50)

Reserved. A status color never doubles as a chart series color, and never carries meaning
without an icon and a label beside it.

| Role | Hex | Meaning |
|---|---|---|
| `--status-good` | `#0ca30c` | Healthy · improving |
| `--status-warning` | `#fab219` | Attention |
| `--status-serious` | `#ec835a` | Degrading |
| `--status-critical` | `#d03b3b` | Critical |
| `--accent` | `#3987e5` dark / `#2a78d6` light | Primary action |

### 3.3 Typography, space, radius, elevation

```css
--font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;   /* SHAs, branches, code only */

--text-xs:11px  --text-sm:13px  --text-base:14px  --text-lg:16px
--text-xl:20px  --text-2xl:26px --text-3xl:34px   --text-hero:56px

--space-1:4px … --space-16:64px            /* 4px base scale */
--radius-sm:6px --radius-md:10px --radius-lg:14px --radius-full:9999px

--elev-1: 0 1px 2px rgba(0,0,0,.28);
--elev-2: 0 4px 16px rgba(0,0,0,.32);
--elev-3: 0 12px 40px rgba(0,0,0,.40);
--glow-accent: 0 0 0 1px rgba(57,135,229,.35), 0 0 24px rgba(57,135,229,.18);
```

Base body text is 14px rather than 16px: this is a dense analytical interface (§49) where a
table row and a metric label sit close together. Long-form marketing copy uses `--text-lg`.

Glass surfaces (`backdrop-filter: blur(12px)` over `--surface-2` at 72% opacity) appear on
exactly three elements — command palette, notification drawer, chart tooltip. A backdrop filter
on a scrolling data table is a repaint cost with no readability gain.

### 3.4 Theming mechanism

```css
:root { /* light values — the complete palette */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark values */ }
}
:root[data-theme="dark"] { /* dark values */ }
```

Three scopes, because the theme has three states: explicit light, explicit dark, and "follow the
OS". A single `data-theme` attribute cannot express the third; a media query alone cannot
express the first two.

---

## 4. Charts

Charts are the product's primary output, so their rules are stricter than the rest of the UI's.
ECharts is the renderer, and every chart is wrapped in a `<Chart>` component that applies the
tokens below — no chart configures its own colors.

### 4.1 Categorical palette

Eight slots, assigned **in fixed order and never cycled**. Color follows the entity, so
filtering a series out never repaints the survivors.

| Slot | Hue | Dark | Light |
|---|---|---|---|
| 1 | blue | `#3987e5` | `#2a78d6` |
| 2 | orange | `#d95926` | `#eb6834` |
| 3 | aqua | `#199e70` | `#1baf7a` |
| 4 | yellow | `#c98500` | `#eda100` |
| 5 | magenta | `#d55181` | `#e87ba4` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#9085e9` | `#4a3aa7` |
| 8 | red | `#e66767` | `#e34948` |

Validated against DevIntel's own surfaces (`#101215` dark, `#fbfbfc` light) rather than assumed:

```text
dark   PASS  lightness band · chroma floor · CVD separation (worst adjacent ΔE 8.4)
             normal-vision floor (19.3) · contrast ≥3:1 on all eight
light  PASS  lightness band · chroma floor · CVD separation (9.1) · normal-vision (19.6)
       WARN  contrast <3:1 — aqua 2.72, yellow 2.09, magenta 2.60
```

The light-mode warning is not dismissed: those three slots ship with **visible direct labels or
the table view**, so their identity never rests on the fill alone. This is exactly why the
palette is checked with a script instead of by eye — the defect it catches is invisible to a
full-color reader looking at the finished chart.

A ninth series never receives a generated color. It folds into "Other", or the chart becomes
small multiples.

### 4.2 Scales that are not categorical

- **Sequential** (contribution heatmap, magnitude): one hue, light→dark, blue ramp
  `#cde2fb → #0d366b`. Never a rainbow.
- **Diverging** (period-over-period change): blue ↔ red with a **neutral gray** midpoint
  (`#383835` dark / `#f0efec` light) — two warm/cool poles so the ends read as opposite and the
  middle reads as "no change".
- **Health scores**: the status palette, banded — ≥80 good, 60–79 warning, 40–59 serious,
  <40 critical — always accompanied by the numeral and a label, never color alone.

### 4.3 Chart conventions

| Rule | Reason |
|---|---|
| **Never a dual y-axis** | Two scales invent a correlation the data does not contain. Two measures → two charts, small multiples, or both indexed to 100 at t₀ |
| Thin marks | 2px lines, ≥8px markers, 4px rounded bar ends anchored to the baseline |
| 2px surface gap between fills | Separation without drawing borders around marks |
| Solid hairline grid | `--grid`, one shade off the surface; never dashed — dashing reads as "threshold" |
| Legend for ≥2 series, none for one | The title names a single series; ≤4 series are also direct-labelled |
| Selective direct labels | The endpoint or the extreme, never a number on every point |
| Crosshair + tooltip by default | Every line and area chart; per-mark tooltip on bars, cells, dots |
| Hit targets ≥24px | Including the 2px gap; dense scatter uses a nearest-point layer |
| Table view on every chart | From the card menu — a tooltip is never the only way to read a value |
| Values in text tokens | Labels and legends use `--text-*`, never the series color |
| One filter row above the charts | Never per-chart filters; every chart re-renders against the same slice |
| Refetch holds the previous render | At reduced opacity — no skeleton flash, no layout jump |
| `tabular-nums` in tables and axes only | Proportional figures on hero and stat-tile numbers |

### 4.4 Chart inventory

| Chart | Form | Notes |
|---|---|---|
| KPI cards | Stat tile + delta + sparkline | The number is the chart; no axis |
| Health score | Radial gauge + component bars | Bars are the `components[]` array from [03](03-algorithms.md) |
| Activity timeline | Bar, day buckets | Stacked by activity type, 2px gaps |
| Contribution heatmap | Sequential cells | 7 rows × N weeks, one hue, scale legend |
| Metric trend | Line + crosshair | Trend band; anomaly points ringed 2px in surface |
| PR lifecycle | Horizontal stage bar | Per-PR, durations from the materialized columns |
| Review load | Horizontal bars | A distribution, never a ranking of people (§19) |
| Cycle-time distribution | Histogram + median rule | Median annotated; the mean deliberately absent |
| Collaboration graph | Force-directed network | Nodes = developers, edges = review counts |
| Bus factor | Stacked share bar | Top contributors + "Other", with the HHI band |
| Period comparison | Diverging bars | Component-level Δ — [03 §5.1](03-algorithms.md)'s explanation, made visual |

---

## 5. Component inventory (§52)

```text
components/
├── charts/       Chart · Sparkline · Heatmap · Gauge · NetworkGraph · TableView
├── dashboard/    KpiCard · HealthScore · ActivityTimeline · InsightCard · TrendBadge
├── analytics/    MetricPicker · DimensionPicker · DateRangePicker · FilterBar · CompareView
├── data/         DataTable · Pagination · EmptyState · Skeleton · ErrorState
├── navigation/   Sidebar · MobileNav · Breadcrumbs · WorkspaceSwitcher · CommandPalette
├── overlay/      Modal · Drawer · Tooltip · ContextMenu · Toast · Popover
└── shared/       Avatar · Badge · ScoreBadge · TimeAgo · LanguageBar · UserHoverCard
```

Two components carry more weight than the rest.

**`CommandPalette`** (⌘K / Ctrl+K, §29) is the fastest path to anything: navigation, workspace
switching, entity search, theme toggle, connect provider. It is registry-driven — each feature
registers its own commands — so it never becomes a hand-maintained list that falls behind the
app.

**`DataTable`** is virtualized above 100 rows, with column visibility, multi-sort, sticky
headers, row selection, and a card layout below `md`. It is the only table implementation; a
second one would drift from the first within two sprints.

---

## 6. Data and state

| Kind of state | Owner |
|---|---|
| Server data | TanStack Query — `['workspace', wid, 'analytics', metric, filters]` |
| URL state (filters, range, tab) | `nuqs` — search params, so a view is shareable and restorable |
| Ephemeral UI (drawer, palette) | Zustand |
| Forms | React Hook Form + the Zod schema shared with the API |

Filters live in the URL rather than in a store. A tech lead who finds something worth discussing
must be able to paste a link and have a colleague see the identical chart; that requirement
settles the question by itself.

Query keys begin with the workspace id, so switching workspaces cannot serve another tenant's
cached data. Analytics queries use `staleTime: 60s` with `placeholderData: keepPreviousData`, so
changing a filter dims the existing chart instead of collapsing it into a skeleton.

Live updates arrive over SSE ([02 §10](02-pipeline.md)): sync progress and notifications are
pushed into the Query cache rather than into component state, so every subscriber updates at
once.

---

## 7. Motion

Purposeful only (§51):

| Motion | Duration / easing | Purpose |
|---|---|---|
| Route transitions | 220 ms, `cubic-bezier(.16,1,.3,1)` | Continuity between pages |
| Chart entrance | 400 ms, staggered 30 ms | Draws the eye along the data's direction |
| Number counters | 600 ms, ease-out | KPI values count to their target |
| Hover / press | 120 ms | Immediate feedback |
| Modal / drawer | 200 ms with a scrim fade | Spatial context |

The landing page hero uses GSAP for a scrubbed scroll timeline; the application uses Framer
Motion only. Everything sits behind a `prefers-reduced-motion` guard that collapses durations to
zero — including chart entrance animation, which is the most nausea-inducing element in a data
product.

---

## 8. Responsive

Genuinely responsive, not desktop-first with a shrink (§54).

```text
sm 640   md 768   lg 1024   xl 1280   2xl 1536
```

| Element | Mobile | Tablet | Desktop |
|---|---|---|---|
| Navigation | Bottom bar + drawer | Collapsed icon rail | Full sidebar |
| Dashboard | Single column, stacked | 2 columns | 12-column grid |
| KPI cards | 2-up | 4-up | 4-up with sparklines |
| Charts | Horizontally scrollable, reduced tick density | Full | Full |
| Data tables | Card list | Priority columns | All columns |
| Filters | Bottom sheet | Popover row | Inline row |
| Command palette | Full screen | Centered dialog | Centered dialog |

Charts scroll inside their own `overflow-x: auto` container; the page body never scrolls
horizontally. Chart containers are sized to include the x-axis label band, so the axis is never
cropped into a nested scrollbar.

---

## 9. Internationalization and RTL

`next-intl`, with English and Persian from the start (§66). Retrofitting RTL onto an existing
layout means auditing every component; building with logical properties costs nothing.

- Layout uses **logical properties** exclusively: `margin-inline-start`, `padding-block`,
  `inset-inline-end`. No `left`/`right` in application CSS.
- `<html dir>` follows the active locale.
- Icons that encode direction (chevrons, arrows, trend indicators) mirror under RTL; icons that
  do not (checkmarks, logos, status glyphs) never do.
- Numbers and dates format through `Intl` with the locale's numbering system and calendar, so
  Persian users see Jalali dates wherever a date is rendered as text.
- **Charts do not mirror.** Time flows left to right in both locales: a time axis that reverses
  direction with the UI language is a documented source of misreading. Axis labels and legends
  translate; the plot geometry does not.
- Insight text renders from templates plus typed `evidence` ([02 §8](02-pipeline.md)), so adding
  a locale is a message catalog, not a change to the rules engine.

---

## 10. Accessibility (§55)

Non-negotiable, and mostly decided by structure rather than by later remediation:

- **Semantic HTML** — `<nav>`, `<main>`, `<table>` for tabular data. ARIA supplements structure;
  it does not replace it.
- **Keyboard** — every interactive element reachable and operable; visible focus ring
  (`--accent`, 2px, 2px offset); focus trapped in modals and restored on close; a skip link.
- **Charts** — each carries a text alternative: `role="img"` with a summary `aria-label`, plus
  the table view holding every value. Identity is never color-alone; the legend and direct
  labels do that work.
- **Contrast** — 4.5:1 for body text, 3:1 for large text and UI boundaries, verified in both
  themes. The three light-mode series colors below 3:1 carry the relief treatment from §4.1.
- **Reduced motion** — respected globally, chart animation included.
- **Screen readers** — live regions announce sync progress and toasts; the command palette
  announces result counts as they change.
- **Forced colors** — `forced-colors: active` swaps chart fills to the opt-in texture channel so
  series stay distinguishable without color.

Testing: `axe-core` inside Playwright on every top-level route, plus keyboard-only walkthroughs
of the journeys listed in [06](06-roadmap.md).

---

## 11. Performance

| Target | Approach |
|---|---|
| Dashboard < 2 s | Server shell streams immediately; data hydrates into skeletons |
| Charts | ECharts imported per chart type, never the whole bundle |
| Long lists | Virtualized above 100 rows |
| Images | `next/image`, AVIF/WebP, explicit dimensions to hold layout |
| Fonts | `system-ui` first — no webfont on the critical path; the mono face is subset and preloaded |
| Bundle budget | < 200 KB gzipped for the app shell, enforced in CI |
| Refetch | Previous data held at reduced opacity — no skeleton flash, no layout shift |

Route-level code splitting is automatic; the heavy pieces (ECharts, the force-directed graph,
the report renderer) are dynamically imported so the dashboard's first paint never pays for the
analytics explorer.
