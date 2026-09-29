# Changelog

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
