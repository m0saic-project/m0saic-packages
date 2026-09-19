# @m0saic/dsl-react

The **Layout → React** bridge. Take an m0 DSL layout (the same string a
`.m0c` carries) and render its labeled regions as absolutely-positioned React
boxes — so a layout you designed in Mosaic becomes the structure of a web page.

Depends only on [`@m0saic/dsl`](../dsl) (parsing) and React (peer). No engine
dependency.

## Why

m0 is a deterministic spatial-layout language. A `.m0c` pairs an m0 string
with **labels** keyed by `stableKey`. This package joins the two: parse the m0
at a canvas size, resolve each label to its rendered rect, and expose the
result as named regions you address by label text. The layout stays the single
source of truth — re-design in the sandbox, swap the `.m0c`, the page follows.

## Usage

```tsx
import { LayoutRegions, LayoutRegion } from "@m0saic/dsl-react";

<LayoutRegions m0={layout.m0} canvasW={1920} canvasH={1080} labels={layout.labels} scale={vw / 1920}>
  <LayoutRegion name="header"><h1>MOSAIC WORKER 01</h1></LayoutRegion>
  <LayoutRegion name="renderHero"><Grid /></LayoutRegion>
  <LayoutRegion name="ffmpeg"><FfmpegLine /></LayoutRegion>
</LayoutRegions>
```

Region names are the label `text` values from the `.m0c`. A `<LayoutRegion>`
whose name isn't in the layout renders nothing (and warns in dev).

## API

- `useLayoutRegions(m0, canvasW, canvasH, labels) → Map<regionName, LayoutRect>`
  — memoized hook resolving the layout to `{ x, y, width, height }` per region.
- `computeLayoutRegions(...)` — the pure, non-React core (codegen / tests / SSR).
- `<LayoutRegions>` — stage that resolves the layout and provides regions to
  descendants; renders a `position: relative` box, optionally `scale`d.
- `<LayoutRegion name>` — absolutely-positioned box at the named region's rect.

Types: `LayoutRect`, `LayoutLabelMap`, `LayoutRegionMap`, `LayoutRegionsProps`,
`LayoutRegionProps`.
