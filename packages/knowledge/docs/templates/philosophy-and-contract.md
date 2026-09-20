# Templates: Contract & Philosophy

Entry doc for `docs/templates/`. Defines what a template IS — the
executable contract and its invariants. How to BUILD one is
[`construction-strategy.md`](construction-strategy.md); the required authoring
process (add / deprecate, tests, registry) is the maintainers' agent contract §10 (not published).

## The template contract

A template is not "a layout string" — a `MosaicTemplate<P>` is a **typed,
capability-scoped program**: a globally-identified unit (`id`), a typed props
interface with schema + canonical defaults (`propsSchema`, `defaultProps`), an
explicit security contract (`capabilities`), and
`render(props, ctx) -> Promise<MosaicRenderableFile>` where the renderable is a
`MosaicDocument` or `MosaicDocumentPipeline`. Templates are the main extension
point for m0saic.

Every template must: return a valid renderable whose emitted m0 strings validate
(`isValidM0String` / `validateM0String`); stay feasible at intended default
sizes; be deterministic under `tier: "core"`; declare capabilities honestly
under `tier: "capability"`. It should document intended resolutions via
`outputHints.note`, provide safe defaults, and avoid unnecessary complexity for
human-authored layouts.

> **Source of truth:** authoring entrypoints `defineMosaicTemplate` +
> `definePropsSchema` in [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src);
> implementations in [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic);
> the full type contract in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts.

## Renderables: spatial vs temporal

**`MosaicDocument` (spatial)** — a pure spatial description of a single render
pass: `m0` defines layout geometry only (splits, holes, donations,
overlays); `config` defines sources and render intent; optional `children`
enables recursive composition (children render first, their outputs become
sources). The DSL describes *where tiles exist*; the template decides *what
fills them*.

**`MosaicDocumentPipeline` (temporal)** — composes multiple renderables over
time: `steps[]` each carry inline `file: MosaicDocument` or a `ref`, explicit
per-step timing (`durationMs`), explicit transitions (`cut` / `fade`), optional
pipeline-level fps normalization. A pipeline has no single `m0` string —
each step has its own spatial layout.

### Document vs pipeline — when to use which

Use a **MosaicDocument** when building layouts, split logic, overlays, spatial media
composition, or reusable building blocks. Use a **MosaicDocumentPipeline** when
sequencing scenes, slideshows, transitions, fade/cut stitching — combining documents
over time. Geometry is the document; time is the pipeline; keep the spatial algebra
pure. (Full pipeline semantics — `emit: "single" | "multi"`, `intermediate`, per-step
geometry — live in [`rendering-model-contract.md`](rendering-model-contract.md).)

## Output contract (hints vs reality)

Templates may provide `outputHints` (width / height / fps / durationMs / note /
format intent). These are UI recommendations, not enforced requirements — with
one declaration the contract does ask for:

**Every public template declares `outputHints.format`** (the `outputFormat`
convention, 2026-09-13; record posture — the templates build gate WARNS, never
fails, and lists it in the Stage 1 line as `warning knob(s): outputFormat`).
`{ kind: "video", container: "mp4" }` for anything with motion;
`{ kind: "image", container: "png" }` for a still, plus `pixelFormat: "rgba"`
when it ships alpha (transparent overlays, QR stamps, wireframes); a template
with an `outputFormat` knob declares the knob's DEFAULT (the knob still wins
at render — precedence in
[`output-resolution-tree.md`](output-resolution-tree.md) §format). Without
it the CLI names the output `out.mp4` even for a still and a Make share link
at defaults carries an `f=` ask. Exempt: `internal: true` (building blocks
render only nested) and `deprecated` (frozen history). Mixed-output templates
whose kind follows the INPUT (blur-regions, watermark) declare the common
case; Make derives the real kind from the resolved renderable and the CLI
switches a defaulted output to png when every input is an image. Audit:
`auditOutputFormat` (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template/auditSchemaConventions.ts).

