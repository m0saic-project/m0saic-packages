/**
 * Tolerant parsing + strict resolution for `MosaicRegionsValue` props —
 * the `picker: "regions"` wire contract in `@m0saic/types`.
 *
 * Split on purpose (the `timeRanges.ts` pattern):
 *
 * - **`parseRegionsValue`** is the BOUNDARY reader. `type: "json"` props
 *   are engine-permissive, and the value may arrive as the wrapper object
 *   (editor), a bare array (hand-authored `--props` shorthand), a JSON
 *   string (agent surfaces), with numeric strings for the px fields, or
 *   with extra keys a future editor added. Parsing coerces what it safely
 *   can, ignores unknown keys, and returns a typed error instead of
 *   throwing.
 * - **`resolveRegionsToPx`** is the SEMANTIC judge. Given the target
 *   canvas it rescales authored-canvas coordinates, rounds to integers,
 *   clamps into the canvas, and issues a per-region verdict — consumers
 *   degrade one bad region without killing the batch. Input order is
 *   preserved, never sorted: order is user intent.
 *
 * Pure module — no node imports, safe for the web bundle re-export.
 */

import type { MosaicRegion, MosaicRegionsValue } from "@m0saic/types";
import { isValidM0String, parseM0StringToLogicalFrames } from "@m0saic/dsl";

export type ParseRegionsResult =
  | {
      ok: true;
      canvas?: { w: number; h: number };
      regions: MosaicRegion[];
      /**
       * The m0-native flavor: the value carried a LAYOUT instead of
       * coordinates ("a series of rects is always expressible as m0").
       * Resolution-independent — resolve to px rects against the target
       * canvas with {@link regionRectsFromM0}; `regions` is empty here.
       */
      m0?: string;
    }
  | { ok: false; error: string };

/** Coerce a number-ish value (number, or numeric string) to a finite number. */
function coercePx(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseOneRegion(entry: unknown, index: number): { ok: true; region: MosaicRegion } | { ok: false; error: string } {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return { ok: false, error: `Region #${index + 1} must be an object with x, y, w, h.` };
  }
  const rec = entry as Record<string, unknown>;
  if (rec.kind !== undefined && rec.kind !== "rect") {
    return { ok: false, error: `Region #${index + 1} has unknown kind "${String(rec.kind)}" (only "rect" is supported).` };
  }
  const x = coercePx(rec.x);
  const y = coercePx(rec.y);
  const w = coercePx(rec.w);
  const h = coercePx(rec.h);
  if (x == null || y == null) {
    return { ok: false, error: `Region #${index + 1} is missing numeric x/y.` };
  }
  if (w == null || h == null) {
    return { ok: false, error: `Region #${index + 1} is missing numeric w/h.` };
  }
  const region: MosaicRegion = { x, y, w, h };

  // Optional rect-local mask ("rect first, mask second"). Malformed mask
  // fields ERROR rather than silently dropping — a censor mask that
  // quietly vanishes is the failure mode this family refuses.
  if (rec.maskPath !== undefined) {
    if (typeof rec.maskPath !== "string" || rec.maskPath.trim() === "") {
      return { ok: false, error: `Region #${index + 1} maskPath must be a non-empty string (SVG path d, rect-local px).` };
    }
    region.maskPath = rec.maskPath.trim();
  }
  if (rec.maskStrokes !== undefined) {
    if (!Array.isArray(rec.maskStrokes) || rec.maskStrokes.length === 0) {
      return { ok: false, error: `Region #${index + 1} maskStrokes must be a non-empty array of { d, width }.` };
    }
    const strokes: Array<{ d: string; width: number }> = [];
    for (let s = 0; s < rec.maskStrokes.length; s++) {
      const st = rec.maskStrokes[s] as Record<string, unknown> | null;
      const d = st && typeof st === "object" && typeof st.d === "string" ? st.d.trim() : "";
      const width = st && typeof st === "object" ? coercePx(st.width) : null;
      if (d === "" || width == null || width <= 0) {
        return { ok: false, error: `Region #${index + 1} maskStrokes[${s}] needs a non-empty d and a positive width.` };
      }
      strokes.push({ d, width });
    }
    region.maskStrokes = strokes;
  }
  return { ok: true, region };
}

/**
 * Read a raw `regions` prop value into `{ canvas?, regions }`.
 *
 * Tolerates: the `{ canvas?, regions }` wrapper OR a bare region array,
 * either JSON-string-encoded, numeric-string px fields, unknown extra
 * keys on entries (dropped), and a missing `kind` (= rect). An ABSENT
 * value (null/undefined) and an empty wrapper (`{}` / `{canvas}` only)
 * parse as ok with ZERO regions — "nothing drawn yet" is a valid base
 * state, and whether that's acceptable is the consumer's policy (a
 * `control.regions.min` / template decision), not a parse failure.
 * Rejects (with a typed error naming the first offending entry):
 * unparsable JSON, non-array `regions`, entries without coercible
 * x/y/w/h, unknown shape kinds, and a wrapper carrying unknown TOP-LEVEL
 * keys with no `regions` array (a likely `regions` typo must not read as
 * "empty" — for a censor consumer that would silently blur nothing).
 *
 * Region SEMANTICS (bounds, degenerate sizes) are deliberately not
 * judged here — that's {@link resolveRegionsToPx}' job, against the
 * target canvas.
 */
