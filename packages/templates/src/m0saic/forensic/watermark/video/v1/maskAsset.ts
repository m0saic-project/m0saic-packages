/**
 * Materialize the watermark mask as an on-disk RGBA PNG.
 *
 * Given the encoder's `CellPlan[]`, build a `cols × rows` RGBA buffer
 * where each pixel encodes:
 *
 *   - RGB = white (255,255,255) when `polarity = +1`, black (0,0,0)
 *     when `polarity = -1`
 *   - alpha = round(α * 255)
 *
 * Composited via standard alpha-blend against a host frame of mean
 * luminance Y₀, the output luminance shifts by `±α * (Y_extreme - Y₀)`
 * — approximately `±α * 128` for mid-luminance host — matching the
 * decoder's expected residual signal.
 *
 * Upscaled to canvas dims via nearest-neighbor (Sharp's `kernel:
 * "nearest"`, `fit: "fill"` — the grid stretches onto the canvas whatever
 * its aspect) so each grid cell becomes a sharp `cellWidth × cellHeight`
 * pixel block. Sharp transforms here are lazy — `.toFile()` triggers
 * the pipeline once.
 *
 * Output path is content-addressed (sha256 of cells + dims + seed +
 * payload) so re-renders of the same inputs hit the cache; nothing
 * is written if the file already exists.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";

import * as os from "node:os";
import * as path from "node:path";
import { M0SAIC_TMP_PREFIX } from "@m0saic/platform/paths";

import { blurRgba, encodePng, stretchNearestRgba } from "../../../../_shared/raster";
const CACHE_DIR = path.join(os.tmpdir(), `${M0SAIC_TMP_PREFIX}forensic-watermark-cache`);

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export interface BuildMaskAssetInputs {
  /** Per-cell plan from `encodePayload()`. Row-major, length cols*rows. */
  cells: ReadonlyArray<{ polarity: -1 | 1; alpha: number }>;
  /** Grid columns. */
  cols: number;
  /** Grid rows. */
  rows: number;
  /** Target canvas width (pixels). */
  canvasW: number;
  /** Target canvas height (pixels). */
  canvasH: number;
  /** Stable fingerprint used in the cache filename — typically a hash of seed + payload + dims. */
  fingerprint: string;
  /**
   * Gaussian sigma (px) applied AFTER the nearest upscale, softening the
   * hard step between neighbouring cells. 0 / undefined = hard cells. A
   * per-cell constant step on a smooth gradient reads as a faint
   * checkerboard; softened over a few px it becomes a low-frequency bump
   * the eye ignores, while a cell's interior — what the area-average
   * decoder integrates — keeps its full offset. Must be in the fingerprint.
   */
  blurSigmaPx?: number;
}

export interface BuildMaskAssetResult {
  /** Absolute on-disk path to the materialized PNG. */
  pngPath: string;
  /** Whether the PNG was generated fresh (false = cache hit). */
  fresh: boolean;
}

/**
 * Build a deterministic cache fingerprint from the inputs that decide
 * the PNG bytes. Callers typically combine seed + payload + grid dims
 * + canvas dims + alpha curve params.
 */
export function makeFingerprint(parts: ReadonlyArray<string | number>): string {
  return crypto
    .createHash("sha256")
    .update(parts.map(String).join("|"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Build the mask PNG (cached). Async because Sharp's I/O is async.
 */
export async function buildMaskPng(
  inputs: BuildMaskAssetInputs,
): Promise<BuildMaskAssetResult> {
  const { cells, cols, rows, canvasW, canvasH, fingerprint } = inputs;
  const blurSigmaPx = inputs.blurSigmaPx && inputs.blurSigmaPx >= 0.3 ? inputs.blurSigmaPx : 0;
  const cellCount = cols * rows;
  if (cells.length !== cellCount) {
    throw new Error(
      `buildMaskPng: expected ${cellCount} cells (${cols}×${rows}), got ${cells.length}`,
    );
  }

  ensureCacheDir();
  const pngPath = path.join(
    CACHE_DIR,
    `mask-${fingerprint}-${cols}x${rows}-${canvasW}x${canvasH}.png`,
  );
  if (fs.existsSync(pngPath)) {
    return { pngPath, fresh: false };
  }

  // RGBA buffer at cell resolution.
  const rgba = Buffer.alloc(cellCount * 4);
  for (let i = 0; i < cellCount; i += 1) {
    const c = cells[i]!;
    const a = Math.max(0, Math.min(255, Math.round(c.alpha * 255)));
    const v = c.polarity > 0 ? 255 : 0;
    const off = i * 4;
    rgba[off] = v;
    rgba[off + 1] = v;
    rgba[off + 2] = v;
    rgba[off + 3] = a;
  }

  // STRETCH the cell grid onto the canvas — never preserve aspect, never crop.
  // sharp's default (`cover`) center-cropped and silently threw away ~2/3 of
  // the cells on any canvas whose aspect differed from cols:rows (a 64x36 grid
  // on a 720x1280 portrait clip kept 20 columns, stretched) — the mark
  // rendered, the decoder found noise (gate-34 catch).
  let px = stretchNearestRgba(rgba, cols, rows, canvasW, canvasH);
  // Soft cell edges (see `blurSigmaPx`). All four channels blur together, so
  // alpha ramps with the colour — exactly the low-frequency bump we want.
  if (blurSigmaPx > 0) px = blurRgba(px, canvasW, canvasH, blurSigmaPx);
  fs.writeFileSync(pngPath, encodePng(px, canvasW, canvasH, 6));

  return { pngPath, fresh: true };
}
