import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/title/v1 — Weekly Pulse · Title beat
 * ============================================================================
 *
 * The opening hero card: the FFmpeg logo + wordmark, a big green "WEEKLY PULSE"
 * title, a one-line activity-summary subtitle, a date pill + week pill, and the
 * m0saic.io watermark — all left-of-center over the signature rectangle scatter,
 * which keeps the right side of the frame.
 *
 * Geometry is ADOPTED from the sidecar `title-layout.m0p` (the sandbox-approved,
 * GCD-compacted desktop / square / mobile layouts). At render we pick the
 * variant for the canvas aspect, read each labeled region's rect, scale it to
 * the target, and compose each cell as a Node (pills = a rounded tile under
 * fitted text) inset at its rect — then overlay the whole thing on the scatter.
 *
 * Aspect-adaptive (the variant carries the reflow), resolution-adaptive (rects
 * scale from the variant's native size), deterministic (intro = a seeded-free
 * staggered fade driven by `ctx.target.durationMs`; `anim.reduceMotion` → static).
 * ============================================================================
 */

import * as path from "node:path";

import { fileAsset as sharedFileAsset } from "@m0saic/template-utils/dist/m0saic/assetPath";
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
  withLayoutContract,
  type LayoutConstraint,
} from "@m0saic/template-utils";
// readLayoutFile reads the filesystem — deep import (not re-exported from the
// barrel, which must stay web-bundleable). This hero pack is node-only.
import { readLayoutFile } from "@m0saic/template-utils/dist/m0saic/readLayoutFile";
import { parseM0StringComplete } from "@m0saic/dsl";
import { getVariant, type M0pFile } from "@m0saic/dsl-file-formats";

import { overlay, paint, rowSplit, colSplit, EMPTY, type Band, type Node } from "../../../../alpine/_shared/alpine-card";
import { labelNode, bindNode } from "../../_shared/pulse-chrome";
import { pulseTheme, type PulsePreset, type PulseTheme } from "../../_shared/pulse-theme";
import { type WeeklyPulse, MOCK_FFMPEG_PULSE, periodLabel, resolvePulse, WEEKLY_PULSE_UPSTREAM_SCHEMA } from "../../_shared/pulse-data";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type AnimConfig = { introFrac: number; reduceMotion: boolean };

type TitleBeatProps = {
  /** The whole-video data sheet (only repo + period are read here). */
  pulse: WeeklyPulse;
  /** Big title line (the storyboard's "WEEKLY PULSE"). */
  headline?: string;
  preset?: PulsePreset;
  anim?: AnimConfig;
  // Human controls.
  animate?: boolean;
  introLength?: number;
  debugLayout?: boolean;
};

const DEFAULT_PRESET: PulsePreset = "dark";
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.85, reduceMotion: false }; // all anim completes ~85% of duration

// Region labels in the adopted layout pack (the durable join).
const LABEL = { logo: "Logo", wordmark: "Wordmark", title: "Title", subtitle: "Subtitle", date: "Date pill", week: "Week pill", watermark: "Watermark" } as const;
// Intro cascade order.
const CASCADE: string[] = [LABEL.logo, LABEL.wordmark, LABEL.title, LABEL.subtitle, LABEL.date, LABEL.week, LABEL.watermark];

// ---------------------------------------------------------------------------
// Layout pack (loaded once; copy-assets mirrors assets/ to dist/)
// ---------------------------------------------------------------------------

let BUNDLED: M0pFile | null = null;
function bundledLayout(): M0pFile {
  if (!BUNDLED) {
    const r = readLayoutFile(path.resolve(__dirname, "..", "..", "_shared", "assets", "title-layout.m0p"));
    if (r.kind !== "m0p") throw new Error("title-layout asset is not an .m0p pack");
    BUNDLED = r.file;
  }
  return BUNDLED;
}

function classify(W: number, H: number): string {
  const ar = W / H;
  return ar >= 1.3 ? "desktop" : ar < 0.85 ? "mobile" : "square";
}

// ---------------------------------------------------------------------------
// Text leaves
// ---------------------------------------------------------------------------

type HAlign = "left" | "center" | "right";
type VAlign = "top" | "middle" | "bottom";

function text1(text: string, fontSize: number, color: MosaicColor, hAlign: HAlign = "left", vAlign: VAlign = "middle"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign, vAlign } as any }] };
}
/** Two stacked lines in one cell (top / bottom thirds). */
function text2(l1: string, l2: string, fontSize: number, color: MosaicColor, hAlign: HAlign = "left"): MosaicTextSource {
  return {
    type: "text", visual: { backgroundColor: "black@0" },
    layers: [
      { content: { kind: "literal", text: l1 || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign, vAlign: "top" } as any },
      { content: { kind: "literal", text: l2 || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign, vAlign: "bottom" } as any },
    ],
  };
}

