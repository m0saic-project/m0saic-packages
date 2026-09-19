import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/timeline/v1 — Alpine Timeline (friendly mobile-marketing)
 * ============================================================================
 *
 * A vertical milestone timeline inside the Alpine white card: a spine running
 * down a left rail with a dot per event, and each event's date + title (+ an
 * optional description) to the right of its dot. The classic "our journey" /
 * roadmap / changelog surface. STANDALONE Alpine brand flavor.
 *
 * Construction follows the donut / heatmap model — the spine segments, dots and
 * every text line are ABSOLUTELY-PLACED tight rects packed full-canvas via
 * `placeRects` on the SNAP_PX lattice, so the dots align exactly to their text
 * rows and the layout never fights nested-split quantization. Dots are rounded
 * `makeColorTile`s (borderRadius 0.5 = circle), no inline-masks. Animation: the
 * spine "draws down" as each segment + dot cascades in top→bottom with the text
 * fading alongside; `anim.reduceMotion` → the static timeline.
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
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type TimelineEvent = { date?: string; title: string; description?: string; color?: MosaicColor };
/** Reveal cost/quality dial. "premium" (default): dots/spine/text fade in (a geq
 *  each). "light": the same cascade via free enable-gate pops — no geq, composable. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; reduceMotion: boolean; introFrac: number; easing: EaseName };
/** "auto" → horizontal on a wide (landscape) card, vertical otherwise. */
type Orientation = "auto" | "vertical" | "horizontal";

type AlpineTimelineProps = {
  // ── Primary props (flat) ──
  events: TimelineEvent[];
  title?: string;
  subtitle?: string;
  orientation?: Orientation;
  preset?: AlpinePreset;
  showDescription?: boolean;
  /** Spine + dot accent color. Defaults to the theme primary. */
  color?: MosaicColor;
  // ── Grouped props ──
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, easing: "easeOut", reduceMotion: false };
const MAX_EVENTS = 7;
const SNAP_PX = 4;
const EDGE_PAD = 1.5;

// ---------------------------------------------------------------------------
// Tight-cell placement + text helpers (mirrors donut / heatmap)
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };
type BBox = { minX: number; minY: number; maxX: number; maxY: number };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const snapGrid = (v: number) => Math.round(v / SNAP_PX) * SNAP_PX;

/** Place a pixel rect, snapping its edges to the SNAP_PX lattice (quantization-safe). */
function rectPiece(W: number, H: number, x: number, y: number, w: number, h: number, source: MosaicSource, importance?: number): Piece {
  const x0 = clampInt(snapGrid(x), 0, W - SNAP_PX);
  const y0 = clampInt(snapGrid(y), 0, H - SNAP_PX);
  const x1 = clampInt(snapGrid(x + w), x0 + SNAP_PX, W);
  const y1 = clampInt(snapGrid(y + h), y0 + SNAP_PX, H);
  return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, claimant: "F", importance }, source };
}

/** Place a text bbox snapped to the SNAP grid. */
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
/** Left-anchored text bbox (the headline starts AT x, extends right). */
function leftTextBBox(x: number, cy: number, text: string, font: number): BBox {
  const w = Math.max(font, text.length * font * 0.6 + font * 0.5);
  const h = font * 1.5;
  return { minX: x, minY: cy - h / 2, maxX: x + w, maxY: cy + h / 2 };
}
/** Center-anchored text bbox (the headline is centered on cx). */
function centerTextBBox(cx: number, cy: number, text: string, font: number): BBox {
  const w = Math.max(font, text.length * font * 0.6 + font * 0.5);
  const h = font * 1.5;
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}
/** Clip a line to `maxW` px with a trailing ellipsis — so an absurdly long title
 *  can't overflow the card or collide with a neighbor (it truncates instead). */