**A canvas that is a knob declares `resolveOutputHints(props)`** (2026-09-15,
`MosaicTemplate.resolveOutputHints?: (props) => Partial<MosaicTemplateOutputHints>`).
Pure and cheap — props in, hints out; no ctx, no media, no I/O. Hosts call it
with the CURRENT props before rendering and seed the target from the result
merged over the static hints (`resolveTemplateOutputHints` in
`@m0saic/template-utils`), so the CLI plans at the right canvas, Make's Device
anchor follows the knob, and the feasibility guard measures the right size.
Precedence is unchanged: an explicit user ask still wins. `render` reads the
canvas back from `ctx.target` like every other template and must still lay
out correctly at ANY target (a host that predates the field ignores it — the
resolver decides the canvas, it is not the layout). Convention
`outputHintsResolve` (throw): object, deterministic, and at defaults equal to
the static hints. First implementer: `@m0saic-dev/creator/drop-calendar/v1`
(`platform` → canvas + safe area).

Authoritative values always come from `ctx` (resolved by host) — but from the right slot:

- **`ctx.target` — geometry and timing.** Width/height/fps/duration for everything you
  size or time. It is the per-render slot rect and may differ from `ctx.output` (nested
  renders override only `ctx.target` — https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/render/renderNestedTemplate.ts#L43).
- **`ctx.output` — format decisions only.** Container/codec/alpha. **Never geometry** —
  sizing off `ctx.output.width/height` is the latent 5× bug documented in
  [`rendering-model-contract.md`](rendering-model-contract.md) Rule 5b.

Templates MUST read timing/resolution from `ctx.target` (the only source of time
— agent contract §10) and stamp resolved values into returned renderables for
portability and correct nesting (the wrapper does this — internal render-path
walkthrough: `.ai/moat/templates/cli-template-lifecycle.md`, step 4). Resolution is
a host decision: be resolution-aware, not resolution-dependent unless documented.

**An `outputHints.durationMs` is a HINT, never a pin.** The CLI seeds
`ctx.output.durationMs` from the hint, so comparing it to your default to detect a
user ask reads a host default as user intent — dsl-tutorial crammed every walk into
its 12s hint (gate 33, 2026-09-05). Detect a pin with `resolvePinnedDurationMs(ctx)`
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/anim/timing.ts#L156, `userIntent`-only); otherwise
author the NATURAL length on `doc.durationMs` (template intent out-ranks the hint
at plan time). On the CLI `.mosaicx` path the wrapper's `durationMs` (or
`--durationMs`) IS the ask — `mosaicxUserIntent` threads it as
`userIntent.durationMs` on both `make` and `resolve`
(the CLI source (not published)); before 2026-09-05 it only set the plan
length, so a self-timing template was TRIMMED (30s of a 220s walk) while Make
pinned. Full precedence tree: [`output-resolution-tree.md`](output-resolution-tree.md).

## Capabilities: explicit security contract

Every template must declare `capabilities`. This is not optional metadata — it is
part of the core execution contract. Two tiers:

### Tier: core (deterministic, safe anywhere)

`{ tier: "core" }` — fully deterministic, safe to run anywhere without
sandboxing, suitable for public registries and one-click renders. Core templates
must not depend on: filesystem access, network access, process execution,
wall-clock time, non-seeded randomness.

#### Core is dynamic — but pure

`{ tier: "core" }` does **not** mean static. A core template may generate different
m0 strings from props, branch on numeric inputs, inspect **engine-provided** media
metadata (ffprobe-derived dimensions/duration — explicit inputs, not side effects),
compute layouts programmatically, and use seeded randomness when the seed derives
from props. Deterministic branching — e.g. `2(1,1)` for landscape media, `2[1,1]`
for portrait — is fully allowed. The rule is purity, not staticness: core templates
are **pure functions of their declared inputs** (`props`, `ctx`, engine metadata) —
same inputs + same engine version → identical `MosaicDocument`.

### Tier: capability (powerful, explicitly granted)

`{ tier: "capability", caps: { fs?, net?, exec? } }` — may request filesystem
access (read/list/write/temp), network access (fetch), process execution
(spawn). The host (CLI / Desktop / Web) may grant, restrict, or deny.
**Default-deny applies: only explicitly granted capabilities are exposed on the
engine context.** Capability templates can fetch external data, build caches,
preprocess assets, and orchestrate multi-step pipelines — intentionally
powerful; treat them like code (review source, understand the requested caps).
Full patterns: [`capability-templates.md`](capability-templates.md).

Because templates are typed, validated before render, capability-scoped, and
deterministic by default, they are the standard mechanism for turning structured
data (JSON, metrics, event lists) into reproducible media artifacts.

## Props as a UI-renderable schema

