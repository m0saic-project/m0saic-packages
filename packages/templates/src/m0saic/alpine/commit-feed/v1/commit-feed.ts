import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/commit-feed/v1 — Commit Feed (Alpine primitive)
 * ============================================================================
 *
 * A scannable list of notable commits for a maintainer audience. Each row:
 *   ▏[kind icon]  title …………………  #PR
 *   ▏[area chip]  author · reviewers · date
 * with a thin left STATUS BAR colored by `signal` (green win / amber warn / grey
 * neutral) so risky changes jump out. Generic — kind→color/glyph + the columns are
 * arbitrary, so it isn't tied to FFmpeg.
 *
 * EVERY element is positioned with placeRect (exact-pixel rect + null-tile margins),
 * NOT proportional splits — splits spread the quantization remainder into small rects
 * (stretched the icon box / drifted rows at sizes that don't divide evenly). See
 * feedback_placerect_exact_positioning. Narrow/portrait drops the reviewer discs to
 * avoid cramming. Rows fade in on a cascade; reduceMotion → static. showHeader:false
 * + washColor + transparent surface to compose under a chrome.
 * ============================================================================
 */

import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource, MosaicTextSource, MosaicTemplate } from "@m0saic/types";
import { definePropsSchema, registerTemplate, makeColorTile, makeErrorMosaic, fadeInExpr, type ThemeSourceConfig } from "@m0saic/template-utils";
import { placeRects } from "@m0saic/dsl-stdlib";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";

type Signal = "win" | "warn" | "neutral";
type CommitRow = { kind?: string; title: string; hash?: string; author?: string; date?: string; pr?: number | string; reviewers?: string[]; area?: string; signal?: Signal };
/** Reveal cost/quality dial. "premium" (default): rows cascade in via `overlay.alpha`
 *  (a geq per faded source). "light": the same cascade via free enable-gate pops —
 *  no geq, composable, cheap when nested. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; introFrac: number; reduceMotion: boolean };

type CommitFeedProps = {
  rows: CommitRow[];
  title?: string;
  subtitle?: string;
  /** Alpine theme variant (light default; "dark" = the night look the FFmpeg hero uses). */
  preset?: AlpinePreset;
  showHeader?: boolean;
  iconPath?: string;
  accent?: MosaicColor;
  backgroundColor?: MosaicColor;
  washColor?: MosaicColor;
  kindColors?: Record<string, MosaicColor>;
  kindGlyphs?: Record<string, string>;
  anim?: AnimConfig;
  /** Opt-in producer theming. Uses the shared alpine theme by default (light); a
   *  producer's published tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
};

// Alpine-pack citizen: card/text colors come from the shared alpine theme (light by
// default; the FFmpeg hero passes preset:"dark"). Only DATA-SEMANTIC colors are local:
// GLYPH_COLOR (dark glyph on the colored chips) + the signal/kind/reviewer maps (their
// meaning IS the color, so they read the same on light or dark).
const GLYPH_COLOR: MosaicColor = "#0d1117";
const DEFAULT_PRESET: AlpinePreset = "light";

const SIGNAL_COLOR: Record<Signal, MosaicColor> = { win: "#3fb950", warn: "#e3b341", neutral: "#6e7681" };
const KIND_COLORS: Record<string, MosaicColor> = { feat: "#3fb950", fix: "#388bfd", perf: "#a371f7", docs: "#e3b341", test: "#2ea043", chore: "#8b949e" };
const KIND_GLYPHS: Record<string, string> = {
  feat: "M12.9 4.5a.9.9 0 0 0-1.8 0v6.6H4.5a.9.9 0 0 0 0 1.8h6.6v6.6a.9.9 0 0 0 1.8 0v-6.6h6.6a.9.9 0 0 0 0-1.8h-6.6V4.5Z",
  fix: "M4.5 10.5h15a1.5 1.5 0 0 1 0 3h-15a1.5 1.5 0 0 1 0-3Z",
  perf: "M12 3.5 19.5 12H15v8.5H9V12H4.5L12 3.5Z",
  docs: "M5 5.4h14v2.4H5zM5 10.8h14v2.4H5zM5 16.2h9v2.4H5z",
  test: "M19.8 6.9a1 1 0 0 1 .15 1.41l-8.8 11a1 1 0 0 1-1.5.07l-4.6-4.6a1 1 0 1 1 1.4-1.42l3.8 3.8 8.13-10.16a1 1 0 0 1 1.42-.1Z",
  chore: "M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z",
};
const REVIEWER_HUES: MosaicColor[] = ["#3fb950", "#388bfd", "#a371f7", "#db61a2", "#e3b341"];

const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, reduceMotion: false };
const MAX_ROWS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Fixed-font text (NO fit:contain — which scales to box height then clips width on
// long strings). The caller sizes the font to fit the box width via capFont.
function textSource(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}
/** Largest font (≤ maxPx) whose `text` fits `boxW` at ~`em` per char. */
function capFont(maxPx: number, text: string, boxW: number, minPx: number, em = 0.58): number {
  return Math.max(minPx, Math.min(Math.round(maxPx), Math.floor(boxW / Math.max(1, (text || " ").length * em))));
}
function blend(a: string, b: string, t: number): MosaicColor {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const mix = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return ("#" + [mix(16), mix(8), mix(0)].map((x) => x.toString(16).padStart(2, "0")).join("")) as MosaicColor;
}
function fadeAll(srcs: MosaicSource[], startSec: number, durSec: number, on: boolean): MosaicSource[] {
  if (!on) return srcs;
  return srcs.map((s) => ({ ...s, overlay: { ...((s as { overlay?: Record<string, unknown> }).overlay ?? {}), alpha: fadeInExpr(startSec, durSec) } }));
}

