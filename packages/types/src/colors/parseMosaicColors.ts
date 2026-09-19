// colors/parseMosaicColor.ts
import type { MosaicColor } from "./mosaicColor";
import { FFMPEG_NAMED_COLORS_SET } from "./ffmpegNamedColors";

/**
 * Parse + validate a MosaicColor.
 *
 * Accepts:
 * - "none"
 * - named ffmpeg colors (case-insensitive)
 * - hex: #rgb, #rrggbb, #rrggbbaa (case-insensitive)
 * - optional alpha suffix: "@<number>" (we accept finite numbers, recommend 0..1)
 *
 * Throws on invalid input.
 */
export function toMosaicColor(input: string, ctx?: string): MosaicColor {
  const s = String(input).trim();
  const where = ctx ? ` (${ctx})` : "";

  if (!s) throw new Error(`Invalid MosaicColor${where}: empty string`);

  // Split optional alpha suffix: "<base>@<alpha>"
  const at = s.lastIndexOf("@");
  let base = s;
  let alpha: string | null = null;

  if (at !== -1) {
    base = s.slice(0, at);
    alpha = s.slice(at + 1);

    if (!alpha.length) {
      throw new Error(`Invalid MosaicColor${where}: missing alpha after '@' in "${s}"`);
    }
    const n = Number(alpha);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid MosaicColor${where}: alpha must be finite number in "${s}"`);
    }
    // Optional strictness (recommended):
    if (n < 0 || n > 1) {
      throw new Error(`Invalid MosaicColor${where}: alpha must be in [0,1] (got ${n} in "${s}")`);
    }
  }

  const baseLower = base.trim().toLowerCase();

  // "none" special
  if (baseLower === "none") {
    return (alpha ? (`none@${Number(alpha)}` as MosaicColor) : ("none" as MosaicColor));
  }

  // Named colors (case-insensitive)
  if (FFMPEG_NAMED_COLORS_SET.has(baseLower as any)) {
    return (alpha
      ? (`${baseLower}@${Number(alpha)}` as MosaicColor)
      : (baseLower as MosaicColor));
  }

  // Hex colors
  // allow #rgb, #rrggbb, #rrggbbaa
  const hex = base.trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex);
  if (m) {
    const normalizedHex = `#${m[1].toLowerCase()}`;
    return (alpha
      ? (`${normalizedHex}@${Number(alpha)}` as MosaicColor)
      : (normalizedHex as MosaicColor));
  }

  throw new Error(`Invalid MosaicColor${where}: "${s}"`);
}

/**
 * Type guard if you want non-throwing checks.
 */
export function isMosaicColor(input: unknown): input is MosaicColor {
  try {
    toMosaicColor(String(input));
    return true;
  } catch {
    return false;
  }
}