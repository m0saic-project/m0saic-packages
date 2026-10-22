# Changelog

## 0.4.0 — 2026-10-22

### A cover can be a start page: `binding.value` answers, `editor.start`, own-size covers

- `src/meta/meta.ts`: `editor.binding.value` / `editor.bindings[].value?: string | number | boolean`. A binding
  with a value makes its rect ONE ANSWER: a click writes the value and no editor opens. A `choice` leaf takes one
  of its set's values, a `number` leaf a finite number, a basic `boolean` prop `true` / `false` (a boolean binds
  ONLY as an answer). A rect whose bindings ALL carry a value is an answer tile: one click writes every one (a
  "3 takes, one big and two small" card sets the count and the layout together).
- `src/meta/meta.ts`: `editor.start?: boolean`, a `renderCover()` page's Start: a click on the rect closes the
  cover and opens the template.
- `src/template/template.ts`: the `renderCover` contract gains the START PAGE: a cover may ask the few things a
  person decides first; on a cover an answer keeps the cover up and the host re-renders it with the new props
  (it shows what is picked); a cover that asks closes only on a start rect, its chip's close, Play or MAKE. A
  cover may return its OWN size (hosts show it at the size it returns), so a portrait template can open on a
  landscape start page.

**Compatibility.**

Additive (new optional fields; a doc widening). Hosts that do not know them ignore them: the rect stays an
ordinary binding, and a cover shows as it always has.

**Release notes.**

Ships with the next lockstep set, beside `@m0saic/platform`'s `bindingValue` (its entry of the same date).

## 0.3.1 — 2026-10-05

### The template catalog — what describes a template lives beside its code

The template convention from 0.3.1: a template's CODE is immutable once it ships; what DESCRIBES it lives in its
catalog sidecar, `<name>.catalog.json` beside the module, and may change after the code ships. New types:
`MOSAIC_TEMPLATE_CATALOG_FIELDS` (label, description, tags, platforms, channels, preview, internal,
primitive, deprecated), `MOSAIC_TEMPLATE_PROP_CATALOG_FIELDS` (a prop's label, description — the in-context hint —
placeholder, order, primary, collapsedByDefault), `MosaicTemplateCatalogEntry` (with `props`),
`MosaicTemplateCatalogSidecar` (the per-template file) and `MosaicTemplateCatalogFile` (the generated
`template-catalog.json` hosts read). `MosaicTemplateDeprecation` names the `deprecated` shape.

**Compatibility.**

Types only loosen; every existing template still type-checks. Hosts read the same `MosaicTemplate` fields — the
registry / repo loader fills them from the catalog.

### `editor.binding.kind` / `bindings[].kind` gain `"choice"`

The authored binding shape on a source (`src/meta/meta.ts`: `editor.binding.kind`, `editor.bindings[].kind`)
accepts `"choice"` — the leaf is one of a closed set (`constraints.oneOf` / a static `control.options` list),
picked and never typed. Hosts classify a basic closed-set prop as a choice by themselves; a `choice` declared on
a structured leaf is refused (no set to offer). Doc comment explains the case it exists for: a full-canvas card
bound to its theme `preset`.

**Compatibility.**

Additive (a wider union).

**Release notes.**

Ships with the 0.3.1 lockstep set.

## 0.3.0 — 2026-09-29

### ffmpeg failure classifier: the missing-codec hint names the one pinned build

The `missing-codec` hint in `telemetry/ffmpegFailure.ts` said "On Windows the bundled m0saic ffmpeg
may be LGPL (no libx264). Use `Tools → Upgrade ffmpeg`…". m0saic bundles no ffmpeg and there is no
LGPL rail any more (2026-09-22); the hint now reads "An ffmpeg built without --enable-gpl has no
libx264 / libx265. Install m0saic's pinned build (Tools → Toolchain, or `m0saic setup`)." Copy only —
the classifier's kinds, signals and enum keys are unchanged (the telemetry enum mirrors stay in sync).

### `"array"` is a declared prop type

`MosaicTemplatePropType` gains `"array"`. It was already a working prop type everywhere except the
type system: `classifyBindableProp` accepts it (`STRUCTURED_TYPES = ["json", "list", "array"]`), the
`objectRows` / `jsonModal` editors render it, and **19 props across 17 shipped templates** declare it
— through a `type: "array" as any` cast, because the union lacked the member.

