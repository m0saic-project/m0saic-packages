# MosaicColor

> **Source of truth:** [https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/colors/mosaicColor.ts](https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/colors/mosaicColor.ts) (the type), https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/colors/parseMosaicColors.ts (the validators), https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/colors/ffmpegNamedColors.ts (the named-color set).

## The type

Verbatim from `mosaicColor.ts:25`:

```ts
export type MosaicColor =
  | "none"
  | FfmpegNamedColor
  | HexColor
  | `${FfmpegNamedColor}${AlphaSuffix}`
  | `${HexColor}${AlphaSuffix}`
  | `none${AlphaSuffix}`;
```

Accepted: ffmpeg named colors (`"white"`, `"darkgray"`), hex (`"#fff"`,
`"#ffffff"`, `"#ff00ffaa"`), optional alpha suffix (`"white@0.5"`), and
`"none"` for transparency. `HexColor` is just `` `#${string}` `` — the type is
a **shape contract, not a full validator** (no hex well-formedness, alpha
range, or casing checks). Runtime validation is required on production paths.

## Validate with the real exports — never hand-roll

`@m0saic/types` ships the canonical pair; use them instead of local regexes
(a naive "has an `@` suffix" check accepts `"garbage@0.5"` — the real one
re-validates the base):

- **`toMosaicColor(input, ctx?)`** (`parseMosaicColors.ts:16`) — throws on
  invalid; returns a normalized (lowercased) `MosaicColor`. Splits any `@alpha`
  suffix, requires alpha finite and in `[0, 1]` (`:39-41`), then validates the
  **base** as `"none"`, a named color, or well-formed hex. `ctx` names the error.
- **`isMosaicColor(input)`** (`parseMosaicColors.ts:75`) — non-throwing type guard.
- **`FFMPEG_NAMED_COLORS_SET`** (`ffmpegNamedColors.ts:157`) — the membership
  set behind named-color validation.

Real caller: https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/charts/bar-graph/v1/internal/plot-area.ts#L30
imports it and uses it as `toMosaicColor("#ffffff", "PlotArea.BASELINE_COLOR")` (:83).

Where to validate: primitives validate incoming color props before passing them
to sources; heroes normalize early; template-utils must never emit invalid
`MosaicColor`. Never widen a field to `string` to silence the compiler.

## `"none"` and alpha

- `"none"` means transparent. The engine mapping to an ffmpeg color string
  lives in the render engine source (not published) (`ffmpegColor()`) —
  templates use `"none"` as intent, never hand-encoding the ffmpeg form.
- Prefer `visual.opacity` for compositing; use an alpha suffix only when
  transparency is part of the color's identity — never encode opacity in both.

## Ternary widening (common pitfall)

When assigning a `MosaicColor` via a conditional, TypeScript widens the literal
branches to `string` and the assignment fails:

```ts
const style = {
  borderColor: isDark ? "#fff" : "#000",  // ❌ widens to string — type error
};
```

✅ Use `as const` on the literals:

```ts
const style = {
  borderColor: (isDark ? ("#fff" as const) : ("#000" as const)),
};
```

✅ Or extract a shared style record so each value is a known literal:

```ts
const COLORS = { light: "#fff", dark: "#000" } as const;
const style = { borderColor: COLORS[isDark ? "dark" : "light"] };
```

The same trap fires on every `MosaicColor`-typed field reached via a ternary
(`borderColor`, `fillColor`, …). Fix at the literal site, never by widening.