export function parseRegionsValue(value: unknown): ParseRegionsResult {
  if (value == null) {
    return { ok: true, regions: [] };
  }

  let raw: unknown = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    // m0-native flavor FIRST: a bare layout string whose leaf cells ARE
    // the regions. Checked before JSON because tiny layouts ("1") are
    // also valid JSON numbers — and a JSON wrapper/array can never be
    // valid m0 (quotes/colons aren't in the grammar), so precedence is
    // unambiguous.
    if (isValidM0String(text)) {
      return { ok: true, regions: [], m0: text };
    }
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        error: `Regions JSON did not parse (and the string is not valid m0): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  let canvas: { w: number; h: number } | undefined;
  let entries: unknown;
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === "object" && raw !== null) {
    const rec = raw as Record<string, unknown>;
    // Wrapped m0 flavor: { m0: "…" }. Resolution-independent — no canvas.
    if (typeof rec.m0 === "string" && rec.m0.trim() !== "") {
      const m0 = rec.m0.trim();
      if (!isValidM0String(m0)) {
        return { ok: false, error: "Regions m0 is not a valid m0 string." };
      }
      return { ok: true, regions: [], m0 };
    }
    entries = rec.regions;
    if (rec.canvas !== undefined) {
      const c = rec.canvas as Record<string, unknown> | null;
      const w = c && typeof c === "object" ? coercePx(c.w) : null;
      const h = c && typeof c === "object" ? coercePx(c.h) : null;
      if (w == null || h == null || w <= 0 || h <= 0) {
        return { ok: false, error: "Regions canvas must be { w, h } with positive numbers (or be omitted)." };
      }
      canvas = { w, h };
    }
  } else {
    return { ok: false, error: `Regions must be an array or a { canvas, regions } object (got ${typeof raw}).` };
  }

  if (entries === undefined && typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    // Wrapper without a `regions` array: empty base state ONLY when no
    // stray keys ride along (`{}` / `{canvas}`); anything else is a
    // likely `regions` typo and must not silently read as "empty".
    const strayKeys = Object.keys(raw as Record<string, unknown>).filter((k) => k !== "canvas");
    if (strayKeys.length === 0) {
      return canvas !== undefined ? { ok: true, canvas, regions: [] } : { ok: true, regions: [] };
    }
    return {
      ok: false,
      error: `Regions object has no "regions" array (found key${strayKeys.length > 1 ? "s" : ""}: ${strayKeys.join(", ")}).`,
    };
  }

  if (!Array.isArray(entries)) {
    return { ok: false, error: "Regions must contain a regions array of { x, y, w, h } entries." };
  }

  const regions: MosaicRegion[] = [];
  for (let i = 0; i < entries.length; i++) {
    const parsed = parseOneRegion(entries[i], i);
    if (!parsed.ok) {
      return parsed;
    }
    regions.push(parsed.region);
  }
  return canvas !== undefined ? { ok: true, canvas, regions } : { ok: true, regions };
}

/** A region's rect-local mask, carried through resolution. `bounds` is
 * the AUTHORED rect's size — the path's design space — so the engine's
 * inline-mask bounds-scaling recovers the shape at ANY resolved cell
 * size without host-side path rewriting. */
export type ResolvedRegionMask = {
  path?: string;
  strokes?: Array<{ d: string; width: number }>;
  bounds: { w: number; h: number };
};

export type ResolvedRegionVerdict =
  | { ok: true; x: number; y: number; w: number; h: number; mask?: ResolvedRegionMask }
  | { ok: false; reason: string; region: MosaicRegion };

/**
 * Judge parsed regions against the target render canvas.
 *
 * Per region, in order (order preserved — verdict `i` is region `i`):
 * - rescaled from the authored canvas onto the target (identity when the
 *   value carried no `canvas` — hand-authored px are target px);
 * - rounded to integers and clamped into `[0, target)`; a region that
 *   collapses below 1×1 px after clamping (entirely outside the canvas,
 *   or degenerate to begin with) → invalid;
 * - otherwise valid with the clamped integer bounds.
 *
 * Overlapping and duplicate regions are ALLOWED — consumers own any
 * merge policy (an inline-mask with overlapping subpaths renders fine).
 */
export function resolveRegionsToPx(
  parsed: { canvas?: { w: number; h: number }; regions: MosaicRegion[] },
  target: { width: number; height: number },
): ResolvedRegionVerdict[] {
  const sx = parsed.canvas ? target.width / parsed.canvas.w : 1;
  const sy = parsed.canvas ? target.height / parsed.canvas.h : 1;
  return parsed.regions.map((region) => {
    if (region.w <= 0 || region.h <= 0) {
      return {
        ok: false as const,
        reason: `region has non-positive size (${region.w}×${region.h})`,
        region,
      };
    }
    const left = Math.round(region.x * sx);
    const top = Math.round(region.y * sy);
    const right = Math.round((region.x + region.w) * sx);
    const bottom = Math.round((region.y + region.h) * sy);
    const x = Math.min(Math.max(0, left), target.width);
    const y = Math.min(Math.max(0, top), target.height);
    const w = Math.min(Math.max(0, right), target.width) - x;
    const h = Math.min(Math.max(0, bottom), target.height) - y;
    if (w < 1 || h < 1) {
      return {
        ok: false as const,
        reason: `region [${region.x}, ${region.y}, ${region.w}×${region.h}] lies outside the ${target.width}×${target.height} canvas`,
        region,
      };
    }
    // Rect-local mask rides along; its design space stays the AUTHORED
    // rect (bounds) — consumers scale via the engine's bounds mechanism.
    const mask: ResolvedRegionMask | undefined =
      region.maskPath !== undefined || region.maskStrokes !== undefined
        ? {
            ...(region.maskPath !== undefined ? { path: region.maskPath } : {}),
            ...(region.maskStrokes !== undefined ? { strokes: region.maskStrokes } : {}),
            bounds: { w: region.w, h: region.h },
          }
        : undefined;
    return { ok: true as const, x, y, w, h, ...(mask ? { mask } : {}) };
  });
}

/**
 * Resolve the m0-native regions flavor to integer px rects: evaluate the
 * layout at the target canvas and take every LEAF tile's rect. The m0 is
 * resolution-independent, so the same string yields proportionally
 * identical regions on any canvas — passthroughs/donations shape the
 * grid but contribute no region. Invalid m0 returns [] (callers gate on
 * {@link parseRegionsValue}'s validation first).
 */
export function regionRectsFromM0(
  m0: string,
  target: { width: number; height: number },
): Array<{ x: number; y: number; w: number; h: number }> {
  try {
    const frames = parseM0StringToLogicalFrames(m0, target.width, target.height);
    return frames.map((f) => {
      const r = f as unknown as { x: number; y: number; width: number; height: number };
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  } catch {
    return [];
  }
}

/**
 * Compose resolved regions (rects + optional rect-local masks) into ONE
 * canvas-space inline-mask: maskless rects join the filled `localPath`
 * as subpaths (exactly {@link regionsToMaskPathD}); masked rects become
 * placed `parts` — translated to the rect's canvas position and scaled
 * from the authored rect (the mask's design space) to the resolved
 * rect. No host-side path rewriting: the rasterizer emits SVG
 * transforms. Feed the result to `mask: { kind: "inline-mask",
 * localPath, parts, bounds: <full canvas> }`.
 */
export function regionsToCompositeMask(
  regions: ReadonlyArray<{
    x: number;
    y: number;
    w: number;
    h: number;
    mask?: ResolvedRegionMask;
  }>,
): {
  localPath: string;
  parts?: Array<{
    d?: string;
    strokes?: Array<{ d: string; width: number }>;
    translate: { x: number; y: number };
    scale?: { x: number; y: number };
    clip?: { x: number; y: number; width: number; height: number };
  }>;
} {
  const plain = regions.filter((r) => !r.mask);
  const masked = regions.filter((r) => r.mask);
  const parts = masked.map((r) => {
    const m = r.mask!;
    const sx = r.w / m.bounds.w;
    const sy = r.h / m.bounds.h;
    return {
      ...(m.path !== undefined ? { d: m.path } : {}),
      ...(m.strokes !== undefined ? { strokes: m.strokes } : {}),
      translate: { x: r.x, y: r.y },
      ...(sx !== 1 || sy !== 1 ? { scale: { x: sx, y: sy } } : {}),
      // Clip to the region rect: brush-stroke WIDTH that overhangs the
      // rect must cut exactly like a real-geometry cell edge would —
      // the three geometry flavors stay pixel-consistent.
      clip: { x: r.x, y: r.y, width: r.w, height: r.h },
    };
  });
  return {
    localPath: regionsToMaskPathD(plain),
    ...(parts.length > 0 ? { parts } : {}),
  };
}

/**
 * Emit an inline-mask SVG path for a set of resolved px rects: one
 * closed subpath per rect (`M x y H … V … H … Z`), space-joined. Feed
 * the result to `mask: { kind: "inline-mask", localPath, bounds }` with
 * `bounds` = the full canvas — N regions cost ONE mask and one effect
 * pass. Rounded corners are a future drop-in via `roundedRectPathD`
 * (`../anim/tracks.ts`).
 */
export function regionsToMaskPathD(
  rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
): string {
  return rects
    .map((r) => `M${r.x} ${r.y}H${r.x + r.w}V${r.y + r.h}H${r.x}Z`)
    .join(" ");
}
