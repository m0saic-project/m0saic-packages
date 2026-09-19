import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/treemap/v1 — Alpine Treemap (friendly mobile-marketing)
 * ============================================================================
 *
 * A squarified treemap inside the Alpine white card: value-sized rounded tiles
 * packed to fill the card, each labelled with its name + share. The classic
 * proportion / composition surface (budget split, market share, storage usage).
 * STANDALONE Alpine brand flavor.
 *
 * Layout = the squarified treemap algorithm (Bruls et al.) — greedily packs the
 * sorted values into rows that keep tile aspect ratios near 1, so no slivers.
 * Construction follows the donut / heatmap model: each tile + label is an
 * ABSOLUTELY-PLACED tight rect packed full-canvas via `placeRects` on the SNAP_PX
 * lattice (grid passed as a full-canvas extraLayer → no insetNode re-quantization).
 * Tiles are plain rounded `makeColorTile`s, no inline-masks. Animation: tiles fade
 * in biggest→smallest; `anim.reduceMotion` → the static map.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTextSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  fadeInExpr,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { placeRects } from "@m0saic/dsl-stdlib";

import {
  alpineCard,
  EMPTY,
  resolveColor,
  type Node,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, ALPINE_PALETTE, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, ALPINE_ANIM_FIELDS, fBool, fFrac, fStr, fEnum } from "../../_shared/alpine-anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type TreeItem = { label: string; value: number; color?: MosaicColor };
type ValueMode = "percent" | "value" | "none";
/** Reveal cost/quality dial. "premium" (default): tiles + text fade in (a geq each).
 *  "light": the same cascade via free enable-gate pops — no geq, composable. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; reduceMotion: boolean; introFrac: number; easing: EaseName };

type AlpineTreemapProps = {
  // ── Primary props (flat) ──
  items: TreeItem[];
  title?: string;
  subtitle?: string;
  /** What the second label line shows. */
  valueMode?: ValueMode;
  preset?: AlpinePreset;
  showValue?: boolean;
  // ── Grouped props ──
  /** Tile geometry. */
  tiles?: { cornerRadius?: number };
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, easing: "easeOut", reduceMotion: false };
const DEFAULT_VALUE_MODE: ValueMode = "percent";
const MAX_ITEMS = 12;
const SNAP_PX = 4;
const EDGE_PAD = 1.5;

// ---------------------------------------------------------------------------
// Color / format helpers
// ---------------------------------------------------------------------------

function luminance(hex: MosaicColor): number {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return (0.2126 * ((v >> 16) & 0xff) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)) / 255;
}
function onColor(hex: MosaicColor, light: MosaicColor, dark: MosaicColor): MosaicColor {
  return luminance(hex) > 0.62 ? dark : light;
}
function compactNum(v: number): string {
  const n = Math.round(v);
  const abs = Math.abs(n);
  const fmt = (x: number, suf: string) => `${x.toFixed(1).replace(/\.0$/, "")}${suf}`;
  if (abs < 1000) return String(n);
  if (abs < 1e6) return fmt(n / 1e3, "K");
  if (abs < 1e9) return fmt(n / 1e6, "M");
  return fmt(n / 1e9, "B");
}

// ---------------------------------------------------------------------------
// Tight-cell placement + text helpers (mirrors donut / heatmap)
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };
type BBox = { minX: number; minY: number; maxX: number; maxY: number };
/** A treemap cell rect (canvas px), before snapping. */
type TileRect = { x: number; y: number; w: number; h: number };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const snapGrid = (v: number) => Math.round(v / SNAP_PX) * SNAP_PX;