### `template.bindings.unbound` — prop-binding provenance, declared

`MosaicTemplate` gains an optional `bindings?: { unbound?: Record<string, string> }`: `propKey` → why
that prop has no canvas handle. It is the declaration half of the new `bindingsDeclared` convention
(`@m0saic/template-utils`, THROW) — every prop that CAN carry a handle is either bound with
`bindProp` / `bindProps` / `bindPropPath` / `bindPropRect`, or named here with a reason.

### `hint` on a prop binding: one line, shown where the value is edited

`editor.binding` and each `editor.bindings[]` entry gain an OPTIONAL `hint?: string`: one plain-text
sentence that a host shows in context when a person edits the rect — what changing the value does and
what it looks like. Absent, hosts fall back to the prop's `description`. Not a convention gate: no
template is required to carry one.

**Compatibility.**

Additive. A 0.2.x host ignores the field; a 0.3.0 host reads it through `@m0saic/platform`
(`PropBindingRef.hint`) and `@m0saic/template-utils` (`bindProp(…, { hint })`, `withBindingHint`).

### `FLATTENED_STABLE_KEY_PATTERN` accepts the engine's own path keys (P34)

`isFlattenedStableKey("r/ov1c0/gcolc0/fc0")` was `false` against the published 0.2.0 types — and that
is the shape of EVERY key the engine mints (`m0StringParser`'s `makeStableKeySegment`: `r`, then group
`gcolc<N>` / `growc<N>`, frame `fc|pc|nc|uc<N>` and overlay `ov<depth>c<N>` segments, the grammar
`collectRefTargets.ts` parses). The pattern only knew the namespaced form (`c0_c1_intro_hero`).
A customer validating a `flattenedStableKey` before a cross-step ref got a refusal for a correct key
(prague-hiphop finding P34, filed from the customer's seat).

### install_completed carries a launch context: surface, invocation, --from source

The `install_completed` analytics event gains three OPTIONAL fields (`MosaicInstallContext`):
`surface` ∈ `"cli" | "desktop"` (which product minted the install), `invocation` ∈ `"npx" | "global"`
(how the CLI was launched — detected, never asked; Desktop omits it), and `source` (the user's own
`--from <slug>` / `M0SAIC_FROM`: a lower-case slug, 2–24 chars, `MOSAIC_INSTALL_SOURCE_RE`, exported).
New types `MosaicInstallSurface`, `MosaicInstallInvocation`, `MosaicInstallSource`, `MosaicInstallContext`.

**Compatibility.**

- Breaking: no. Every field is optional; a 0.2.x client's event validates as before. The server
  (`m0saic-site/lib/telemetry/validate.ts`) accepts the fields as optional and deploys FIRST.

**Release notes.**

Ships with the next lockstep publish. Hosts: the CLI stamps `surface: "cli"`, the detected
`invocation`, and a `--from` slug; Desktop stamps `surface: "desktop"`.

### `renderStatus: "incomplete"` — waiting on an input, not broken

`engine.renderStatus` gains a third value, `"incomplete"`: the template is waiting on an input only
the host can supply (a source not yet picked, takes not yet marked) and says so on a card. Reported
like an error — exit 3, `renderStatus` in the `--report` sidecar, a picture that says what is missing —
and it gates Make the same way, but Make never blames the last edit for it: no undo bar, no
"can't render" copy; instead it opens the pane or the tool that takes the input.

**Compatibility.**

Additive. A 0.2.x host that compares against `"error"` ignores the new value (the CLI's and Desktop's
collectors are updated in the same lockstep to count it).

## 0.2.0 — 2026-09-19

### First npm publish

`@m0saic/types` — Canonical TypeScript type definitions shared across every m0saic package — document, template, source, output, diagnostic, telemetry and secrets contracts, plus the `mosaic.schema.json` JSON Schema.

Published at the same source as the `m0saic` CLI 0.2.0 line (the CLI bundles its own copy). `0.x`: the surface is still being shaped; minor versions may change exports, and every change from here on carries a `pending-releases/types/` entry.
