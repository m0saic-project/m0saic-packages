# MosaicPlacementProps

> **Source of truth:** [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/source/source.ts#L99-188`](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/source/source.ts); runtime validation in https://github.com/m0saic-project/m0saic-packages/blob/main/packages/platform/src/mosaic/validate/validateSources.ts; cover-crop math in the render engine source (not published).

## The union

`MosaicPlacementProps = MosaicPlacementContain | MosaicPlacementCover`
(`source.ts:188`) — a discriminated union on `fit`. Fields that are meaningless
on one fit are declared `?: never` on that variant, so misuse is a **compile
error**, not a silent no-op:

| Field | Contain (`fit?: "contain"`, default) | Cover (`fit: "cover"`) |
|---|---|---|
| `inset` | ✅ (`source.ts:128`, on the shared base) | ✅ |
| `padding` | ✅ (`source.ts:152`) | ❌ `padding?: never` (:166) |
| `hAlign` / `vAlign` | ✅ (:133-134) | ❌ `hAlign?: never` / `vAlign?: never` (:162-163) |
| `focusX` / `focusY` | ❌ `focusX?: never` / `focusY?: never` (:155-156) | ✅ (:177, :185) |

Defaults when omitted: `fit="contain"`, `hAlign="center"`, `vAlign="middle"`,
no `inset`, no `padding`; on cover, focus defaults to centered (`0.5`).

## Boxes: tile rect → inset → padding → content box

- **Tile rect**: the rectangle the layout engine allocates to the source.
- **`inset?: MosaicBoxFrac`** (both fits): shrinks the destination rect **before**
  fit math. Role: the **slot-level gutter**, typically owned by the composing
  layer. Fractions of **tile size**.
- **`padding?: MosaicBoxFrac`** (contain-only): extra dead space reserved
  **inside** the inset box, before contain math. Role: content-level breathing
  room, composing with (not fighting) the slot's `inset`. Fractions of the
  **inset box** (= of tile size when `inset` is unset; the engine resolves
  `padLeft = insetBox.width * padding.left`). Cover forbids it — "cover +
  padding would create intentional dead space" — enforced by the type AND the
  `*_COVER_PADDING` validator (`validateSources.ts:561`).
- **`MosaicBoxFrac`** (`source.ts:85-97`): `0.02` (all sides) | `{x, y}`
  (symmetric per axis) | `{top, right, bottom, left}` (per-side overrides win).
  All fractions 0..1; validators require each side in `[0, 0.49]`.
- **Content box**: the tile rect after `inset` (and, for contain, `padding`).

⚠️ **Both are applied BEFORE the per-tile effects chain.** Quoting the `inset`
JSDoc (`source.ts:117-121`): "Applied before the per-tile effects chain — the
content's buffer IS the shrunk box, so effects that need headroom
(`effects.rotate`) clip against it. Rotation headroom must be real geometry
instead: a nested child whose declared `size` equals the padded box (see
watermark page-mode `buildPaddedInstanceChild`)."

## Contain

Uniform scale, aspect preserved, so the media fits entirely inside the content
box. Leftover per axis: `leftoverX = contentW - scaledW`, `leftoverY = contentH - scaledH`.

Alignment maps to factors — `left/top = 0`, `center/middle = 0.5` (default),
`right/bottom = 1` — and placement is:

```
x = contentX + (leftoverX > 0 ? leftoverX * hFactor(hAlign) : 0)
y = contentY + (leftoverY > 0 ? leftoverY * vFactor(vAlign) : 0)
```

**Exact-fit invariant (still observable, and required):** on an axis with zero
leftover, varying the alignment MUST NOT change output — byte-identical frames.
This is the surviving observability check now that cover-side misuse is
unrepresentable.

## Cover

Uniform scale, aspect preserved, so the media fully covers the content box;
overflow is cropped to exactly `contentW × contentH`; placed at
`(contentX, contentY)`. No leftover space, so alignment is unrepresentable.

### Crop anchor: `focusX` / `focusY`

```ts
placement: { fit: "cover", focusX?: number, focusY?: number }   // 0..1 each
```

**Offset per axis = `(scaled - content) * focus`.** `0` keeps the leading edge
(left/top), `0.5` centers (default), `1` keeps the trailing edge. Motivating
case: portrait photos put faces near the top — `focusY: 0` keeps the head.

- **Byte-identity guarantee.** Focus absent or exactly `0.5` emits the exact
  legacy `(in_w-W)/2` string — helper `coverCropOffsetExpr`
  (the render engine source (not published)). Existing goldens do not move.
- **Enforced twice.** Type level: `focusX?: never` on contain. Runtime:
  `*_FOCUS_REQUIRES_COVER` (https://github.com/m0saic-project/m0saic-packages/blob/main/packages/platform/src/mosaic/validate/validateSources.ts#L575)
  plus range checks `*_INVALID_FOCUSX` / `*_INVALID_FOCUSY` in `[0, 1]`
  (`validateFocus`, `validateSources.ts:502`). Note these live in **platform**,
  not core.
- **Also steered by focus:** `zoomInPercent`'s zoom crop on cover tiles
  (contain + zoom stays centered), and `doc.backgroundImage`'s cover fill.
- **Not `effects.camera`.** Same focus vocabulary, different layer: the camera
  is the animatable zoom/pan downstream on the already-cropped content box;
  placement focus is the static, plan-time fit-crop anchor. They compose.
- **Web parity:** `GeometricPreview` maps cover focus to CSS
  `object-position: ${fx*100}% ${fy*100}%` — identical percentage math.

## Historical note

Pre-v2 versions of this spec carried "for `fit="cover"`, `hAlign`/`vAlign`
MUST NOT affect output" invariants. The union now declares those fields `never`
on cover (verified against `source.ts` 2026-07-27), so the misuse is
unrepresentable and those invariants are moot — only the contain exact-fit
invariant above remains testable.
