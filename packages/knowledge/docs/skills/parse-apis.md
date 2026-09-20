# Choosing the right parse API (and mapping frames → sources)

> **Source of truth:** [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl/src/parse/m0StringParser.ts).
> All four parse exports re-exported from `@m0saic/dsl`. (A fifth,
> `parseM0StringToFullGraphWithTraversal`, was removed in the public-API prune —
> use `parseM0StringComplete` with `opts.trace`.)

## The canonical entry point: `parseM0StringComplete`

`parseM0StringComplete(input, width, height, opts?)` returns (on success):

- `ok: true`
- `ir.renderFrames` — RenderFrame[] in **paint order**
- `ir.editorFrames` — EditorFrame[] (full structural graph, always present)
- `ir.traversal` — optional DFS event stream if `opts.trace`
- `precision`, `resolutionDiagnostics`, `warnings`

Frames are one level deep under **`ir`**, not top-level. On failure:
`{ ok: false, error, precision, warnings }`. Other options:
`opts.materialize: "renderOnly"` (the cheap mode `parseM0StringToLogicalFrames`
rides on) and `opts.precisionNorm` (default 100; gates `PRECISION_EXCEEDS_NORM`
warnings). Prefer Complete for tooling, editor logic, anything non-trivial.

## The three cheaper tiers

| Tier | API | Returns | Use for |
|---|---|---|---|
| 1 | `parseM0StringToLogicalFrames(s, w, h)` | rendered leaves only, **logical order**; each has `rect`, `logicalIndex` (array index === logicalIndex), `meta` | template tile mapping — `cell-<logicalIndex>`, labels indexing, "Nth tile" logic |
| 2 | `parseM0StringToRenderFrames(s, w, h)` | renderable frames in **paint order**; each has `rect`, `paintOrder`, `logicalIndex` | engine paint plan / ffmpeg stacking |
| 3 | `parseM0StringToFullGraph(s, w, h)` | EVERYTHING as EditorFrame[] — roots, groups, leaves, passthroughs, nulls, overlay subtrees | editor UIs, structural analysis |

Key invariant (Tier 2): `paintOrder` is the compositing order; `logicalIndex` is
the logical tile index. There is **no `sourceIndex` field** — build sources by
`logicalIndex`, paint by `paintOrder`.

Common mistakes the wrong tier causes: confusing paint order with logical order,
attaching sources to the wrong index, losing overlays/group nodes in a UI.

## Identity on every frame

All frame views carry `meta` identity: deterministic StableKey, structuralDepth,
overlayDepth (separate axes; overlay keys live in the `/ov{depth}c{k}` namespace and
never shift structural keys). The full contract: [`identity.md`](identity.md).

## Frames → sources → children (the template bridge)

The standard pattern for turning geometry into a `MosaicDocument`:

1. Parse the layout — `parseM0StringToLogicalFrames` for leaf mapping. The public
   frames APIs already exclude null-render nodes (the parser filters
   `nullRender` internally — you do NOT hand-filter holes/containers).
2. For each frame: create a child renderable (often
   `renderNestedTemplate(cellTemplateId, props, ctx)` —
   https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/render/renderNestedTemplate.ts#L35), attach it under
   `children[id]`, push a `sources[]` entry referencing it.
3. Return `{ m0: <same layout>, config.sources, children }` (the document's layout
   field is `m0` — https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/document/document.ts#L132).

Rules that keep the bridge deterministic:

- **Child IDs come from `frame.logicalIndex`** (e.g. `cell-${logicalIndex}`) — or
  `frame.stableKey` when identity must survive structural edits. Never bare loop
  order. ([`identity.md`](identity.md) owns the when-to-use-which.)
- **Size and time from `ctx.target`, never `ctx.output`** — `ctx.output` is
  format/codec/alpha only ([`../templates/rendering-model-contract.md`](../templates/rendering-model-contract.md) Rule 5b).
- **Internal cell templates** (`internal: true`, id `…/cell/v1`) are the reusable
  building block for per-tile content — wireframe-style label/debug tiles are the
  canonical example.
- Props schemas: use `definePropsSchema` with typed defaults. (There is no
  `constraints.isM0saicLayout` — an older revision of this guidance invented it;
  the real constraint set is `MosaicPropConstraints`,
  https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts#L108-146`.)

## Quick decision table

- Engine paint plan / ffmpeg stacking → `parseM0StringToRenderFrames`
- Template tile mapping / "Nth tile" logic → `parseM0StringToLogicalFrames`
- Full structural tree / editor UI → `parseM0StringToFullGraph`
- Traversal events, or anything multi-view → `parseM0StringComplete` (+ `opts.trace`)
