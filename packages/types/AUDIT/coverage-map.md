# Source × operator visual coverage map

The Phase 2 visual-test mandate (see [epic.md](../../../epic.md)).

Every pixel-affecting cell — every `<source variant> × <operator>` pair — must
have a visual golden test in `packages/core/__tests__/`. The cross product
below is the closed enumeration; missing cells are Phase 2 exit blockers.

Codename convention: `V:<source>×<operator>[=<value>]`. See [README](./README.md).

---

## Status

Tracked per source variant. `🟢` = every operator covered with a passing golden;
`🟡` = some cells covered, gaps documented below; `⬜` = not yet enumerated.

| Source | Status |
|---|---|
| `source.media` | 🟡 enumerated, gaps below |
| `source.text` | ⬜ |
| `source.mosaic` (nested) | ⬜ |
| `source.lavfi` | ⬜ |
| `source.ref` | n/a — `needs-wiring` (Phase 3c); enumerate after engine resolves refs |
| `source.data` | n/a — non-pixel |
| composition (overlays, slots, refs) | ⬜ |

---

## Operator axis

Operators that get applied to most source variants. The enumeration walks
each variant × each applicable operator × discrete value buckets.

| Operator | Codename axis | Apply to | Cell strategy |
|---|---|---|---|
| `placement` (contain/cover × hAlign × vAlign × inset × padding) | `T:source.placement.*` | media, text, mosaic, lavfi, ref | Enumerate `fit` × discrete `hAlign` × discrete `vAlign`; spot-check inset/padding boundary values |
| `effects.rounding` | `T:source.effects.rounding.*` | all renderable | `borderRadius` at {0, 0.1, 0.5, 1.0}; `cornerStyle` at `rounded`/`pill` |
| `effects.stroke` | `T:source.effects.stroke.*` | all renderable | width × color × alpha × inner-position |
| `effects.dropShadow` | `T:source.effects.dropShadow.*` | all renderable | non-zero dx/dy/blur with a contrast color |
| `effects.rotate` | `T:source.effects.rotate` | all renderable | {0, 45, 90, 180, 359} degrees |
| `effects.blur` | `T:source.effects.blur` | all renderable | {0, 5, 20} px |
| `effects.zoomInPercent` | `T:source.effects.zoomInPercent` | all renderable | start vs end frame |
| `effects.fadeInMs` | `T:source.effects.fadeInMs` | all renderable | mid-fade frame |
| `effects.fadeOutMs` | `T:source.effects.fadeOutMs` | all renderable | mid-fadeout frame |
| `mask` | `T:source.mask.kind=*` | all renderable | `inline-mask` × one path+bounds; `alpha-image` × one asset |
| `visual.backgroundColor` | `T:source.visual.backgroundColor` | all renderable | contain-letterbox with non-black bg |
| `visual.opacity` | `T:source.visual.opacity` | all renderable | {0.25, 0.5, 1.0} |
| `visual.opacityExpr` | `T:source.visual.opacityExpr` | all renderable | time-varying expression at start/middle/end |
| `overlay.blendMode` | `T:source.overlay.blendMode=*` | all renderable | `normal`/`add`/`screen`/`multiply` |
| `overlay.xExpr`/`yExpr`/`enable` | `T:source.overlay.*` | all renderable | static + time-varying expressions |
| text.layers, text.style | text-only | text | per-layer override precedence, font-resolution fallback |
| text.renderMode | text-only | text | `image` vs `video` |
| lavfi.fitMode | lavfi-only | lavfi | `tile` vs `content` |
| lavfi.size | lavfi-only | lavfi | DEFERRED — see source.md pruning candidate |
| mosaic-source recursion depth | mosaic-only | mosaic | 1 level deep, 2 levels deep (grandchild) |
| ref mirroring | ref-only | ref | DEFERRED until 3c lands |

---

## Composition operators (DSL-level, not on individual sources)

| Codename | Operator | Test reference |
|---|---|---|
| `V:composition×overlay` | `{}` overlay region | TBD |
| `V:composition×null-slot` | null-tile in `[…]` | TBD |
| `V:composition×zero-slot` | `0` zero-tile | TBD |
| `V:composition×row-vs-column` | `(…)` vs `[…]` orientation | TBD |
| `V:composition×ref-mirror` | `MosaicRefSource` chain into composition | n/a until 3c |

---

## `source.media` cross product (exemplar — populate this pattern for the others)

`media` is the worst-case for cells (covers image, video, and audio sub-axes).
`audio` cells skip the visual operators entirely.

