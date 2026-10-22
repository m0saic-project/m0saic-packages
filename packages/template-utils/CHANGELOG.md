# Changelog

## 0.4.0 — 2026-10-22

### Starter media: a browser twin of `dist/media/defaultMedia` (inline SVG data-URIs), swapped in by `package.json` `browser`

`src/media/defaultMedia.browser.ts` is the browser twin of the node-only starter-media helper: the same
exports (`STARTER_MEDIA_ROLES`, `starterMedia`, `starterMediaFrom`, `starterMediaPath`, the dir helpers,
`CORE_MEDIA`) returning the six included stand-ins as `{ kind: "data-uri", uri: "data:image/svg+xml,…" }`
assets instead of `{ kind: "file" }` paths. The SVG text is inlined by `tools/inline-starter-svg.mjs` into
`src/media/starterSvgInline.ts` (generated from `assets/starter/*.svg`; `defaultMedia.browser.test.ts` fails
on drift). `package.json` gains `"browser": { "./dist/media/defaultMedia.js": "./dist/media/defaultMedia.browser.js" }`,
so a browser bundle (webpack honours the field; Node and jest ignore it) that resolves the node helper gets
the twin. Neither module joins the barrel: the node one stays deep-import-only as before, and the twin is
reached only through the swap.

**Compatibility.**

Additive. Node callers of `dist/media/defaultMedia` see no change. A bundler that does not read the
`browser` field resolves the node module exactly as today. The data-URI form is URL-encoded with no `;utf8`
parameter — what the engine's plain-SVG parser accepts — and uses no `Buffer`.

## 0.3.1 — 2026-10-05

### Registry applies the template catalog; `catalogSidecar` convention (0.3.1)

- `declareTemplateCatalog(entries)`: a repo declares its catalog before its templates register; `registerTemplate`
  applies the entry catalog-first (fields, and prop presentation written into a copy of `propsSchema`) BEFORE the
  definition-time conventions run, so `browseSurface` / `propLabels` / `bindingHints` judge the template as hosts
  see it. An entry binds to the origin that declared it — an external repo can never restyle, hide or deprecate a
  first-party template. Copies a repo loader already merged are recognised too.
- `getTemplateAsRegistered(id)`: the template as its CODE declares it (catalog fields and `propsSchema` as written)
  — what a freeze pin hashes, so catalog edits never move a pin.
- New convention `catalogSidecar` (since 0.3.1, throw): a template's code declares no catalog field and no prop
  presentation. Templates shipped before 0.3.1 lag it (reported, never fatal); new work meets it.
  `auditCatalogSidecar(template)` exported.
- `browseSurface` also requires a resolved `label`.
- `defineHelloWorldTemplate({ …, catalog: true })`: the front-door card with no label / description / tags / version
  and a presentation-free schema (`HELLO_WORLD_PROPS_SCHEMA_BARE`) — the repo's `hello-world.catalog.json` supplies
  them, starting from `HELLO_WORLD_CATALOG_ENTRY`. Renders the identical card; the default path (the frozen official
  and community cards) is untouched.

**Compatibility.**

A template that describes itself in code still registers and renders exactly as before; on new work the
`catalogSidecar` finding is an error, on shipped work it is lag.

### `canvasFill` closes the rounded-card loophole (from 0.3.1); `choice` bindings accepted

A static, opaque, full-canvas colour tile is flagged by `canvasFill` whether or not it is rounded or stroked
(`effects` no longer takes it out of the rule) — UNLESS it carries a handle (a prop bound to it), or the template
declares `canvas.baseRect` / defaults `useNestedBackgroundColor`. Overlay, mask and placement still exempt. The
tightening is held to the line: a repo held to `0.3.0` (its `frozen.manifest.json` release or `repo.conventions`,
the lower of the two) keeps the rounded-card exemption it shipped under (`CANVAS_FILL_SHAPED_SINCE = "0.3.1"`).
The finding's detail now offers the second fix: make the rect a handle. The binders (`bindProps`, `bindPropPath`)
and `resolvePropBindings` accept kind `"choice"`.

