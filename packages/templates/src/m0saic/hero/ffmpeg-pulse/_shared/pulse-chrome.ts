/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/_shared/pulse-chrome — the shared beat chrome
 * ============================================================================
 *
 * One source of truth for the "every Weekly-Pulse beat looks the same" guarantee:
 * the header cluster (BEAT chip floating top-left + FFmpeg logo IN LINE with the
 * title + subtitle), the footer (WEEK · period), the rounded backdrop panels, the
 * baked scatter background, and the bg-first-then-content intro timing.
 *
 * Each beat owns its GEOMETRY (where the header rects / content region sit per
 * aspect) and its CONTENT (grid, chart+rail, table, …); it calls these builders to
 * draw the chrome around that content with identical styling + timing.
 *
 * Text is fixed-font + width-capped (NEVER fit:"contain" — contain scales to the
 * cell height then clips a long line's width, e.g. "ACTIVITY TREND").
 * ============================================================================
 */

import * as path from "node:path";

// Node-only deep import (not re-exported from the barrel, which must stay
// web-bundleable). Translates in-asar paths so ffmpeg can open the assets.
import { fileAsset } from "@m0saic/template-utils/dist/m0saic/assetPath";
import type { MosaicColor, MosaicSource, MosaicTextSource } from "@m0saic/types";
import { bindProp, makeColorTile, fadeInExpr, isSmooth, latticeWeights, quantizedSections, type LayoutConstraint } from "@m0saic/template-utils";
import { overlay, paint, rowSplit, colSplit, EMPTY, type Band, type Node } from "../../../alpine/_shared/alpine-card";
import type { PulseTheme } from "./pulse-theme";

export type Rect = { x: number; y: number; w: number; h: number };
export type Variant = "desktop" | "square" | "mobile";

export function classify(W: number, H: number): Variant {
  const ar = W / H;
  return ar >= 1.3 ? "desktop" : ar < 0.85 ? "mobile" : "square";
}

// ── Leaves / utilities ──────────────────────────────────────────────────────

/** A fixed-font (NO fit:"contain") text leaf; callers width-cap via `capFont`. */
export function text1(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right" = "left"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}

/** A pill: a fully-rounded color tile under centered fitted text. */
export function pill(label: string, fill: MosaicColor, textColor: MosaicColor, fontSize: number): Node {
  return overlay([
    paint(makeColorTile(fill, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.34 } } }) as MosaicSource),
    paint(text1(label, fontSize, textColor, "center")),
  ]);
}

/** Largest font ≤ `px` that keeps `text` within `cellW` (≈`em` per char). */
export function capFont(px: number, text: string, cellW: number, min: number, em = 0.6): number {
  return Math.max(min, Math.min(Math.round(px), Math.floor(cellW / Math.max(1, (text || " ").length * em))));
}

/** Stamp an intro fade (overlay.alpha) onto every source of a Node. */
export function withFade(node: Node, startSec: number, durSec: number, on: boolean): Node {
  if (!on) return node;
  const alpha = fadeInExpr(startSec, durSec);
  return { m0: node.m0, sources: node.sources.map((s) => ({ ...s, overlay: { ...((s as { overlay?: object }).overlay ?? {}), alpha } } as MosaicSource)) };
}

/**
 * Stamp `editor.label` on a node's FIRST source — the box a `LayoutConstraint`
 * resolves the label to. Every chrome/content node here is `insetSafe(...)` around
 * a single content leaf (pill tile / logo / text / backdrop / mosaic-ref), so its
 * first source IS that leaf, placed at the node's rect. Editor-only metadata: it
 * never touches the m0 or the rendered pixels, so it's safe to leave on always
 * (the contract CHECK is separately debug-gated by `withLayoutContract`).
 */
export function labelNode(node: Node, label: string): Node {
  const [first, ...rest] = node.sources;
  if (!first) return node;
  const tagged = { ...(first as object), editor: { ...((first as { editor?: object }).editor ?? {}), label } } as MosaicSource;
  return { m0: node.m0, sources: [tagged, ...rest] };
}