function rectPiece(W: number, H: number, x: number, y: number, w: number, h: number, source: MosaicSource, importance?: number): Piece {
  const x0 = clampInt(snapGrid(x), 0, W - SNAP_PX);
  const y0 = clampInt(snapGrid(y), 0, H - SNAP_PX);
  const x1 = clampInt(snapGrid(x + w), x0 + SNAP_PX, W);
  const y1 = clampInt(snapGrid(y + h), y0 + SNAP_PX, H);
  return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, claimant: "F", importance }, source };
}
function placeText(W: number, H: number, bbox: BBox, source: MosaicSource, importance?: number): Piece {
  const snapDown = (v: number) => Math.floor((v - EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const snapUp = (v: number) => Math.ceil((v + EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const x = clampInt(snapDown(bbox.minX), 0, W - 1);
  const y = clampInt(snapDown(bbox.minY), 0, H - 1);
  const x2 = clampInt(snapUp(bbox.maxX), x + SNAP_PX, W);
  const y2 = clampInt(snapUp(bbox.maxY), y + SNAP_PX, H);
  return { rect: { x, y, w: x2 - x, h: y2 - y, claimant: "F", importance }, source };
}
function cellText(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right" = "left"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}
function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}
/** Left-anchored text bbox (starts AT x). */
function leftTextBBox(x: number, cy: number, text: string, font: number): BBox {
  const w = Math.max(font, text.length * font * 0.6 + font * 0.4);
  const h = font * 1.5;
  return { minX: x, minY: cy - h / 2, maxX: x + w, maxY: cy + h / 2 };
}
/** Clip a line to maxW px with an ellipsis so a long name never spills its tile. */
function truncateToWidth(text: string, font: number, maxW: number): string {
  const maxChars = Math.max(1, Math.floor(maxW / (font * 0.6)));
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Squarified treemap (Bruls/Huizing/van Wijk). Returns one rect per input area,
// in the SAME order as `areas`. `areas` must be pre-scaled to the rect's area.
// ---------------------------------------------------------------------------

function squarify(areas: number[], rect: TileRect): TileRect[] {
  const out: TileRect[] = new Array(areas.length);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  // worst aspect ratio of a row laid along a side of length `side`.
  const worst = (row: number[], side: number): number => {
    if (row.length === 0) return Infinity;
    const s = sum(row);
    const rmax = Math.max(...row), rmin = Math.min(...row);
    return Math.max((side * side * rmax) / (s * s), (s * s) / (side * side * rmin));
  };
  let x = rect.x, y = rect.y, w = rect.w, h = rect.h;
  let i = 0;
  const n = areas.length;
  // Lay a finished row into [x,y,w,h]; write rects to `out[startIdx..]`; return the leftover rect.
  const layoutRow = (row: number[], startIdx: number): void => {
    const s = sum(row);
    if (w >= h) {
      const rw = s / h; // column of width rw down the left edge
      let yy = y;
      for (let k = 0; k < row.length; k++) {
        const rh = row[k] / rw;
        out[startIdx + k] = { x, y: yy, w: rw, h: rh };
        yy += rh;
      }
      x += rw; w -= rw;
    } else {
      const rh = s / w; // row of height rh across the top
      let xx = x;
      for (let k = 0; k < row.length; k++) {
        const rw = row[k] / rh;
        out[startIdx + k] = { x: xx, y, w: rw, h: rh };
        xx += rw;
      }
      y += rh; h -= rh;
    }
  };
  let row: number[] = [];
  let rowStart = 0;
  while (i < n) {
    const side = Math.min(w, h);
    const next = areas[i];
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      i++;
    } else {
      layoutRow(row, rowStart);
      rowStart += row.length;
      row = [];
    }
  }
  if (row.length) layoutRow(row, rowStart);
  return out;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineTreemapProps>({
  items: { type: "array" as any, required: true, description: "Treemap items. Each: a label, a value (sizes the tile), an optional color.", meta: { control: { flavor: "objectRows", columns: [{ label: "Label", key: "label", kind: "text", placeholder: "Segment" }, { label: "Value", key: "value", kind: "number" }, { label: "Color", key: "color", kind: "color" }] }, ui: { label: "Items", order: 1 } } },
  // ── Flat props grouped by control type (text → enum → toggle). ──
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., MARKET SHARE" }, ui: { label: "Title", order: 2 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  valueMode: { type: "string", required: false, description: "Second label line: percent share, raw value, or none.", meta: { constraints: { oneOf: ["percent", "value", "none"] }, ui: { label: "Value mode", order: 4 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 5 } } },
  showValue: { type: "boolean", required: false, description: "Show the value / share line in each tile.", meta: { ui: { label: "Show value", order: 6 } } },
  // ── Canonical (agent) ──
  // ── Collapsible groups (the slider lives here, not intermixed with the flat props). ──
  tiles: {
    type: "group" as any, required: false, description: "Tile geometry.",
    meta: { ui: { label: "Tiles", order: 7, collapsedByDefault: true } },
    fields: { cornerRadius: fFrac("Tile radius", "Tile corner radius (0..0.5).") },
  } as any,
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + tile-cascade intro.",
    meta: { ui: { label: "Animation", order: 8, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): tiles + text fade in — a geq each. \"light\": the same cascade via free enable-gate pops — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      easing: ALPINE_ANIM_FIELDS.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 9, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,
});

export const AlpineTreemap: MosaicTemplate<AlpineTreemapProps> = {
  id: asTemplateId("@m0saic/alpine/treemap/v1"),
  label: "Alpine Treemap",
  version: 1,
  description: "Alpine treemap — friendly mobile-marketing card: value-sized rounded tiles (squarified) filling the card, each labelled with its name + share, tiles fading in biggest→smallest. Standalone Alpine brand flavor.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "Absolute-placement antipattern: the squarified algorithm's natural nested structure is flattened to a flat rect list packed full-canvas via placeRects, so precision tracks the canvas (audit: ABSOLUTE, slope 1.04) and it pins its parent when nested. Use v2 — the SAME squarified layout emitted as its natural NESTED row/col splits (auto-quantized to a small basis → bounded precision), with the gap as a per-tile placement.inset. Composes at any canvas.",
    replacement: asTemplateId("@m0saic/alpine/treemap/v2"),
    since: "2026-07-09",
  },
  tags: ["alpine", "treemap", "proportion", "data-viz"],
  outputHints: { width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    theme: { forceFetch: false },
    items: [
      { label: "Engineering", value: 42 },
      { label: "Sales", value: 26 },
      { label: "Marketing", value: 16 },
      { label: "Support", value: 9 },
      { label: "Design", value: 7 },
    ],
    title: "HEADCOUNT",
    subtitle: "By department",
    preset: DEFAULT_PRESET,
    valueMode: DEFAULT_VALUE_MODE,
    tiles: { cornerRadius: 0.06 },
    showValue: true,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineTreemapProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const raw = (props.items ?? [])
      .filter((it) => it && typeof it.label === "string" && Number.isFinite(it.value) && it.value > 0)
      .slice(0, MAX_ITEMS);
    if (raw.length === 0) {
      return makeErrorMosaic("items[] must have at least one item with value > 0", { title: `${this.id} props`, width: W, height: H });
    }

    // Theming: the shared alpine theme (light default). A producer overrides tokens
    // via props.theme; explicit colors still win. Unthemed → byte-identical.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    // Mode-aware reveals: premium fades (geq); light enable-gates (no geq).
    const revealOv = (s: number, dur: number): Record<string, unknown> => light ? { startAtSec: s, enable: `gte(t,${s.toFixed(3)})` } : { startAtSec: s, alpha: fadeInExpr(s, dur) };
    const ffText = <T extends MosaicSource>(src: T, s: number, dur: number): T => !animate ? src : light ? revealGate(src, s) : fadeIn(src, s, dur, true);
    const showValue = props.showValue ?? true;
    const valueMode: ValueMode = props.valueMode ?? DEFAULT_VALUE_MODE;
    const cornerRadius = Math.max(0, Math.min(0.5, props.tiles?.cornerRadius ?? 0.06));

    // Sort biggest→smallest (squarify expects descending) but remember the original
    // index so per-item color overrides + palette cycling track the input order.
    const order = raw.map((_, i) => i).sort((a, b) => raw[b].value - raw[a].value);
    const total = raw.reduce((s, it) => s + it.value, 0);
    const tileColor = (origIdx: number): MosaicColor => resolveColor(raw[origIdx].color, ALPINE_PALETTE[origIdx % ALPINE_PALETTE.length]);

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    // Squarify the sorted values into the content rect (areas scaled to its area).
    const areaPx = cr.w * cr.h;
    const areas = order.map((oi) => (raw[oi].value / total) * areaPx);
    const tiles = squarify(areas, { x: cr.x, y: cr.y, w: cr.w, h: cr.h });

    const gap = Math.max(SNAP_PX, snapGrid(Math.min(cr.w, cr.h) * 0.012));
    // Label fonts SHRINK-TO-FIT per tile: each tile picks the largest font (≤ base)
    // that fits its full name, floored at a minimum below which the name truncates.
    // So medium tiles show their whole label instead of clipping at one global size.
    const baseNameFont = Math.max(12, Math.round(H * 0.028));
    const baseValFont = Math.max(10, Math.round(H * 0.022));
    const minNameFont = Math.max(10, Math.round(H * 0.018));

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const fadeDur = Math.max(0.08, introT * 0.45);
    const N = order.length;
    const startAt = (rank: number) => (animate ? (introT - fadeDur) * (N > 1 ? rank / (N - 1) : 0) : 0);

    const pieces: Piece[] = [];

    for (let rank = 0; rank < N; rank++) {
      const oi = order[rank];
      const t = tiles[rank];
      // inset by the gap so tiles read as separated cards.
      const tx = t.x + gap / 2, ty = t.y + gap / 2, tw = t.w - gap, th = t.h - gap;
      if (tw < SNAP_PX || th < SNAP_PX) continue;
      const fill = tileColor(oi);
      const s = startAt(rank);
      const tile = makeColorTile(fill, {
        effects: { rounding: { cornerStyle: "rounded", borderRadius: cornerRadius } },
        ...(animate ? { overlay: revealOv(s, fadeDur) } : {}),
      });
      pieces.push(rectPiece(W, H, tx, ty, tw, th, tile, 0));

      // Labels (top-left), shown only when the tile is big enough to hold them.
      // pad also clears the rounded CORNER (radius·minSide) so the label never
      // crowds the curve at a high cornerRadius.
      const cornerPx = cornerRadius * Math.min(tw, th);
      const pad = Math.max(SNAP_PX, Math.round(Math.min(tw, th) * 0.1), Math.round(cornerPx * 0.5));
      const innerW = tw - pad * 2;
      // Shrink-to-fit: largest font (≤ base) that fits the full name in innerW,
      // floored at minNameFont (below which truncateToWidth clips it).
      const nameLen = Math.max(1, raw[oi].label.length);
      const nameFont = Math.max(minNameFont, Math.min(baseNameFont, Math.floor(innerW / (nameLen * 0.6))));
      const valFont = Math.max(8, Math.round(nameFont * (baseValFont / baseNameFont)));
      const txtColor = onColor(fill, "#FFFFFF", theme.title);
      const subColor = onColor(fill, "#FFFFFF", theme.subtitle);
      const wantValue = showValue && valueMode !== "none";
      const fitsName = innerW >= nameFont * 2 && th >= nameFont * 1.9;
      const fitsValue = wantValue && th >= pad * 2 + nameFont * 1.7 + valFont * 1.2;
      if (fitsName) {
        const name = truncateToWidth(raw[oi].label, nameFont, innerW);
        const nameCy = ty + pad + nameFont * 0.6;
        pieces.push(placeText(W, H, leftTextBBox(tx + pad, nameCy, name, nameFont),
          ffText(cellText(name, nameFont, txtColor, "left"), s + fadeDur * 0.3, fadeDur), 1));
        if (fitsValue) {
          const vText = valueMode === "percent" ? `${Math.round((raw[oi].value / total) * 100)}%` : compactNum(raw[oi].value);
          // Clear gap between the name and the value line (was cramped at ~0.7·font).
          const valCy = nameCy + nameFont * 0.62 + Math.round(nameFont * 0.42) + valFont * 0.5;
          pieces.push(placeText(W, H, leftTextBBox(tx + pad, valCy, vText, valFont),
            ffText(cellText(vText, valFont, subColor, "left"), s + fadeDur * 0.4, fadeDur), 1));
        }
      }
    }

    // Pack full-canvas → one { m0, sources }.
    const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) as any });
    const sources: MosaicSource[] = [];
    for (const layer of (placed as { layers: Array<{ rectIndices: number[] }> }).layers) {
      const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
      for (const idx of ordered) sources.push(pieces[idx].source);
    }
    const body: Node = { m0: String((placed as { m0: string }).m0), sources };

    // Full-canvas absolute geometry → extraLayer (NOT scaled content) so it renders
    // at exact canvas pixels and is never re-quantized by insetNode.
    const root = card.compose(EMPTY, body);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument);
  },
};

registerTemplate(AlpineTreemap);
