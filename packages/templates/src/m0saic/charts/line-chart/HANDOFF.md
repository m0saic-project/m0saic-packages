# Line Chart primitive — build handoff

> **You (the next Claude) build this template live inside Mosaic Desktop.** This doc is your single source of truth. Work the sandbox loop, then implement the template. The session is being screen-recorded — narrate decisions as you go.

## Goal

Add the **canonical line-chart primitive** to the charts lineup, the sibling of `bar-graph/v1`, `donut/v1`, `stat-card/v1`. It is the base template every dashboard/report composes, so it carries *ample, well-organized* customization: **multi-series data, full axis control, full line/point control, and transparent / solid / image backgrounds**.

**Reference (visual north star):** a blue single-series polyline — straight segments, filled circular markers at each vertex, light gridlines, numeric x (years 1800–2010) and y (0–110000) axes. The seed candidate has it baked into `derive.background` — flip it on in Layout and judge your rects against it.

**Done means:**
- `charts/line-chart/v1/` exists, mirrors bar-graph's structure, `registerTemplate(ChartsLineChart)` fires.
- All knobs in §3 are wired and resolve through defaults.
- Renders end-to-end (`npm run test:cli:slow`) for: single-series, multi-series, and all three background modes (`"none"`/transparent, solid, image).
- Registered in `template-registry.ts` + exported from `charts/index.ts` (which today says *"future: line, sparkline"*).
- A showcase preview rendered and wired into the template's `preview` assets.

---

## 0. Prime directive — NEVER hand-author m0 strings

Build all geometry with **`@m0saic/dsl-stdlib` builders** — `weightedSplit`, `grid`, `strip`, `container`, `placeRect`/`placeRects`, `rectsToM0`, `svgToM0`. m0 operations are function calls: your job is to turn **math + intent → builder call → validated `M0String`**, then round-trip through `isValidM0String` + `parseM0StringToLogicalFrames` to confirm rects.

Read first:
- the internal m0saic-string-generation notes — "prefer library ops over hand-writing strings"; the generation algorithm.
- the internal axis-and-geometry notes — axis/geometry math → DSL.
- the internal line-chart-frame-weightedsplit notes — the exact `weightedSplit` recipe that built this template's frame (copy it).
- For *edits* to an existing candidate ("nudge the plot", "widen the gutter"): the internal english-m0-operations notes (null-out + `placeRect`), not a fresh build.

The frame seed was composed like this (intent → m0, not by hand):
```js
const header   = weightedSplit([2,1],  "col", { claimants: ["1","1"] });   // title | legend
const leftcol  = weightedSplit([11,1], "row", { claimants: ["1","-"] });   // y-gutter / empty corner
const rightcol = weightedSplit([11,1], "row", { claimants: ["1","1"] });   // plot / x-gutter
const body     = weightedSplit([1,9],  "col", { claimants: [String(leftcol), String(rightcol)] });
const m0       = weightedSplit([1,10], "row", { claimants: [String(header), String(body)] });
```

---

## 1. Sandbox loop (do this BEFORE writing template code)

Protocol: `packages/sandbox/agent.md`. Session: **`2026-06-20-line-chart-primitive`** (already seeded with `candidate-001.m0c`).

**One file = one prompt = one response.** Never edit a candidate after the human responds — write the next one. `tools/wireframe.mjs --session <name>` auto-picks the next `candidate-NNN`.

