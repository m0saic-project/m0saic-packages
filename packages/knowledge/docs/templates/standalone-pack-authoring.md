# Standalone data-viz pack authoring — the sandbox playbook

A *pack* (`@<publisher>/<pack>/<slug>/vN`) is a cohesive set of **standalone**
templates sharing one brand look. Do **not** compose the generic `@m0saic/charts/*`
primitives — **reuse their pure geometry MATH** and build your own chrome on a small
shared kit. Canonical reference: `@m0saic/alpine/*` (bar-graph · commit-feed ·
contributor-table · donut · heatmap · kpi-card · leaderboard · line-chart ·
progress-card · stat-card · timeline · treemap), a **12-template** pack (as of
2026-07-27 — `ls` the folder) built end-to-end via the sandbox protocol. Pairs with
https://github.com/m0saic-project/m0saic-sandbox/blob/main/packages/sandbox/agent.md and this folder's `construction-strategy.md` + `reference/`.

## 0. Constraints first — the authoring loop (founder direction, 2026-09-05)

"Template design should move towards: you start by defining your constraints and
general direction, then build layout and check against various canvases and prop
combinations in a loop. The layout contract allows you to drive towards a
solution. And the build-time check throws before you even have a chance to open
Mosaic Desktop or invoke the CLI."

