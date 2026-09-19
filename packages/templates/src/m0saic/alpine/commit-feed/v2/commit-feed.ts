import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/commit-feed/v2 — Commit Feed (Alpine primitive, RATIO rebuild)
 * ============================================================================
 *
 * Same picture as v1 — a scannable list of notable commits, each row a thin
 * signal STATUS BAR + kind icon + title/#PR + area chip · author · reviewers ·
 * date — but rebuilt as a RATIO layout instead of absolute `placeRects`.
 *
 * v1 packed every element as an exact-pixel rect via `placeRects`, so its
 * precision floor tracked the canvas (audit: ABSOLUTE, slope 1.00) — a nestable
 * primitive that pins its parent near its own render canvas. v2 emits nested
 * row/col splits whose weights are PROPORTIONS of the row's pixel dims (basis
 * ~100), so the m0 is resolution-invariant within an aspect and the whole feed
 * composes at any canvas (audit: RATIO). Construction follows the
 * leaderboard / bar-graph-v2 model via the shared alpine-card Node kit.
 *
 * Narrow/portrait still drops the reviewer discs + #PR to avoid cramming. Rows
 * cascade in (premium = alpha fade / light = enable-gate pop); reduceMotion →
 * static. showHeader:false + a transparent surface compose it under a chrome.
 * ============================================================================
 */

import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource, MosaicTemplate } from "@m0saic/types";
import { definePropsSchema, registerTemplate, makeColorTile, makeErrorMosaic, withLayoutContract, textEmUnits, bindProp, bindPropPath, latticeWeights, quantizedSections, type ThemeSourceConfig } from "@m0saic/template-utils";
import {
  EMPTY, paint, rowSplit, colSplit, overlay, insetNode, textCell, tag, fitEmUnits, type Node, type Band,
} from "../../_shared/alpine-card";
import { ALPINE_GLYPHS, ALPINE_GLYPH_NAMES, resolveAlpineGlyph } from "../../_shared/alpine-glyphs";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGateNode, revealFadeNode, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";

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
  /** Friendly named header glyph (shared alpine catalog); raw `iconPath` wins. */
  icon?: string;
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
  /** Dev-only layout contract: assert every feed row rendered the same size. */
  debugLayout?: boolean;
};

// Alpine-pack citizen: card/text colors come from the shared alpine theme (light by
// default; the FFmpeg hero passes preset:"dark"). Only DATA-SEMANTIC colors are local:
// GLYPH_COLOR (dark glyph on the colored chips) + the signal/kind/reviewer maps.
const GLYPH_COLOR: MosaicColor = "#0d1117";
const DEFAULT_PRESET: AlpinePreset = "light";

const SIGNAL_COLOR: Record<Signal, MosaicColor> = { win: "#3fb950", warn: "#e3b341", neutral: "#6e7681" };

/**
 * Named kind-chip MARK vocabulary (24×24 paths, simple geometry). The
 * `kindGlyphs` override map accepts either a mark NAME from this catalog or a
 * raw SVG path (values starting with "M") — the friendly half lives in the
 * VALUE domain, so `{"security": "shield"}` is human-typable while the prop
 * stays one code-friendly map. Exported for tests.
 */
export const KIND_MARKS: Record<string, string> = {
  add: "M12.9 4.5a.9.9 0 0 0-1.8 0v6.6H4.5a.9.9 0 0 0 0 1.8h6.6v6.6a.9.9 0 0 0 1.8 0v-6.6h6.6a.9.9 0 0 0 0-1.8h-6.6V4.5Z",
  dash: "M4.5 10.5h15a1.5 1.5 0 0 1 0 3h-15a1.5 1.5 0 0 1 0-3Z",
  up: "M12 3.5 19.5 12H15v8.5H9V12H4.5L12 3.5Z",
  lines: "M5 5.4h14v2.4H5zM5 10.8h14v2.4H5zM5 16.2h9v2.4H5z",
  check: "M19.8 6.9a1 1 0 0 1 .15 1.41l-8.8 11a1 1 0 0 1-1.5.07l-4.6-4.6a1 1 0 1 1 1.4-1.42l3.8 3.8 8.13-10.16a1 1 0 0 1 1.42-.1Z",
  dot: "M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z",
  shield: "M12 2 20 5v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5l8-3Z",
  back: "M15 5 7 12l8 7V5Z",
  diamond: "M12 3l7 9-7 9-7-9 7-9Z",
  box: "M4 8l8-4 8 4v8l-8 4-8-4V8Z",
  blocks: "M5 5h6v6H5zM13 13h6v6h-6z",
};