Loop:
1. Read the live candidate's `agent.response.body`. If the human edited geometry, **diff against the `-agent` snapshot** (parse, don't eyeball; labels are the join key) to read corrections.
2. Re-derive the intent with stdlib builders; write the next candidate via `wireframe.mjs` (bake the reference with `--bg` every time — it's the default).
3. `--open-mosaic` to hand back. Iterate in this order:
   - **frame** (title / legend / y-gutter / plot / x-gutter proportions — candidate-001 is here)
   - **plot internals** (gridlines, axis lines, tick positions)
   - **line + points** (the actual data path — prototype the stroke approach here, see §5)
4. **Closeout** (only when the human approves a master): `master-candidate01.m0c` (live labels, baked render, intent `ship`) → ask to compact → render showcase preview with `--save-mosaic --save-plan --save-commands` → generate `master.mosaicx` → copy preview into template `preview/` → write `postmortem.mosaicx` (don't render it).

---

## 2. File structure — mirror `bar-graph/v1` one-for-one

```
charts/line-chart/
├── HANDOFF.md              ← this file
└── v1/
    ├── index.ts            ← side-effect import internals; export ChartsLineChart + LineChartProps
    ├── line-chart.ts       ← public MosaicTemplate + render()
    ├── types.ts            ← LineChartProps (public unions) + resolved internal types + AxisConfig
    ├── defaults.ts         ← DEFAULT_* + PRESET tokens + resolvers (px→fraction, union→resolved)
    ├── axis.ts             ← resolveAxisConfig() (x/y dock, grid direction)
    ├── format.ts           ← value-label formatting; axis math comes from @m0saic/dsl-stdlib (linearScale)
    ├── anim.ts             ← timing math (pure JS); FFmpeg exprs live only in the leaf
    └── internal/
        ├── chart-frame.ts  ← card surface: bg preset / solid / image + border + inset plot
        ├── plot-area.ts    ← grid + x/y axis lines + the line-series stack
        ├── line-series.ts  ← one series: path + area + points
        ├── line-path.ts    ← LEAF: stroked polyline + draw-on FFmpeg reveal expr
        └── labels.ts       ← title / subtitle / axis tick labels / legend
```

**Copy-from-bar-graph map** (read each, change as noted):
| Copy | From | Change |
|---|---|---|
| template object shape, schema, render() flow | `bar-graph/v1/bar-graph.ts` | swap bars-stack → line-series; add multi-series fan-out |
| public-union → resolved-internal types | `bar-graph/v1/types.ts` | add line/point/area configs; `values: number[] \| number[][]` |
| preset tokens + resolvers | `bar-graph/v1/defaults.ts` + `internal/chart-frame.ts` `tokensForPreset` | add `line`/`grid`/`point` token defaults per preset; add solid + image bg paths |
| grid + axis-as-lavfi-strips + grid primitive | `bar-graph/v1/internal/plot-area.ts` | keep grid primitive `@m0saic/primitives/grid/v1`; add BOTH x & y axis lines (`baselineSourceForEdge` pattern) |
| scale/tick/projection math | **`@m0saic/dsl-stdlib`** `{ niceNum, linearScale, project, categoryCenters, formatTick }` (lands via `charts/_shared/scale.ts`) | **already built + tested** (`dsl-stdlib/.../scale.test.ts`) — import, don't re-derive |
| line model + canonical SVG | **`charts/_shared/line.ts`** `{ buildLineChartModel, renderLineChartSvg, linePathD, pointsPathD }` | already built; reuse for the data→geometry core |
| anim timing + leaf-only FFmpeg expr | `bar-graph/v1/anim.ts` + `internal/bar-fill.ts` | reveal = left→right wipe instead of bottom-up fill |
| SVG path → masked color tile (stroke + markers) | `donut/v1/geometry.ts` + `donut.ts` (`makeColorTile`, `inline-mask` `localPath`); marker mask example: `stat-card/v1` `triangleSource` | build polyline + marker paths |

Helpers: `definePropsSchema`, `registerTemplate`, `renderNestedTemplate`, `makeColorTile`, `fadeInExpr`, `makeErrorMosaic`, `transparentSlot` from `@m0saic/template-utils`; `toM0String`, `buildOverlayStack`, `weightedSplit`, `rectsToM0`, `roundedRectMask`/`circleMask` from `@m0saic/dsl-stdlib`.

---

## 3. `LineChartProps` — the customization surface

Public boundary is permissive (unions, single-or-array); internals receive fully-resolved values (resolve in `line-chart.ts`/`defaults.ts`). Group config objects mirror bar-graph's `grid`/`baseline`/`valueLabels` pattern with `meta.ui.{label,section,order,collapsedByDefault}`, `meta.control.{colorPicker,placeholder,flavor:"slider",step}`, `meta.constraints.{min,max,oneOf,isColor,minItems}`.

**Data / domain**
- `values: number[] | number[][]` — one or many series (**multi-series core**)
- `seriesLabels?: string[]` — legend names (index-aligned)
- `labels?: string[]` — categorical x tick labels
- `xValues?: number[]` — numeric x (e.g. reference's years) for non-categorical spacing
- `minValue?/maxValue?` (y), `minX?/maxX?` (x) — else `linearScale()` derives

**Background (transparent / solid / image — explicit requirement)**
- `preset?: "neutral"|"dark"|"terminal"|"glass"|"paper"` — drives card/grid/axis/line default tokens
- `backgroundColor?: MosaicColor | "none"` — solid override; `"none"` ⇒ transparent (composition under card-chrome)
- `backgroundImage?: string` — image bg (asset ref / data-URI); layer an image source under the plot in `chart-frame`
- card `cornerRadius`, `border:{color,alpha}`, `padding` (number | per-side)

**Axis — `xAxis` / `yAxis` config groups (full control, each):**
- `show` (axis line), `color`, `thickness`
- `showLabels`, label `color`, `fontSize`, `format:"raw"|"compact"|"percent"`, `decimals`, `prefix/suffix`
- `tickCount`, `showTicks` (marks), tick `length`/`color`, x-label `rotation`
- gridlines: `showGrid`, `count`, `color`, `opacity`, `dash`

**Line (single value OR per-series array)**
- `lineColor: MosaicColor | MosaicColor[]`
- `strokeWidth: number | number[]`
- `lineStyle: "solid"|"dashed"|"dotted"`, `curve: "linear"|"smooth"|"stepped"` (reference = `linear`)
- `lineCap/lineJoin`
- `area?: { show, color|gradient, opacity }` — fill under line

**Points / markers** (reference shows filled circles at vertices)
- `showPoints`, `pointRadius`, `pointColor?` (default = line color), `pointShape:"circle"|"square"|"diamond"`, `pointBorder:{color,width}`, `highlightIndex?` / highlight-last

**Title / legend / value labels**
- `title?`, `subtitle?` + color/size/align
- `legend: { show, position, color, fontSize }`
- optional per-point `valueLabels` (reuse bar-graph value-label pattern)

**Animation** (mirror `anim.ts` / `DEFAULT_ANIM`)
- `anim.intro`: line **draw-on reveal** (left→right wipe), `durationSec`, `delaySec`, per-series `staggerSec`, `ease`; points fade in after their x is revealed
- `reduceMotion`

---

## 4. render() flow (follow bar-graph)
1. Validate `values` non-empty → else `makeErrorMosaic(...)`.
2. Normalize `values` to `number[][]` (wrap single series). Resolve preset, bg mode, padding (px→fraction of `ctx.target`), per-series line/point configs, anim.
3. Domain: `linearScale(dataMin,dataMax,{beginAtZero,maxTicks})` (from `@m0saic/dsl-stdlib`, already used by `charts/_shared/line.ts`) for y; project points with `project()` / `categoryCenters()`.
4. Render children via `renderNestedTemplate(...)`: one `line-series` per series → `plot-area` (grid + axes + series stack) → `labels` → `chart-frame` (bg + inset). Store in `children`, reference by `{ type:"mosaic", ref }`.
5. Return `{ kind:"mosaic_document", version:1, assets:{}, m0: toM0String(...), children, sources:[{type:"mosaic",ref:"chart-frame"}] }`. `backgroundColor` = resolved canvas/solid/none.

---

## 5. Rendering open questions — prototype these in the sandbox
- **Stroking the polyline — ANSWERED:** the engine's SVG masks (`packages/core/src/core/rasterizeMaskPng.ts`, via `sharp`) are **fill-only; strokes are ignored.** So the line must be a **filled ribbon polygon** (offset the polyline both sides) or — simplest and already working — rendered as a single full-chart **SVG image rasterized by `sharp`**, exactly what `charts/_shared/line.ts` `renderLineChartSvg` does (see the canonical render below). Points = filled circles (`pointsPathD`). Background research: `./RESEARCH-chartjs.md`.
- **Draw-on animation:** reuse the bar-fill technique — render the full line, animate a left→right reveal via an overlay crop/alpha expression keyed on `t`. Leaf (`line-path.ts`) owns the FFmpeg expr; timing math stays in `anim.ts`.
- **Multi-series:** N `line-series` children overlaid in the plot; per-series color/width/stagger; legend swatches from `seriesLabels` + resolved colors.
- **Points:** each marker = a small masked color tile (`circleMask`/`roundedRectMask`/diamond path) at the vertex pixel, faded in after its x reveals.
- **Backgrounds:** `chart-frame` composes — image source (if `backgroundImage`) under a card-surface lavfi (solid `backgroundColor` or preset `card`), or a `transparentSlot()` when `"none"`.

---

## 6. Registration & verification
- Add `export * from "./line-chart/v1";` to `packages/templates/src/m0saic/charts/index.ts` (replace the "future: line" comment).
- Add an entry to `packages/templates/src/template-registry.ts`: `{ slug:"line-chart", templateId:"@m0saic/charts/line-chart/v1", exportName:"ChartsLineChart", title:"Line Chart", description:"…", tags:["charts","line-chart","data-viz"] }`.
- Add a minimal deterministic variant to `packages/cli/src/e2eTemplateVariants.ts`.
- Run: `npm run build:templates` (compiles + regenerates `template-manifest.json`) · `npm run test:templates` (add `line-chart.test.ts`: props validation, domain math, determinism) · `npm run test:cli:slow` (renders end-to-end).
- Visual check: render the reference's year/value series; confirm it reads like the north-star image; confirm transparent (`backgroundColor:"none"`), solid, and image backgrounds all render.

---

## 7. Seed candidate
- `packages/sandbox/sessions/2026-06-20-line-chart-primitive/candidate-001.m0c` — frame geometry (title / legend / y-axis-gutter / plot-area / x-axis-gutter) with the reference image baked in `derive.background`. Open it (`m0saic open <path>`), read the question, iterate from there.
