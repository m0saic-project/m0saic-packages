/**
 * ============================================================================
 * hero/ffmpeg-pulse — background scatter (loads the shipped layout)
 * ============================================================================
 *
 * The signature backdrop: a field of dark rounded squares with the occasional
 * green accent, behind every beat. The geometry is NOT generated — it's the
 * HUMAN-TRACED scatter shipped as a sidecar `.m0p` (`scatter-layout.m0p`, the
 * sandbox-approved desktop trace + cover-fit square/mobile derivations, each
 * variant carrying per-tile fill colors). At render the loader:
 *   1. picks the variant matching the canvas aspect,
 *   2. scales its tiles to the actual render dims,
 *   3. paints each as a rounded `makeColorTile` of its stored fill color,
 *   4. packs them into `placeRects` layers (a valid overlay base each).
 *
 * Returns per-layer Nodes so the chrome can nest its content as the frontmost
 * child over the backdrop ({@link pulseChrome} `scatter` opt). Resolution is
 * baked per render (the px are scaled from the variant's native size), the
 * deliberate trade for matching the approved trace exactly.
 * ============================================================================
 */

import * as path from "node:path";
import type { MosaicSource } from "@m0saic/types";
import { makeColorTile, fadeInExpr, type EaseName } from "@m0saic/template-utils";
// readLayoutFile reads the filesystem — deep import (not re-exported from the
// barrel, which must stay web-bundleable). This hero pack is node-only.
import { readLayoutFile } from "@m0saic/template-utils/dist/m0saic/readLayoutFile";
import { placeRects } from "@m0saic/dsl-stdlib";
import { getVariant, type M0pFile } from "@m0saic/dsl-file-formats";
import { parseM0StringComplete } from "@m0saic/dsl";

import { overlay, EMPTY, type Node } from "../../../alpine/_shared/alpine-card";

// The shipped scatter pack, loaded once (copy-assets mirrors assets/ to dist).
let BUNDLED: M0pFile | null = null;
function bundledPack(): M0pFile {
  if (!BUNDLED) {
    const r = readLayoutFile(path.resolve(__dirname, "assets", "scatter-layout.m0p"));
    if (r.kind !== "m0p") throw new Error("scatter-layout asset is not an .m0p pack");
    BUNDLED = r.file;
  }
  return BUNDLED;
}

function variantKey(W: number, H: number): string {
  const ar = W / H;
  return ar >= 1.3 ? "desktop" : ar < 0.85 ? "mobile" : "square";
}

export type ScatterOpts = {
  W: number;
  H: number;
  /** Override the shipped scatter pack. */
  pack?: M0pFile;
  /** Corner radius as a fraction of the tile's shorter side (0..0.5). */
  cornerRadius?: number;
  /**
   * Rank-set reveal: stagger each tile's fade-in by its rank over `spanSec`,
   * each tile fading over `tileSec`. Order is a deterministic sweep (default
   * top-left → bottom-right by x+y; `"random"` for a seeded sparkle). Omitted →
   * tiles are static (no per-tile animation).
   */
  reveal?: { startSec: number; spanSec: number; tileSec: number; order?: "sweep" | "random" | "horizontal"; ease?: EaseName };
};

/**
 * Build the scatter as per-layer Nodes (one per `placeRects` layer, each a
 * single split → a valid overlay base). Spread into `overlay([...layers, top])`
 * so caller content nests over the backdrop. Returns `[]` for degenerate dims.
 */
export function scatterLayers(opts: ScatterOpts): Node[] {
  const W = Math.max(1, Math.round(opts.W));
  const H = Math.max(1, Math.round(opts.H));
  const pack = opts.pack ?? bundledPack();
  const variant = getVariant(pack, variantKey(W, H)) ?? getVariant(pack, "desktop");
  if (!variant) return [];

  const nW = variant.size.width;
  const nH = variant.size.height;
  const fill = (variant.fill ?? {}) as Record<string, { color?: string }>;
  const parsed: any = parseM0StringComplete(variant.m0, nW, nH);
  const frames: any[] = parsed.ir?.renderFrames ?? parsed.renderFrames ?? [];

  const sx = W / nW;
  const sy = H / nH;
  const SNAP = 4;
  const snap = (v: number) => Math.max(SNAP, Math.round(v / SNAP) * SNAP);

  type R = { x: number; y: number; w: number; h: number; claimant: string };
  const rects: R[] = [];
  const colors: string[] = [];
  for (const f of frames) {
    const key = f.meta?.stableKey ?? f.stableKey;
    const color = fill[key]?.color;
    if (!color) continue;
    const x = snap(f.x * sx);
    const y = snap(f.y * sy);
    let w = snap(f.width * sx);
    let h = snap(f.height * sy);
    if (x + w > W) w = W - x;
    if (y + h > H) h = H - y;
    if (w < SNAP || h < SNAP) continue;
    rects.push({ x, y, w, h, claimant: "F" });
    colors.push(color);
  }
  if (rects.length === 0) return [];

  const cr = opts.cornerRadius ?? 0.16;

  // Rank-set reveal: assign every tile a global rank, then a staggered fade start.
  // Ranks span all tiles (across placeRects layers) so the reveal reads as one
  // ordered sweep/sparkle, not per-layer.
  let revealStart: ((idx: number) => string) | null = null;
  if (opts.reveal) {
    const N = rects.length;
    const order = rects.map((_, i) => i);
    if (opts.reveal.order === "random") {
      // Seeded shuffle (deterministic — no Math.random): hash the rect geometry.
      const keyOf = (i: number) => { const r = rects[i]; let h = (r.x * 73856093) ^ (r.y * 19349663) ^ (r.w * 83492791) ^ (r.h * 2654435761); return (h >>> 0); };
      order.sort((a, b) => keyOf(a) - keyOf(b));
    } else if (opts.reveal.order === "horizontal") {
      // A vertical reveal line sweeping LEFT → RIGHT (order purely by x).
      order.sort((a, b) => rects[a].x - rects[b].x || rects[a].y - rects[b].y);
    } else {
      // Diagonal sweep (top-left → bottom-right).
      order.sort((a, b) => (rects[a].x + rects[a].y) - (rects[b].x + rects[b].y));
    }
    const rank = new Array<number>(N);
    order.forEach((ri, o) => { rank[ri] = o; });
    const { startSec, spanSec, tileSec, ease } = opts.reveal;
    revealStart = (idx: number) => fadeInExpr(startSec + (N <= 1 ? 0 : (rank[idx] / (N - 1)) * spanSec), tileSec, ease ?? "smoothstep");
  }

  const placed = placeRects({ rootW: W, rootH: H, rects: rects as any });
  return (placed as { layers: Array<{ rectIndices: number[]; m0: string }> }).layers.map((L) => {
    const ordered = [...L.rectIndices].sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
    const sources: MosaicSource[] = ordered.map((idx) => {
      const src = makeColorTile(colors[idx] as any, {
        effects: { rounding: { cornerStyle: "rounded", borderRadius: cr } },
      }) as MosaicSource;
      return revealStart
        ? ({ ...src, overlay: { ...((src as { overlay?: object }).overlay ?? {}), alpha: revealStart(idx) } } as MosaicSource)
        : src;
    });
    return { m0: String(L.m0), sources };
  });
}

/** The scatter composed into a single full-canvas Node (standalone backdrop).
 *  EMPTY when nothing is emitted. */
export function scatterNode(opts: ScatterOpts): Node {
  const layers = scatterLayers(opts);
  return layers.length ? overlay(layers) : EMPTY;
}