1. **Declare the contract before the layout.** Write the props schema with its
   defaults (every optional boolean / closed-set knob has a `defaultProps` value,
   every plain string/number a default or a placeholder — §3 "Defaults are the
   contract"), tag the pieces that carry design intent, and declare their
   `LayoutConstraint`s + `textFits` under `debugLayout` — canvas-independent
   ratios, not pixels. State the general direction (the aspect it is designed for,
   how it degrades) in the description.
2. **Build the layout against those constraints.** Real geometry first
   ([`construction-strategy.md`](construction-strategy.md)); fit text under the
   same ruler the contract checks with ([`layout-contract.md`](layout-contract.md)
   §"Text").
3. **Loop: check, don't eyeball.** `assertLayout` at the 7-canvas set
   (1920×1080 · 1280×720 · 1080×1920 · 1080×1080 · 3840×2160 · 640×360 · 480×270)
   × the prop combinations that change geometry (long titles, max items, every
   closed-set value) in the gate test; `auditDefaultProps(T)` empty. A violation is
   a design decision to make (shrink, compact wording, drop), not noise — the
   contract drives toward the solution. Exemplar:
   https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/dsl-tutorial/v1/dsl-tutorial.gate33.test.ts.
4. **The build is the first gate.** `npm run build` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates (and
   in the community pack and both starter repos) ends by loading the built
   registry first-party (`tools/check-registry.mjs`): a template that hides a
   default throws — naming the knobs and the fix — and the build fails before the
   template can load in Mosaic Desktop or the CLI. Only then does the sandbox loop
   (candidate → human verdict, §4) begin.

The layout contract stays debug-only at render time (2026-08-22 ruling — a render
with slightly clipped text beats no render); the gate test and the build step are
where it bites during authoring.

## 1. Stand up the seam first (once per pack)

Three `_shared/` files (verified 2026-07-27 in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/alpine/_shared):

- `<pack>-theme.ts` — tokens (surface/card/border, title/subtitle/label/muted,
  primary/positive/negative, grid/axis), a categorical `PALETTE`,
  `PRESETS{light,dark}`, a `theme(preset)` resolver. **Dark is not an afterthought:**
  every color, wash, and contrast must be retuned for it (leaderboard `MEDALS_DARK`,
  heatmap `EMPTY_DARK`) — a wash tuned for white glares or vanishes on navy.
- `<pack>-card.ts` — the Node combinator kit lifted from `charts/bar-graph/v2` (the
  canonical tight-rect template): `paint` / `EMPTY` / `rowSplit` / `colSplit` /
  `overlay` / `insetNode` / `textCell`, plus `resolveColor`, and a
  `card({theme, W, H, title, subtitle})` returning `{contentRect, compose(content,
  ...extraLayers), backgroundColor}`. Every template wraps its body in this card.
- `<pack>-anim.ts` — shared reveal choreography + prop-schema field factories:
  `revealGate` / `revealSlide` / `revealFade` (source and Node flavors), the `fBool`
  / `fStr` / `fNum` / `fFrac` / `fEnum` schema-field helpers, and the shared
  `ALPINE_ANIM_FIELDS` block every template spreads into its props schema.

A `Node` is `{ m0: string; sources: MosaicSource[] }` built together so source
emission order always matches the DSL's DFS order.

**And the front door (the hello-world convention, 2026-09-14).** Every template
repo names the template a newcomer renders first: `repo.helloWorld` on the repo
descriptor (`src/repo.ts` in the starters). The default is the canonical m0saic
card, one call from `@m0saic/template-utils`:

```ts
const card = defineHelloWorldTemplate({ id: "@acme/basics/hello-world/v1", subline: `by ${TEMPLATE_REPO.displayName}` });
```

The field, the M, the wordmark and the greeting stay the brand ("made with
m0saic"); `subline` is the repo's own line, seeded into the `caption` prop. A pack
that wants its own look writes its own template and points `repo.helloWorld` at
it. The gate warns (`repoFrontDoor`, record posture — never fatal) when a repo
names no front door or names an id it does not register. `m0saic hello-world
--template-repo .` renders it; the manifest carries the field zero-exec.

Two authoring facts, both learned on the starters:

- Spell the structural fields out in the repo module — a literal with
  `version`, `propsSchema: { ...HELLO_WORLD_PROPS_SCHEMA }`, `defaultProps`, and a
  `render` that delegates to the factory — because the no-install contract check
  loads the entry with every `@m0saic/*` import stubbed to an identity proxy, under
  which a bare factory call reads as an options bag. Copy either starter's
  `src/basics/hello-world/v1/hello-world.ts`.
- A still of the card at t=0 is a bare navy canvas (the field wipes in, the M
  assembles). Gallery stills are cut from the clip near its end — the starters'
  `gen-previews.mjs` carries a per-id `STILL_AT_SEC` (hello-world → 2.45 s). The
  card also WIDENS for a long line (to 92% of the canvas) before type shrinks or
  truncates; the default card never widens, so the shipped fingerprint holds.

## 2. Two construction modes — pick per template

- **Splits** (leaderboard, bar, progress) — real m0 cells via `weightedSplit`. Best
  for row/column layouts. Snap nested weights to a multiple of 8 so they GCD-collapse
  and stay quantization-feasible at any resolution. (Large splits with coprime pixel
  weights deterministically spread the fractional remainder — that's precision, not
  a bug; canonical: `handbook/feasibility-precision-quantization.md`.)
- **placeRects absolute** (donut, line, heatmap, timeline, treemap) — every cell is a
  tight rect on the **SNAP_PX (4px) lattice**, packed full-canvas via `placeRects`.
  Use for grids, rings, scatter, calendars, treemaps, spines — anything not a clean
  split. **THE recurring bug (bit on heatmap, timeline, treemap):** pass the
  placeRects body as a **full-canvas extraLayer** — `card.compose(EMPTY, body)` —
  **never as the scaled `content`.** Scaled content goes through `insetNode`, which
  re-quantizes the split weights into a smaller rect → uneven cells /
  `SPLIT_EXCEEDS_AXIS` (0-size band). Also snap **pitch, gap, and all offsets** to
  the lattice so every cell edge and gap-band boundary is grid-aligned.

## 3. The knobs every template gets right

- **Defaults are the contract ("a knob shows what it does", 2026-09-05).** Every
  optional `boolean` and closed-set knob (`constraints.oneOf` / `control.options`)
  carries a `defaultProps` value; every plain `string` / `number` a default OR a
  `meta.control.placeholder` naming the unset behaviour ("auto"). A fallback that
  lives only in `render()` (`props.title ?? "…"`, `props.show !== false`) makes the
  Make panel LIE (empty / OFF for a value the render fills in). `defineMosaicTemplate`
  throws `TemplateConventionError` for a first-party violation at import; an external
  pack's is recorded, never fatal. A closed-set knob whose unset state is not one
  of its options gets a `"none"` option (defaulted, normalised away in `render()`).
  Rule + exemptions: [`philosophy-and-contract.md`](philosophy-and-contract.md)
  §"Props as a UI-renderable schema".
- **`resolveColor(value, fallback)` on EVERY color knob.** A bare `props.color ??
  fallback` keeps `""` (not nullish) → renders the mark in no color → invisible. A
  cleared / "none" / blank picker must fall back.
- **Dual props.** Agent-canonical knobs (`anim`, `valueMode`, `orientation`, …) plus
  human-facing toggles/sliders (`animate`, `showValue`, `introLength`, `cornerRadius`)
  wired via `meta.control.syncsTo` (e.g. `animate` → `anim.reduceMotion` boolInvert).
  Anything a human flips or drags belongs in `consumer:"human"` — they WILL ask.
- **Labels.** Compact big numbers (`compactNum`: `4500→4.5K`); size the font
  length-aware or shrink-to-fit; ellipsis-truncate only when even the min font
  overflows, bounding truncation width so labels can't collide. Do **not** use
  `fit:"contain"` for a single line — it scales to HEIGHT and clips width. Fit
  under `textEmUnits × fontSize × em` with a `cell × 0.94 − 2px` budget and lock it
  with `textFits` — [`layout-contract.md`](layout-contract.md) §"Text".
- **Contrast auto-flip.** `onColor(hex, light, dark)` via relative luminance for any
  text sitting on a colored fill (white on saturated, dark on pale/amber).
- **Animation.** Opacity rides `overlay.alpha` — `makeColorTile` IGNORES `visual`.
  `fadeInExpr(start, dur)` cascades; `animateNumbersInText` for count-up;
  `reduceMotion` → the static board. **Overlay-depth limit (~25 nested layers):** the
  engine silently drops masks (circle markers → squares, text → tofu); use a single
  curtain-wipe overlay, not a per-sliver cascade.
- **Aspect-awareness.** Stress vertical / square / horizontal. A wide card may need a
  different layout (timeline's `orientation:"auto"`); clamp edge content so it can't
  spill the card.
- **A canvas that is a knob → `resolveOutputHints(props)`.** When a prop picks the
  output size (a `platform` knob: YouTube 1920×1080 vs TikTok 1080×1920), declare
  the resolver on the template so hosts SEED the right target before rendering
  (`resolveTemplateOutputHints` is the one helper CLI / Electron / web / Make use);
  `render` still reads `ctx.target` and lays out at any size. At `defaultProps` it
  must agree with the static `outputHints` (`outputHintsResolve`, throw). Rules:
  [`philosophy-and-contract.md`](philosophy-and-contract.md) §"Output contract".
- **Prop bindings — the rect that SHOWS a prop is its handle in Make.**
  `bindProp(src, key)` / `bindProps(src, entries)` / `bindPropPath(src, key, path,
  kind)` / `bindPropRange(...)` (`@m0saic/template-utils`) stamp `editor.binding` on
  the source that displays a prop; Make resolves them per render (`bindingsSound`
  throws on a binding the schema refuses — booleans, closed pickers and whole lists
  are never bindable) and the preview shows one glyph per thing the tile can do (T
  text · 123 number · swatch colour · move rect · picture media), collapsing to ONE
  dot on a small tile. Bind even when the value is empty (the rect is a handle to
  ADD). The full contract — kinds, `onClear`, `seedDraft`, `kind: "media"` (a rect
  that takes a dropped file), `companion`, starter media — is
  [`reference/prop-bindings.md`](reference/prop-bindings.md).
  **`kind: "rect"` (2026-09-15) — a rendered cell edited IN PLACE:** a `json` prop
  with `picker: "regions"` and `regions.max: 1`, bound with `bindPropRect(src, key)`
  (no path). Double-click / the move badge opens the regions draw session seeded
  from the cell's painted rect; drag, 8 handles, Shift = aspect lock, Delete = back
  to automatic placement, Esc / Enter = done; every gesture end writes `{ canvas,
  regions: [rect] }` into the prop and the template re-renders — never a
  destructive post-render edit. The template must still render a correct default
  placement when the prop is empty: the binding is the handle, not the layout. A
  cell may carry several bindings (`bindProps` with a rect entry AND text entries) —
  that is the "move the cell OR change its contents" surface. First implementer:
  `@m0saic-dev/creator/drop-calendar/v1` (`facecamRegion`).

## 4. The sandbox loop

The full iteration ritual is https://github.com/m0saic-project/m0saic-sandbox/blob/main/packages/sandbox/agent.md — read it before authoring
or iterating on any candidate; this doc does not duplicate it. Naming convention in
one line: `candidate-NNN.mosaicx` (one file = one question = one verdict), a frozen
`candidate-NNN-agent.mosaicx` snapshot before every open, and
`candidate-NNN_humanedits.mosaic` frozen from the live dist BEFORE editing the
template on negative feedback.

## 5. The lock is the full closeout — non-negotiable

Canonical: https://github.com/m0saic-project/m0saic-sandbox/blob/main/packages/sandbox/agent.md §"Session closeout" + §"Template-build
closeout (the `.mosaicx` flavor)". This doc intentionally does not summarize the
artifact list — read agent.md and follow it. Two rules earlier summaries
dangerously omitted:

1. **The master is `master_candidate-NN.mosaicx` until approval.** "Do NOT mint a
   bare `master.mosaicx` before approval — that name is reserved for the approved
   file." Rejected gates stay frozen; the fix ships as `master_candidate-02`, etc.;
   only on approval is the file renamed to `master.mosaicx` + `master.mosaic`.
2. **"Gate EVERY output aspect, not just one."** Aspect-adaptive templates pass
   desktop and still fail square/mobile — the final gate is the human rendering ALL
   aspects (H / V / square) from the candidate and signing off. Verify the aspects
   yourself first, but the gate is theirs.
3. **The layout contract comes BEFORE candidate-01.** Tag every fitted text source,
   declare `textFits` under `debugLayout`, and sweep `assertLayout` at the 7-canvas
   set in the gate test — [`layout-contract.md`](layout-contract.md)
   §"Recommended". A gate that passed one aspect and clipped on portrait is the
   scenario this rule was written for (gate 33).

## 6. Cross-cutting gotchas (bit on multiple templates)

- `cornerRadius` is a **0..0.5 fraction of the cell's shorter side** → px radius
  (`borderRadius * min(w, h)`). At high radius, inset top-left labels must clear
  the corner curve.
- **Make `--make` open adopts the file's `size`** over the template's `outputHints`
  (a 1080² candidate must open square, not 1280×800). Beware: Make's save-back
  rewrites the file's size/props to the panel state — re-freeze candidates that drift.
- **The render-hero preview rounds a cell by driving `border-radius !important`** on
  the matched ViewFrame cell (`Frame.tsx` wires `var(--vf-tile-radius, 0px)`, so a
  plain assign is overridden). Measure the radius via `ResizeObserver` — cells can be
  0×0 on the first effect pass.
- **The 119/121 fencepost.** `weights.map(w => round(w / sum * 120))` sums to
  120 ± (bands − 1): every Alpine card carried `121×2`, the pulse heroes `121×8`,
  and 121 = 11² poisons every composition (LCM with the core = 14,520). The kit
  line is `weightedSplit(latticeWeights(weights, { cap: 120 }), axis, { claimants })`
  (Hamilton to an exact 5-smooth total, GCD to a divisor: `[59,1802,59] → [1,28,1]`).
  Since 2026-09-16 the build gate and `m0saic doctor` refuse a rough count above 12
  (`latticeSmooth`, throw — [`reference/template-flags.md`](reference/template-flags.md))
  — for a pack it is the publish requirement, so run the doctor before tagging.