function truncateToWidth(text: string, font: number, maxW: number): string {
  const charW = font * 0.6;
  const maxChars = Math.max(1, Math.floor(maxW / charW));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineTimelineProps>({
  events: { type: "array" as any, required: true, description: "Timeline events (top→bottom). Each: an optional date, a title, an optional description + color.", meta: { control: { flavor: "objectRows", columns: [{ label: "Date", key: "date", kind: "text", placeholder: "Jan 2024" }, { label: "Title", key: "title", kind: "text", placeholder: "Milestone" }, { label: "Description", key: "description", kind: "text", placeholder: "What happened" }, { label: "Color", key: "color", kind: "color" }] }, ui: { label: "Events", order: 1 } } },
  // ── Flat props grouped by control type (text → enum → toggle → color). ──
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., MILESTONES" }, ui: { label: "Title", order: 2 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  orientation: { type: "string", required: false, description: "Layout direction. auto → horizontal on a wide card, vertical on square/tall.", meta: { constraints: { oneOf: ["auto", "vertical", "horizontal"] }, ui: { label: "Orientation", order: 4 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 5 } } },
  showDescription: { type: "boolean", required: false, description: "Show each event's description line.", meta: { ui: { label: "Show description", order: 6 } } },
  color: { type: "string", required: false, description: "Spine + dot accent color. Defaults to the theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Accent color", order: 7 } } },

  // ── Collapsible groups. ──
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + spine-draw cascade intro.",
    meta: { ui: { label: "Animation", order: 8, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): dots/spine/text fade in — a geq each. \"light\": the same cascade via free enable-gate pops — no geq, composable, cheap when nested."),
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

export const AlpineTimeline: MosaicTemplate<AlpineTimelineProps> = {
  id: asTemplateId("@m0saic/alpine/timeline/v1"),
  label: "Alpine Timeline",
  version: 1,
  description: "Alpine timeline — friendly mobile-marketing card: a vertical milestone timeline with a spine + dots that draw down top→bottom, each event a date + title + description. Standalone Alpine brand flavor.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "Absolute-placement antipattern: the spine segments, dots and every text line are exact-pixel rects packed full-canvas via placeRects on the SNAP lattice, so precision tracks the canvas (audit: ABSOLUTE, slope 1.04) — a nestable primitive that pins its parent near its own render canvas. Kept as the canonical 'absolute list' example. Use v2 — the SAME picture rebuilt as nested row/col splits (dots insetNode-centered to squares on a shared band), so it composes at any canvas.",
    replacement: asTemplateId("@m0saic/alpine/timeline/v2"),
    since: "2026-07-09",
  },
  tags: ["alpine", "timeline", "milestones", "data-viz"],
  outputHints: { width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    theme: { forceFetch: false },
    events: [
      { date: "Jan 2024", title: "Project kickoff", description: "Team assembled, first commit landed" },
      { date: "Mar 2024", title: "Beta launch", description: "500 early users onboarded" },
      { date: "Jun 2024", title: "Series A", description: "$12M raised to scale the team" },
      { date: "Sep 2024", title: "10k customers", description: "Crossed five figures" },
      { date: "Dec 2024", title: "Global expansion", description: "Live in 12 countries" },
    ],
    title: "MILESTONES",
    subtitle: "Our journey so far",
    preset: DEFAULT_PRESET,
    orientation: "auto",
    showDescription: true,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineTimelineProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const events = (props.events ?? [])
      .filter((e) => e && typeof e.title === "string" && e.title.trim())
      .slice(0, MAX_EVENTS);
    if (events.length === 0) {
      return makeErrorMosaic("events[] must have at least one event with a title", { title: `${this.id} props`, width: W, height: H });
    }
    const N = events.length;

    // Theming: the shared alpine theme (light default). A producer overrides tokens
    // via props.theme; explicit colors still win. Unthemed → byte-identical.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    // Mode-aware overlay for the dots/spine (premium fades = geq; light enable-gates = no geq).
    const revealOv = (s: number, dur: number): Record<string, unknown> => light ? { startAtSec: s, enable: `gte(t,${s.toFixed(3)})` } : { startAtSec: s, alpha: fadeInExpr(s, dur) };
    // Mode-aware text reveal.
    const ffText = <T extends MosaicSource>(src: T, s: number, dur: number): T => !animate ? src : light ? revealGate(src, s) : fadeIn(src, s, dur, true);
    const showDescription = props.showDescription ?? true;
    const accent = resolveColor(props.color, theme.primary);
    const dotColor = (i: number): MosaicColor => resolveColor(events[i].color, accent);

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    // Fonts.
    const titleFont = Math.max(13, Math.round(H * 0.03));
    const dateFont = Math.max(10, Math.round(H * 0.021));
    const descFont = Math.max(10, Math.round(H * 0.022));

    const dotR = Math.max(SNAP_PX, snapGrid(titleFont * 0.42));
    const spineW = Math.max(SNAP_PX, snapGrid(H * 0.005));

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelay = Math.min(0.12, introT * 0.06);
    const CASCADE = 0.6;
    const eventDur = Math.max(0.05, (introT - introDelay) / (1 + CASCADE * Math.max(0, N - 1)));
    const eventStagger = CASCADE * eventDur;
    const startAt = (i: number) => (animate ? introDelay + i * eventStagger : 0);
    const lineGap = Math.round(titleFont * 0.28);

    type Line = { text: string; font: number; color: MosaicColor };
    const eventLines = (i: number): Line[] => {
      const lines: Line[] = [];
      if (events[i].date && events[i].date!.trim()) lines.push({ text: events[i].date!, font: dateFont, color: theme.muted });
      lines.push({ text: events[i].title, font: titleFont, color: theme.title });
      if (showDescription && events[i].description && events[i].description!.trim()) lines.push({ text: events[i].description!, font: descFont, color: theme.subtitle });
      return lines;
    };
    const stackHeight = (lines: Line[]) => lines.reduce((a, l) => a + l.font * 1.1, 0) + lineGap * (lines.length - 1);

    const pieces: Piece[] = [];
    // dot: a circle (borderRadius 0.5 on a square), accent (or per-event) color.
    const pushDot = (cx: number, cy: number, i: number, s: number) =>
      pieces.push(rectPiece(W, H, cx - dotR, cy - dotR, dotR * 2, dotR * 2,
        makeColorTile(dotColor(i), { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.5 } }, ...(animate ? { overlay: revealOv(s, eventDur) } : {}) }), 1));
    // spine segment (between two dots) — draws in with the later event (importance 0, behind dots).
    const pushSeg = (x: number, y: number, w: number, h: number, s: number) =>
      pieces.push(rectPiece(W, H, x, y, w, h,
        makeColorTile(theme.grid, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.5 } }, ...(animate ? { overlay: revealOv(s, eventDur) } : {}) }), 0));
    const pushStack = (lines: Line[], anchorX: number, blockTop: number, hAlign: "left" | "center", s: number) => {
      let ly = blockTop;
      for (const ln of lines) {
        const hK = ln.font * 1.1, lcy = ly + hK / 2;
        const bbox = hAlign === "left" ? leftTextBBox(anchorX, lcy, ln.text, ln.font) : centerTextBBox(anchorX, lcy, ln.text, ln.font);
        pieces.push(placeText(W, H, bbox, ffText(cellText(ln.text, ln.font, ln.color, hAlign), s + eventDur * 0.25, eventDur), 1));
        ly += hK + lineGap;
      }
    };

    // Orientation: explicit, else auto — horizontal on a wide (landscape) card so the
    // timeline fills the width instead of hugging the left rail; vertical on square/tall.
    const orientation: "vertical" | "horizontal" =
      props.orientation === "vertical" || props.orientation === "horizontal"
        ? props.orientation
        : W / H >= 1.25 ? "horizontal" : "vertical";

    if (orientation === "vertical") {
      // Left rail: spine + dot, then a gap, then the left-aligned text block.
      const rowH = Math.min(Math.round(H * 0.16), Math.floor(cr.h / N));
      const top = snapGrid(cr.y + Math.max(0, (cr.h - rowH * N) / 2));
      const rowCenterY = (i: number) => top + Math.round(rowH * (i + 0.5));
      const railX = snapGrid(cr.x + dotR + Math.round(cr.w * 0.01));
      const textX = snapGrid(railX + dotR + Math.round(cr.w * 0.03));
      // Truncate to the room between the text rail and the card's right edge.
      const maxW = Math.max(dotR * 4, cr.x + cr.w - textX - Math.round(cr.w * 0.01));
      for (let i = 1; i < N; i++) pushSeg(railX - spineW / 2, rowCenterY(i - 1), spineW, rowCenterY(i) - rowCenterY(i - 1), startAt(i));
      for (let i = 0; i < N; i++) {
        const cy = rowCenterY(i), s = startAt(i);
        const lines = eventLines(i).map((l) => ({ ...l, text: truncateToWidth(l.text, l.font, maxW) }));
        pushDot(railX, cy, i, s);
        pushStack(lines, textX, cy - stackHeight(lines) / 2, "left", s);
      }
    } else {
      // Horizontal: a spine across the content rect, dots evenly spaced, each event's
      // text block ALTERNATING above / below the line so the card fills its width.
      const margin = Math.round(cr.w * 0.06);
      const railL = snapGrid(cr.x + margin), railR = snapGrid(cr.x + cr.w - margin);
      const spineY = snapGrid(cr.y + cr.h / 2);
      const dotX = (i: number) => (N > 1 ? snapGrid(railL + (railR - railL) * (i / (N - 1))) : snapGrid(cr.x + cr.w / 2));
      const gap = Math.round(dotR + titleFont * 0.7);
      // Truncate each block to ~one column width so adjacent events never collide.
      const columnPitch = N > 1 ? (railR - railL) / (N - 1) : cr.w;
      const maxW = Math.min(columnPitch * 0.92, cr.w * 0.92);
      for (let i = 1; i < N; i++) pushSeg(dotX(i - 1), spineY - spineW / 2, dotX(i) - dotX(i - 1), spineW, startAt(i));
      const halfWidth = (lines: Line[]) => Math.max(...lines.map((l) => l.text.length * l.font * 0.6 + l.font * 0.5)) / 2;
      for (let i = 0; i < N; i++) {
        const cx = dotX(i), s = startAt(i);
        const lines = eventLines(i).map((l) => ({ ...l, text: truncateToWidth(l.text, l.font, maxW) }));
        pushDot(cx, spineY, i, s);
        const above = i % 2 === 0;
        const blockTop = above ? spineY - gap - stackHeight(lines) : spineY + gap;
        // Clamp the text-block center so the edge events (first/last dot near the card
        // border) never spill past the content rect — the dot stays at cx; the text
        // shifts inward just enough to stay in-bounds.
        const hw = halfWidth(lines);
        const ax = Math.max(cr.x + hw, Math.min(cr.x + cr.w - hw, cx));
        pushStack(lines, snapGrid(ax), blockTop, "center", s);
      }
    }

    // ── Pack full-canvas → one { m0, sources } ──
    const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) as any });
    const sources: MosaicSource[] = [];
    for (const layer of (placed as { layers: Array<{ rectIndices: number[] }> }).layers) {
      const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
      for (const idx of ordered) sources.push(pieces[idx].source);
    }
    const body: Node = { m0: String((placed as { m0: string }).m0), sources };

    // Full-canvas absolute geometry → pass as an extraLayer (NOT the scaled content),
    // so it renders at exact canvas pixels and is never re-quantized by insetNode.
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

registerTemplate(AlpineTimeline);
