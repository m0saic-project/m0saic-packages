# Template status flags: `internal` / `primitive` / `deprecated`

Lookup reference for the three orthogonal discovery/visibility flags on
`MosaicTemplate`. A template may carry any combination; conflating them is the
standard mistake. Declared in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts —
`internal?` (:1385), `primitive?` (:1416), `deprecated?` (:1446), each with its
truth table in the JSDoc (line numbers verified 2026-07-27; re-verify:
`grep -n "internal?: boolean\|primitive?: boolean\|deprecated?: {" https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts).

| Flag | Question | Renderable alone? | Default UI |
|---|---|---|---|
| `primitive?: boolean` | "Is this a base others build on?" | **Yes** | Shown + **PRIMITIVE** badge (teal) |
| `internal?: boolean` | "Is this intended as a **top-level selection**?" (No → hidden) | **Sometimes** — the flag doesn't decide this | **Hidden**; **INTERNAL** badge (violet) when revealed |
| `deprecated?: {reason?, replacement?, since?}` | "Is this still the recommended pick?" | Yes | **Hidden**; **DEPRECATED** tag + "use X instead" |

**`primitive` is informational — it does NOT hide anything.** `internal` and
`deprecated` are the visibility gates.

## Why `primitive` ≠ `internal`

- **`primitive` is a quality** — foundational, widely reused. `charts/donut`,
  `charts/stat-card`, `charts/bar-graph`, `primitives/grid` are primitives *and*
  perfectly good standalone picks.
- **`internal` is an INTENT/visibility flag, not a capability statement** — it says
  "not intended as a top-level pick": excluded from public listings and template
  pickers by default, but fully available to `renderNestedTemplate()`
  (`internal` JSDoc, `template.ts:1375-1384`). Whether it can render standalone
  varies by template and is NOT what the flag encodes: the ffmpeg-pulse piece
  templates are internal yet render fine on their own; `bar-graph`'s `bar-cell`
  leaf is internal AND genuinely expects parent-injected context. Don't infer
  either way from the flag — read the template.
- **Both** is a real combination: a shared building block many templates reuse
  that still isn't meant to be picked top-level.

(The `primitive` flag's orthogonality table in `template.ts` used to gloss
`internal` as "can this render on its own?", contradicting the `internal` JSDoc —
fixed in-code 2026-07-27; both JSDoc now carry the top-level-selection semantics.)

## Where the flags surface

- **Electron `templates:get`** (the Mosaic Desktop / Web app source (not published)) serializes all
  three into the meta the desktop Templates page consumes.
- **Desktop Templates page** — PRIMITIVE / INTERNAL badges with explanatory tooltips.
- **CLI `list-templates` / `browse-templates`** — annotates
  `(primitive) (internal) (deprecated)` in that **fixed order**
  (the CLI source (not published)-33`).

## Curation is a content decision

`primitive` started as 4 seeded entries and is on **29 templates** as of 2026-07-27
(re-verify: `grep -rn "primitive: true" https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic | wc -l`).
There is no rule that derives it — like `deprecated`, someone decides. If you're
adding a template that other templates will compose, set it; don't wait for a sweep.

⚠️ **Setting `deprecated` obligates a pruning pass** — repoint the curated registry,
and remove the id from the CLI E2E cases and the e2e variant list. The full ordered
procedure is in the maintainers' agent contract §10 (not published) "Deprecating a template"; a deprecated id must
never linger in those lists. The default e2e sweep auto-excludes deprecated
templates; opt back in with `M0SAIC_INCLUDE_DEPRECATED=1`.

### Deprecation also silences convention advice (2026-09-09)

`M0SAIC_INCLUDE_DEPRECATED=1` governs more than the e2e render sweep: it also
controls **convention findings** in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/tools/check-registry.mjs,
which gates `npm run build`.

By default a deprecated template's definition-time and render-time convention
warnings/errors are **suppressed** — the template is defunct, so the advice will
never be acted on and repeating it forever is noise. This makes the intended
workflow self-cleaning: for a shipped template that violates a convention, **bump
to vN+1 and deprecate the old one — the old one goes quiet automatically.** There
is no exclusion list to maintain.