**Compatibility.**

- Breaking: no for any repo held to a line (`shippedAt` / `conventionsTarget` ≤ 0.3.0) — the rule it shipped
  under still applies. A template audited with NO line (new work, a repo that has shipped nothing and declares
  no target) is held to the tightened rule: a rounded full-canvas card that nothing binds now fails
  `canvasFill` where it passed with 0.3.0 tooling. The fix is one of: bind the rect (`bindProp(src, "preset")`),
  `canvas.baseRect = "<why>"`, or `document.backgroundColor` instead of the rect.
- `m0saic doctor` on the starter and on community repos (all held to 0.3.0) is unchanged.

**Release notes.**

Ships with the 0.3.1 lockstep set (`@m0saic/platform` of the same cut defines the `choice` kind).

### `resolveTemplateOutputHints`: the reserved `outputFormat` knob wins over the static format hint

`resolveTemplateOutputHints(template, props)` now returns the format the PROPS ask for: when the merged props
carry a reserved `outputFormat` naming a container (`png` / `jpeg` / `jpg` / `webp` → image; `mp4` / `mov` /
`webm` / `mkv` → video) that differs from the static `outputHints.format`, the result's `format` is
`{ kind, container }` for that container. Precedence: static hint < the knob < a `format` the template's own
`resolveOutputHints` returns. At the knob's default the static hint stands whole (its `pixelFormat` and the
rest). `formatFromOutputFormatKnob` is exported.

**Compatibility.**

- Breaking: no. A template without an `outputFormat` prop, or with the knob at its hint, resolves exactly as
  before. A host that already let the knob win (the CLI) gets the same answer from the resolver.
- A template that uses a prop named `outputFormat` for something OTHER than the deliverable's container would
  see its hint move; none in the official or community packs does (the name is reserved by convention).

**Release notes.**

Mosaic Desktop's render handler (`templates:renderToFile`) reads the resolved hints from this cut on — it read
the static hint directly before, so it needs the same build.

## 0.3.0 — 2026-09-29

### `bindingsDeclared` — the prop-binding roll call (THROW, new templates only)

A new render-time convention: **every prop that can carry a canvas handle is either bound on the rect
that shows it, or named in `template.bindings.unbound` with the reason it has none.** Posture is
`throw` from the start — a first-party template that does neither fails the build.

It ships with no migration because every template that exists is hashed in `frozen.manifest.json` and
exempt by construction. Founder ruling 2026-09-25: "throw from the start" — there is no fleet to
migrate, which is the point of landing it at the start of a line rather than the end.

### `bindingsCover` covers drawn NUMBER props, and names the composite-line fix

The render-time `bindingsCover` convention — "bind what you display" — used to look at free-text
`string` props only. It now also covers `number` props whose default is drawn verbatim, and when the
rect that shows a prop already binds a DIFFERENT prop it reports that case with its own fix
(`bindProps`, or split the line) instead of advising a bare `bindProp` that would replace the
existing handle. Posture is unchanged: `record` → warning, never a build failure.

### `canvasFill` — the canvas is filled by the document, not by a rect (THROW)

A new render-time convention: **a root document must not contain a static, opaque, full-canvas
colour source.** Use `document.backgroundColor`. Posture is `throw`.

### Conventions carry a VERSION — "does template X pass conventions at Y?"

Conventions now have a version axis, so a template's convention status is a LEVEL rather than a
binary. Founder, 2026-09-25: *"conventions change over time, but if we semver them we know: does X
template pass conventions at Y semver."*

### createDesignContext takes the host's resolved `format`

`createDesignContext({ …, format? })` accepts the output format the HOST resolved for the current props
— normally `resolveTemplateOutputHints(tmpl, props).format` — and puts it on `ctx.output.format`. The
`defineMosaicTemplate` wrapper stamps `ctx.output.format` onto the rendered document, so with this the
preview's stamp carries the template's own answer instead of being empty. (`@m0saic/core`'s
`createEngineContext` gained the same parameter; core is the moat and versions with the monorepo.)