/** Built-in kind styling — colors + marks for the COMMON kinds, so most feeds
 *  never need the override maps (custom kinds fall back to muted + no glyph). */
const KIND_COLORS: Record<string, MosaicColor> = {
  feat: "#3fb950", fix: "#388bfd", perf: "#a371f7", docs: "#e3b341", test: "#2ea043", chore: "#8b949e",
  refactor: "#39c5cf", revert: "#f85149", security: "#f0883e", ci: "#db61a2", deps: "#58a6ff",
};
const KIND_GLYPHS: Record<string, string> = {
  feat: KIND_MARKS.add, fix: KIND_MARKS.dash, perf: KIND_MARKS.up, docs: KIND_MARKS.lines,
  test: KIND_MARKS.check, chore: KIND_MARKS.dot,
  refactor: KIND_MARKS.blocks, revert: KIND_MARKS.back, security: KIND_MARKS.shield,
  ci: KIND_MARKS.diamond, deps: KIND_MARKS.box,
};

/** kindGlyphs override values: a KIND_MARKS name, or a raw path ("M…"). */
function resolveKindMark(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("M")) return value;
  const mark = KIND_MARKS[value];
  if (!mark) {
    throw new Error(`@m0saic/alpine/commit-feed/v2: unknown kind mark "${value}" — a KIND_MARKS name (${Object.keys(KIND_MARKS).join(", ")}) or a raw 24x24 SVG path.`);
  }
  return mark;
}
const REVIEWER_HUES: MosaicColor[] = ["#3fb950", "#388bfd", "#a371f7", "#db61a2", "#e3b341"];

const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, reduceMotion: false };
const MAX_ROWS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blend(a: string, b: string, t: number): MosaicColor {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const mix = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return ("#" + [mix(16), mix(8), mix(0)].map((x) => x.toString(16).padStart(2, "0")).join("")) as MosaicColor;
}
const fmtPr = (pr?: number | string) => (pr == null || pr === "" ? "" : `#${pr}`);

const propsSchema = definePropsSchema<CommitFeedProps>({
  rows: { type: "array" as any, required: true, description: "Feed rows. Each: title (+ optional kind, author, date, pr, reviewers, area, signal).", meta: { control: { flavor: "jsonModal" }, ui: { label: "Rows", order: 1 } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., NOTABLE COMMITS" }, ui: { label: "Title", order: 2 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant (light default; dark = the FFmpeg hero look).", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 4 } } },
  showHeader: { type: "boolean", required: false, description: "Show the icon + title + subtitle band (default true). False when a parent chrome supplies the title.", meta: { ui: { label: "Show header", order: 5 } } },
  accent: { type: "string", required: false, description: "Accent color (header chip). Defaults to the theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Accent", order: 6 } } },
  backgroundColor: { type: "string", required: false, description: "Card surface color. \"black@0\" → transparent (composed under a chrome).", meta: { constraints: { isColor: true }, control: { placeholder: "theme card", colorPicker: true, defaultColor: "#FFFFFF" }, ui: { label: "Card color", order: 7 } } },
  washColor: { type: "string", required: false, description: "Solid color the row tiles blend against (for transparent surfaces on a colored backdrop).", meta: { constraints: { isColor: true }, control: { placeholder: "card background", colorPicker: true, defaultColor: "#FFFFFF" }, ui: { label: "Wash base", order: 8 } } },

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

  icon: { type: "string", required: false, description: "Named header glyph (shared alpine catalog). A derived HUMAN view of the raw iconPath agent prop: picking a name WRITES the SVG path into iconPath (the stored, code-friendly value); a bespoke agent-written path shows as no selection.", meta: { constraints: { oneOf: ALPINE_GLYPH_NAMES }, ui: { label: "Icon", order: 14, consumer: "human" }, control: { syncsTo: [{ prop: "iconPath", map: { kind: "lookup", table: ALPINE_GLYPHS } }] } } },
  iconPath: { type: "string", required: false, description: "Header glyph SVG path d (24×24) — the raw value behind the friendly `icon` knob, and the override that wins.", meta: { ui: { label: "Icon path (SVG d)", order: 15, consumer: "agent" } } },
  kindColors: { type: "group" as any, required: false, description: "kind → chip color override (open-keyed map). Built-ins already cover feat, fix, perf, docs, test, chore, refactor, revert, security, ci, deps — this map restyles them or colors CUSTOM kinds.", meta: { ui: { label: "Kind colors", order: 16, collapsedByDefault: true, consumer: "agent" } } },
  kindGlyphs: { type: "group" as any, required: false, description: "kind → chip glyph override (open-keyed map). Values are a mark NAME (add, dash, up, lines, check, dot, shield, back, diamond, box, blocks) or a raw 24x24 SVG path starting with \"M\" — e.g. {\"hotfix\": \"shield\"}.", meta: { ui: { label: "Kind glyphs", order: 17, collapsedByDefault: true, consumer: "agent" } } },
  // ── Debug — hidden by default; the sandbox / matrix / Make iteration flip it true. ──
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract view: renders the contract wireframe instead of the feed — rows GREEN with the measured rule when every row is the same size, offenders RED when not. Deterministic default false; production never sets it.", meta: { ui: { label: "Debug layout", order: 18, collapsedByDefault: true } } },
});