Props are defined by `propsSchema` (metadata) + `defaultProps` (canonical
defaults). Prop metadata exists for UI generation, docs, and high-level
validation. The design goal: every prop must have a clear generic UI
representation.

The full `MosaicTemplatePropType` union
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts#L75-105`, verified 2026-07-27):

- primitives: `string`, `number`, `boolean`
- arrays: `string[]`, `number[]`
- media: `media`, `media[]`
- structural: `group`, `list`
- m0-family (DSL inputs — editor surfaces them as Layout pickers): `m0` (bare
  layout string), `m0c` (m0 with cell labels; can require label names via
  `meta.contract`), `m0p` (named bag of layout variants, enumerated or targeted
  — see `MosaicPropContract`, template.ts:815)
- `json` — structured payload mapping to a TS interface; renders as a code
  editor, or a structured form when `meta.constraints.jsonSchema` is declared.
  The validator accepts any value for `type: "json"` — render-time parsing /
  validation is the template's job. Prefer this over JSON-string encoding.
  Details: [`reference/json-prop-type.md`](reference/json-prop-type.md).

Constraints (`MosaicPropConstraints`, template.ts:108-146): numeric bounds
(`min`/`max`), array bounds (`minItems`/`maxItems`), linked lengths
(`lengthOf`), literal enums (`oneOf`), `isColor`, and `jsonSchema` for `json`
props. (An `isM0saicLayout` flag no longer exists — layout inputs are the
m0-family prop *types* above.) Editor presentation hints live under `meta.ui`
(`MosaicPropUI`, template.ts:727).

### Defaults are part of the contract — "a knob shows what it does"

Founder ruling 2026-09-05 (gate 33): Make showed dsl-tutorial's `title` EMPTY and
`showCanvas` OFF while the render used "DSL Tutorial" with the canvas on, because
those fallbacks lived inside `render()` where no editor can see them. "If they are
at a default value, the prop showing has to reflect that — enforce it at the
contract level." An optional knob's UNSET state must be visible:

| optional knob | must carry |
|---|---|
| `boolean` | a `defaultProps` value (a toggle cannot show "unset" — it shows OFF) |
| closed-set `string`/`number` (`constraints.oneOf` / `control.options`) | a `defaultProps` value (a picker shows "—" otherwise) |
| plain `string`/`number` | a `defaultProps` value OR `meta.control.placeholder` naming the unset behaviour ("auto") |
| required · `ui.hidden` · `ui.consumer:"human"` · media / json / lists / m0-family / code / a group's own presence | exempt (inputs, not defaults); a `group` is audited field by field against its default object |

Keep `render()` fallbacks as belt-and-braces only; the schema is the truth an
editor shows.

**Where it fires:** inside `defineMosaicTemplate` — the one seam every registered
template passes through — at DEFINITION time (module import / `registerTemplate`),
so the author sees it, not a test they may never run. Code
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template, verified 2026-09-05; re-verify:
`grep -n "^export function\|^export class" https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template/{auditDefaultProps,templateConventions,templateOriginScope}.ts`):

- `auditDefaultProps` / `assertDefaultPropsComplete` — the pure rule
  (`auditDefaultProps.ts:97` / `:108`).
- `enforceTemplateConventions` + `TemplateConventionError` (`templateConventions.ts:106`
  / `:51`) — the seam; findings log `listTemplateConventionFindings` /
  `drainTemplateConventionFindings` (`:81` / `:86`).
- **Posture follows the ambient origin scope** (`templateOriginScope.ts:50`, shared by
  the registry and the wrapper): first-party → **throws**; inside
  `withExternalTemplateOrigin` (`templateRegistry.ts:274` — an external repo,
  including one whose module body calls `defineMosaicTemplate` directly at import)
  → **recorded**, never thrown, so one bad template can't abort a repo load; hosts
  read the log. `defineMosaicTemplate(t, { conventions: "record" | "throw" })`
  overrides.
- **No escape hatch.** The 76 pre-contract templates were migrated the day the
  contract landed (2026-09-05, 366 knobs: a real default wherever the render had a
  literal fallback, a placeholder wherever the value is derived from theme / data /
  mode), so every first-party template passes at import; the registry sweep
  https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/default-props-audit.test.ts restates the guarantee.
- **Where a file defines a base and a runner under one id** (`brand/logo/v3`:
  `logo.ts` + `logo_runner.ts`), the REGISTERED object is the one the seam audits.
