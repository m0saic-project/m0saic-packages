import type { MosaicColor } from "@m0saic/types";

/**
 * Ensure a `MosaicColor` carries an opaque alpha (`@1.0`) suffix so it
 * renders as a solid bg fill on alpha-bearing output formats (rgba PNG,
 * yuva420p video, etc.).
 *
 * **Why this exists.** The engine's bgFill step
 * (`packages/core/src/ffmpeg/ffmpegCommands.ts` — see `mosaicBackground`)
 * forces the bg's alpha to `0.0` (fully transparent) when the output
 * format has alpha, *unless* the color already carries an explicit
 * `@<alpha>` suffix. That default exists for translucent watermark
 * templates (e.g. `qr-stamp/still/v1`) that want the bg to vanish on
 * alpha output so downstream compositing math works.
 *
 * Templates that want a **solid** bg on the same alpha-output formats
 * have to opt in via the `@<alpha>` suffix. Forgetting it is silent — the
 * `backgroundColor` field is set, typechecks fine, and the PNG comes out
 * fully transparent. This helper centralizes the knowledge in one place
 * so template authors aren't on the hook for remembering.
 *
 * Behavior:
 * - `undefined` → `undefined`. Preserves the "no bg, keep alpha gaps"
 *   intent so transparent-output templates pass through cleanly.
 * - Already carries `@<alpha>` (e.g. `"#ffffff@0.6"` for a translucent
 *   card) → returned as-is. Respects explicit alpha, including
 *   semi-opaque values.
 * - Otherwise (raw hex like `"#ffffff"` or named color like `"black"`)
 *   → returns `${c}@1.0`.
 *
 * @example
 * ```ts
 * const bg = transparentBackground
 *   ? undefined
 *   : mode === "dark" ? "#000000" : "#ffffff";
 *
 * return {
 *   // ...
 *   ...(bg !== undefined ? { backgroundColor: solidBackground(bg) } : {}),
 * };
 * ```
 */
export function solidBackground(c: undefined): undefined;
export function solidBackground(c: MosaicColor): MosaicColor;
export function solidBackground(
  c: MosaicColor | undefined,
): MosaicColor | undefined;
export function solidBackground(
  c: MosaicColor | undefined,
): MosaicColor | undefined {
  if (c === undefined) return undefined;
  if (typeof c === "string" && c.includes("@")) return c;
  return `${c}@1.0` as MosaicColor;
}
