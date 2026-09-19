/**
 * Deterministic monospace-grid text → grouped SVG glyph paths.
 *
 * Code renderers need a stricter contract than prose text: every character
 * occupies one shared floating-point grid cell, ligatures and kerning cannot
 * move glyphs off that grid, and runs with the same semantic color must merge
 * into one path so callers can rasterize a motion block as one RGBA asset.
 */

import * as fs from "fs";
import * as path from "path";
import type * as OpentypeNS from "opentype.js";
import {
  BUNDLED_FONT_CACHE_KEY,
  getCachedFont,
  getOpentype,
  setCachedFont,
} from "./fontCache";
import { bundledFontPath } from "./textToPath";

const DEFAULT_LINE_HEIGHT = 1.5;
const MONOSPACE_PROBE = [" ", "i", "M", "W", "0", "@"] as const;

export interface MeasureMonoGridOptions {
  /** Em size in pixels. */
  fontSize: number;
  /** Concrete .ttf/.otf file. Default: bundled Roboto Regular. */
  fontPath?: string;
  /** Line-box height as a multiple of fontSize. Default 1.5. */
  lineHeight?: number;
}

export interface MonoGridMetrics {
  /** One character-cell advance in pixels. Kept as a float. */
  charW: number;
  /** Integer line-box step in pixels. */
  lineStep: number;
  /** Font ascent at this size in pixels. */
  ascent: number;
  /** Positive font descent at this size in pixels. */
  descent: number;
  /** True when representative single-width glyphs share one advance. */
  monospace: boolean;
}

export interface PathRun {
  text: string;
  /** Opaque caller-owned token. A later rasterizer maps it to a color. */
  colorKey: string;
  /** Absolute zero-based character-grid column. */
  col: number;
}

export interface PathLine {
  runs: PathRun[];
}

export interface RunsToPathsOptions extends MeasureMonoGridOptions {
  /** Absolute grid column represented by the raster's left edge. Default 0. */
  originCol?: number;
  /** Absolute grid line represented by the raster's top edge. Default 0. */
  originLine?: number;
  /** Decimal places in emitted SVG path coordinates. Default 4. */
  decimals?: number;
}

export interface ColorPath {
  colorKey: string;
  d: string;
}