- **A closed set must contain the unset state.** `wireframe/*`'s `preset` picker had
  no "no preset" option, so unset could not be shown: add the option (`"none"` =
  mode-driven), default it, and normalise it back to `undefined` at the top of
  `render()` — never default a real preset over "no preset".

Lock per template: `expect(auditDefaultProps(T)).toEqual([])` plus an
explicit-equals-implicit render in the gate test. Reference:
[`reference/template-flags.md`](reference/template-flags.md).

## Identity, nesting, and ownership

Templates may stamp `editor` metadata (UI-only ownership/labeling/provenance)
and `engine` metadata (diagnostics) on renderables; neither affects rendering.
Identity inside the DSL is structural (StableKeys); template attachment is
explicit via config/children — the DSL does not name tiles. Full nested-render
semantics: [`recursion-nested-rendering.md`](recursion-nested-rendering.md).

## Provenance & trust flair

**Trust comes from the HOST-stamped `provenance` (`builtin` | `community` |
`external`), never from anything a repo declares about itself** — `repoId`,
`displayName`, template-id scope, homepage are all self-declared. Always call
`deriveTemplateSource(templateId, meta)` WITH the meta
(the Mosaic Desktop / Web app source (not published)); the id-prefix fallback
exists only for hosts that predate the stamp. (The Templates card called it with
the id alone until 2026-09-17, and an external repo publishing `@m0saic/…` ids
wore a VERIFIED ribbon.)

**Three protected namespaces get official flair; everything else is 3P.**

| Namespace | Provenance | Flair |
|---|---|---|
| `@m0saic/…` (built-in) | `builtin` | VERIFIED ribbon / badge |
| `@m0saic-dev/…`, `@m0saic-community` (the community pack) | `community` → kind `curated` | COMMUNITY ribbon, `Community · official` badge (same accent family) |
| anything else | `external` | 3P ribbon + the third-party banner / note |

Official templates ship inside the app; they are never loaded from a repo. The
registry enforces the same three prefixes (`RESERVED_TEMPLATE_ID_PREFIXES` in
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/template/templateRegistry.ts): an external
registration under any of them is refused (`TEMPLATE_ID_RESERVED_NAMESPACE`)
unless the host opened the origin scope with a matching `trustedNamespaces`
grant (only the pinned community repo).

**Lookalikes get the louder warning.** `assessOfficialLookalike(templateId,
meta, source)` (the Mosaic Desktop / Web app source (not published)) flags an
EXTERNAL repo whose id scope is a protected namespace, or whose `repoId` /
display name / source URL reads as m0saic or the community pack after folding
case, leetspeak digits and separators (`m0saic`, `mo5aic`, `M-0-S-A-I-C` →
`mosaic`; tokens: mosaic, community, official, verified, curated, builtin).
Filesystem paths are never judged (every dev checkout lives under
`…/m0saic/…`), and neither is `repoHomepage` (the public starter ships
`github.com/m0saic/template-repo-starter`, and every un-edited fork carries
it). Surfaces: `3P · NOT m0saic` ribbon (TemplateCard), red badge + "Not an
m0saic template" note (TemplateInfoModal), red banner (Make), and a per-URL
callout in the consent gate (`sourceLooksOfficial` — URL only, since no code
has loaded). The classifier can only ESCALATE a warning; it never grants trust.

An adversarial fixture exercises every layer in one folder:
the Mosaic Desktop / Web app source (not published) (README has the desktop
test steps; locked by the Mosaic Desktop / Web app source (not published)).

## Template categories

Practically, templates fall into three families: **structural** (human-authored
split hierarchies, predictable, maintainable), **engine-native**
(generated/dictionary-driven — deep overlay chains, large strings, optimized for
deterministic emission over readability), and **advanced integrations**
(capability-tier, data-connected). When to use which style — and the live
category folder list — is [`construction-strategy.md`](construction-strategy.md).

## Status flags: `internal` / `primitive` / `deprecated`

Three orthogonal flags describe whether and how a template surfaces: `primitive`
(informational badge — a base others build on, still standalone), `internal`
(visibility gate — **not intended as a top-level pick**, hidden from listings but
available for nested rendering; it may or may not render standalone — the flag
doesn't decide that), `deprecated` (visibility gate — superseded, hidden with a
"use X instead" pointer). Truth table, code pointers, surfaces, and the curation
rules: [`reference/template-flags.md`](reference/template-flags.md).
