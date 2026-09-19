/**
 * textToPath — official text → SVG path conversion for templates.
 *
 * Lays a text string out inside an input canvas and returns an SVG path `d`
 * string of the glyph OUTLINES (not `<text>`). Because the glyphs are vector
 * outlines, the result is fully deterministic — it does NOT depend on the
 * host's installed fonts or fontconfig, so it renders identically on macOS /
 * Windows / Linux CI, using the bundled Roboto Regular (Apache-2.0).
 *
 * The returned `d` has two uses, one mechanism:
 *   1. FILL — `<path d="…" fill="…"/>` to draw the text.
 *   2. MASK — hand `d` to a source's `inline-mask.localPath` (with `bounds`
 *      equal to the canvas you passed here) so a single flat color source
 *      shows through only as the glyph shapes. That turns "one drawtext ffmpeg
 *      spawn per label" into "one masked color source per cell", which the
 *      engine composites in a single filtergraph pass.
 *
 * Node-only: reads the font file from disk and lazily requires opentype.js
 * (deferred to first call, so importing this module never pulls the parser
 * into a browser / typecheck-only graph).
 *
 * Coordinate system: SVG/screen space — origin top-left, `y` grows DOWN.
 * The path is positioned inside `[0,0,canvas.width,canvas.height]` per the
 * alignment options.
 */