/**
 * Bind a node's FIRST source (the content leaf — same reasoning as `labelNode`)
 * to the prop it SHOWS, so Make's double-click edits that prop in place.
 * Editor-only metadata, like the label: never touches the m0 or the pixels.
 */
export function bindNode(node: Node, propKey: string): Node {
  const [first, ...rest] = node.sources;
  if (!first) return node;
  return { m0: node.m0, sources: [bindProp({ ...(first as object) } as MosaicSource, propKey), ...rest] };
}

/** Inset a node at a pixel rect, omitting 0-weight margin bands (flatten-safe). */
export function insetSafe(node: Node, r: Rect, W: number, H: number): Node {
  const left = Math.max(0, Math.round(r.x)), top = Math.max(0, Math.round(r.y));
  const right = Math.max(0, W - Math.round(r.x + r.w)), bottom = Math.max(0, H - Math.round(r.y + r.h));
  const midW = Math.max(1, W - left - right), midH = Math.max(1, H - top - bottom);
  const cols: Band[] = [];
  if (left > 0) cols.push({ weight: left, node: EMPTY });
  cols.push({ weight: midW, node });
  if (right > 0) cols.push({ weight: right, node: EMPTY });
  const mid = cols.length === 1 ? node : colSplit(cols);
  const rows: Band[] = [];
  if (top > 0) rows.push({ weight: top, node: EMPTY });
  rows.push({ weight: midH, node: mid });
  if (bottom > 0) rows.push({ weight: bottom, node: EMPTY });
  return rows.length === 1 ? mid : rowSplit(rows);
}

/** The kit's cap — `split()` in alpine-card Hamilton-scales any band set over it to exactly this. */
const KIT_BASIS_CAP = 120;

/**
 * The cell `insetSafe(node, r, W, H)` will ACTUALLY produce, in px — the same
 * arithmetic as the kit (latticeWeights → weightedSplit → GCD) and the engine
 * (outside-in remainder), band construction mirrored from insetSafe.
 */
function insetCellPx(r: Rect, W: number, H: number): { width: number; height: number } {
  const left = Math.max(0, Math.round(r.x)), top = Math.max(0, Math.round(r.y));
  const right = Math.max(0, W - Math.round(r.x + r.w)), bottom = Math.max(0, H - Math.round(r.y + r.h));
  const midW = Math.max(1, W - left - right), midH = Math.max(1, H - top - bottom);
  const axis = (total: number, lo: number, mid: number, hi: number): number => {
    const bands = [lo, mid, hi].filter((v, i) => i === 1 || v > 0);
    if (bands.length === 1) return total;
    return quantizedSections(total, latticeWeights(bands, { cap: KIT_BASIS_CAP }))[lo > 0 ? 1 : 0];
  };
  return { width: axis(W, left, midW, right), height: axis(H, top, midH, bottom) };
}

/**
 * A nested child's slot, derived from the CELL its inset will produce — not
 * from the ideal rect. An absolutely-laid-out child (the deprecated alpine v1s
 * place rects at slot pixels) needs its cell to be at least its slot, and the
 * kit's 120-slot quantization can leave the cell a pixel short of the rect:
 * notable-commits' 720-wide feed in a 719 px cell was SPLIT_EXCEEDS_AXIS on
 * flatten at 1024² (2026-09-16). Rendering the child at the predicted cell
 * makes the fit exact at every canvas. The rect is also nudged until that cell
 * is 5-smooth on both axes, so the child inherits no rough factor
 * (latticeSmooth): the kit quantizes to 120 slots, so a cell only moves in
 * ~canvas/120 steps (8.5 px at 1024) and the search must span a few slots —
 * shrink first (up to `shrink` px, a card never grows into its neighbour's
 * gap), grow as a fallback (up to `grow` px). If nothing lands, the raw
 * prediction is used.
 */
