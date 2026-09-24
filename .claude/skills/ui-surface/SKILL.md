---
name: ui-surface
description: Build or change a page, component or chart in src/app. Use for any frontend work — dashboard surfaces, data tables, charts, filters, forms, navigation. Enforces design tokens, the chart rules including the validated palette, URL-based filter state, RTL logical properties and accessibility.
---

# UI surface

Reference: [docs/05-frontend.md](../../../docs/05-frontend.md).

## Before writing a component

1. Does it already exist in `components/`? A second `DataTable` will drift from the first
   within two sprints.
2. Which route group — `(marketing)` SSG, `(auth)` SSR, or `(app)` client-rendered?
3. What state does it own? Server data → TanStack Query. Filters and range → **URL**. Ephemeral
   UI → Zustand.

## Non-negotiables

**No raw hex.** Every color is a token. Tokens are named for their **role**, never their hue —
`--status-warning`, not `--yellow`.

**No `left` / `right` in CSS.** Logical properties only: `margin-inline-start`, `padding-block`,
`inset-inline-end`. The app is RTL-capable from day one and retrofitting means auditing
everything.

**Filters live in the URL** via `nuqs`. A tech lead must be able to paste a link and have a
colleague see the identical chart. That requirement settles the question alone.

**Query keys start with the workspace id**, so switching workspaces cannot serve another
tenant's cached data.

**Theme has three states**, not two: explicit light, explicit dark, and follow-the-OS. Define
the full palette on bare `:root`, redefine tokens under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`, and again under
`:root[data-theme="dark"]`. Never give a color its only definition inside a media block.

## Charts

Always wrapped in `<Chart>`; it applies tokens. Individual charts never set colors.

| Rule | Why |
|---|---|
| **Never a dual y-axis** | Two scales invent a correlation the data does not contain. Two measures → two charts, or index both to 100 at t₀ |
| Categorical slots in **fixed order, never cycled** | Color follows the entity; filtering must not repaint the survivors |
| A 9th series folds into "Other" | A generated hue is indistinguishable under CVD |
| Sequential = one hue light→dark | Never a rainbow |
| Diverging = two warm/cool poles + **neutral gray** midpoint | The midpoint must read as "nothing" |
| Status colors are reserved | Never reused as a series color; always with an icon + label |
| Legend for ≥2 series, none for one | The title names a single series |
| Selective direct labels | Never a number on every point |
| Thin marks, solid hairline grid | Dashed gridlines read as "threshold" |
| 2px surface gap between fills | Not borders drawn around marks |
| Crosshair + tooltip by default | A tooltip is never the *only* way to read a value |
| Table view on every chart | The WCAG-clean twin |
| Refetch holds the previous render at reduced opacity | A skeleton flash causes layout jump |
| One filter row above the charts | Never per-chart filters |

The palette in docs/05-frontend.md §4.1 is validated against DevIntel's surfaces. **If you change
any series color, re-run the validator** — do not judge colorblind-safety by eye. Three
light-mode slots sit below 3:1 contrast and must ship with visible direct labels or the table
view.

## Responsive

Genuinely responsive, not desktop-first with a shrink. Navigation becomes a bottom bar on
mobile; tables become card lists; charts scroll inside their own `overflow-x: auto` container
and the page body never scrolls sideways. Size chart containers to include the x-axis label band
— otherwise the axis is cropped into a nested scrollbar.

## Accessibility

- Semantic HTML first; ARIA supplements structure, never replaces it
- Visible focus ring, focus trapped in modals and restored on close, skip link
- Charts get `role="img"` with a summary label **plus** the table view
- Identity never color-alone — legend and direct labels carry it
- `prefers-reduced-motion` collapses every duration, chart entrance included
- Contrast 4.5:1 body, 3:1 large text and UI boundaries, verified in both themes

## Motion

Purposeful only: route transitions 220 ms, chart entrance 400 ms staggered, counters 600 ms,
hover 120 ms. Framer Motion in the app; GSAP only for the landing hero.

## Done when

- [ ] No raw hex, no `left`/`right`
- [ ] Filters in the URL, query key workspace-scoped
- [ ] Both themes checked; no color defined only inside a media block
- [ ] Chart rules held — especially: no dual axis, fixed slot order, table view present
- [ ] Keyboard walkthrough passes; `axe-core` clean
- [ ] Mobile, tablet and desktop layouts verified