import * as fs from "fs";
import * as path from "path";
import { parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { placeRect } from "@m0saic/dsl-stdlib";
// Type-only import — erased at compile time; the parser is required() lazily
// in fontCache (mirrors core's lazy `sharp` loader).
import type * as OpentypeNS from "opentype.js";
import {
  getCachedFont,
  setCachedFont,
  getOpentype,
  BUNDLED_FONT_CACHE_KEY,
} from "./fontCache";

// ── Bundled font resolution ──────────────────────────────────────────────
// Resolved relative to this module so it works in dev (src/) and the
// published build (dist/) alike — both sit one level under the package root,
// which holds `assets/`. `assets` ships via package.json `files`.
const BUNDLED_FONT_REL = "../assets/fonts/Roboto-Regular.ttf";

/**
 * Absolute path to the bundled default font (Roboto Regular, Apache-2.0).
 * NODE-ONLY: `path.resolve` is stubbed in a browser bundle. Only reached on a
 * default-font cache MISS, which never happens in the browser (the host
 * pre-registers the bundled bytes under BUNDLED_FONT_CACHE_KEY).
 */
export function bundledFontPath(): string {
  return path.resolve(__dirname, BUNDLED_FONT_REL);
}

/**
 * Resolve `fontPath` (or the bundled default when omitted) to a parsed font.
 *
 * Cache-FIRST: the parsed-font cache (fontCache.ts) is consulted before any
 * `fs`/`path` call, so a browser bundle — where those modules resolve to
 * `false` — returns a pre-registered font with zero node access. A cache miss
 * falls back to reading the file from disk (the Node path, unchanged).
 */
function loadFont(fontPath?: string): OpentypeNS.Font {
  // Bundled default: resolve via the logical cache key first. The browser
  // pre-registers the Roboto bytes under this key (registerFontBytes), so the
  // default-font path never touches fs/path there.
  if (fontPath == null) {
    const cached = getCachedFont(BUNDLED_FONT_CACHE_KEY);
    if (cached) return cached;
    return loadFontFromDisk(bundledFontPath(), BUNDLED_FONT_CACHE_KEY);
  }
  // Explicit path: the browser may have registered under the exact string;
  // else Node resolves + reads from disk, keyed by the absolute path.
  const direct = getCachedFont(fontPath);
  if (direct) return direct;
  const abs = path.resolve(fontPath);
  const cachedAbs = getCachedFont(abs);
  if (cachedAbs) return cachedAbs;
  return loadFontFromDisk(abs, abs);
}

/** Node-only: read + parse a font file from disk and cache it under `key`. */
function loadFontFromDisk(abs: string, key: string): OpentypeNS.Font {
  if (!fs.existsSync(abs)) {
    throw new Error(`textToPath: font file not found at "${abs}"`);
  }
  const font = getOpentype().loadSync(abs);
  setCachedFont(key, font);
  return font;
}

// ── Public API ───────────────────────────────────────────────────────────

/** Standard horizontal alignment within the canvas. */
export type HAlign = "left" | "center" | "right";
/** Standard vertical alignment within the canvas. */
export type VAlign = "top" | "middle" | "bottom";

/** Inset from the canvas edges, in pixels. */
export type TextPadding = number | { x?: number; y?: number };

export interface TextOptions {
  /** Em size in pixels. Required. */
  fontSize: number;
  /** Horizontal alignment within the canvas. Default "center". */
  hAlign?: HAlign;
  /** Vertical alignment within the canvas. Default "middle". */
  vAlign?: VAlign;
  /** Inset from the canvas edges (pixels). Default 0. */
  padding?: TextPadding;
  /** Line height as a multiple of fontSize, for multi-line text. Default 1.25. */
  lineHeight?: number;
  /** Extra spacing between glyphs (pixels). Default 0. */
  letterSpacing?: number;
  /** Decimal places in the emitted path coordinates. Default 2. */
  decimals?: number;
  /** Override font file. Default: the bundled Roboto Regular. */
  fontPath?: string;
  /**
   * Escape hatch — provide your own single-frame m0 layout as the placement
   * box. Parsed against the input canvas; the one frame's geometry becomes the
   * box (`hAlign`/`vAlign`/`padding` then position the text WITHIN it).
   *
   * Contract (narrowed, enforced — throws on violation):
   *   - resolves to **exactly one** rendered frame (not zero, not many),
   *   - that frame **fits within the canvas** (≤ size, in bounds).
   * Carve the box with `-` null tiles, e.g. `2(F,-)` = left half. Easiest is
   * to not hand-author it at all — pass {@link TextOptions.rect} and let
   * `placeRect` generate a correct, feasible string for you.
   *
   * Mutually exclusive with {@link TextOptions.rect}.
   */
  m0?: string;
  /**
   * Escape hatch — place the text in an exact pixel rect inside the canvas. We
   * run `@m0saic/dsl-stdlib`'s `placeRect` for you (which validates the rect
   * fits and emits a single-frame, feasible m0) and use the resulting frame as
   * the box. `width`/`height` are required; give `x`/`y` for an exact top-left,
   * or `hAlign`/`vAlign` to align the box within the canvas (placeRect default:
   * centered).
   *
   * Mutually exclusive with {@link TextOptions.m0}.
   */
  rect?: {
    width: number;
    height: number;
    x?: number;
    y?: number;
    hAlign?: "left" | "center" | "right";
    vAlign?: "top" | "center" | "bottom";
  };
}

/** The box the text is laid out inside. */
export interface TextCanvas {
  width: number;
  height: number;
}

function resolvePadding(p: TextPadding | undefined): { x: number; y: number } {
  if (p == null) return { x: 0, y: 0 };
  if (typeof p === "number") return { x: p, y: p };
  return { x: p.x ?? 0, y: p.y ?? 0 };
}

/** The box (in canvas pixels) the text is laid out inside. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Resolve the single box the text lays out inside. Default: the full canvas.
 * Escape hatches (mutually exclusive): an explicit single-frame `m0`, or a
 * `rect` we run through `placeRect`. Both collapse to the same contract — the
 * layout must yield exactly one frame, and it must fit inside the canvas.
 */
function resolveBox(options: TextOptions, canvas: TextCanvas): Box {
  if (options.m0 != null && options.rect != null) {
    throw new Error(
      "textToPath: specify either `m0` or `rect`, not both",
    );
  }

  if (options.rect != null) {
    const r = options.rect;
    // placeRect validates rect-fits-canvas and emits a single-frame m0.
    const { m0 } = placeRect({
      rootW: canvas.width,
      rootH: canvas.height,
      rectW: r.width,
      rectH: r.height,
      ...(r.x != null ? { x: r.x } : {}),
      ...(r.y != null ? { y: r.y } : {}),
      ...(r.hAlign != null ? { hAlign: r.hAlign } : {}),
      ...(r.vAlign != null ? { vAlign: r.vAlign } : {}),
    });
    return frameBoxFromM0(m0, canvas);
  }

  if (options.m0 != null) {
    return frameBoxFromM0(options.m0, canvas);
  }

  return { x: 0, y: 0, width: canvas.width, height: canvas.height };
}

/**
 * Parse `m0` against the canvas and return its single frame as the box,
 * enforcing the narrowed contract: exactly one rendered frame, fitting inside
 * the canvas. Throws (with a specific message) on any violation.
 */
function frameBoxFromM0(m0: string, canvas: TextCanvas): Box {
  const frames = parseM0StringToLogicalFrames(m0, canvas.width, canvas.height);
  if (frames.length !== 1) {
    throw new Error(
      `textToPath: placement m0 must resolve to exactly one frame, got ` +
        `${frames.length} for "${m0}" (carve the box with \`-\` null tiles, ` +
        `or pass \`rect\` to let placeRect generate it)`,
    );
  }
  const f = frames[0];
  const fitsX = f.x >= 0 && f.width <= canvas.width && f.x + f.width <= canvas.width;
  const fitsY = f.y >= 0 && f.height <= canvas.height && f.y + f.height <= canvas.height;
  if (!fitsX || !fitsY) {
    throw new Error(
      `textToPath: placement frame ${f.x},${f.y} ${f.width}x${f.height} ` +
        `does not fit within the ${canvas.width}x${canvas.height} canvas`,
    );
  }
  return { x: f.x, y: f.y, width: f.width, height: f.height };
}

function metricsFor(font: OpentypeNS.Font, fontSize: number) {
  const scale = fontSize / font.unitsPerEm;
  return {
    ascent: font.ascender * scale,
    descent: -font.descender * scale, // descender is negative in font units
  };
}

/** Measured extent of a (possibly multi-line) string at a given size. */
export interface TextMetrics {
  /** Widest line's advance width, in px (includes letterSpacing). */
  width: number;
  /** Block height: (lines-1)*lineStep + ascent + descent, in px. */
  height: number;
  /** Number of non-empty lines measured. */
  lines: number;
  /** Font ascent at this size (px). */
  ascent: number;
  /** Font descent at this size (px). */
  descent: number;
}

export interface MeasureOptions {
  /** Em size in pixels. Required. */
  fontSize: number;
  /** Line height as a multiple of fontSize. Default 1.25 (matches textToPath). */
  lineHeight?: number;
  /** Extra spacing between glyphs (pixels). Default 0. */
  letterSpacing?: number;
  /** Override font file. Default: the bundled Roboto Regular. */
  fontPath?: string;
}

/**
 * Measure how much space `text` needs at `fontSize`, WITHOUT producing a path.
 *
 * This is the companion to {@link textToPath}: `textToPath` lays glyphs out at
 * the size you give it and never shrinks to fit, so callers that need
 * fit-to-box behaviour (progressive label disclosure, auto-sizing) measure
 * first and decide the size / which lines to keep themselves. Uses the same
 * bundled font and metrics as `textToPath`, so the numbers line up with what
 * it will actually emit.
 */
export function measureText(text: string, options: MeasureOptions): TextMetrics {
  const { fontSize, lineHeight = 1.25, letterSpacing = 0, fontPath } = options;
  if (!(fontSize > 0)) {
    throw new Error(`measureText: fontSize must be > 0, got ${fontSize}`);
  }
  const font = loadFont(fontPath);
  const { ascent, descent } = metricsFor(font, fontSize);
  const lines = (text ?? "").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { width: 0, height: 0, lines: 0, ascent, descent };
  }
  let width = 0;
  for (const line of lines) {
    const base = font.getAdvanceWidth(line, fontSize);
    const spacing = letterSpacing * Math.max(0, line.length - 1);
    width = Math.max(width, base + spacing);
  }
  const lineStep = fontSize * lineHeight;
  const height = (lines.length - 1) * lineStep + ascent + descent;
  return { width, height, lines: lines.length, ascent, descent };
}