export function insetSlot(r: Rect, W: number, H: number, shrink = 40, grow = 16): { rect: Rect; slot: { width: number; height: number } } {
  const nudges = [0];
  for (let k = 1; k <= Math.max(shrink, grow); k++) {
    if (k <= shrink) nudges.push(-k);
    if (k <= grow) nudges.push(k);
  }
  let rect = { ...r };
  let cell = insetCellPx(rect, W, H);
  if (!isSmooth(cell.width)) {
    for (const dw of nudges) {
      const cand = { ...rect, w: Math.max(1, r.w + dw) };
      const c = insetCellPx(cand, W, H);
      if (isSmooth(c.width)) { rect = cand; cell = c; break; }
    }
  }
  if (!isSmooth(cell.height)) {
    for (const dh of nudges) {
      const cand = { ...rect, h: Math.max(1, r.h + dh) };
      const c = insetCellPx(cand, W, H);
      if (isSmooth(c.height)) { rect = cand; cell = c; break; }
    }
  }
  return { rect, slot: { width: cell.width, height: cell.height } };
}

/** A rounded backdrop card that covers the busy scatter behind a content region. */
export function backdrop(fill: MosaicColor, r: Rect, W: number, H: number, startSec: number, durSec: number, on: boolean): Node {
  const card = paint(makeColorTile(fill, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.05 } } }) as MosaicSource);
  return insetSafe(withFade(card, startSec, durSec, on), r, W, H);
}

/** Bounding box of a set of rects (padded, clamped to the canvas). */
export function unionRect(rects: Rect[], pad: number, W: number, H: number): Rect {
  const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w)), maxY = Math.max(...rects.map((r) => r.y + r.h));
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return { x, y, w: Math.min(W - x, maxX - minX + 2 * pad), h: Math.min(H - y, maxY - minY + 2 * pad) };
}

// ── Intro timing ─────────────────────────────────────────────────────────────

export type PulseTiming = { clipSec: number; animOn: boolean; bgFinishT: number; chromeFadeDur: number; cardStagger: number; cardsStart: number };

/**
 * The shared intro choreography: the baked bg reveal plays first (its L→R wipe is
 * pre-rendered into the scatter video, finishing ~22%); THEN the chrome fades in;
 * THEN the beat's content cascades. reduceMotion → everything at t=0.
 */
export function pulseTiming(durationMs: number, reduceMotion: boolean): PulseTiming {
  const clipSec = Math.max(0.1, (durationMs ?? 9000) / 1000);
  const animOn = !reduceMotion;
  const bgFinishT = animOn ? clipSec * 0.22 : 0;
  const chromeFadeDur = Math.max(0.3, clipSec * 0.07);
  const cardStagger = Math.max(0.1, clipSec * 0.02);
  return { clipSec, animOn, bgFinishT, chromeFadeDur, cardStagger, cardsStart: bgFinishT + chromeFadeDur };
}

// ── Header + footer builders ─────────────────────────────────────────────────

export type HeaderRects = { beat: Rect; logo: Rect; title: Rect; subtitle: Rect };
export type HeaderLabels = {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** The prop key each label SHOWS (`bindNode` provenance). Omit an entry when
   *  the text is derived rather than a prop. */
  bind?: { eyebrow?: string; title?: string; subtitle?: string };
};

/** Build the header cluster (BEAT chip + logo + title + subtitle) at the given
 *  rects, faded with the chrome. Returns the nodes (compose order) + their bbox. */
export function buildHeader(rects: HeaderRects, theme: PulseTheme, labels: HeaderLabels, t: PulseTiming, W: number, H: number): { nodes: Node[]; bbox: Rect } {
  const { beat, logo, title, subtitle } = rects;
  const fc = (n: Node) => withFade(n, t.bgFinishT, t.chromeFadeDur, t.animOn);
  const beatNode = labelNode(insetSafe(fc(pill(labels.eyebrow, theme.primary, "#0d1117", capFont(beat.h * 0.5, labels.eyebrow, beat.w * 0.82, 10))), beat, W, H), "eyebrow");
  const logoNode = labelNode(insetSafe(fc(paint({ type: "media", mediaType: "image", assetId: "ffmpegLogo", placement: { fit: "contain" } } as unknown as MosaicSource)), logo, W, H), "logo");
  const titleNode = labelNode(insetSafe(fc(paint(text1(labels.title, capFont(title.h * 0.86, labels.title, title.w, 20, 0.62), theme.title, "left"))), title, W, H), "title");
  const subNode = labelNode(insetSafe(fc(paint(text1(labels.subtitle, capFont(subtitle.h * 0.92, labels.subtitle, subtitle.w, 11, 0.5), theme.subtitle, "left"))), subtitle, W, H), "subtitle");
  const b = labels.bind ?? {};
  const bound = (n: Node, key?: string) => (key ? bindNode(n, key) : n);
  return {
    nodes: [bound(beatNode, b.eyebrow), logoNode, bound(titleNode, b.title), bound(subNode, b.subtitle)],
    bbox: unionRect([beat, logo, title, subtitle], 0, W, H),
  };
}

