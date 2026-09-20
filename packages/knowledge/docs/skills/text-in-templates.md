# Text in templates

How to put text into a template without it silently clipping.

---

## ⚠️ The rule that bites: nothing soft-wraps

**No rasterizer in m0saic wraps text.** A long string in a single `MosaicTextLayer`
renders as **one line and clips off the cell** — no error, no warning, no visual cue
in the plan. It just disappears past the edge.

This is true for **both** rasterizers:

- `drawtext` (ffmpeg) has no soft-wrap.
- `rasterizer: "svg"` converts glyphs to outlines via `@m0saic/text` — there is no
  wrapping logic in that path either.

**Any template that puts user-typed or composed strings into text MUST pre-break
them.** Use `multilineTextLayers` (below); don't hand-roll.

The failure is worst with user data — a title that fits every fixture and clips on the
one real input nobody tested.

---

## The source shape

A text tile is one `MosaicTextSource` per leaf cell:

```ts
{
  type: "text",
  style: { fontSize, fontColor, fontFamily },   // source-level, applies to all layers
  layers: [ /* MosaicTextLayer[] — one per LINE */ ],
  placement: { hAlign, vAlign },                // optional if layers carry their own
  visual: { backgroundColor },                  // solid fill behind the text
  renderMode: { kind: "image" },                // see below
}
```

A `MosaicTextLayer` is
`{ content: { kind: "literal", text } | { kind: "expr", expr }, style?, placement? }`.
Layers stack within one source; each may carry its own `placement` (including a
`yExpr`) to position itself in the cell.

### Two orthogonal knobs — don't confuse them

| Knob | Values | Question it answers |
|---|---|---|
| `renderMode` | `{ kind: "image" }` \| `{ kind: "video" }` | single RGBA frame, or an RGBA video for `ctx.target.durationMs`? |
| `rasterizer` | `"drawtext"` \| `"svg"` | which mechanism turns glyphs into pixels? |

**Choose the rasterizer on dynamism**, per `templates/patterns/perf-authoring-rules.md`
**R9**: `svg` for static text (a mask + colour tile — no drawtext, no per-frame
shaping), `drawtext` only when the text is genuinely per-frame dynamic. `svg` does
**not** support expressions; the fallback to drawtext for those is correct. Read R9
before scaling up — it carries the density budgets (hundreds of glyph masks in one
panel approach the argv wall) and the note that **the app fits text wider than the
CLI**, so leave generous fixed-font margins.

---

## Helpers — use these, don't hand-roll

All from `@m0saic/template-utils`:

| Helper | Signature | Use |
|---|---|---|
| `multilineTextLayers` | `({ text, maxCharsPerLine, fontSize, lineHeightRatio?, hAlign? }) => MosaicTextLayer[]` | **The one you usually want.** Wraps and returns one centred layer per line, vertically stacked via `yExpr`. Feed straight into `layers`. |
| `wrapText` | `(text, maxCharsPerLine) => string[]` | Greedy word-wrap by character count. Never splits a word. Use when you need the lines themselves. |
| `makeErrorMosaic` | `(message, { width, height, title?, errorCode?, … })` | Fail-fast card that **also sets `engine.renderStatus = "error"`** — the UI disables Make, and the CLI exits **3** (RENDER DEGRADED) after writing the card. Use for invalid input, and **pass `errorCode`**: it is what lands in the `--report` sidecar's `renderErrorCodes` (omit it and the caller only sees `ENGINE_ERROR`). See `runtime/cli-usage.md` → "Exit codes". |
| `makeStubMosaic` | `(label, { width, height, backgroundColor?, textColor?, note? })` | "STUB" placeholder. Auto-sizes the font. Does **not** mark an error — validate-only still passes. |
| `animateNumbersInText` | `(text, { startSec, durationSec, ease }) => string` | Returns an `expr` that counts numbers up on intro (KPI / stat cards). |
| `fadeInExpr` | `(startSec, durSec, ease?) => string` | Overlay-alpha expression for a timed fade-in. |

> `multilineTextLayers` returns `[]` for empty input — **check and omit the source**
> rather than emitting a text tile with no layers.

> `makeErrorMosaic` vs `makeStubMosaic` is a real distinction, not a style choice:
> error blocks the render path, stub does not. Reach for stub only when "not
> implemented yet" is a legitimate state.

Both size their cards from dimensions **you** pass — pass `ctx.target.{width,height}`,
never `ctx.output` (see `rendering-model-contract.md` Rule 5b).

---

## Sizing

`maxCharsPerLine` is coarse — glyph widths vary by font. Start from:

```
maxCharsPerLine = floor(cellWidthPx / (fontSize * 0.55))
```

and tune per font. **Scale `fontSize` to the cell** — `clamp(width / N, lo, hi)` —
rather than hard-coding pixels, so the template survives a resolution change.

### Canonical wrapped, centred text tile

```ts
import { multilineTextLayers } from "@m0saic/template-utils";

function textTile(text: string, fontSize: number, bg: string, cellWidth: number) {
  const maxChars = Math.max(8, Math.floor(cellWidth / (fontSize * 0.55)));
  return {
    type: "text" as const,
    style: { fontSize, fontColor: "#ffffff", fontFamily: "Arial" },
    layers: multilineTextLayers({ text, maxCharsPerLine: maxChars, fontSize }),
    visual: { backgroundColor: bg },
    renderMode: { kind: "image" as const },
  };
}
```

---

## Related

- **`templates/patterns/perf-authoring-rules.md` R9** — rasterizer choice + density budgets.
- **`templates/construction-strategy.md`** — "Drawing shapes: SVG inline-mask on a
  color source". Text is for *words*; never draw a shape with a glyph — ffmpeg drops
  `▲`/`▼`/emoji as tofu.
- **`templates/rendering-model-contract.md` Rule 5b** — size error/stub cards off
  `ctx.target`.