const propsSchema = definePropsSchema<CommitFeedProps>({
  // ── Primary props — flat, like controls grouped together (text → toggles → colors). ──
  rows: { type: "array" as any, required: true, description: "Feed rows. Each: title (+ optional kind, author, date, pr, reviewers, area, signal).", meta: { control: { flavor: "jsonModal" }, ui: { label: "Rows", order: 1 } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., NOTABLE COMMITS" }, ui: { label: "Title", order: 2 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant (light default; dark = the FFmpeg hero look).", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 4 } } },
  showHeader: { type: "boolean", required: false, description: "Show the icon + title + subtitle band (default true). False when a parent chrome supplies the title.", meta: { ui: { label: "Show header", order: 5 } } },
  accent: { type: "string", required: false, description: "Accent color (header chip). Defaults to the theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Accent", order: 6 } } },
  backgroundColor: { type: "string", required: false, description: "Card surface color. \"black@0\" → transparent (composed under a chrome).", meta: { constraints: { isColor: true }, control: { placeholder: "theme card", colorPicker: true, defaultColor: "#FFFFFF" }, ui: { label: "Card color", order: 7 } } },
  washColor: { type: "string", required: false, description: "Solid color the row tiles blend against (for transparent surfaces on a colored backdrop).", meta: { constraints: { isColor: true }, control: { placeholder: "card background", colorPicker: true, defaultColor: "#FFFFFF" }, ui: { label: "Wash base", order: 8 } } },

  // ── Collapsible groups (nice human controls). ──
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + row-cascade intro.",
    meta: { ui: { label: "Animation", order: 11, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): rows cascade in via alpha fade — a geq per faded source. \"light\": the same cascade via free enable-gate pops — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 13, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,

  // ── Agent props — opaque, no nice human control (a raw SVG path / an open-keyed
  //    map you'd have to hand-type): they live in the agent fold, not the main form. ──
  iconPath: { type: "string", required: false, description: "Header glyph SVG path d (24×24).", meta: { control: { placeholder: "none" }, ui: { label: "Icon path (SVG d)", order: 14, consumer: "agent" } } },
  kindColors: { type: "group" as any, required: false, description: "kind → tile color override (open-keyed map).", meta: { ui: { label: "Kind colors", order: 15, collapsedByDefault: true, consumer: "agent" } } },
  kindGlyphs: { type: "group" as any, required: false, description: "kind → 24×24 SVG path glyph override (open-keyed map).", meta: { ui: { label: "Kind glyphs", order: 16, collapsedByDefault: true, consumer: "agent" } } },
});