/**
 * The cross-beat CHROME invariant, keyed off the labels `buildHeader`/`buildFooter`
 * stamp: the header cluster (eyebrow chip · logo · title · subtitle) stays in the
 * top band and left of center; the footer stays in the bottom band. Ratio-based,
 * so one declaration holds at any canvas AND any aspect (desktop / square / mobile).
 * Each beat spreads these and adds its own content-region constraints. The bands
 * are the invariant; the exact cluster positions differ per aspect (responsive) —
 * these assert nothing escapes its zone, which is what "chrome across resolutions"
 * means. Verified by `audit:layout-envelope` (16:9 × 9:16 × 1:1, 240→2160px).
 */
export const PULSE_CHROME_CONSTRAINTS: LayoutConstraint[] = [
  { label: "eyebrow", within: { yFrac: [0, 0.3], xFrac: [0, 0.55] } },
  { label: "logo", within: { yFrac: [0, 0.36], xFrac: [0, 0.55] } },
  { label: "title", within: { yFrac: [0, 0.36] } },
  { label: "subtitle", within: { yFrac: [0, 0.42] } },
  { label: "footer", within: { yFrac: [0.84, 1.0] } },
];

/**
 * The shared CONTENT invariant for the chart+rail beats (activity-trend,
 * contributions, top-contributors, changes-breakdown, notable-commits): the main
 * content panel (`content-panel` — chart / heatmap / table / donut / feed) and the
 * stat rail (`rail-panel`) both live in the mid band, between the header and footer,
 * at any aspect. The exact split (side-by-side on desktop, stacked on square/mobile)
 * is responsive; these assert both panels stay clear of the chrome bands.
 */
export const PULSE_CONTENT_CONSTRAINTS: LayoutConstraint[] = [
  { label: "content-panel", within: { yFrac: [0.14, 0.97] } },
  { label: "rail-panel", within: { yFrac: [0.14, 0.99] } },
];

/** Build the footer (WEEK · period) line at the given rect, faded with the chrome. */
export function buildFooter(footR: Rect, theme: PulseTheme, text: string, t: PulseTiming, W: number, H: number): Node {
  return labelNode(insetSafe(withFade(paint(text1(text, capFont(footR.h * 0.5, text, footR.w, 11, 0.5), theme.label, "left")), t.bgFinishT, t.chromeFadeDur, t.animOn), footR, W, H), "footer");
}

// ── Baked scatter background ─────────────────────────────────────────────────

/** The scatter background layer — references the baked per-aspect video (assetId
 *  "scatterBg", supplied by `chromeAssets`). */
export function scatterNode(): Node {
  return paint({ type: "media", mediaType: "video", assetId: "scatterBg", placement: { fit: "cover" } } as unknown as MosaicSource);
}

/** The chrome's shared file assets: the FFmpeg logo + the baked scatter for the
 *  given aspect. Spread into the beat document's `assets`. */
export function chromeAssets(variant: Variant): Record<string, { kind: "file"; path: string; mediaType: "image" | "video" }> {
  const asset = (name: string, mediaType: "image" | "video") => fileAsset(path.resolve(__dirname, "assets"), name, mediaType);
  return { ffmpegLogo: asset("ffmpeg-logo.png", "image"), scatterBg: asset(`scatter-${variant}.mp4`, "video"), qrFin: asset("qr-fin.mp4", "video") };
}