| Cell codename | Value | Golden file | Status |
|---|---|---|---|
| `V:source.media×mediaType=image` | — | TBD | gap |
| `V:source.media×mediaType=video` | — | `packages/core/__tests__/mediaSource.spec.ts` | partial |
| `V:source.media×mediaType=audio` | — | n/a | non-visual |
| `V:source.media×placement=contain×hAlign=center×vAlign=middle` | defaults | TBD | gap |
| `V:source.media×placement=contain×hAlign=left×vAlign=top` | corner case | TBD | gap |
| `V:source.media×placement=contain×hAlign=right×vAlign=bottom` | corner case | TBD | gap |
| `V:source.media×placement=cover` | — | TBD | gap |
| `V:source.media×placement=contain×inset=0.1` | uniform inset | TBD | gap |
| `V:source.media×placement=contain×padding={top:0.05}` | per-side padding | TBD | gap |
| `V:source.media×effects.rounding.borderRadius=0` | square (default) | TBD | gap |
| `V:source.media×effects.rounding.borderRadius=0.1` | mild rounding | TBD | gap |
| `V:source.media×effects.rounding.borderRadius=0.5` | strong rounding | TBD | gap |
| `V:source.media×effects.rounding.cornerStyle=pill` | pill (overrides radius) | TBD | gap |
| `V:source.media×effects.stroke.width=0.02×color=#ff0000` | inner red stroke | TBD | gap |
| `V:source.media×effects.dropShadow.dx=10×dy=10×blur=8` | drop shadow | TBD | gap |
| `V:source.media×effects.rotate=45` | rotation | TBD | gap |
| `V:source.media×effects.rotate=90` | rotation | TBD | gap |
| `V:source.media×effects.blur=10` | gaussian | TBD | gap |
| `V:source.media×effects.zoomInPercent=0.03` | start frame | TBD | gap |
| `V:source.media×effects.zoomInPercent=0.03+endframe` | end frame | TBD | gap |
| `V:source.media×effects.fadeInMs=500+midframe` | mid-fade | TBD | gap |
| `V:source.media×effects.fadeOutMs=500+midframe` | mid-fadeout | TBD | gap |
| `V:source.media×mask=inline-mask` | one inline silhouette | TBD | gap |
| `V:source.media×mask=alpha-image` | grayscale PNG | TBD | gap |
| `V:source.media×visual.backgroundColor=#0000ff` | letterbox blue | TBD | gap |
| `V:source.media×visual.opacity=0.5` | half-transparent | TBD | gap |
| `V:source.media×visual.opacityExpr=t/2+startframe` | time-varying start | TBD | gap |
| `V:source.media×visual.opacityExpr=t/2+endframe` | time-varying end | TBD | gap |
| `V:source.media×overlay.blendMode=normal` | default | TBD | gap |
| `V:source.media×overlay.blendMode=add` | additive | TBD | gap |
| `V:source.media×overlay.blendMode=screen` | screen | TBD | gap |
| `V:source.media×overlay.blendMode=multiply` | multiply | TBD | gap |
| `V:source.media×overlay.xExpr=t*100+startframe` | scrolling x | TBD | gap |
| `V:source.media×overlay.alpha=if(lt(t\,1)\,t\,1)` | time-varying alpha | TBD | gap |

That's **~38 cells for `media` alone**. Same density across `text`, `lavfi`, `mosaic`. Plus composition cells.

---

## Methodology notes

1. **Value selection.** Pick discrete buckets that span the boundaries: 0 / default / typical / max. Not every numeric value needs a golden — `effects.rotate=37` and `effects.rotate=38` produce indistinguishable expectations. Document the bucket choice next to each cell.

2. **Frame selection for time-varying cells.** When a cell is time-varying (`opacityExpr`, `zoomInPercent`, `fadeInMs`, etc.), the golden captures a specific frame. Use start / mid / end conventions, suffix the codename with `+startframe`/`+midframe`/`+endframe`.

3. **Cross-cell interactions.** Two operators applied together can interact (`rotate=45 × dropShadow` looks different from each in isolation). The matrix does NOT enumerate every pairwise combination — that's a combinatorial explosion. We test individual cells; cross-interactions get scenario tests in Phase 4 hero scenarios.

4. **Audio cells.** `mediaType=audio` skips visual operators entirely (per `MosaicMediaSource` JSDoc — visual fields are ignored for audio). Audio behavior is tested via spectrum/waveform/duration assertions, not pixel goldens.

---

## Open questions

1. **Mask asset provenance.** `V:source.media×mask=alpha-image` needs a real grayscale PNG checked in. Where do test mask assets live? Probably `packages/core/__tests__/__fixtures__/masks/`.

2. **Font availability for text goldens.** Text rendering depends on the system font. To keep goldens reproducible, all text-source goldens should use a font bundled with the test fixtures, not a system font.

3. **Composition cells need DSL fixtures.** `V:composition×overlay` etc. require minimal `.mosaic` test fixtures. Likely `packages/core/__tests__/__fixtures__/composition/` with one `.mosaic` per cell.

4. **Tolerance.** Image-diff goldens are platform-flaky (Mac vs Windows). The merge-gate routes through Windows; Mac dev allows N% pixel tolerance. The tolerance should be documented per cell once we know what mac↔win drift looks like in practice.