/**
 * Lay `text` out inside `canvas` and return an SVG path `d` of its glyph
 * outlines, positioned per the alignment options.
 *
 * - Multi-line: split on "\n"; lines stack by `lineHeight`, each aligned
 *   horizontally per `hAlign`, the block aligned vertically per `vAlign`.
 * - Empty / whitespace-only text returns "".
 *
 * Pair the result with an `inline-mask` whose `bounds` is this same canvas
 * to mask a flat color source to the text shape.
 */
export function textToPath(
  text: string,
  options: TextOptions,
  canvas: TextCanvas,
): string {
  const {
    fontSize,
    hAlign = "center",
    vAlign = "middle",
    lineHeight = 1.25,
    letterSpacing = 0,
    decimals = 2,
    fontPath,
  } = options;

  if (!(fontSize > 0)) {
    throw new Error(`textToPath: fontSize must be > 0, got ${fontSize}`);
  }
  if (!(canvas.width > 0) || !(canvas.height > 0)) {
    throw new Error(
      `textToPath: canvas must have positive dimensions, got ${canvas.width}x${canvas.height}`,
    );
  }

  if (!text) return "";
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return "";

  // Resolve the box the text lays out inside: the whole canvas, or — via the
  // m0 escape hatch — one frame of a layout subdividing the canvas.
  const box = resolveBox(options, canvas);

  const font = loadFont(fontPath);
  const ot = getOpentype();
  const { ascent, descent } = metricsFor(font, fontSize);
  const pad = resolvePadding(options.padding);

  // Vertical: stack lines by lineHeight, then align the whole block.
  const lineStep = fontSize * lineHeight;
  const blockHeight = (lines.length - 1) * lineStep + ascent + descent;

  // y of the FIRST line's baseline (box-relative, then offset by box.y).
  const top = pad.y;
  const bottom = box.height - pad.y;
  let firstBaselineLocal: number;
  if (vAlign === "top") {
    firstBaselineLocal = top + ascent;
  } else if (vAlign === "bottom") {
    firstBaselineLocal = bottom - blockHeight + ascent;
  } else {
    // middle
    const blockTop = (box.height - blockHeight) / 2;
    firstBaselineLocal = blockTop + ascent;
  }
  const firstBaseline = box.y + firstBaselineLocal;

  const left = box.x + pad.x;
  const right = box.x + box.width - pad.x;
  const centerX = box.x + box.width / 2;

  const combined = new ot.Path();

  lines.forEach((line, i) => {
    const baselineY = firstBaseline + i * lineStep;

    // Horizontal advance (with letterSpacing) → resolve anchor.
    const baseAdvance = font.getAdvanceWidth(line, fontSize);
    const spacingTotal = letterSpacing * Math.max(0, line.length - 1);
    const advance = baseAdvance + spacingTotal;

    const originX =
      hAlign === "left"
        ? left
        : hAlign === "right"
          ? right - advance
          : centerX - advance / 2;

    if (letterSpacing === 0) {
      combined.extend(font.getPath(line, originX, baselineY, fontSize));
    } else {
      let cx = originX;
      for (const ch of line) {
        combined.extend(font.getPath(ch, cx, baselineY, fontSize));
        cx += font.getAdvanceWidth(ch, fontSize) + letterSpacing;
      }
    }
  });

  return combined.toPathData(decimals);
}
