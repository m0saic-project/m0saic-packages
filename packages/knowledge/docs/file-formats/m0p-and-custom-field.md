# File Formats: `.m0p` Packs and the `custom.*` Sidecar Pattern

## Purpose

Reference for m0saic's file-format model. Covers:

- When to use `.m0` vs. `.m0c` vs. `.m0p` (see §1's note for the two later arrivals, `.m0g` and `.m0v`).
- How to read, write, and convert between the formats via `@m0saic/dsl-file-formats`.
- The `custom: unknown | null` field — the canonical persistence carrier for tool-defined sidecar data.
- The label and pack validators that ride on top of the formats.

These features shipped together in April 2026. They are foundational to v2 work — most v2 features (animation tracks, constraint maps, region asset bindings, mask sets, rank sets, Figma round-trip, SVG round-trip) persist in `custom.*` until convergence justifies promotion to first-class fields.

> **Source of truth:** [https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src). Types in [`types.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/types.ts); pack format in [`m0p/m0pFile.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/m0p/m0pFile.ts); conversions in [`conversions.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/conversions.ts); validators in [`validate/`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/validate).

---

## 1. The file formats — five, not three (updated 2026-07-26)

| Format | Shape | When to use |
|---|---|---|
| `.m0` | Canonical text DSL + lightweight headers (incl. the `m0agent:*` block) | One layout, one canvas, no labels / no derive image / no per-region metadata |
| `.m0c` | JSON: DSL + StableKey-keyed labels + derive image + meta | One layout, with labels / overlays / derive thumbnail / `custom.*` |
| `.m0g` | `.m0c`-shaped JSON with `format: "m0g"` + the `M0cGold` `gold` block | A **m0saic golden** ("mogging") — a tried-and-true, signed-off layout; `#mogging` comment-line convention (`types.ts`) |
| `.m0p` | JSON: pack of `.m0c`-shaped variants under shared identity | Multiple coordinated variants (cross-canvas, brand pack, content set, themed collection) |
| `.m0v` | JSON: `outputs` / `assets` / `custom` (`src/m0v/m0vFile.ts`) | **Mosaic Vocabulary** — user-tier shared brand language: output presets, palette, typography, asset paths. CLI `--m0v <path>`; `m0saic open` accepts it |

`.m0` and `.m0c` are unchanged by the later formats' arrival — each is purely additive.
This doc covers `.m0`/`.m0c`/`.m0p` in depth; `.m0g` and `.m0v` have their own type
homes in the same package (conversion helpers for them are not exported — the §3
matrix below is `.m0`/`.m0c`/`.m0p` only, by design).

All JSON formats (and `.m0` via its header block) also carry the top-level
`agent` slot (`M0AgentMeta`) used by the sandbox iteration protocol — see
[`m0-iteration-protocol.md`](m0-iteration-protocol.md).

---

## 2. `.m0p` — multi-variant pack format

A single JSON container that bundles multiple `.m0c`-shaped layout variants under one shared identity.

```ts
type M0pFile = {
  format: "m0p";
  version: 1;
  created: string;             // ISO timestamp
  app?: string | null;
  appVersion?: string | null;
  meta?: M0FileMeta | null;
  regions?: M0pRegions | null;
  custom?: unknown | null;     // pack-level custom JSON
  variants: Record<string, M0pVariantEntry>;
};

type M0pVariantEntry = {
  meta?: M0FileMeta | null;    // overrides pack-level when present
  size: { width: number; height: number };
  m0: M0String;
  labels?: Record<StableKey, { text: string }> | null;
  derive?: { image: string | null };
  custom?: unknown | null;     // per-variant custom JSON
};
```

**Variant keys** validated as `^[a-z0-9][a-z0-9-]*$` (kebab-case). Examples: `desktop`, `mobile`, `square`, `story`.

**Pack-level fields are defaults.** Per-variant overrides for `meta` are supported but only emitted when they differ — roundtripping doesn't manufacture spurious overrides.

**Pack-level `regions` registry** declares the shared semantic vocabulary (e.g. `headline`, `hero`, `logo`, `cta`) that variants reference *by label text* (not by StableKey — keeping StableKey purely structural).

**Deterministic serialization.** Variant keys sorted alphabetically, region keys sorted, label keys sorted by StableKey, DSL canonicalized, fixed field order, 2-space indent + trailing newline. Byte-stable roundtrip.

**Forward-compatible.** Unknown fields silently preserved at every level (same posture as `.m0c`).

Live type definitions: see `M0pFile`, `M0pVariantEntry`, `M0pRegions`, `M0FileMeta`, `M0cFile`, `M0File` in [`types.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/types.ts). **Trust the types over the snippets above** if they ever drift.

---

## 3. The 3×3 conversion matrix

`@m0saic/dsl-file-formats` exposes one canonical entry point for every direction:

| from \ to | `.m0` | `.m0c` | `.m0p` |
|---|---|---|---|
| `.m0` | identity | `upgradeM0ToM0c` | `upgradeM0ToPack` |
| `.m0c` | `downgradeM0cToM0` ⚠ | identity | `bundleM0cIntoPack` |
| `.m0p` | `extractVariantAsM0` ⚠ | `extractVariantAsM0c` | identity |

⚠ = lossy by design. Named `downgrade*` / `extract*` so the data loss is visible at the call site rather than hidden in an `as`-style cast.

All conversions are pure object transforms — no I/O, no async.

`upgradeM0ToM0c` / `downgradeM0cToM0` / `upgradeM0ToPack` / `extractVariantAsM0` live in [`conversions.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/conversions.ts). `bundleM0cIntoPack` / `extractVariantAsM0c` live in [`m0p/m0pFile.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/m0p/m0pFile.ts).

**Discovery helpers** (also exported from `m0p/m0pFile.ts`): `listVariantKeys(pack)` (alphabetical), `getVariant(pack, key)`, `findVariantBySize(pack, w, h)`.

---

## 4. The `custom: unknown | null` field

Both `.m0c` and `.m0p` carry a `custom` field at every level — pack root + per-variant. JSON round-trips byte-stable; the format treats it as opaque.

**Why opaque.** Tool-defined metadata that the format spec does not bless. Tools that care read `custom.<key>`; tools that don't ignore it. No validator commitment, no conversion-matrix obligation, no schema enforcement.

**The persistence pattern for v2 sidecar data.** Multiple v2 features use `custom.*` keys:

| `custom.*` key | What it carries | Owning ticket / surface |
|---|---|---|
| `custom.animation` | Animation tracks + keyframes | ED-4 (animation timeline) |
| `custom.constraints` | Per-tile / per-region constraint maps | SL-8 (constraints layer) |
| `custom.assets` | StableKey → asset binding | ED-10a (asset registry) |
| `custom.maskSets` | Named subsets of StableKeys | ED-10b (mask editor) |
| `custom.rankSets` | Named ordered StableKey lists | ED-10c (rank editor) |
| `custom.figma` | Figma round-trip metadata | XP-4 (Figma plugin) |
| `custom.svg` | SVG import round-trip metadata | ED-7 / XP-3 |

**Promotion rule.** A shape lives in `custom.*` first. Promote to a first-class field only when (a) ≥2 tools have converged on the shape, and (b) a real exchange need exists. This is how the format stays additive without committing to schemas that need to evolve.

**Already promoted (first-class per-frame fields).** Several shapes have walked this path and now sit next to `labels` on both `M0cFile` and `M0pVariantEntry`, every one keyed by `StableKey` (structural identity that survives splits / overlays / repacks) — `masks` (`{ localPath, bounds }` inline silhouettes), `fill` (`{ color?, mediaRef? }` rect fill), `rankSets` (named sweep-progress maps), and `insets` (`{ top, right, bottom, left }`, per-edge fractions 0..1 of the frame's cell). **Trust `types.ts` for the live field list.** Notes on `insets` (the newest, shipped 2026-07):

- It's the render-time box a source shrinks its cell to — promoted from the engine-only `MosaicSource.placement.inset`. It's the **resolved projection** of `placement.inset`'s `MosaicBoxFrac` superset (`number | {x,y} | per-side`), collapsed to the one four-edge wire form at the extraction boundary (the app's `resolveBoxFrac`), byte-identical to ViewFrame's `insetBoxes` prop. If `MosaicBoxFrac` grows a new authoring form, the `resolveBoxFrac` call sites resolve it — `M0cInset` doesn't change (see `MIRRORED_TYPES.md`).
- It's the persisted home for **quantization-hostile** layout: quantize cells outward onto a coarse divisor lattice, then recover the exact painted rect at render time via half-pixel-centered fractions (`(n + 0.5) / dim`; the engine floors `frac * dim`) — zero drift at the authored canvas size, ≤1px degradation at other sizes. This is the `placeInsetRects` launder given a file-format home.
- **Null semantics follow `fill`, not `masks`:** no inner explicit `null` (key absence = "no inset"); all-zero entries are dropped by normalizer and parser.
- `validateInsets` warns (never errors — the engine clamps): `ORPHANED_INSET`, `INSET_OUT_OF_RANGE` (edge < 0 or ≥ 1), `INSET_COLLAPSES_FRAME` (`top+bottom ≥ 1` or `left+right ≥ 1`). Rolled into `validatePack` as `PackVariantIssues.insetIssues`.
- **Derived-vs-sidecar precedence, no merge logic:** Make / Compose paint *derived* insets from live sources (`buildGeometryDecor`); Layout paints the *sidecar* (`m0cExtras.insets`). Layout has no sources → no conflict. The Make → Layout handoff converts derived → sidecar once at send time; the Layout → Compose join writes the sidecar back onto `sources[i].placement.inset`. A public `(m0, inset map) → exact rects` adapter is deferred until a real caller appears.

**Default value.** `null`. Round-tripping a file without a `custom` field through serialize→parse→serialize is byte-stable.

---

## 5. Label and pack validators

**Four** pure validators ship in `@m0saic/dsl-file-formats` ([`validate/`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/validate)): `validateLabels`, `validateFill`, `validateInsets` (§4 above), and `validatePack`. All return structured results — no React, no DOM, no parsing inside. This section details the label + pack pair.

Result types: `LabelValidationResult`, `PackValidationResult`, `PackVariantIssues` in [`validate/types.ts`](https://github.com/m0saic-dsl/m0/blob/main/packages/dsl-file-formats/src/validate/types.ts). Empty-result sentinels: `EMPTY_LABEL_RESULT`, `EMPTY_PACK_RESULT`.

### `validateLabels`

```ts
validateLabels({
  validStableKeys: Set<StableKey>,
  labels: Record<StableKey, { text: string }>,
}): LabelValidationResult;
```

Flags labels whose `stableKey` no longer maps to a frame in the layout's parsed frame set. Surfaces "you split the frame I was labeled on, my label is now floating in space."

The caller supplies the parsed `validStableKeys` set so editors can reuse a parse they were already going to do (`<ViewFrame>` runs `parseM0StringComplete` on every geometry change; the validator just consumes its output).

### `validatePack`

```ts
validatePack(
  pack: M0pFile,
  opts?: { liveVariantOverride?: ...; parseCache?: ... }
): PackValidationResult;
```

Three classes of issue:

1. **Region coverage.** Variants missing required regions (per `pack.regions`).
2. **Region duplicates.** Variants where multiple labels resolve to the same region (case-insensitive duplicate).
3. **Per-variant orphan labels.** Same shape `validateLabels` produces, scoped per variant.

Returns aggregates at the pack level + a per-variant breakdown.

---

## 6. When to use what — decision tree

- One layout, one canvas, no metadata → **`.m0`**
- One layout, with labels / overlays / derive image → **`.m0c`**
- One layout, with tool-defined sidecar data → **`.m0c` with `custom.*`**
- Multiple coordinated variants of one design (responsive) → **`.m0p`**
- Multiple unrelated layouts under shared identity (brand pack, content set) → **`.m0p`**
- Anything format-doesn't-bless-yet → **`custom.*` on the appropriate format**

---

## 7. Common mistakes to avoid

- **Don't promote a `custom.*` shape to a first-class field early.** Wait for ≥2 tools on the shape.
- **Don't put random data on the root of `.m0c` or `.m0p`.** It will be silently preserved as an unknown field but won't go through `custom.*` validation hooks.
- **Don't use StableKeys as region names.** Regions reference labels by *text*, not by StableKey, so labels survive structural edits while regions stay stable.
- **Don't skip `validateLabels` after structural edits.** Splitting a frame can orphan labels; the validator surfaces this immediately.
- **Don't rely on `.m0p` variant order.** Serialization sorts variant keys alphabetically. If your tool depends on order, store it explicitly in `custom.*`.

---

## See also

- `../handbook/dsl-rules.md` — DSL grammar for the m0 strings each variant carries.
- Quality scoring works against any of these formats — internal: `.ai/moat/skills/score-layout-primitive.md`.
- `../skills/identity.md` — the StableKey contract, overlay namespace, and identity-continuity rules that labels and regions ride on.