The `outputFormat` convention (2026-09-13: a public template declares
`outputHints.format`; record posture) treats both visibility gates as
exemptions at the audit itself, not only through this suppression: an
`internal` building block renders only nested and a `deprecated` template is
frozen history, so neither owes a deliverable declaration
(`auditOutputFormat`, https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template/auditSchemaConventions.ts).

The suppressed count is always printed, never silent:

```
[check-registry] ℹ 14 finding(s) on 22 deprecated template(s) suppressed
                   (advice only — freeze + fingerprints still apply).
                   M0SAIC_INCLUDE_DEPRECATED=1 to see them.
```

⭐ **Suppression is ADVICE ONLY.** The freeze gate (`frozen.manifest.json`, every
template shipped in 0.1.0) and the layout fingerprints still cover deprecated
templates in full, byte for byte, in both modes. Deprecation means "stop
suggesting improvements" — it NEVER grants permission to change a shipped
template. See the maintainers' agent contract §10 (not published).

Measured when introduced (103 registered templates, 22 deprecated): render-time
warnings 21 → 12, definition-time warning knobs 208 → 165 across 30 → 25
templates; freeze (327 files) and fingerprints (89) identical either way.

## The repo's front door — `repo.helloWorld` (2026-09-14)

Not a template flag but a **repo-descriptor** field beside them
(`MosaicTemplateRepoDescriptor.helloWorld?: TemplateId`,
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template-repo/template-repo.ts): the id of the template a
newcomer renders first. Core names `@m0saic/hello-world/v1`; each starter names
its own `…/basics/hello-world/v1`. It is deliberately NOT a `TemplateRole` — roles
say what a template *produces*; this says which one is the door.

Readers: the CLI alias (`m0saic hello-world --template-repo <path>`), the manifest
(the descriptor is embedded, so `template-manifest.json` carries it zero-exec; the
platform loader passes it through), and — follow-up — Make's "Start here" chip.
The gate's `repoFrontDoor` convention (record posture) warns when the field is
unset or names an id the repo does not register; `internal` / `deprecated`
templates are fine to name, just unusual. Authoring recipe: `standalone-pack-authoring.md`
§1.

## A canvas that is a knob — `resolveOutputHints` (2026-09-15)

Also not a flag but a **template field** beside `outputHints`:
`resolveOutputHints?: (props) => Partial<MosaicTemplateOutputHints>`. The
static `outputHints` stay what the manifest and the cards show; the resolver
is what a host asks with the current props before rendering, through the one
helper `resolveTemplateOutputHints(tmpl, props)` (`@m0saic/template-utils`).
Readers: CLI `make` (+ wireframe / tutorial paths), Electron preview / cover /
render-to-file + the `templates:resolveOutputHints` IPC, the web design
preview, and Make's Device anchor (re-resolved on every prop change). The
seam's `outputHintsResolve` convention (THROW posture) checks it returns an
object, is deterministic at `defaultProps`, and agrees with the static hints
for every field it returns there. Precedence: [`../output-resolution-tree.md`](../output-resolution-tree.md) §size.

## The lattice declarations — `lattice` (2026-09-16)

**Convention `latticeSmooth` (throw):** every split count above 12 in the rendered
layout — root document and every nested child, walked as documents (a nested doc
whose flatten fails below its floor is still measured) — is 5-smooth, `N = 2ᵃ·3ᵇ·5ᶜ`.
Counts ≤ 12 with a rough factor (7 weekdays, 11 tiles) pass as small-basis ratio
fill. Measured at the hinted canvas and, under `--sweep`, on the standard canvases.
Why: all delivery canvases are 5-smooth with family gcd 120, so 5-smooth counts
divide them (pixel-exact), any two 5-smooth self-lattices LCM to a small number,
and a child never inherits a rough cell size (handbook
[`composition-arithmetic.md`](../../handbook/composition-arithmetic.md) §1–3).
`m0saic doctor <repo>` reports it for external packs at error severity — the
publish requirement. Plan + numbers: (internal design history).

`MosaicTemplate.lattice?` (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts, beside
`primitive?` / `deprecated?`) is the declaration surface — every override is typed,
reasoned, and printed by the gate:

| field | when it is honest | effect |
|---|---|---|
| `mode: "bitmap"` | the split counts ARE a raster (QR modules, barcode bars, a logo trace, the community M) — handbook §3c BITMAP, baked once, never live-composed | the template is skipped with a note |
| `allow: [{ count, reason }]` | a count above 12 that is content cardinality (53 ISO weeks; a 335-tile fixture grid) | the count is accepted; the reason is printed and carried in `--json` |
| `canvas: "physical"` | the hinted size is a millimetre spec at a dpi (business card 1130×678 = 2·5·113 × 2·3·113) | the rough-axis finding is not raised, counts the canvas hands down are charged to it (not to the construction), and the `--sweep` canvases are skipped — a print size cannot move |

Per DOCUMENT, `MosaicEngineMeta.lattice?: { mode: "bitmap" }` (`doc.engine.lattice`)
marks a raster a parent assembles itself (the business card's QR child, built from
`qrToRenderable` pieces) — that subtree is skipped, the parent is still measured.
(The layout-fingerprint sidecar cannot carry this marker: the fleet lock
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/lattice-audit.test.ts re-measures such a template with
`auditRenderedTemplate` instead of trusting the flattened string.)

**Not honest:** a count that came from your arithmetic — independent rounding to a
cap (121/119/241/245), a pitch matched to a grid that no longer exists (499),
`round(side/K)` + `ceil` self-frames (99/101), pixel splits inside an already
quantized cell. The finding names the nearest 5-smooth neighbours and the LCM cost;
the neighbour almost always looks identical.

## Reading the dictionary from a template — web vs node (2026-09-16)

`@m0saic/dictionary` has two entries: node (`index.ts`, reads `.m0`/`.m0c` from
disk) and browser (`browser.ts`, what the Mosaic Desktop / Web app source (not published) bundles via the package's
`browser` field). Every jest suite resolves the NODE entry, so a template that reads
a brand entry synchronously can be green under test and an error mosaic on
app.m0saic.io — which is exactly what QR Code's centre M, Brand Marks v3 and
community-m did until 2026-09-16 (the browser entry shipped every brand `m0` as `""`
and its `getRankSet` threw). Rules that hold on BOTH entries now:

- **`entry.m0` is populated for every entry whose canonical m0 is ≤ 40 KB**
  (`INLINE_M0_MAX_CHARS` in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/dictionary/tools/validate.js, which emits a
  committed sibling `m0.json` per entry that `browser.ts` imports). Only
  `brand/m-33_bitmap` (149 KB) ships `m0: ""` on web — a template that can take it
  must guard `if (!entry.m0)` and say "Desktop renders this" (Brand Marks v3 does).
- **`entry.masks`, `entry.rankSets`, `entry.sourceCount` ride in `metadata.json`** →
  identical on web. `registry.getRankSet(id, name)` works on web (same lookup as
  node). Named mask SETS (`getMaskSet`) are node-only.
- **The guards, in order of reach:** https://github.com/m0saic-project/m0saic-packages/blob/main/packages/dictionary/src/browser.test.ts
  (browser m0 == node m0 for every inlined entry; only the bitmap lazy) ·
  https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/webDictionary.test.ts (renders QR Code / Brand Marks /
  community-m against the browser entry via `jest.mock`) · the Playwright web lane
  the Mosaic Desktop / Web app source (not published) (the shipped bundle).
  **Add your template to `webDictionary.test.ts` if it reads a brand entry.**

the Mosaic Desktop / Web app source (not published) copies `*.json`, so `m0.json`
also lands under `public/dictionary/` — harmless (≤ 10 KB each). The light entries in
`browser.ts` are still hand-written F-form literals; the drift test compares them
canonically to the generated `m0.json`.

## Known wrinkle

The Templates page's **"Show layout primitives" toggle** (renamed from "Show
primitives" on 2026-09-16 so the label says what it does) gates a *tag-derived*
Primitives **category** (tags `grid` / `primitive` — in practice the `primitives/`
family) — separate from the cross-cutting `primitive` **flag**, which only ranks and
badges. They coexist cleanly, but they are two mechanisms with one word. Driving the
toggle off the flag would hide most of the alpine/charts shelf by default, so the
founder kept the category gate and fixed the label instead.