export interface RunsToPathsResult {
  /** One merged path per colorKey, in first-seen color order. */
  paths: ColorPath[];
  /** Grid-aligned output width in pixels. */
  width: number;
  /** Full line-box output height in pixels. */
  height: number;
  /** First input line's baseline in output-local pixels. */
  firstBaselineY: number;
  metrics: MonoGridMetrics;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0, got ${value}`);
  }
}

function requireGridOrigin(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
}

/** Load a parsed font through the package-wide cache. */
function loadFont(fontPath?: string): OpentypeNS.Font {
  if (fontPath == null) {
    const cached = getCachedFont(BUNDLED_FONT_CACHE_KEY);
    if (cached) return cached;
    const abs = bundledFontPath();
    if (!fs.existsSync(abs)) {
      throw new Error(`measureMonoGrid: font file not found at "${abs}"`);
    }
    const font = getOpentype().loadSync(abs);
    setCachedFont(BUNDLED_FONT_CACHE_KEY, font);
    return font;
  }

  const direct = getCachedFont(fontPath);
  if (direct) return direct;
  const abs = path.resolve(fontPath);
  const cached = getCachedFont(abs);
  if (cached) return cached;
  if (!fs.existsSync(abs)) {
    throw new Error(`measureMonoGrid: font file not found at "${abs}"`);
  }
  const font = getOpentype().loadSync(abs);
  setCachedFont(abs, font);
  return font;
}

function glyphAdvance(font: OpentypeNS.Font, char: string): number {
  const advance = font.charToGlyph(char).advanceWidth;
  return typeof advance === "number" && Number.isFinite(advance)
    ? advance
    : font.unitsPerEm;
}

/**
 * Measure the shared character grid for a concrete font.
 *
 * `monospace` is derived from actual representative glyph advances rather
 * than trusting font metadata alone. A proportional fallback such as Roboto
 * therefore reports false and code rasterizers can fail actionably.
 */
export function measureMonoGrid(
  options: MeasureMonoGridOptions,
): MonoGridMetrics {
  const {
    fontSize,
    fontPath,
    lineHeight = DEFAULT_LINE_HEIGHT,
  } = options;
  requirePositiveFinite(fontSize, "measureMonoGrid: fontSize");
  requirePositiveFinite(lineHeight, "measureMonoGrid: lineHeight");

  const font = loadFont(fontPath);
  const scale = fontSize / font.unitsPerEm;
  const advanceUnits = glyphAdvance(font, "M");
  const monospace = MONOSPACE_PROBE.every(
    (char) => glyphAdvance(font, char) === advanceUnits,
  );

  return {
    charW: advanceUnits * scale,
    lineStep: Math.max(1, Math.round(fontSize * lineHeight)),
    ascent: font.ascender * scale,
    descent: -font.descender * scale,
    monospace,
  };
}

/**
 * Convert positioned code runs into one SVG path per colorKey.
 *
 * Characters are outlined one at a time at `col * charW`; this explicitly
 * disables ligature substitution and kerning and makes the char grid the
 * only horizontal authority. The integer origin floor is subtracted from
 * every coordinate so a caller can place the resulting raster at that floor
 * while retaining its fractional glyph phase inside the image.
 */
export function runsToPaths(
  lines: PathLine[],
  options: RunsToPathsOptions,
): RunsToPathsResult {
  if (!Array.isArray(lines)) {
    throw new Error("runsToPaths: lines must be an array");
  }

  const {
    originCol = 0,
    originLine = 0,
    decimals = 4,
  } = options;
  requireGridOrigin(originCol, "runsToPaths: originCol");
  requireGridOrigin(originLine, "runsToPaths: originLine");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    throw new Error(
      `runsToPaths: decimals must be an integer from 0 to 10, got ${decimals}`,
    );
  }

  const metrics = measureMonoGrid(options);
  const font = loadFont(options.fontPath);
  const ot = getOpentype();
  const originXPx = Math.floor(originCol * metrics.charW);
  const originYPx = Math.floor(originLine * metrics.lineStep);
  const pathsByColor = new Map<string, OpentypeNS.Path>();
  let maxEndCol = originCol;

  lines.forEach((line, lineIndex) => {
    if (line == null || !Array.isArray(line.runs)) {
      throw new Error(`runsToPaths: lines[${lineIndex}].runs must be an array`);
    }
    const baselineY =
      (originLine + lineIndex) * metrics.lineStep +
      metrics.ascent -
      originYPx;

    line.runs.forEach((run, runIndex) => {
      const at = `runsToPaths: lines[${lineIndex}].runs[${runIndex}]`;
      if (run == null || typeof run.text !== "string") {
        throw new Error(`${at}.text must be a string`);
      }
      if (typeof run.colorKey !== "string") {
        throw new Error(`${at}.colorKey must be a string`);
      }
      if (!Number.isInteger(run.col) || run.col < originCol) {
        throw new Error(
          `${at}.col must be an integer >= originCol (${originCol}), got ${run.col}`,
        );
      }

      const chars = Array.from(run.text);
      maxEndCol = Math.max(maxEndCol, run.col + chars.length);
      if (chars.length === 0) return;

      let combined = pathsByColor.get(run.colorKey);
      if (!combined) {
        combined = new ot.Path();
        pathsByColor.set(run.colorKey, combined);
      }

      chars.forEach((char, charIndex) => {
        const x =
          (run.col + charIndex) * metrics.charW - originXPx;
        combined!.extend(font.getPath(char, x, baselineY, options.fontSize));
      });
    });
  });

  const width =
    maxEndCol === originCol
      ? 0
      : Math.max(0, Math.ceil(maxEndCol * metrics.charW) - originXPx);
  const height =
    lines.length === 0
      ? 0
      : Math.max(
          0,
          Math.ceil((originLine + lines.length) * metrics.lineStep) -
            originYPx,
        );

  return {
    paths: [...pathsByColor].map(([colorKey, pathValue]) => ({
      colorKey,
      d: pathValue.toPathData(decimals),
    })),
    width,
    height,
    firstBaselineY:
      originLine * metrics.lineStep + metrics.ascent - originYPx,
    metrics,
  };
}