export const AlpineCommitFeedV2: MosaicTemplate<CommitFeedProps> = {
  id: asTemplateId("@m0saic/alpine/commit-feed/v2"),
  label: "Alpine Commit Feed",
  version: 2,
  description: "Alpine commit feed — friendly mobile-marketing card: a scannable list of notable commits (kind icon + title + PR, area chip + author + reviewers + date) with a signal status bar (green win / amber warn / neutral). Alpine-light by default; the FFmpeg Weekly Pulse uses preset:\"dark\". v2 rebuilds the geometry as a RATIO layout (nested row/col splits with proportional weights) so it composes at any canvas without the absolute-placement precision blowup.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "commit-feed", "feed", "list", "animated", "developers", "analysts", "git", "changelog"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 720, fps: 30, durationMs: 3000 }, // 720 not 708: a 5-smooth hinted canvas (latticeSmooth)
  propsSchema,

  defaultProps: {
    showHeader: true,
    preset: "light",
    debugLayout: false,
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
    // Default header glyph — stored as the CANONICAL raw (the Icon dropdown
    // shows "commits" via the lookup sync's inverse map).
    iconPath: ALPINE_GLYPHS.commits,
    anim: DEFAULT_ANIM,
  },

  async render(props: CommitFeedProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    // Keep each drawn row's ORIGINAL index into props.rows: the leaf bindings
    // (Make's double-click edit of rows[i].title etc.) must address the prop
    // value, not the filtered / truncated draw order.
    const rowEntries = (props.rows ?? [])
      .map((r, srcIndex) => ({ r, srcIndex }))
      .filter(({ r }) => r && typeof r.title === "string")
      .slice(0, MAX_ROWS);
    const rows = rowEntries.map((e) => e.r);
    if (!rows.length) return makeErrorMosaic("commit-feed needs rows[]", { title: `${this.id} props`, width: W, height: H });

    // Alpine theming: light by default; the FFmpeg hero passes preset:"dark". A producer
    // can override via props.theme; explicit color props still win.
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
    const narrow = W < 820; // portrait / small → drop the reviewer discs + PR to avoid cramming
    const N = rows.length;

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 3000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelay = Math.min(0.15, introT * 0.1);
    const CASCADE = 0.5;
    const rowDur = Math.max(0.05, (introT - introDelay) / (1 + CASCADE * Math.max(0, N - 1)));
    const rowStagger = CASCADE * rowDur;

    // Pixel geometry — used ONLY to derive proportional split weights (so the m0 is
    // resolution-invariant within an aspect: at 2× resolution every px doubles and the
    // ratios are identical). Fonts are sized to H (the ratio-template convention).
    const pad = Math.round(Math.min(W, H) * 0.04);
    const innerW = Math.max(1, W - 2 * pad), innerH = Math.max(1, H - 2 * pad);
    const headerH = showHeader ? Math.round(innerH * 0.16) : 0;
    const headerGap = showHeader ? Math.round(innerH * 0.04) : 0;
    const rowsH = Math.max(1, innerH - headerH - headerGap);
    const gap = Math.max(6, Math.round(rowsH * 0.025));
    // Row PITCH (band incl. its half-gaps) from the EQUAL band split below —
    // the row box itself is pitch minus the gap carved inside the band.
    const pitch = Math.max(1, Math.floor(rowsH / N));
    const rowH = Math.max(1, pitch - gap);

    // Weight helpers: proportions of a reference px extent (basis ~100). `split()`
    // caps the basis at 120, so these stay low-precision regardless of canvas.
    const wOf = (px: number, ref: number) => Math.max(1, Math.round((px / ref) * 100));
    // What the engine will ACTUALLY hand each band, in px: the kit rewrites
    // weights onto the 5-smooth lattice (latticeWeights) and the parser hands
    // the remainder out outside-in (quantizedSections) — an edge section can be
    // several px wider than its ideal fraction. Intents that must register
    // with a cell (the header chip's insets) derive from these, not from the
    // fraction, so the painted chip stays square at every canvas.
    const sectionsPx = (totalPx: number, weights: number[]): number[] => quantizedSections(totalPx, latticeWeights(weights));
    const innerWpx = sectionsPx(W, [pad, innerW, pad])[1];
    const innerHpx = sectionsPx(H, [pad, innerH, pad])[1];
    const bodyWeights = showHeader ? [wOf(headerH, innerH), wOf(headerGap, innerH)] : [];
    const bodyRowsWeight = Math.max(1, 100 - bodyWeights.reduce((a, b) => a + b, 0));

    const roundTile = (color: MosaicColor, radius: number): MosaicSource =>
      makeColorTile(color, { effects: { rounding: { cornerStyle: "rounded", borderRadius: radius } } }) as MosaicSource;
    const glyphTile = (path: string): MosaicSource =>
      makeColorTile(GLYPH_COLOR, { mask: { kind: "inline-mask", localPath: path, bounds: { x: 0, y: 0, width: 24, height: 24 } } }) as MosaicSource;

    // Reveal a whole node's leaves at `startSec` (premium fades / light enable-gates /
    // reduceMotion static). Matches v1's per-piece cascade, applied per sub-tree.
    const reveal = (node: Node, startSec: number): Node =>
      !animate ? node : light ? revealGateNode(node, startSec) : revealFadeNode(node, startSec, rowDur);

    // Fonts (sized to H — the ratio convention; replaces v1's box-width capFont)
    // …then WIDTH-CAPPED to their slots: H-derived fonts cram narrow canvases
    // and long strings (clipped titles at 720×1280, PR-over-title at 1001×733;
    // textCell is plain text, not fit:contain). Each cap binds only when the
    // longest string would overflow its slot — defaults render byte-identical.
    const capW = (px: number, longest: number, slotPx: number, min: number) =>
      Math.max(min, Math.min(px, Math.floor(slotPx / (Math.max(1, longest) * 0.62))));
    const textWpx = Math.max(1, innerW - Math.round(rowH * 0.16) * 2 - Math.max(4, Math.round(rowH * 0.06)) - Math.round(rowH * 0.18) - Math.round(rowH * 0.5) - Math.round(rowH * 0.2));
    const longestTitle = Math.max(1, ...rows.map((r) => textEmUnits(r.title)));
    const anyPr = !narrow && rows.some((r) => !!fmtPr(r.pr));
    const longestPr = Math.max(1, ...rows.map((r) => textEmUnits(fmtPr(r.pr))));
    const longestAuthor = Math.max(1, ...rows.map((r) => textEmUnits(r.author ?? "")));
    const longestDate = Math.max(1, ...rows.map((r) => textEmUnits(r.date ?? "")));
    const longestArea = Math.max(1, ...rows.map((r) => textEmUnits(r.area ?? "")));
    // ×0.95: realized cells run a few % under the weight model (split
    // quantization) — exact-slot caps left 43-char titles 4-16px over at
    // square-ish canvases (text-fit tripwire catch). Floor-bound titles
    // (12px can't shrink further) ELLIPSIZE: truncated text must FIT.
    const titleSlot = textWpx * (anyPr ? 0.84 : 1) * 0.95;
    const titleFont = capW(Math.max(12, Math.round(rowH * 0.30)), longestTitle, titleSlot, 12);
    const maxTitleUnits = Math.max(4, titleSlot / (titleFont * 0.62));
    const fitTitle = (t: string): string => fitEmUnits(t, maxTitleUnits);
    let metaFont = Math.max(9, Math.round(rowH * 0.20));
    metaFont = capW(metaFont, longestAuthor, textWpx * 0.28, 9);
    metaFont = capW(metaFont, longestDate, textWpx * (narrow ? 0.26 : 0.15), 9);
    if (anyPr) metaFont = capW(metaFont, longestPr, textWpx * 0.16, 9);
    const chipFont = capW(Math.max(8, Math.round(rowH * 0.18)), longestArea, textWpx * 0.22 * 0.84, 8);
    // Floor-bound meta text (9px can't shrink) ellipsizes to its slot.
    // ×0.88: the realized line-2 bands run up to ~12% under their weight
    // model at tiny canvases (19-char authors 4px over at 360×640).
    const fitToSlot = (t: string, slotPx: number): string =>
      fitEmUnits(t, Math.max(2, (slotPx * 0.88) / (metaFont * 0.62)));
    const fitPr = (t: string): string => fitToSlot(t, textWpx * 0.16);

    // ── One row: [bar · icon · text column] over a soft row wash ──
    const rowNode = (i: number): Node => {
      const r = rows[i];
      const ri = rowEntries[i].srcIndex;
      // Leaf binding into the `rows` prop for the rect that shows a field.
      const bindRow = <T extends MosaicSource>(src: T, field: string, kind: "string" | "number", ...rest: Array<string | number>): T =>
        bindPropPath(src, "rows", [ri, field, ...rest], kind);
      const sig = SIGNAL_COLOR[(r.signal ?? "neutral") as Signal] ?? SIGNAL_COLOR.neutral;
      const kColor = (r.kind && kindColors[r.kind]) || LABEL_COLOR;
      const kGlyph = r.kind ? resolveKindMark(kindGlyphs[r.kind]) : undefined;

      // Column pixel widths (→ proportional weights of innerW).
      const cpad = Math.round(rowH * 0.16);
      const barW = Math.max(4, Math.round(rowH * 0.06));
      const iconSide = Math.round(rowH * 0.5);
      const g1 = Math.round(rowH * 0.18), g2 = Math.round(rowH * 0.2);
      const textW = Math.max(1, innerW - cpad * 2 - barW - g1 - iconSide - g2);

      // Status bar — a thin vertical rule inset to ~60% of the row height.
      const barCell = rowSplit([
        { weight: 2, node: EMPTY },
        { weight: 6, node: paint(roundTile(sig, 0.5)) },
        { weight: 2, node: EMPTY },
      ]);
      // Kind icon — a rounded square (vertically centered) with the glyph inset.
      // Placement insets (fiber), NOT insetNode: the 100-grain [22,56,22] split
      // emitted 50 unit cells inside a chip that bottoms out ~24px at small
      // canvases — infeasible (SPLIT_EXCEEDS_AXIS killed the doc at 640×360).
      const iconInner = kGlyph
        ? overlay([
            paint(roundTile(kColor, 0.28)),
            paint({ ...glyphTile(kGlyph), placement: { inset: { x: 0.22, y: 0.22 } } } as MosaicSource),
          ])
        : paint(roundTile(kColor, 0.28));
      const iconCell = rowSplit([
        { weight: 1, node: EMPTY },
        { weight: 2, node: iconInner },
        { weight: 1, node: EMPTY },
      ]);

      // ── Text column: line1 (title + #PR) over line2 (area · author · reviewers · date) ──
      const showPr = !narrow && !!fmtPr(r.pr);
      const line1: Node = colSplit([
        { weight: showPr ? 84 : 100, node: paint(bindRow(tag(textCell(fitTitle(r.title), titleFont, TITLE_COLOR, "left"), "row-title"), "title", "string")) },
        ...(showPr ? [{ weight: 16, node: paint(bindRow(tag(textCell(fitPr(fmtPr(r.pr)), metaFont, LABEL_COLOR, "right"), "row-pr"), "pr", "number")) }] : []),
      ]);

      const areaChip: Node = r.area
        ? overlay([
            paint(roundTile(blend(washBase, kColor, 0.24), 0.34)),
            paint(bindRow(tag(textCell(r.area, chipFont, TITLE_COLOR, "center", "middle", { left: 0.08, right: 0.08 }), "chip-text"), "area", "string")),
          ])
        : EMPTY;
      // Reviewer discs — up to 2 initials (wide only). Each disc is sized SQUARE:
      // its column width weight is derived from the disc height (≈ line2 height) as a
      // proportion of the text-column width, so it reads as a circle, not a wide bar.
      const reviewers = !narrow ? (r.reviewers ?? []).slice(0, 2) : [];
      const discHpx = Math.round(rowH * 0.24);
      const dw = Math.max(2, Math.round((discHpx / textW) * 100)); // square disc width weight
      const discGap = Math.max(1, Math.round(dw * 0.4));
      const discsNode: Node = reviewers.length
        ? colSplit(
            reviewers.flatMap((nm, k): Band[] => {
              const init = (nm.trim()[0] ?? "?").toUpperCase();
              const disc = overlay([
                paint(roundTile(REVIEWER_HUES[k % REVIEWER_HUES.length], 0.5)),
                // The disc shows an initial; the leaf it edits is the reviewer's full name.
                paint(bindRow(textCell(init, Math.max(8, Math.round(rowH * 0.16)), GLYPH_COLOR, "center"), "reviewers", "string", k)),
              ]);
              // Vertically center the square disc within the (taller) line-2 band.
              const discCell = rowSplit([{ weight: 1, node: EMPTY }, { weight: 3, node: disc }, { weight: 1, node: EMPTY }]);
              return k > 0 ? [{ weight: discGap, node: EMPTY }, { weight: dw, node: discCell }] : [{ weight: dw, node: discCell }];
            }),
          )
        : EMPTY;

      // line2 columns: [areaChip? · author · reviewers? · date] — proportional weights.
      const areaW = r.area ? Math.min(22, Math.max(10, Math.round(r.area.length * 2.4) + 6)) : 0;
      const dateW = narrow ? 26 : 15;
      const revW = reviewers.length ? (narrow ? 0 : reviewers.length * dw + (reviewers.length - 1) * discGap + 3) : 0;
      const authorW = Math.max(8, 100 - areaW - (areaW ? 2 : 0) - revW - dateW - 2);
      const line2Bands: Band[] = [];
      if (r.area) { line2Bands.push({ weight: areaW, node: areaChip }); line2Bands.push({ weight: 2, node: EMPTY }); }
      line2Bands.push({ weight: authorW, node: paint(bindRow(tag(textCell(fitToSlot(r.author ?? "", textWpx * (authorW / 100)), metaFont, META_COLOR, "left"), "row-author"), "author", "string")) });
      if (revW) line2Bands.push({ weight: revW, node: discsNode });
      line2Bands.push({ weight: dateW, node: paint(bindRow(tag(textCell(r.date ?? "", metaFont, LABEL_COLOR, "right"), "row-date"), "date", "string")) });
      const line2 = colSplit(line2Bands);

      const textCol = rowSplit([
        { weight: 8, node: EMPTY },
        { weight: 40, node: line1 },
        { weight: 6, node: EMPTY },
        { weight: 30, node: line2 },
        { weight: 8, node: EMPTY },
      ]);

      const content = colSplit([
        { weight: wOf(cpad, innerW), node: EMPTY },
        { weight: wOf(barW, innerW), node: barCell },
        { weight: wOf(g1, innerW), node: EMPTY },
        { weight: wOf(iconSide, innerW), node: iconCell },
        { weight: wOf(g2, innerW), node: EMPTY },
        { weight: wOf(textW, innerW), node: textCol },
        { weight: wOf(cpad, innerW), node: EMPTY },
      ]);

      const washTile = roundTile(blend(washBase, ROW_BG, 0.5), 0.12);
      // "row" tag = the layout contract's join key (equal-size relation).
      (washTile as MosaicSource & { editor?: { label?: string } }).editor = { label: "row" };
      // The wash is `washColor` blended toward the row tint → the one prop that controls
      // it; every row wash binds it (1:N). Kind chips (kindColors map) / signal bars (enum)
      // / reviewer discs (fixed hues) never bind.
      const rowBg = paint(bindProp(washTile, "washColor"));
      return overlay([rowBg, content]);
    };

    // ── Rows stack: one EQUAL band per row (quantization-exact — handbook §3:
    // interleaved [row, gap] weights let the engine's outside-in remainder
    // starve the CENTER row under ancestor drift; measured 96/94/90/93/96 at
    // 1001×733 before this). The half-gap is carved INSIDE each band by a
    // tiny [1, K, 1] split, so row height can never drift by more than ~1px. ──
    const halfGapU = 1;
    const rowU = Math.max(2, Math.round((2 * rowH) / Math.max(1, gap)));
    const rowBands: Band[] = [];
    for (let i = 0; i < N; i++) {
      const startSec = introDelay + i * rowStagger;
      const banded = rowSplit([
        { weight: halfGapU, node: EMPTY },
        { weight: rowU, node: reveal(rowNode(i), startSec) },
        { weight: halfGapU, node: EMPTY },
      ]);
      rowBands.push({ weight: 1, node: banded });
    }
    const rowsNode = rowSplit(rowBands);

    // ── Header: accent icon tile + title / subtitle ──
    let headerNode: Node = EMPTY;
    if (showHeader) {
      const titleText = props.title ?? "NOTABLE COMMITS";
      const subText = props.subtitle ?? "Highlight interesting work.";
      // Friendly `icon` name → shared catalog path; raw `iconPath` wins.
      const headerGlyphPath = resolveAlpineGlyph(props.icon, props.iconPath, "@m0saic/alpine/commit-feed/v2");
      // Icon chip: an intended SQUARE (side 0.6·headerH) carved from its cell by
      // placement insets (fiber — quantization-immune). The old [2,6,2] shave
      // squared only the HEIGHT, so the chip painted cell-wide (~1.6:1) and
      // stretched the glyph. Intents use the QUANTIZED ratio yields (what the
      // emitted weights actually produce), so the painted aspect stays ~1 at any
      // canvas; the `header-icon` aspect constraint below ENFORCES it.
      const headerColWeights = [wOf(headerH, innerW), wOf(Math.round(headerH * 0.22), innerW)];
      headerColWeights.push(Math.max(1, 100 - headerColWeights[0] - headerColWeights[1]));
      const colWInt = sectionsPx(innerWpx, headerColWeights)[0];
      const bandHInt = sectionsPx(innerHpx, [...bodyWeights, bodyRowsWeight])[0];
      const chipS = 0.6 * Math.min(colWInt, bandHInt);
      const chipX = (colWInt - chipS) / (2 * colWInt);
      const chipY = (bandHInt - chipS) / (2 * bandHInt);
      const glyphX = chipX + (1 - 2 * chipX) * 0.22;
      const glyphY = chipY + (1 - 2 * chipY) * 0.22;
      const chipTile = makeColorTile(accent, {
        effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.28 } },
        placement: { inset: { x: chipX, y: chipY } },
      }) as MosaicSource;
      (chipTile as MosaicSource & { editor?: { label?: string } }).editor = { label: "header-icon" };
      // The chip's fill IS `accent` → Make's color picker (the glyph over it is a fixed ink).
      bindProp(chipTile, "accent");
      const hGlyphTile = headerGlyphPath
        ? ({ ...glyphTile(headerGlyphPath), placement: { inset: { x: glyphX, y: glyphY } } } as MosaicSource)
        : null;
      const hIconCell = hGlyphTile ? overlay([paint(chipTile), paint(hGlyphTile)]) : paint(chipTile);
      // Width-capped like the row fonts — long titles shrink, never clip.
      // 1.16× the length ≈ a 0.72em char width: the title renders ALL-CAPS,
      // which runs wider than the 0.62em body factor (clipped at 720×1280).
      // Slot = the ACTUAL header text stack (innerW minus the square icon
      // column + its gap), not a flat 0.66·innerW — the flat model overshot
      // ~15% at portrait canvases where the icon eats a big share of a
      // narrow width (27-char subtitle 42px over at 480×1040).
      const headerStackW = Math.max(1, innerW - Math.round(headerH * 1.22));
      const hTitleFont = capW(Math.max(14, Math.round(headerH * 0.4)), Math.ceil(textEmUnits(titleText) * 1.16), headerStackW * 0.95, 14);
      const hSubFont = capW(Math.max(10, Math.round(headerH * 0.2)), textEmUnits(subText), headerStackW * 0.95, 10);
      // Self-drawn header (no alpineCard): bind title / subtitle here for Make's
      // double-click edit — unconditionally, so the fallback copy can be replaced.
      const headerText = rowSplit([
        { weight: 58, node: paint(bindProp(tag(textCell(titleText, hTitleFont, TITLE_COLOR, "left"), "feed-title"), "title")) },
        { weight: 42, node: paint(bindProp(tag(textCell(subText, hSubFont, LABEL_COLOR, "left"), "feed-subtitle"), "subtitle")) },
      ]);
      headerNode = reveal(
        colSplit([
          { weight: headerColWeights[0], node: hIconCell },
          { weight: headerColWeights[1], node: EMPTY },
          { weight: headerColWeights[2], node: headerText },
        ]),
        introDelay,
      );
    }

    // ── Card body: [header · gap · rows] inside the padded card ──
    const bodyBands: Band[] = [];
    if (showHeader) {
      bodyBands.push({ weight: wOf(headerH, innerH), node: headerNode });
      bodyBands.push({ weight: wOf(headerGap, innerH), node: EMPTY });
    }
    // The rows band absorbs the percent rounding so the body sums to EXACTLY
    // 100 (on the 5-smooth lattice; the same weights the chip intents used).
    bodyBands.push({ weight: bodyRowsWeight, node: rowsNode });
    const body = rowSplit(bodyBands);
    const insetBody = insetNode(body, pad, pad, pad, pad, W, H);

    // Surface: a rounded card tile when solid; skipped (transparent) when composed
    // under a chrome (backgroundColor "black@0"). The surface fades with the first row.
    const root = surfaceSolid
      ? overlay([reveal(paint(bindProp(roundTile(cardBg, 0.04), "backgroundColor")), 0), insetBody])
      : insetBody;

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      // Standalone (solid card) → the alpine canvas shows in the rounded-corner gaps;
      // composed under a chrome (transparent surface) → keep it transparent.
      backgroundColor: surfaceSolid ? theme.canvas : "black@0",
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
    } as MosaicDocument;

    // Dev tripwire: every feed row must render the SAME size. Falsy debugLayout
    // (default) returns the doc untouched at zero cost; the relation needs ≥2
    // rows to be meaningful.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/commit-feed/v2",
        // tolerancePx 1 = the equal split's quantization guarantee; 2% catches
        // real starvation where a fraction is meaningful.
        relations: N >= 2 ? [{ label: "row", equal: "size", tolerance: 0.02, tolerancePx: 1 }] : [],
        // The header icon chip must paint SQUARE (the 2026-08-20 squashed-glyph
        // find). The checker judges the PAINTED box (inset-recovered), so this
        // enforces the fiber-carved square, not the wide cell.
        constraints: [
          // 0.06, not 0.05: at 360×640 the chip realizes 63×60 (quantization) =
          // aspect 1.050, dead on the old boundary. The squash this guards is 2-3×.
          ...(showHeader ? [{ label: "header-icon", aspect: 1, aspectTolerance: 0.06 }] : []),
          // Text-fit tripwires at the template's own 0.62em capW model.
          ...(showHeader ? [
            { label: "feed-title", textFits: { charWidthEm: 0.62 } },
            { label: "feed-subtitle", textFits: { charWidthEm: 0.62 } },
          ] : []),
          // Row-level checks need N ≥ 2: the N=1 doc shape mis-recovers row
          // frames as px slivers (the frames↔sources measurement-channel
          // candidate, the internal contract-frame-zip-misalignment
          // notes) — 1-4px boxes for visually-correct cells.
          ...(N >= 2 ? [
            { label: "row-title", textFits: { charWidthEm: 0.62 } },
            { label: "row-author", textFits: { charWidthEm: 0.62 } },
            { label: "row-date", textFits: { charWidthEm: 0.62 } },
            ...(anyPr ? [{ label: "row-pr", textFits: { charWidthEm: 0.62 } }] : []),
            ...(rows.some((r) => !!r.area) ? [{ label: "chip-text", textFits: { charWidthEm: 0.62 } }] : []),
          ] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme (chat pane +
  // real-material hero). The hero is this template's OWN static default feed,
  // rendered at the hero box and INLINED flat (gate-15/21 keeper: never a
  // nested child composite).
  async renderCover(_props: CommitFeedProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const feed = (await AlpineCommitFeedV2.render(
      {
        ...(AlpineCommitFeedV2.defaultProps as CommitFeedProps),
        anim: { renderMode: "light", introFrac: 0.7, reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Commit Feed",
        title: "A commit feed.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(feed), theme.borderStrong),
      heroAssets: feed.assets,
    });
  },
};

registerTemplate(AlpineCommitFeedV2);
