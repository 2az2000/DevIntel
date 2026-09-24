---
name: echarts-charts
description: Building charts with Apache ECharts in this app — the Chart wrapper, tree-shaken imports, option construction from tokens, theming, resize and disposal, tooltips, heatmaps and network graphs, accessibility twins. Use when adding or changing any chart. For the visual rules themselves, use ui-surface.
---

# ECharts

`/ui-surface` defines *what a chart must look like and encode*. This covers *how to build it*
without leaking memory, bloating the bundle, or breaking theme switching.

## Never call ECharts directly in a feature component

All charts go through one wrapper, which owns instance lifecycle, theme, resize and disposal:

```tsx
<Chart option={option} height={280} ariaLabel="Median PR cycle time, last 90 days" tableView={rows} />
```

If you are writing `echarts.init` outside `components/charts/Chart.tsx`, stop — that is where
the resize observer and disposal live, and duplicating it is how charts leak.

## Tree-shaken imports only

```ts
import * as echarts from 'echarts/core';
import { LineChart, BarChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, HeatmapChart, GridComponent, TooltipComponent,
             LegendComponent, DataZoomComponent, CanvasRenderer]);
```

`import * as echarts from 'echarts'` pulls the entire library (~1 MB) and blows the 200 KB shell
budget on its own. Register only what the app renders, in one module.

Canvas renderer by default. SVG only for a chart that must be exported or printed.

## Options are built from tokens, never literals

```ts
const css = getComputedStyle(document.documentElement);
const token = (n: string) => css.getPropertyValue(n).trim();

const base = {
  backgroundColor: 'transparent',            // the card paints the surface
  textStyle: { fontFamily: 'var(--font-sans)', color: token('--text-secondary') },
  grid: { left: 8, right: 8, top: 24, bottom: 24, containLabel: true },
  xAxis: {
    axisLine:  { lineStyle: { color: token('--axis') } },
    axisTick:  { show: false },
    splitLine: { show: false },
    axisLabel: { color: token('--text-muted'), fontSize: 11 },
  },
  yAxis: {
    axisLine:  { show: false },
    splitLine: { lineStyle: { color: token('--grid'), type: 'solid' } },   // never dashed
    axisLabel: { color: token('--text-muted'), fontSize: 11 },
  },
};
```

**Series colors come from the palette module in fixed slot order** — a chart never picks a
colour, and a filtered-out series never causes the survivors to be repainted.

## Theme switching

Tokens are CSS variables, and ECharts reads their computed values once at option build time. The
wrapper must therefore rebuild the option when the theme changes:

```ts
useEffect(() => {
  const mo = new MutationObserver(rebuild);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', rebuild);
  return () => { mo.disconnect(); mq.removeEventListener('change', rebuild); };
}, []);
```

Both listeners are needed: the attribute covers the explicit toggle, the media query covers the
"follow the OS" state where no attribute is stamped.

## Lifecycle

```ts
useEffect(() => {
  const chart = echarts.init(ref.current!, undefined, { renderer: 'canvas' });
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(ref.current!);
  return () => { ro.disconnect(); chart.dispose(); };     // dispose is mandatory
}, []);

useEffect(() => { chart?.setOption(option, { notMerge: false, lazyUpdate: true }); }, [option]);
```

- **`dispose()` on unmount.** Without it, every navigation leaks a canvas and its data.
- **`ResizeObserver`, not a window listener** — the sidebar collapsing changes the container
  without a window resize event.
- **`notMerge: false`** for data updates so transitions animate; `true` when the option's
  *structure* changes (different series count), or stale series linger.
- Memoize the option object; a new object identity on every render re-renders the chart.

## Server rendering

ECharts touches the DOM at import. Every chart is `dynamic(..., { ssr: false })` with a skeleton
whose dimensions match the final chart.

## Tooltips

```ts
tooltip: {
  trigger: 'axis',
  axisPointer: { type: 'line', lineStyle: { color: token('--axis') } },
  backgroundColor: token('--surface-2'),
  borderColor: token('--border'),
  textStyle: { color: token('--text-primary'), fontSize: 12 },
  formatter: (params) => renderTooltip(params),   // return a string, escape all values
}
```

Never interpolate provider-supplied strings (branch names, PR titles) into tooltip HTML without
escaping. And a tooltip is never the only way to read a value — the table view is the twin.

## Specific chart types

- **Heatmap** — `visualMap` with the single-hue sequential ramp, `type: 'piecewise'` for a
  legible legend. Cell gap 2px via `itemStyle.borderColor` set to the surface token.
- **Network graph** — `series.type: 'graph'`, `layout: 'force'`. Cap nodes; above ~200 the force
  layout stops converging in reasonable time. Fix positions after first stabilization
  (`layout: 'none'` with stored coordinates) so it does not re-scramble on every render.
- **Large series** — `sampling: 'lttb'` above ~2000 points, and `large: true` on scatter.
- **DataZoom** — only on the analytics explorer, never on dashboard cards.

## Accessibility

`role="img"` plus a summarizing `aria-label` on the container, and the table view reachable from
the card menu. Under `prefers-reduced-motion`, set `animation: false`.

## Before finishing

- [ ] Rendered through `<Chart>`, not a bare `echarts.init`
- [ ] Tree-shaken imports; nothing new added to the global registration without reason
- [ ] Colors from tokens and the fixed palette order
- [ ] Rebuilds on both theme signals
- [ ] `dispose()` and `ResizeObserver` cleanup present
- [ ] Option memoized
- [ ] `ssr: false` with a matching skeleton
- [ ] `aria-label` and table view present