/** A pill: a fully-rounded color tile under centered fitted text. */
function pill(label: string, fill: MosaicColor, textColor: MosaicColor, fontSize: number): Node {
  return overlay([
    paint(makeColorTile(fill, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.5 } } }) as MosaicSource),
    paint(text1(label, fontSize, textColor, "center", "middle")),
  ]);
}

/** Inset a node at a pixel rect WITHOUT emitting 0-weight margin bands. A
 *  0-weight split cell is a 0-size frame — tolerated by the live renderer but
 *  rejected by flatten (SPLIT_EXCEEDS_AXIS). So we omit any zero margin, which
 *  matters for edge-flush rects (e.g. a bottom-right watermark touching W/H). */
function insetSafe(node: Node, rect: { x: number; y: number; w: number; h: number }, W: number, H: number): Node {
  const left = Math.max(0, Math.round(rect.x)), top = Math.max(0, Math.round(rect.y));
  const right = Math.max(0, W - Math.round(rect.x + rect.w)), bottom = Math.max(0, H - Math.round(rect.y + rect.h));
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

/** Stamp an intro fade (overlay.alpha expr) onto every source of a Node. */
function withFade(node: Node, startSec: number, durSec: number): Node {
  const alpha = fadeInExpr(startSec, durSec);
  return { m0: node.m0, sources: node.sources.map((s) => ({ ...s, overlay: { ...((s as { overlay?: object }).overlay ?? {}), alpha } } as MosaicSource)) };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<TitleBeatProps>({
  pulse: { type: "group" as any, required: false, description: "Weekly Pulse data sheet (repo + period drive the title card).", meta: { ui: { label: "Pulse data", order: 1, consumer: "agent" } } },
  headline: { type: "string", required: false, description: "Big title line.", meta: { control: { placeholder: "WEEKLY PULSE" }, ui: { label: "Headline", order: 1 } } },
  preset: { type: "string", required: false, description: "Pulse theme variant.", meta: { constraints: { oneOf: ["dark"] }, ui: { label: "Preset", order: 10 } } },
  anim: { type: "group" as any, required: false, description: "Intro: introFrac (share of clip), reduceMotion.", meta: { ui: { label: "Animation", collapsedByDefault: true, consumer: "agent" } } },
  animate: { type: "boolean", required: false, description: "Animate the intro cascade.", meta: { ui: { label: "Animate", consumer: "human", order: 1 }, control: { syncsTo: [{ prop: "anim.reduceMotion", map: { kind: "boolInvert" } }] } } },
  introLength: { type: "number", required: false, description: "How much of the clip the intro occupies.", meta: { constraints: { min: 0.1, max: 1 }, control: { flavor: "slider", step: 0.05, displayUnit: "pct", syncsTo: [{ prop: "anim.introFrac", map: { kind: "identity" } }] }, ui: { label: "Intro length", consumer: "human", order: 2 } } },
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract: assert the title content column stays on-canvas and left-of-center at any resolution/aspect (the SCALE_CONTENT clamp's guarantee); on violation render a LAYOUT_CONTRACT error mosaic + stamp editor.layoutContract. Default false; production never sets it. Swept by audit:layout-envelope.", meta: { ui: { label: "Debug layout", order: 20, collapsedByDefault: true } } },
});

export const FfmpegPulseTitle: MosaicTemplate<TitleBeatProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/title/v1"),
  label: "Weekly Pulse · Title",
  version: 1,
  description: "FFmpeg Weekly Pulse — title beat. The opening hero card: logo + wordmark, a big WEEKLY PULSE title, a summary subtitle, date + week pills, and the m0saic.io watermark over the signature rectangle scatter. Aspect-adaptive.",
  capabilities: { tier: "core" },
  internal: true,
  tags: ["hero", "ffmpeg-pulse", "title", "beat"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 9000 },
  upstreamDataSchema: WEEKLY_PULSE_UPSTREAM_SCHEMA,
  propsSchema,

  defaultProps: {
    debugLayout: false,
    pulse: MOCK_FFMPEG_PULSE,
    headline: "WEEKLY PULSE",
    preset: DEFAULT_PRESET,
    anim: DEFAULT_ANIM,
  },

  async render(props: TitleBeatProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const theme: PulseTheme = pulseTheme(props.preset ?? DEFAULT_PRESET);
    const pulse = resolvePulse(props.pulse, ctx);

    const variantKey = classify(W, H);
    const layout = bundledLayout();
    const variant = getVariant(layout, variantKey) ?? getVariant(layout, "desktop");
    if (!variant) return Promise.resolve(makeErrorMosaic("title-layout pack has no usable variant", { title: `${this.id}`, width: W, height: H }));

    // Read each labeled region rect at the variant's native size, scale to target.
    const nW = variant.size.width, nH = variant.size.height;
    const sx = W / nW, sy = H / nH;
    const labels = variant.labels ?? {};
    const parsed: any = parseM0StringComplete(variant.m0, nW, nH);
    const frames: any[] = parsed.ir?.renderFrames ?? parsed.renderFrames ?? [];
    const labelOf = (f: any): string | undefined => labels[f.meta?.stableKey ?? f.stableKey]?.text;
    type Rect = { x: number; y: number; w: number; h: number };
    const rectOf = (txt: string): Rect | null => {
      const f = frames.find((fr) => labelOf(fr) === txt);
      if (!f) return null;
      return { x: Math.round(f.x * sx), y: Math.round(f.y * sy), w: Math.round(f.width * sx), h: Math.round(f.height * sy) };
    };

    // Copy text.
    const headline = props.headline ?? "WEEKLY PULSE";
    const wordmark = pulse.repo?.name ?? "FFmpeg";
    const subL1 = "Weekly activity summary";
    const subL2 = `for the ${wordmark} repository`;
    const dateText = periodLabel(pulse.period);
    const weekText = `WEEK ${pulse.period?.weekNumber ?? ""}`.trim();

    // Intro choreography: the bg rects reveal first (rank-set sweep), THEN the
    // chrome cascades up over the remaining intro.
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 9000) / 1000);
    // Phase targets (fractions of the clip): the BAKED bg reveal completes at
    // ~22% (≈2s @ 9s — the L→R wipe is pre-rendered into the scatter video); the
    // chrome comes up after, finishing at ~83% (≈7.5s @ 9s), then holds to the end.
    const bgFinishT = animate ? clipSec * 0.22 : 0;
    const chromeEndT = clipSec * 0.83;
    const chromeStart = bgFinishT;                            // chrome starts when the baked bg finishes
    const elemFadeDur = Math.max(0.4, clipSec * 0.1);
    const cardFadeDur = Math.max(0.8, clipSec * 0.16);        // title card + M fade slower
    // Stagger so the LAST element's (slow) fade ends right at chromeEndT.
    const lastStart = Math.max(chromeStart, chromeEndT - cardFadeDur);
    const stepGap = CASCADE.length > 1 ? Math.max(0.05, (lastStart - chromeStart) / (CASCADE.length - 1)) : 0;
    const startOf = (label: string) => chromeStart + Math.max(0, CASCADE.indexOf(label)) * stepGap;

    // Scale the title card + ALL its children up ~25%, grown from the block's
    // top-left anchor (stays left-of-center; fonts derive from the scaled height).
    const contentLabels = [LABEL.logo, LABEL.wordmark, LABEL.title, LABEL.subtitle, LABEL.date, LABEL.week];
    const crects = contentLabels.map((l) => rectOf(l)).filter((r): r is Rect => !!r);
    const anchorX = crects.length ? Math.min(...crects.map((r) => r.x)) : 0;
    const anchorY = crects.length ? Math.min(...crects.map((r) => r.y)) : 0;
    // CLAMP the growth so the scaled block never overflows the canvas. Desktop is
    // wide enough to keep the full 1.25; the narrow aspects (square/mobile) — whose
    // native content already nearly fills the width — pull the factor back to ~1.0,
    // which is what kept the title overflowing the right edge and shoving the
    // right-aligned WEEK pill off-canvas / under the watermark.
    const marginX = Math.round(W * 0.05), marginY = Math.round(H * 0.04);
    const maxRight = crects.length ? Math.max(...crects.map((r) => r.x + r.w)) : W;
    const maxBot = crects.length ? Math.max(...crects.map((r) => r.y + r.h)) : H;
    const sMaxX = (W - marginX - anchorX) / Math.max(1, maxRight - anchorX);
    const sMaxY = (H - marginY - anchorY) / Math.max(1, maxBot - anchorY);
    const SCALE_CONTENT = Math.min(1.25, sMaxX, sMaxY);
    const scaleRect = (r: Rect): Rect => ({
      x: Math.round(anchorX + (r.x - anchorX) * SCALE_CONTENT),
      y: Math.round(anchorY + (r.y - anchorY) * SCALE_CONTENT),
      w: Math.round(r.w * SCALE_CONTENT),
      h: Math.round(r.h * SCALE_CONTENT),
    });
    const fh = (frac: number, r: Rect, min: number) => Math.max(min, Math.round(r.h * frac));

    // Content cells (everything inside the title card), scaled + inset + fade-stamped.
    const content: Node[] = [];
    const place = (label: string, build: (r: Rect) => Node, rectOverride?: Rect | null) => {
      const src = rectOf(label);
      const r = rectOverride ?? (src ? scaleRect(src) : null);
      if (!r || r.w <= 0 || r.h <= 0) return;
      const lit = animate ? withFade(build(r), startOf(label), elemFadeDur) : build(r);
      content.push(insetSafe(lit, r, W, H));
    };

    // Brand pairing: square the FFmpeg logo cell (so the glyph has no side
    // padding) and butt the FFmpeg wordmark right against it — read as one unit.
    const logoScaled = rectOf(LABEL.logo) ? scaleRect(rectOf(LABEL.logo)!) : null;
    const logoSquare: Rect | null = logoScaled ? { ...logoScaled, w: logoScaled.h } : null;
    let wordmarkRect: Rect | null = null;
    if (logoSquare && rectOf(LABEL.wordmark)) {
      const w = scaleRect(rectOf(LABEL.wordmark)!);
      const x = logoSquare.x + logoSquare.w + Math.round(logoSquare.h * 0.1);
      wordmarkRect = { x, y: w.y, w: Math.max(1, w.x + w.w - x), h: w.h };
    }
    // Right-align the WEEK pill to the content column's right edge.
    const colRight = Math.max(0, ...[LABEL.title, LABEL.subtitle].map((l) => { const s = rectOf(l); if (!s) return 0; const r = scaleRect(s); return r.x + r.w; }));
    let weekRect: Rect | null = null;
    if (rectOf(LABEL.week)) { const w = scaleRect(rectOf(LABEL.week)!); weekRect = { ...w, x: Math.max(w.x, Math.round(colRight - w.w)) }; }

    place(LABEL.logo, () => paint({ type: "media", mediaType: "image", assetId: "ffmpegLogo", placement: { fit: "contain" } } as unknown as MosaicSource), logoSquare);
    place(LABEL.wordmark, (r) => paint(text1(wordmark, fh(0.62, r, 16), theme.title, "left", "middle")), wordmarkRect);
    place(LABEL.title, (r) => bindNode(paint(text1(headline, fh(0.78, r, 24), theme.primaryBright, "left", "middle")), "headline"));
    place(LABEL.subtitle, (r) => paint(text2(subL1, subL2, fh(0.38, r, 12), theme.subtitle, "left")));
    place(LABEL.date, (r) => pill(dateText, theme.card, theme.label, fh(0.34, r, 12)));
    place(LABEL.week, (r) => pill(weekText, theme.primary, "#0d1117", fh(0.34, r, 12)), weekRect);

    // Watermark = the m0saic brand M (static image, assets/m-hero.png — the canonical
    // orange brand mark) beside the m0saic.io URL text. Static (not animated) so it
    // doesn't distract; a flat image scales to any slot cheaply and flattens cleanly
    // (the live logo grid is infeasible at watermark size).
    const wmR = rectOf(LABEL.watermark);
    if (wmR && wmR.w > 0 && wmR.h > 0) {
      // A compact BLACK card anchored bottom-right, with the brand M STACKED over the
      // m0saic.io URL (M on top, text right underneath with a little breathing room).
      // Smaller, more rectangular surface than the full watermark region.
      const edge = Math.round(Math.min(W, H) * 0.014);
      // Card anchored to min(W,H) (≈1080 on every native variant) so it scales with
      // render resolution. Desktop + mobile sit at 0.21 (≈227px — approved). Square's
      // FFmpeg logo glyph is smaller than desktop's (≈107px vs ≈133px), so the same
      // card reads oversized there; pull square back to ~0.175 (≈189px) so the
      // attribution M tracks the FFmpeg logo size, the stated reference.
      const wmF = variantKey === "square" ? 0.175 : 0.21;
      const cardW = Math.round(Math.min(W, H) * wmF);
      const cardH = Math.round(cardW * 1.08); // a touch taller for the 3-row stack
      const cx = W - edge - cardW, cy = H - edge - cardH;
      const padX = Math.round(cardW * 0.12), padY = Math.round(cardH * 0.09);
      const poweredNode = paint(text1("Powered by", Math.max(9, Math.round(cardH * 0.085)), theme.label, "center", "middle"));
      const mark = paint({ type: "media", mediaType: "image", assetId: "mHero", placement: { fit: "contain" } } as unknown as MosaicSource);
      const textNode = paint(text1("m0saic.io", Math.max(11, Math.round(cardH * 0.115)), theme.label, "center", "middle"));
      const stack = rowSplit([
        { weight: padY, node: EMPTY },
        { weight: Math.round(cardH * 0.12), node: poweredNode },  // "Powered by" above
        { weight: Math.round(cardH * 0.03), node: EMPTY },
        { weight: Math.round(cardH * 0.40), node: mark },         // the M
        { weight: Math.round(cardH * 0.04), node: EMPTY },        // breathing room
        { weight: Math.round(cardH * 0.15), node: textNode },     // m0saic.io underneath
        { weight: padY, node: EMPTY },
      ]);
      const inner = colSplit([
        { weight: padX, node: EMPTY },
        { weight: Math.max(1, cardW - 2 * padX), node: stack },
        { weight: padX, node: EMPTY },
      ]);
      const card = paint(makeColorTile("#0B0B0B", { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.12 } } }) as MosaicSource);
      const wmStack = overlay([card, inner]);
      const lit = animate ? withFade(wmStack, startOf(LABEL.watermark), cardFadeDur) : wmStack;
      content.push(insetSafe(lit, { x: cx, y: cy, w: cardW, h: cardH }, W, H));
    }

    // Rounded backdrop card behind the left content column (covers the busy
    // scatter so the copy reads) — drawn between the scatter and the content.
    let backdrop: Node | null = null;
    const bbox = contentLabels.map((l) => rectOf(l)).filter((r): r is Rect => !!r).map(scaleRect);
    if (bbox.length) {
      const minX = Math.min(...bbox.map((r) => r.x)), minY = Math.min(...bbox.map((r) => r.y));
      const maxX = Math.max(...bbox.map((r) => r.x + r.w)), maxY = Math.max(...bbox.map((r) => r.y + r.h));
      const P = Math.round(Math.min(W, H) * 0.03);
      const bx = Math.max(0, minX - P), by = Math.max(0, minY - P);
      const bw = Math.min(W - bx, maxX - minX + 2 * P), bh = Math.min(H - by, maxY - minY + 2 * P);
      const card = paint(makeColorTile(theme.card, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.05 } } }) as MosaicSource);
      const lit = animate ? withFade(card, chromeStart, cardFadeDur) : card;
      backdrop = labelNode(insetSafe(lit, { x: bx, y: by, w: bw, h: bh }, W, H), "content-panel");
    }

    // Baked scatter background — the CONSTANT field + its L→R reveal, pre-rendered
    // once to a flat per-aspect video (scatter-<aspect>.mp4, by scatter-bake/v1).
    // Referenced as ONE media source (was ~80K chars of nested live scatter that
    // took minutes to render): the bake collapses DSL + render cost to near-zero.
    // "cover" fills the canvas at any render size; it's the bottom (background) layer.
    const scatterRef = paint({ type: "media", mediaType: "video", assetId: "scatterBg", placement: { fit: "cover" } } as unknown as MosaicSource);
    const root = overlay([scatterRef, ...(backdrop ? [backdrop] : []), ...content]);

    const assetsDir = path.resolve(__dirname, "..", "..", "_shared", "assets");
    const fileAsset = (name: string, mediaType: "image" | "video") =>
      sharedFileAsset(assetsDir, name, mediaType);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {
        mHero: fileAsset("m-hero.png", "image"),
        ffmpegLogo: fileAsset("ffmpeg-logo.png", "image"),
        scatterBg: fileAsset(`scatter-${variantKey}.mp4`, "video"),
      } as any,
      m0: root.m0 as any,
      sources: root.sources,
      backgroundColor: theme.canvas,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Layout contract (dev tripwire; no nested children here). The content column
    // must stay on-canvas + left-of-center — the SCALE_CONTENT clamp's guarantee.
    const constraints: LayoutConstraint[] = [
      { label: "content-panel", within: { yFrac: [0, 0.97], xFrac: [0, 0.99] } },
    ];
    return withLayoutContract(doc, ctx, { templateId: "@m0saic/hero/ffmpeg-pulse/title/v1", constraints, flatten: false, debug: props.debugLayout === true });
  },
};

registerTemplate(FfmpegPulseTitle);
