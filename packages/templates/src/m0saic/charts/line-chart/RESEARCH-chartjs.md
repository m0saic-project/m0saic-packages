# Research note — the canonical OSS line chart (Chart.js) → m0saic

**Studied:** `chart.js@4.5.1` (MIT), installed from npm and read locally (`dist/chart.js`, `dist/chunks/helpers.dataset.js`). Chart.js is the daily-driver line chart for most of the web, so its defaults *are* the canonical baseline. We do **not** depend on it at runtime — we reimplement the (small) math it standardized and render through m0saic's own pipeline.

## The canonical minimal line chart

```js
new Chart(ctx, {
  type: 'line',
  data: { labels: ['Jan',…], datasets: [{ label: 'Renders', data: [1200,…] }] },
  options: { scales: { y: { beginAtZero: true } } },
});
```

Everything visible in the default render comes from a few structural pieces:

| Piece | Chart.js default | m0saic translation |
|---|---|---|
| **x model** | `data.labels` → **category scale**, points evenly spaced; for `line`, `offset:false` puts first/last on the plot edges | `categoryCenters(n, left, right, offset=false)` |
| **y model** | `datasets[].data` → **linear scale**, `beginAtZero` | `linearScale(min, max, { beginAtZero:true })` |
| **ticks** | `generateTicks` + `niceNum` (Heckbert), capped by `maxTicksLimit` (11) | `linearScale().ticks` — identical algorithm |
| **value→pixel** | `Scale.getPixelForValue` (linear interpolation) | `project(v, min, max, pxStart, pxEnd)` |
| **line** | straight segments (`tension:0` default), `borderWidth:2` | `linePathD(points)` stroked |
| **points** | filled circles, `radius:3` | `pointsPathD(points, r)` filled |
| **grid** | light lines at each tick (`#e5e7eb`-ish) | grid lines at tick/category pixels |
| **legend/title/subtitle** | `plugins.{legend,title,subtitle}` | rendered text layers |

## The only real math (and it's tiny)

**1. `niceNum(range)`** — round a range up to 1/2/5/10 × 10^k (Heckbert "nice numbers", Graphics Gems 1990). Verbatim from Chart.js:
```js
const niceRange = 10 ** Math.floor(Math.log10(range));
const f = range / niceRange;
return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * niceRange;
```

**2. `generateTicks` (bounds:"ticks")** — `spacing = niceNum(range / (maxTicks-1))`; if the snapped domain needs more spaces than allowed, re-nice once; then `min = floor(rmin/spacing)*spacing`, `max = ceil(rmax/spacing)*spacing`.

**3. Linear projection** — `pixel = pxStart + (v-min)/(max-min) * (pxEnd-pxStart)`. For y, pass `pxStart=bottom, pxEnd=top`.

**4. Category x** — evenly spaced across the plot; line charts use `offset:false` so endpoints touch the edges.

That's the entire structural contract. Tooltips/hover/animation are interaction concerns with no bearing on a static render.

## Verification against the live library

Rendered the canonical chart with `chartjs-node-canvas` on the mocked m0saic data (renders 1200→9800) and logged Chart.js's own scale internals:

- Y ticks `[0,1000,…,10000]` (step 1000, 11 ticks) — **our `linearScale(0,9800)` reproduces this exactly.**
- Category x pixels `[67,306,546,785,1025,1264]` across `left=67,right=1264` — **`categoryCenters(6,67,1264)` reproduces this exactly.**
- y pixels for `min/max` = `676/122` — **`project` reproduces this.**

These equalities are locked in as unit tests: `packages/dsl-stdlib/src/builders/scale.test.ts`.

## Where it lives in m0saic

- **`@m0saic/dsl-stdlib` → `builders/scale.ts`**: `niceNum`, `linearScale`, `project`, `categoryCenters`, `formatTick`. General, zero-dep, ecosystem-wide (charts, timelines, gauges, sparklines). Indexed in `packages/dsl-stdlib/the internal method-catalog notes.
- **`charts/_shared/line.ts`**: chart-specific model (`buildLineChartModel`) + canonical SVG renderer (`renderLineChartSvg`) — reimports the scale math, never forks it.
- **Render path**: the SVG is rasterized by the repo's own `sharp` (the same rasterizer the engine uses for masks) → real PNG.

**Bottom line:** a line chart is `nice ticks + linear projection + a polyline`. The accepted MIT solution is ~15 lines of math; we put those 15 lines in the std lib and let the whole graph base share them.