**Compatibility.**

- Breaking: no. The argument is optional; callers that omit it get the previous behaviour.

**Release notes.**

Ships with the next lockstep publish. No template-facing change: authors keep declaring
`outputHints.format` / `resolveOutputHints`; hosts now carry that answer into the preview stamp.

### `bindProp(…, { hint })` and `withBindingHint()`: say what a bound value does

- `bindProp(src, propKey, index?, opts?)` takes an optional `{ hint }`.
- `bindProps` entries take an optional `hint`.
- New `withBindingHint(src, hint)` composes with every binder (`bindProp`, `bindProps`,
  `bindPropPath`, `bindPropRect`, `bindPropRange`): it sets `hint` on the source's single `binding`,
  else on the FIRST of `bindings`, and throws on an unbound source or an empty string.

Every hint is trimmed and must be a non-empty string; the rest of each binder is unchanged.

**Compatibility.**

Additive; existing calls are byte-identical in their output. Needs `@m0saic/types` with `hint` on the
binding type (same lockstep).

### `bindingHints` — every bound rect explains itself in place (THROW, new templates only)

A new render-time convention: **every bound rect must show one line in context** — the binding's
`hint`, else the prop's `description`. Make shows that line under the inline editor, on the tile card
and in the handle's tooltip (see `pending-releases/types/2026-09-27-binding-hint.md` and the
template-utils note of the same day for the field and the binders). Posture is `throw` from the start.

Like `bindingsDeclared`, it ships with no migration: every template that exists is hashed in its repo's
`frozen.manifest.json` and reports in `lagging`. Founder ruling 2026-09-27: "a production-grade
template adheres to all the surfaces of the Mosaic ecosystem … it's better to take this tax now."

### `costBudget` measures overlay depth and inline masks PER NODE, like the engine

`costBudget`'s `overlayDepth` was read off the FLATTENED document — every child inlined — while the
engine's own wall (`OVERLAY_CHAIN_DEEP`, `buildMosaicNode.ts`) is the chain ONE node's composite
command emits, and it warns only when inline masks ride that chain. So a template that followed the
rule's own fix text ("nest a child document") read deeper the more it nested: Lyric Stack read 30 with
no node past 10 (Rainier finding R10, 2026-09-27). Now the audit walks the tree node by node — the
root, then each `children` entry (recursively; a pipeline child contributes its step files; `mosaicx_*`
invocations and bitmap lattices are skipped, as `collectM0Strings` skips them) — parses each node's
OWN `m0` at its declared `size` (else the canvas), takes the deepest `overlayDepth` among nodes that
carry at least one `inline-mask` source, and names the child (`on child document "deep"`) when the
worst node is not the root. `inlineMasks` is per node the same way (the mask resolver's argv is per
command). A deep chain with no masks is silent, as the engine is: it renders slower, which the estimate
already shows, and never loses a pixel. `frames` and `sources` are unchanged.

### `makeIncompleteMosaic()` — the card for a template waiting on an input

`makeIncompleteMosaic(message, opts)` — the same card as `makeErrorMosaic`, titled "Needs an input"
by default and stamped `renderStatus: "incomplete"`. `makeErrorMosaic` itself takes an optional
`status: "error" | "incomplete"` (default unchanged). A template says what is missing and where it
goes: `makeIncompleteMosaic("Drop a video, then mark your takes.", { width, height })`.

### The error card reads again, the wireframe builders ship, and two text helpers grow (P11, P4, P5, P9, P18)

## 0.2.0 — 2026-09-19

### First npm publish

`@m0saic/template-utils` — Template runtime helpers — `definePropsSchema`, `defineMosaicTemplate`, `seededRng`, `stampOutput`, ffmpeg expression builders, primitives, the geometry contract and the `forensic` namespace.

Published at the same source as the `m0saic` CLI 0.2.0 line (the CLI bundles its own copy). `0.x`: the surface is still being shaped; minor versions may change exports, and every change from here on carries a `pending-releases/template-utils/` entry.