export const AlpineCommitFeed: MosaicTemplate<CommitFeedProps> = {
  id: asTemplateId("@m0saic/alpine/commit-feed/v1"),
  label: "Alpine Commit Feed",
  version: 1,
  description: "Alpine commit feed — friendly mobile-marketing card: a scannable list of notable commits (kind icon + title + PR, area chip + author + reviewers + date) with a signal status bar (green win / amber warn / neutral). Alpine-light by default; the FFmpeg Weekly Pulse uses preset:\"dark\".",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "Absolute-placement antipattern: every row element (status bar, kind tile, glyph, title, PR, area chip, author, reviewer discs, date) is an exact-pixel rect packed full-canvas via placeRects, so precision tracks the canvas (audit: ABSOLUTE, slope 1.00) — a nestable primitive that pins its parent near its own render canvas. Kept as the canonical 'absolute list' example. Use v2 — the SAME picture rebuilt as nested row/col splits with proportional weights (resolution-invariant m0), so it composes at any canvas.",
    replacement: asTemplateId("@m0saic/alpine/commit-feed/v2"),
    since: "2026-07-09",
  },
  tags: ["alpine", "commit-feed", "feed", "list", "data-viz"],
  outputHints: { width: 1280, height: 720, fps: 30, durationMs: 3000 }, // 720 not 708: a 5-smooth hinted canvas (latticeSmooth)
  propsSchema,

  defaultProps: {
    showHeader: true,
    preset: "light",
    theme: { forceFetch: false },
    rows: [
      { kind: "perf", area: "avcodec", title: "avcodec: improve AV1 decode performance", hash: "a1b2c3d", author: "Anton Khirnov", date: "May 15", pr: 14201, reviewers: ["James Almer", "Michael Niedermayer"], signal: "warn" },
      { kind: "feat", area: "avformat", title: "avformat: add support for new container", hash: "d4e5f6g", author: "James Almer", date: "May 14", pr: 14198, reviewers: ["Anton Khirnov"], signal: "neutral" },
      { kind: "fix", area: "avfilter", title: "avfilter: fix memory leak in overlay filter", hash: "h7i8j9k", author: "Marton Balint", date: "May 13", pr: 14185, reviewers: ["Anton Khirnov", "Limin Wang"], signal: "win" },
      { kind: "docs", area: "doc", title: "doc: update HLS documentation", hash: "l0m1n2o", author: "Limin Wang", date: "May 12", pr: 14180, reviewers: ["Marton Balint"], signal: "neutral" },
      { kind: "test", area: "tests", title: "tests: add FATE test for edge case", hash: "p3q4r5s", author: "Michael Niedermayer", date: "May 16", pr: 14205, reviewers: ["James Almer"], signal: "win" },
    ],
    title: "NOTABLE COMMITS",
    subtitle: "Highlight interesting work.",
    anim: DEFAULT_ANIM,
  },

  async render(props: CommitFeedProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const rows = (props.rows ?? []).filter((r) => r && typeof r.title === "string").slice(0, MAX_ROWS);
    if (!rows.length) return makeErrorMosaic("commit-feed needs rows[]", { title: `${this.id} props`, width: W, height: H });

    // Alpine theming: light by default; the FFmpeg hero passes preset:"dark". A producer
    // can override via props.theme; explicit color props still win. The palette names
    // below shadow the (removed) module constants, so every body reference stays unchanged.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const CARD_BG = theme.card, ROW_BG = theme.grid, TITLE_COLOR = theme.title,
      LABEL_COLOR = theme.muted, META_COLOR = theme.label;
    const accent = props.accent ?? theme.primary;
    const cardBg = props.backgroundColor ?? CARD_BG;
    const surfaceSolid = typeof cardBg === "string" && cardBg.startsWith("#");
    const washBase: MosaicColor = props.washColor ?? (surfaceSolid ? cardBg : CARD_BG);
    const kindColors = { ...KIND_COLORS, ...(props.kindColors ?? {}) };
    const kindGlyphs = { ...KIND_GLYPHS, ...(props.kindGlyphs ?? {}) };
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    const showHeader = props.showHeader ?? true;
    const narrow = W < 820; // portrait / small → drop the reviewer discs to avoid cramming
    const N = rows.length;

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 3000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelay = Math.min(0.15, introT * 0.1);
    const CASCADE = 0.5;
    const rowDur = Math.max(0.05, (introT - introDelay) / (1 + CASCADE * Math.max(0, N - 1)));
    const rowStagger = CASCADE * rowDur;

    const pad = Math.round(Math.min(W, H) * 0.04);
    const innerW = Math.max(1, W - 2 * pad), innerH = Math.max(1, H - 2 * pad);
    const headerH = showHeader ? Math.round(innerH * 0.16) : 0;
    const headerGap = showHeader ? Math.round(innerH * 0.04) : 0;
    const rowsTop = pad + headerH + headerGap;
    const rowsH = Math.max(1, innerH - headerH - headerGap);
    const gap = Math.max(6, Math.round(rowsH * 0.025));
    const rowH = Math.max(1, Math.floor((rowsH - (N - 1) * gap) / N));

    const tile = (color: MosaicColor, radius: number): MosaicSource => makeColorTile(color, { effects: { rounding: { cornerStyle: "rounded", borderRadius: radius } } }) as MosaicSource;
    const glyph = (path: string): MosaicSource => makeColorTile(GLYPH_COLOR, { mask: { kind: "inline-mask", localPath: path, bounds: { x: 0, y: 0, width: 24, height: 24 } } }) as MosaicSource;
    const fmtPr = (pr?: number | string) => (pr == null || pr === "" ? "" : `#${pr}`);

    // z-order via importance: surface < row bg < tiles < text/glyphs.
    const Z = { surface: 0, rowBg: 1, tile: 2, ink: 3 };
    type Piece = { rect: { x: number; y: number; w: number; h: number; importance: number }; source: MosaicSource };
    const pieces: Piece[] = [];
    const add = (src: MosaicSource, x: number, y: number, w: number, h: number, importance: number, startSec: number) => {
      const xi = Math.max(0, Math.min(W - 1, Math.round(x))), yi = Math.max(0, Math.min(H - 1, Math.round(y)));
      const wi = Math.max(1, Math.min(Math.round(w), W - xi)), hi = Math.max(1, Math.min(Math.round(h), H - yi));
      // Mode-aware reveal: premium fades (geq), light enable-gates (no geq); reduceMotion static.
      // Premium is byte-identical to the pre-audit `fadeAll` overlay.
      const revealed = !animate ? src : light ? revealGate(src, startSec) : fadeAll([src], startSec, rowDur, true)[0];
      pieces.push({ rect: { x: xi, y: yi, w: wi, h: hi, importance }, source: revealed });
    };

    // ── Surface ──
    if (surfaceSolid) add(tile(cardBg, 0.04), 0, 0, W, H, Z.surface, 0);

    // ── Header ──
    if (showHeader) {
      const hIcon = Math.round(headerH * 0.62), hIconX = pad, hIconY = pad + Math.round((headerH - hIcon) / 2);
      add(tile(accent, 0.28), hIconX, hIconY, hIcon, hIcon, Z.tile, introDelay);
      if (props.iconPath) { const hg = Math.round(hIcon * 0.56); add(glyph(props.iconPath), hIconX + Math.round((hIcon - hg) / 2), hIconY + Math.round((hIcon - hg) / 2), hg, hg, Z.ink, introDelay); }
      const tX = hIconX + hIcon + Math.round(headerH * 0.22), tW = Math.max(1, W - pad - tX);
      const titleText = props.title ?? "NOTABLE COMMITS";
      add(textSource(titleText, capFont(Math.round(headerH * 0.42), titleText, tW, 14, 0.64), TITLE_COLOR, "left"), tX, pad, tW, Math.round(headerH * 0.58), Z.ink, introDelay);
      const subText = props.subtitle ?? "Highlight interesting work.";
      add(textSource(subText, capFont(Math.round(headerH * 0.22), subText, tW, 10, 0.55), LABEL_COLOR, "left"), tX, pad + Math.round(headerH * 0.6), tW, Math.round(headerH * 0.4), Z.ink, introDelay);
    }

    // ── Rows ──
    for (let i = 0; i < N; i++) {
      const r = rows[i];
      const startSec = introDelay + i * rowStagger;
      const rx = pad, ry = rowsTop + i * (rowH + gap), rw = innerW;
      const sig = SIGNAL_COLOR[(r.signal ?? "neutral") as Signal] ?? SIGNAL_COLOR.neutral;
      const kColor = (r.kind && kindColors[r.kind]) || LABEL_COLOR;
      const kGlyph = r.kind ? kindGlyphs[r.kind] : undefined;

      const cpad = Math.round(rowH * 0.16);
      const barW = Math.max(4, Math.round(rowH * 0.06));
      const barX = rx + cpad, barY = ry + Math.round(rowH * 0.2), barH = rowH - 2 * Math.round(rowH * 0.2);
      const iconSide = Math.round(rowH * 0.5);
      const iconX = barX + barW + Math.round(rowH * 0.18), iconY = ry + Math.round((rowH - iconSide) / 2);
      const gSide = Math.round(iconSide * 0.56), gX = iconX + Math.round((iconSide - gSide) / 2), gY = iconY + Math.round((iconSide - gSide) / 2);
      const cX = iconX + iconSide + Math.round(rowH * 0.2), cRight = rx + rw - cpad, cW = Math.max(1, cRight - cX);
      const line1Y = ry + Math.round(rowH * 0.15), line1H = Math.round(rowH * 0.4);
      const line2Y = ry + Math.round(rowH * 0.56), line2H = Math.round(rowH * 0.3);

      add(tile(blend(washBase, ROW_BG, 0.5), 0.12), rx, ry, rw, rowH, Z.rowBg, startSec); // row bg
      add(tile(sig, 0.5), barX, barY, barW, barH, Z.tile, startSec); // status bar
      add(tile(kColor, 0.28), iconX, iconY, iconSide, iconSide, Z.tile, startSec); // kind tile
      if (kGlyph) add(glyph(kGlyph), gX, gY, gSide, gSide, Z.ink, startSec); // kind glyph

      // line 1: title (+ PR when wide).
      const showPr = !narrow && !!fmtPr(r.pr);
      const prW = showPr ? Math.round(cW * 0.16) : 0, prX = cRight - prW;
      const titleW = Math.max(1, (showPr ? prX - Math.round(rowH * 0.1) : cRight) - cX);
      add(textSource(r.title, capFont(Math.round(line1H * 0.62), r.title, titleW, 12, 0.55), TITLE_COLOR, "left"), cX, line1Y, titleW, line1H, Z.ink, startSec);
      if (showPr) add(textSource(fmtPr(r.pr), capFont(Math.round(line1H * 0.5), fmtPr(r.pr), prW, 10, 0.6), LABEL_COLOR, "right"), prX, line1Y, prW, line1H, Z.ink, startSec);

      // line 2: area chip · author · [reviewers when wide] · date.
      const dateText = r.date ?? "";
      const dateW = Math.max(1, Math.round(cW * (narrow ? 0.26 : 0.15))), dateX = cRight - dateW;
      let mx = cX;
      if (r.area) {
        const chipFont = capFont(Math.round(line2H * 0.6), r.area, Math.round(cW * 0.18), 8, 0.6);
        const areaW = Math.min(Math.round(cW * 0.22), Math.round(chipFont * (r.area.length + 2) * 0.62));
        add(tile(blend(washBase, kColor, 0.24), 0.34), mx, line2Y, areaW, line2H, Z.tile, startSec);
        add(textSource(r.area, chipFont, TITLE_COLOR, "center"), mx, line2Y, areaW, line2H, Z.ink, startSec);
        mx += areaW + Math.round(rowH * 0.12);
      }
      const discSide = Math.min(line2H, Math.round(rowH * 0.26));
      const revW = !narrow ? (Math.min(2, r.reviewers?.length ?? 0) * (discSide + Math.round(rowH * 0.05)) + Math.round(rowH * 0.1)) : 0;
      const authorW = Math.max(1, dateX - revW - mx - Math.round(rowH * 0.12));
      add(textSource(r.author ?? "", capFont(Math.round(line2H * 0.7), r.author ?? "", authorW, 9, 0.6), META_COLOR, "left"), mx, line2Y, authorW, line2H, Z.ink, startSec);
      if (!narrow && r.reviewers?.length) {
        let dx = dateX - revW + Math.round(rowH * 0.05);
        const dy = line2Y + Math.round((line2H - discSide) / 2);
        r.reviewers.slice(0, 2).forEach((nm, k) => {
          const init = (nm.trim()[0] ?? "?").toUpperCase();
          add(tile(REVIEWER_HUES[k % REVIEWER_HUES.length], 0.5), dx, dy, discSide, discSide, Z.tile, startSec); // square → circle
          add(textSource(init, Math.max(8, Math.round(discSide * 0.6)), GLYPH_COLOR, "center"), dx, dy, discSide, discSide, Z.ink, startSec);
          dx += discSide + Math.round(rowH * 0.05);
        });
      }
      add(textSource(dateText, capFont(Math.round(line2H * 0.7), dateText, dateW, 9, 0.6), LABEL_COLOR, "right"), dateX, line2Y, dateW, line2H, Z.ink, startSec);
    }

    // ── Pack everything onto as few layers as possible (placeRects) ──
    const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) });
    const sources: MosaicSource[] = [];
    for (const layer of (placed as { layers: Array<{ rectIndices: number[] }> }).layers) {
      const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
      for (const idx of ordered) sources.push(pieces[idx].source);
    }

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: String((placed as { m0: string }).m0) as any,
      sources,
      // Standalone (solid card) → the alpine canvas shows in the rounded-corner gaps;
      // composed under a chrome (transparent surface) → keep it transparent.
      backgroundColor: surfaceSolid ? theme.canvas : "black@0",
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
    } as MosaicDocument);
  },
};

registerTemplate(AlpineCommitFeed);
