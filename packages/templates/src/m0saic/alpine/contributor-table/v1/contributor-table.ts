import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/contributor-table/v1 — Hero Contributor Table (Alpine primitive)
 * ============================================================================
 *
 * A ranked, MULTI-COLUMN table: rank · avatar · name + N right-aligned value
 * columns, under an icon + title + subtitle header. The Alpine-pack sibling of
 * the leaderboard — alpine-light by default (the FFmpeg Weekly Pulse "Top
 * Contributors" beat passes preset:"dark"), and GENERIC — value columns are
 * arbitrary labels + per-row values, so it isn't tied to commits/additions/deletions.
 *
 * Built coarse + light (the primitive rule): proportional row/col splits (the
 * alpine-card kit caps split bases) + rounded `makeColorTile`s, NO pixel-exact
 * geometry — so the DSL stays small and renders crisp at any size. Top-N rows get
 * a soft accent wash; value columns count up; avatars are colored-initial discs
 * (real avatar_url media is a Phase-4 fetch). `anim.reduceMotion` → static.
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
  animateNumbersInText,
  fadeInExpr,
  withLayoutContract,
  textEmUnits,
  bindProp,
  bindPropPath,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { paint, EMPTY, rowSplit, colSplit, overlay, textCell, tag, fitEmUnits, type Node, type Band } from "../../_shared/alpine-card";
import { ALPINE_GLYPHS, ALPINE_GLYPH_NAMES, resolveAlpineGlyph } from "../../_shared/alpine-glyphs";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type ContribRow = { rank?: number; name: string; avatar?: string; values: Array<number | string> };
/** Reveal cost/quality dial. "premium" (default): rows cascade in via `overlay.alpha`
 *  (a geq per faded source). "light": the same cascade via free enable-gate pops —
 *  no geq, composable, cheap when nested. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; introFrac: number; countUp: boolean; easing: EaseName; reduceMotion: boolean };

type ContributorTableProps = {
  rows: ContribRow[];
  /** Value-column headers (index-aligned to each row's `values`). */
  columns: string[];
  title?: string;
  subtitle?: string;
  /** Alpine theme variant (light default; "dark" = the night look the FFmpeg hero uses). */
  preset?: AlpinePreset;
  /** Show the icon + title + subtitle band (default true). Set false when composing
   *  inside a chrome that already supplies the title — the table then fills with the
   *  column header + rows. */
  showHeader?: boolean;
  /** Optional header glyph: an SVG path `d` (24×24), drawn as a mask on the icon chip. */
  /** Friendly named header glyph (shared alpine catalog); a derived view of `iconPath`. */
  icon?: string;
  iconPath?: string;
  accent?: MosaicColor;
  backgroundColor?: MosaicColor;
  /** How many top rows get the accent wash (default 3). */
  topTint?: number;
  /** Solid color the row washes blend against (default = backgroundColor if solid,
   *  else the dark card). Set this when the surface is transparent ("black@0") but you
   *  want the bands tuned to a specific panel color (e.g. a lighter chrome backdrop). */
  washColor?: MosaicColor;
  /** Per-column value color (index-aligned to `columns`). Used by the PORTRAIT
   *  stacked-card layout to tint secondary metrics (e.g. additions green / deletions red). */
  columnColors?: Array<MosaicColor | undefined>;
  /** Per-column sign prefix (index-aligned to `columns`), e.g. "+" / "-". Portrait only. */
  columnSigns?: string[];
  anim?: AnimConfig;
  /** Opt-in producer theming. Uses the shared alpine theme by default (light); a
   *  producer's published tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert every row/card rendered the same size. */
  debugLayout?: boolean;
};

// Alpine-pack citizen: card/text colors come from the shared alpine theme (light by
// default; the FFmpeg hero passes preset:"dark"). Only DATA-SEMANTIC colors are local:
// ACCENT/NEG (the additions-green / deletions-red columnColors defaults) + GLYPH_COLOR
// (dark glyph/initial on the colored chips) — their meaning IS the color.
const ACCENT: MosaicColor = "#3fb950";
const NEG: MosaicColor = "#f85149";
const GLYPH_COLOR: MosaicColor = "#0d1117";
const DEFAULT_PRESET: AlpinePreset = "light";

const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: false };
const MAX_ROWS = 8;

// Column width weights (basis 100): pad · rank · contributor · N value cols · pad.
// The contributor column ABSORBS the rounding remainder so the row always sums to
// exactly 100 (= 2²·5², on the 5-smooth lattice). Rounding the value columns
// independently summed to 101 — a prime basis that composed with nothing.
const PAD_W = 3, RANK_W = 5, CONTRIB_W_NOMINAL = 42;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tcell(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign, vAlign: "middle" } as any }] };
}
/** Fixed-font cell (NO fit:contain) — sized by the caller to fit its width, so it
 *  can't trip the renderer's fit:contain height-scale-then-clip-width behavior. */
function fcell(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}
function exprCell(expr: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right"): MosaicTextSource {
  return { type: "text", renderMode: { kind: "video" }, visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}
function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}
function wrapFade(node: Node, startSec: number, durSec: number, on: boolean): Node {
  if (!on) return node;
  return { m0: node.m0, sources: node.sources.map((s) => ((s as { overlay?: { alpha?: string } }).overlay?.alpha ? s : fadeIn(s, startSec, durSec, true))) };
}
/** The geq-free analog of `wrapFade`: gate each source ON at `startSec` via a free
 *  `overlay.enable` (no per-pixel alpha fold). `renderMode:"light"` uses this so the
 *  row cascade pops instead of fades — composable/cheap when nested. Skips sources
 *  that already carry an enable gate. */
function wrapGate(node: Node, startSec: number, on: boolean): Node {
  if (!on) return node;
  return { m0: node.m0, sources: node.sources.map((s) => ((s as { overlay?: { enable?: string } }).overlay?.enable ? s : revealGate(s, startSec, true))) };
}
/** Mix two #rrggbb colors at ratio t (0→a, 1→b). Used to BAKE the row wash into a
 *  solid tile color so the tile fades in with its row (a static overlay.alpha would
 *  make wrapFade skip it → the band shows at t=0). */
function blend(a: string, b: string, t: number): MosaicColor {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const mix = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return ("#" + [mix(16), mix(8), mix(0)].map((x) => x.toString(16).padStart(2, "0")).join("")) as MosaicColor;
}
/** A circular disc (rounded tile, full radius) in an accent-derived hue + the
 *  name's initial (fixed font, centered) — the avatar fallback until real
 *  avatar_url media (Phase 4). Place it in a SQUARE cell so the disc is round. */
function avatarDisc(name: string, fill: MosaicColor, font: number, inset?: { x: number; y: number }): Node {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const letter: MosaicTextSource = { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: initial }, style: { fontSize: font, fontColor: "#0d1117" }, placement: { hAlign: "center", vAlign: "middle" } as any }] };
  const tile = makeColorTile(fill, {
    effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.5 } },
    ...(inset ? { placement: { inset } } : {}),
  }) as MosaicSource;
  // The disc is the future profile-picture slot (avatar_url, Phase 4) — the
  // layout contract's `avatar` aspect rule keeps it headshot-suitable.
  (tile as MosaicSource & { editor?: { label?: string } }).editor = { label: "avatar" };
  return overlay([
    paint(tile),
    paint(inset ? ({ ...letter, placement: { inset } } as unknown as MosaicTextSource) : letter),
  ]);
}
/** Center a node as a square-ish disc inside its (≈square) cell. */
function discInCell(disc: Node): Node {
  return rowSplit([{ weight: 2, node: EMPTY }, { weight: 7, node: colSplit([{ weight: 2, node: EMPTY }, { weight: 7, node: disc }, { weight: 2, node: EMPTY }]) }, { weight: 2, node: EMPTY }]);
}
// A small avatar-color cycle (hero greens + a few accents), keyed by row index.
const AVATAR_HUES: MosaicColor[] = ["#3fb950", "#2ea043", "#56d364", "#388bfd", "#a371f7", "#db61a2", "#e3b341", "#f0883e"];

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<ContributorTableProps>({
  // ── Required data. `rows` is a rich array (rank·name·avatar·values[]) → JSON modal;
  //    `columns` is a simple string list → pill editor. ──
  rows: { type: "array" as any, required: true, description: "Table rows. Each: name, optional rank + avatar, and values[] index-aligned to columns.", meta: { control: { flavor: "jsonModal" }, ui: { label: "Rows", order: 1 } } },
  columns: { type: "string[]", required: true, description: "Value-column headers (index-aligned to each row's values).", meta: { control: { placeholder: "Commits" }, ui: { label: "Columns", order: 2 } } },

  // ── Primary props — flat, like controls grouped together (text → toggles → number → colors). ──
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., TOP CONTRIBUTORS" }, ui: { label: "Title", order: 3 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { ui: { label: "Subtitle", order: 4 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant (light default; dark = the FFmpeg hero look).", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 5 } } },
  showHeader: { type: "boolean", required: false, description: "Show the icon + title + subtitle band (default true). False when a parent chrome supplies the title.", meta: { ui: { label: "Show header", order: 6 } } },
  topTint: { type: "number", required: false, description: "How many top rows get the accent wash (default 3).", meta: { constraints: { min: 0, max: 8 }, ui: { label: "Top tint rows", order: 7 } } },
  accent: { type: "string", required: false, description: "Accent color (icon chip + top-row wash). Defaults to the theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Accent", order: 8 } } },
  backgroundColor: { type: "string", required: false, description: "Card surface color. \"black@0\" → transparent (composed under a chrome).", meta: { constraints: { isColor: true }, control: { placeholder: "theme card", colorPicker: true, defaultColor: "#FFFFFF" }, ui: { label: "Card color", order: 9 } } },
  washColor: { type: "string", required: false, description: "Solid color the row washes blend against (for transparent surfaces composed on a colored backdrop).", meta: { constraints: { isColor: true }, control: { placeholder: "card background", colorPicker: true, defaultColor: "#FFFFFF" }, ui: { label: "Wash base", order: 10 } } },

  // ── Everything else grouped into collapsible sections. ──
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + row-cascade intro.",
    meta: { ui: { label: "Animation", order: 13, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): rows cascade in via alpha fade — a geq per faded source. \"light\": the same cascade via free enable-gate pops — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      countUp: fBool("Count up", "Count the value columns up during the intro."),
      easing: ALPINE_ANIM_FIELDS.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 14, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,

  // ── Agent props — opaque, no nice human control (a raw SVG path / index-aligned
  //    per-column arrays you'd hand-type): they live in the agent fold. ──
  icon: { type: "string", required: false, description: "Named header glyph (shared alpine catalog). A derived HUMAN view of the raw iconPath agent prop: picking a name WRITES the SVG path into iconPath (the stored, code-friendly value); a bespoke agent-written path shows as no selection.", meta: { constraints: { oneOf: ALPINE_GLYPH_NAMES }, ui: { label: "Icon", order: 11, consumer: "human" }, control: { syncsTo: [{ prop: "iconPath", map: { kind: "lookup", table: ALPINE_GLYPHS } }] } } },
  iconPath: { type: "string", required: false, description: "Header glyph SVG path d (24×24), drawn as a mask on the icon chip — the raw value behind the friendly `icon` knob.", meta: { ui: { label: "Icon path (SVG d)", order: 15, consumer: "agent" } } },
  columnColors: { type: "array" as any, required: false, description: "Per-column value color (index-aligned to columns). Portrait layout tints secondary metrics (e.g. additions green / deletions red).", meta: { ui: { label: "Column colors", order: 16, consumer: "agent" } } },
  columnSigns: { type: "string[]", required: false, description: "Per-column sign prefix (index-aligned to columns), e.g. + / -. Portrait only.", meta: { ui: { label: "Column signs", order: 17, consumer: "agent" } } },
  // ── Debug — hidden by default; the sandbox / matrix / Make iteration flip it true. ──
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract view: renders the contract wireframe instead of the table — rows GREEN with the measured rule when every row/card is the same size, offenders RED when not. Deterministic default false; production never sets it.", meta: { ui: { label: "Debug layout", order: 18, collapsedByDefault: true } } },
});

export const AlpineContributorTable: MosaicTemplate<ContributorTableProps> = {
  id: asTemplateId("@m0saic/alpine/contributor-table/v1"),
  label: "Alpine Contributor Table",
  version: 1,
  description: "Alpine contributor table — friendly mobile-marketing card: a ranked multi-column table (rank · avatar · name + arbitrary right-aligned value columns), icon + title header, top-N accent wash, count-up values. Alpine-light by default; the FFmpeg Weekly Pulse uses preset:\"dark\".",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "contributor-table", "ranking", "table", "animated", "developers", "analysts", "team", "open-source"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 720, fps: 30, durationMs: 3000 }, // 720 not 708: a 5-smooth hinted canvas (latticeSmooth)
  propsSchema,

  defaultProps: {
    showHeader: true,
    preset: "light",
    debugLayout: false,
    theme: { forceFetch: false },
    rows: [
      { rank: 1, name: "Anton Khirnov", values: [23, 4512, 2103] },
      { rank: 2, name: "Michael Niedermayer", values: [18, 3204, 1034] },
      { rank: 3, name: "James Almer", values: [14, 2193, 812] },
      { rank: 4, name: "Marton Balint", values: [11, 1842, 1201] },
      { rank: 5, name: "Limin Wang", values: [9, 1503, 623] },
    ],
    columns: ["Commits", "Additions", "Deletions"],
    title: "TOP CONTRIBUTORS",
    subtitle: "This week",
    topTint: 3,
    columnColors: [undefined, ACCENT, NEG],
    columnSigns: ["", "+", "-"],
    // Default header glyph — stored as the CANONICAL raw (the Icon dropdown
    // shows "contributors" via the lookup sync's inverse map).
    iconPath: ALPINE_GLYPHS.contributors,
    anim: DEFAULT_ANIM,
  },

  async render(props: ContributorTableProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    // Keep each drawn row's ORIGINAL index into props.rows: the leaf bindings
    // (Make's double-click edit of rows[i].name / rank / values[c]) must address
    // the prop value, not the filtered / truncated draw order.
    const rowEntries = (props.rows ?? [])
      .map((r, srcIndex) => ({ r, srcIndex }))
      .filter(({ r }) => r && typeof r.name === "string")
      .slice(0, MAX_ROWS);
    const rows = rowEntries.map((e) => e.r);
    const columns = props.columns ?? [];
    if (!rows.length || !columns.length) {
      return makeErrorMosaic("contributor-table needs rows[] + columns[]", { title: `${this.id} props`, width: W, height: H });
    }
    // Alpine theming: light by default; the FFmpeg hero passes preset:"dark". A producer
    // can override via props.theme; explicit color props still win. The palette names
    // below shadow the (removed) module constants, so every body reference stays unchanged.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const CARD_BG = theme.card, ROW_BG = theme.grid, TITLE_COLOR = theme.title,
      LABEL_COLOR = theme.muted, VALUE_COLOR = theme.label;
    const accent = props.accent ?? theme.primary;
    const cardBg = props.backgroundColor ?? CARD_BG;
    // Row washes blend against a SOLID base even when the surface is transparent
    // ("black@0", set when composing under a chrome that draws the backdrop) — so the
    // banded rows stay visible without a self-drawn card panel.
    const surfaceSolid = typeof cardBg === "string" && cardBg.startsWith("#");
    const washBase: MosaicColor = props.washColor ?? (surfaceSolid ? cardBg : CARD_BG);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    // Mode-aware reveal: premium fades (geq per source), light enable-gates (no geq);
    // reduceMotion → static. Premium is byte-identical to the pre-audit `wrapFade`.
    const wrapReveal = (node: Node, startSec: number, durSec: number): Node =>
      !animate ? node : light ? wrapGate(node, startSec, true) : wrapFade(node, startSec, durSec, true);
    const topTint = props.topTint ?? 3;
    const showHeader = props.showHeader ?? true;
    const N = rows.length, C = columns.length;

    // Fonts off canvas height. Title/column-header get the portrait treatment —
    // width-capped to their slots so long strings SHRINK instead of overflowing
    // the canvas / colliding (tcell is plain text, not fit:contain).
    const titleLen = Math.max(1, textEmUnits(props.title ?? "TOP CONTRIBUTORS"));
    const titleFont = Math.max(18, Math.min(Math.round(H * 0.05), Math.floor((W * 0.68) / (titleLen * 0.62))));
    // Width-capped like the title (same 0.68 header slot): a 69-char stress
    // subtitle @19px overran the band by ~12px (text-fit tripwire catch).
    const subLen = Math.max(1, textEmUnits(props.subtitle ?? "This week"));
    const subFont = Math.max(11, Math.min(Math.round(H * 0.026), Math.floor((W * 0.68) / (subLen * 0.62))));
    const valWPct = Math.max(8, Math.floor((100 - PAD_W * 2 - RANK_W - CONTRIB_W_NOMINAL) / C));
    // Contributor column = whatever the value columns leave of the 100 (42..47 for
    // C ≤ 5; narrower once eight-unit value columns need the room).
    const CONTRIB_W = 100 - PAD_W * 2 - RANK_W - valWPct * C;
    const colLongest = Math.max(1, ...columns.map((c) => String(c).length), "Contributor".length);
    const colFont = Math.max(10, Math.min(Math.round(H * 0.024), Math.floor((W * (valWPct / 100) * 0.92) / (colLongest * 0.62))));
    const nameFont = Math.max(12, Math.round(H * 0.032));
    const valueFont = Math.max(12, Math.round(H * 0.034));
    const rankFont = Math.max(11, Math.round(H * 0.03));
    const avatarFont = Math.max(14, Math.round(H * 0.042));

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 3000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelay = Math.min(0.15, introT * 0.1);
    const CASCADE = 0.5;
    const rowDur = Math.max(0.05, (introT - introDelay) / (1 + CASCADE * Math.max(0, N - 1)));
    const rowStagger = CASCADE * rowDur;

    const fmt = (raw: number | string): string => (typeof raw === "number" ? Math.round(raw).toLocaleString("en-US") : String(raw ?? ""));
    // Leaf binding into the `rows` prop for the rect that shows a field, at the
    // row's ORIGINAL index. `values[c]` binds as "number" — the type the default
    // data uses (Make seeds from the raw leaf, not the formatted / signed text).
    const bindRow = <T extends MosaicSource>(src: T, i: number, field: string, kind: "string" | "number", ...rest: Array<string | number>): T =>
      bindPropPath(src, "rows", [rowEntries[i].srcIndex, field, ...rest], kind);
    // Header glyph chip (font-independent) — shared by both layouts. The chip
    // tile is tagged for the layout contract's aspect rule (must paint square).
    const chipTile = (): MosaicSource => {
      const t = makeColorTile(accent, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.28 } } }) as MosaicSource;
      (t as MosaicSource & { editor?: { label?: string } }).editor = { label: "header-icon" };
      // The chip's fill IS `accent` → Make's color picker (the glyph over it is a fixed ink).
      return bindProp(t, "accent");
    };
    // Friendly `icon` name → shared catalog path; raw `iconPath` wins.
    const headerGlyphPath = resolveAlpineGlyph(props.icon, props.iconPath, "@m0saic/alpine/contributor-table/v1");
    const iconChip: Node = headerGlyphPath
      ? overlay([
          paint(chipTile()),
          // 22% pad on every side (commit-feed's chip ratio) — the glyph must not touch the chip edge.
          paint(makeColorTile(GLYPH_COLOR, {
            mask: { kind: "inline-mask", localPath: headerGlyphPath, bounds: { x: 0, y: 0, width: 24, height: 24 } },
            placement: { inset: { x: 0.22, y: 0.22 } },
          }) as MosaicSource),
        ])
      : paint(chipTile());

    let root: Node;
    const portrait = H > W * 1.15;
    if (portrait) {
      // ════ PORTRAIT — hero-metric stacked cards (mobile-leaderboard pattern) ════
      // Each contributor = a card: rank · square avatar · name + the ranked metric
      // (column 0) BIG on the right; secondary columns as a colored diff line below.
      // Fonts sized off WIDTH (the constraining axis) + width-capped (fixed font).
      const padP = Math.round(Math.min(W, H) * 0.045);
      const innerW = Math.max(1, W - 2 * padP);
      const innerH = Math.max(1, H - 2 * padP);
      const headerH = showHeader ? Math.round(innerH * 0.13) : 0;
      const headerGap = showHeader ? Math.round(innerH * 0.025) : 0;
      const rowsH = Math.max(1, innerH - headerH - headerGap);
      const gapP = Math.max(8, Math.round(rowsH * 0.02));
      // Card PITCH (band incl. its half-gaps) from the EQUAL band split below —
      // the card box itself is pitch minus the gap carved inside the band.
      const pitchP = Math.max(1, Math.floor(rowsH / N));
      const cardH = Math.max(1, pitchP - gapP);

      const cardPadX = Math.round(innerW * 0.045);
      const cardPadY = Math.round(cardH * 0.07);
      const contentW = Math.max(1, innerW - 2 * cardPadX);
      const contentH = Math.max(1, cardH - 2 * cardPadY);
      const topLineH = Math.round(contentH * 0.56);
      const botLineH = Math.max(1, contentH - topLineH);

      // Top-line column pixels — they SUM to contentW, so the avatar cell is exactly
      // topLineH wide (and topLineH tall) → a true square → a round disc.
      const rankColPx = Math.round(contentW * 0.09);
      const avatarColPx = topLineH;
      const gap1Px = Math.round(contentW * 0.02);
      const heroColPx = Math.round(contentW * 0.22);
      const nameColPx = Math.max(40, contentW - rankColPx - avatarColPx - gap1Px - heroColPx);
      const indentPx = rankColPx + avatarColPx + gap1Px;

      // Width-cap fonts so the longest string in each zone fits (≈0.62em char width
      // — generous, all-caps glyphs run wide).
      const cap = (px: number, longest: number, slotPx: number, min: number) => Math.max(min, Math.min(px, Math.floor(slotPx / (Math.max(1, longest) * 0.62))));
      const nameLongest = Math.max(1, ...rows.map((r) => textEmUnits(r.name)));
      const heroLongest = Math.max(1, ...rows.map((r) => textEmUnits(fmt(r.values[0]))));
      let secLongest = 1;
      for (const r of rows) for (let c = 1; c < C; c++) secLongest = Math.max(secLongest, textEmUnits((props.columnSigns?.[c] ?? "") + fmt(r.values[c])));
      const titleText = props.title ?? "TOP CONTRIBUTORS";
      const secCount = Math.max(1, C - 1);
      const secColPx = Math.floor(Math.max(1, contentW - indentPx) / secCount);

      const rankFontP = Math.max(12, Math.round(W * 0.042));
      // ×0.94: q() weight quantization shaves a few % off the realized name
      // cell — capping to the full modeled slot left 19-char names 3px over
      // at 360×640 (text-fit tripwire catch). Floor-bound long names
      // ellipsize (truncated text must still FIT, never clip).
      const nameFontP = cap(Math.round(W * 0.05), nameLongest, Math.round(nameColPx * 0.94), 12);
      const fitNameP = (s: string): string => fitEmUnits(s, Math.max(2, (nameColPx * 0.94) / (nameFontP * 0.62)));
      // Height-cap too: the font tracks W but the hero row (64% of topLineH)
      // tracks H — wide-short portraits (e.g. 733×977) clipped the digits' tops.
      const heroFontP = Math.max(14, Math.min(cap(Math.round(W * 0.092), heroLongest, heroColPx, 18), Math.round(topLineH * 0.55)));
      const heroLabelFontP = Math.max(9, Math.round(W * 0.026));
      const secFontP = cap(Math.round(W * 0.042), secLongest, secColPx, 11);
      const avatarFontP = Math.max(14, Math.round(W * 0.052));
      const titleFontP = cap(Math.round(W * 0.062), titleText.length, Math.round(innerW * 0.7), 18);
      const subFontP = Math.max(11, Math.round(W * 0.032));

      const hasDiff = !!(props.columnColors || props.columnSigns);

      // Grain-collapse for the card-interior splits (handbook: px-per-weight ≥4).
      // The interior weights below are PIXEL-derived; their sums match the
      // computed cell size, but the REALIZED cell drifts ±1-2px under ancestor
      // quantization — at units ≈ span an edge cell floors to 0 and the whole
      // doc dies with SPLIT_EXCEEDS_AXIS (repro: defaults at 733×977). Dividing
      // every weight by 4 keeps the ratios (±2px) with a 4× feasibility margin.
      const q = (px: number) => Math.max(1, Math.round(px / 4));

      const cardNode = (i: number): Node => {
        const r = rows[i];
        const startAtSec = introDelay + i * rowStagger;
        const rankNode = paint(bindRow(tag(fcell(String(r.rank ?? i + 1), rankFontP, LABEL_COLOR, "center"), "rank"), i, "rank", "number"));
        const disc = avatarDisc(r.name, AVATAR_HUES[i % AVATAR_HUES.length], avatarFontP);
        const nameNode = paint(bindRow(tag(fcell(fitNameP(r.name), nameFontP, TITLE_COLOR, "left"), "row-name"), i, "name", "string"));

        // The hero metric shows values[0] as-is (formatted) → bound. The secondary
        // lines below merge a sign / column label INTO the value → composites, unbound.
        const heroText = fmt(r.values[0]);
        const heroVal = anim.countUp && animate && /\d/.test(heroText)
          ? paint(bindRow(tag(exprCell(animateNumbersInText(heroText, { startSec: startAtSec, durationSec: rowDur, ease: anim.easing }), heroFontP, VALUE_COLOR, "right"), "row-value"), i, "values", "number", 0))
          : paint(bindRow(tag(fcell(heroText, heroFontP, VALUE_COLOR, "right"), "row-value"), i, "values", "number", 0));
        const heroBlock = rowSplit([
          { weight: 64, node: heroVal },
          { weight: 36, node: paint(bindProp(tag(fcell(columns[0] ?? "", heroLabelFontP, LABEL_COLOR, "right"), "col-header"), "columns", 0)) },
        ]);

        const topLine = colSplit([
          { weight: q(rankColPx), node: rankNode },
          { weight: q(avatarColPx), node: discInCell(disc) },
          { weight: q(gap1Px), node: EMPTY },
          { weight: q(nameColPx), node: nameNode },
          { weight: q(heroColPx), node: heroBlock },
        ]);

        // bottom line: secondary metrics (columns 1..), indented under the name.
        const botBands: Band[] = [{ weight: q(indentPx), node: EMPTY }];
        for (let c = 1; c < C; c++) {
          const text = fmt(r.values[c]);
          const sign = props.columnSigns?.[c] ?? "";
          const color = props.columnColors?.[c] ?? LABEL_COLOR;
          const display = hasDiff ? `${sign}${text}` : `${columns[c]}  ${text}`;
          const node = anim.countUp && animate && /\d/.test(text)
            ? paint(tag(exprCell(animateNumbersInText(display, { startSec: startAtSec, durationSec: rowDur, ease: anim.easing }), secFontP, color, "left"), "row-value"))
            : paint(tag(fcell(display, secFontP, color, "left"), "row-value"));
          const w = c === C - 1 ? Math.max(1, contentW - indentPx - secColPx * (secCount - 1)) : secColPx;
          botBands.push({ weight: q(w), node });
        }
        const botLine = colSplit(botBands);

        const cardContent = rowSplit([{ weight: q(topLineH), node: topLine }, { weight: q(botLineH), node: botLine }]);
        const cardInset = rowSplit([
          { weight: q(cardPadY), node: EMPTY },
          { weight: q(contentH), node: colSplit([{ weight: q(cardPadX), node: EMPTY }, { weight: q(contentW), node: cardContent }, { weight: q(cardPadX), node: EMPTY }]) },
          { weight: q(cardPadY), node: EMPTY },
        ]);
        const isTop = i < topTint;
        const rowColor = isTop ? blend(washBase, accent, 0.1) : blend(washBase, ROW_BG, 0.55);
        const cardTileSrc = makeColorTile(rowColor, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.12 } } }) as MosaicSource;
        // "row" tag = the layout contract's join key (equal-size relation).
        (cardTileSrc as MosaicSource & { editor?: { label?: string } }).editor = { label: "row" };
        // The wash is `washColor` blended toward the row/accent tint → the one prop that
        // controls it; every card wash binds it (1:N).
        const rowTile = paint(bindProp(cardTileSrc, "washColor"));
        return wrapReveal(overlay([rowTile, cardInset]), startAtSec, rowDur);
      };

      // Cards stack: one EQUAL band per card (quantization-exact — the
      // interleaved [card, gap] weights let the engine's outside-in remainder
      // starve the CENTER card under ancestor drift; measured 195/187/187/187/194
      // at 720×1280 before this). The half-gap is carved INSIDE each band.
      const cardU = Math.max(2, Math.round((2 * cardH) / Math.max(1, gapP)));
      const cardBands: Band[] = [];
      for (let i = 0; i < N; i++) {
        cardBands.push({
          weight: 1,
          node: rowSplit([
            { weight: 1, node: EMPTY },
            { weight: cardU, node: cardNode(i) },
            { weight: 1, node: EMPTY },
          ]),
        });
      }
      const cardsStack = rowSplit(cardBands);

      const iconBoxP = rowSplit([{ weight: 1, node: EMPTY }, { weight: 5, node: iconChip }, { weight: 2, node: EMPTY }]);
      const titleStackP = rowSplit([
        { weight: 58, node: paint(bindProp(tag(fcell(titleText, titleFontP, TITLE_COLOR, "left"), "table-title"), "title")) },
        { weight: 42, node: paint(bindProp(tag(tcell(props.subtitle ?? "This week", subFontP, LABEL_COLOR, "left"), "table-subtitle"), "subtitle")) },
      ]);
      // Icon column width == the chip's height (the 5/8 band of the header),
      // so the chip cell is a SQUARE by construction — innerW·0.15 only
      // happened to be near-square at some canvases (108×80 at 733×977).
      const iconW = Math.max(1, Math.round(headerH * (5 / 8)));
      const iconGapW = Math.round(innerW * 0.04);
      const headerP = colSplit([
        { weight: iconW, node: iconBoxP },
        { weight: iconGapW, node: EMPTY },
        { weight: Math.max(1, innerW - iconW - iconGapW), node: titleStackP },
      ]);
      const headerNodeP = wrapReveal(headerP, introDelay, rowDur);

      const body = showHeader
        ? rowSplit([
            { weight: headerH, node: headerNodeP },
            { weight: headerGap, node: EMPTY },
            { weight: rowsH, node: cardsStack },
          ])
        : cardsStack;
      const contentInsetP = rowSplit([
        { weight: padP, node: EMPTY },
        { weight: innerH, node: colSplit([{ weight: padP, node: EMPTY }, { weight: innerW, node: body }, { weight: padP, node: EMPTY }]) },
        { weight: padP, node: EMPTY },
      ]);
      // Skip the surface tile entirely when transparent — a "black@0" tile composites
      // opaque-black over a parent backdrop; with no tile, the parent panel shows through.
      const surfaceP = wrapReveal(paint(bindProp(makeColorTile(cardBg, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.04 } } }) as MosaicSource, "backgroundColor")), 0, rowDur);
      root = surfaceSolid ? overlay([surfaceP, contentInsetP]) : contentInsetP;
    } else {
    // ════ LANDSCAPE / SQUARE — the approved multi-column table ════
    const pad = Math.round(Math.min(W, H) * 0.04);
    const valW = valWPct; // each value col (computed early for the colFont width-cap)
    // Name: fixed font width-capped to the name slot so long names SHRINK (not clip,
    // the fit:contain failure mode) — binds only when the slot is tight (square).
    // 0.72, not 0.77: the realized name cell is 15/20 of CONTRIB_W (=0.75)
    // MINUS split quantization — the 0.77 model let 19-char default names
    // graze the value column by ~5% (text-fit tripwire catch).
    const nameSlotPx = Math.max(1, Math.round((W - 2 * pad) * (CONTRIB_W / 100) * 0.72));
    const nameLongestT = Math.max(1, ...rows.map((r) => textEmUnits(r.name)));
    const tableNameFont = Math.max(11, Math.min(Math.round(H * 0.04), Math.floor(nameSlotPx / (nameLongestT * 0.6))));
    // When the 11px floor binds (absurdly long names), the font can't shrink
    // further — ELLIPSIZE to what fits instead of clipping (founder rule:
    // long text may truncate, but even the truncated string must fit).
    const fitName = (s: string): string => fitEmUnits(s, Math.max(2, nameSlotPx / (tableNameFont * 0.6)));

    // ── A table row's column split (shared by the column-header + data rows) ──
    const rowCols = (rank: Node, contributor: Node, vals: Node[]): Node =>
      colSplit([
        { weight: PAD_W, node: EMPTY },
        { weight: RANK_W, node: rank },
        { weight: CONTRIB_W, node: contributor },
        ...vals.map((v) => ({ weight: valW, node: v })),
        { weight: PAD_W, node: EMPTY },
      ]);

    // Column-header row. The value-column headers display `columns[i]` — bound
    // for Make's double-click edit (bindProp); "#" / "Contributor" are static chrome.
    const colHeader = rowCols(
      paint(tag(tcell("#", colFont, LABEL_COLOR, "left"), "col-header")),
      paint(tag(tcell("Contributor", colFont, LABEL_COLOR, "left"), "col-header")),
      columns.map((c, i) => paint(bindProp(tag(tcell(c, colFont, LABEL_COLOR, "right"), "col-header"), "columns", i))),
    );

    // ── Data rows ──
    // Avatar disc: a computed SQUARE (side 0.64·min of its cell) via placement
    // insets — the cell's own aspect swings wildly with canvas/N (wide pill at
    // 1920×480, tall pill at N=1 square), and the disc is the future profile-
    // picture slot, so its paint must stay headshot-shaped at ANY canvas. The
    // `avatar` contract constraint below enforces it.
    const rowsHpx = Math.max(1, (H - 2 * pad) * ((showHeader ? 66 : 87) / 100));
    const rowHpx = Math.max(1, (rowsHpx / N) * 0.8);
    // CONTRIB_W/100: rowCols weights sum to exactly 100. 4/20: the contributor colSplit below
    // — coarse on purpose (100-unit [18,5,77] sat at 2.4px/unit in this cell,
    // and the engine's edge-first remainder fattened the disc band 43→56px).
    const discCellWpx = Math.max(1, (W - 2 * pad) * (CONTRIB_W / 100) * (4 / 20));
    const discSide = 0.64 * Math.min(discCellWpx, rowHpx);
    const discInset = {
      x: Math.max(0, (discCellWpx - discSide) / (2 * discCellWpx)),
      y: Math.max(0, (rowHpx - discSide) / (2 * rowHpx)),
    };
    const discFont = Math.min(avatarFont, Math.max(10, Math.round(discSide * 0.6)));
    const dataRow = (i: number): Node => {
      const r = rows[i];
      const startAtSec = introDelay + i * rowStagger;
      const rankNode = paint(bindRow(tag(tcell(String(r.rank ?? i + 1), rankFont, LABEL_COLOR, "left"), "rank"), i, "rank", "number"));
      // contributor cell = avatar disc (square circle) + name.
      const disc = avatarDisc(r.name, AVATAR_HUES[i % AVATAR_HUES.length], discFont, discInset);
      const contributor = colSplit([
        { weight: 4, node: disc }, // insets center a true square in the cell
        { weight: 1, node: EMPTY },
        { weight: 15, node: paint(bindRow(tag(fcell(fitName(r.name), tableNameFont, TITLE_COLOR, "left"), "row-name"), i, "name", "string")) },
      ]);
      const vals = columns.map((_, c) => {
        const text = fmt(r.values[c]);
        const sign = props.columnSigns?.[c] ?? "";
        const color = props.columnColors?.[c] ?? VALUE_COLOR; // per-column tint (additions green / deletions red)
        const display = `${sign}${text}`;
        // The cell shows ONE leaf (values[c]) behind a constant per-column sign
        // affix — bound like a prefixed value (Make seeds from the raw number).
        return anim.countUp && animate && /\d/.test(text)
          ? paint(bindRow(tag(exprCell(animateNumbersInText(display, { startSec: startAtSec, durationSec: rowDur, ease: anim.easing }), valueFont, color, "right"), "row-value"), i, "values", "number", c))
          : paint(bindRow(tag(tcell(display, valueFont, color, "right"), "row-value"), i, "values", "number", c));
      });
      const content = rowCols(rankNode, contributor, vals);
      // Top-N rows get a soft accent wash + a subtle row tile behind; the rest a
      // faint row tile so the table reads as banded.
      const isTop = i < topTint;
      // Bake the wash into a SOLID color so the band fades in WITH its row. A static
      // overlay.alpha would make wrapFade skip the tile → the band shows at t=0.
      const rowColor = isTop ? blend(washBase, accent, 0.1) : blend(washBase, ROW_BG, 0.55);
      const rowTileSrc = makeColorTile(rowColor, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.16 } } }) as MosaicSource;
      // "row" tag = the layout contract's join key (equal-size relation).
      (rowTileSrc as MosaicSource & { editor?: { label?: string } }).editor = { label: "row" };
      // The wash is `washColor` blended toward the row/accent tint → the one prop that
      // controls it; every row wash binds it (1:N).
      const rowTile = paint(bindProp(rowTileSrc, "washColor"));
      const rowNode = overlay([rowTile, content]);
      return wrapReveal(rowNode, startAtSec, rowDur);
    };

    // Rows stack: one EQUAL band per row (quantization-exact — the old
    // interleaved [120, 32] weights let the engine's outside-in remainder
    // starve the CENTER row under ancestor drift; measured 75/72/72/72/74 at
    // 1001×733 before this). The half-gap is carved INSIDE each band by a tiny
    // [1, 8, 1] split (row:gap ≈ the old 120:32 banding).
    const rowsBands: Band[] = [];
    for (let i = 0; i < N; i++) {
      rowsBands.push({
        weight: 1,
        node: rowSplit([
          { weight: 1, node: EMPTY },
          { weight: 8, node: dataRow(i) },
          { weight: 1, node: EMPTY },
        ]),
      });
    }
    const rowsStack = rowSplit(rowsBands);

    // ── Header (SQUARE icon chip + title + subtitle) — iconChip is shared (built above) ──
    // The icon cell is built in pixels so its width == the header-band height → a square
    // cell, and the 15/70/15 inset (both axes) keeps the chip itself square.
    const hInnerW = Math.max(1, W - 2 * pad);
    const headerHpx = Math.round(Math.max(1, H - 2 * pad) * 0.18); // = the weight-18 header band below
    const iconBox = rowSplit([
      { weight: 15, node: EMPTY },
      { weight: 70, node: colSplit([{ weight: 15, node: EMPTY }, { weight: 70, node: iconChip }, { weight: 15, node: EMPTY }]) },
      { weight: 15, node: EMPTY },
    ]);
    const titleStack = rowSplit([
      { weight: 58, node: paint(bindProp(tag(tcell(props.title ?? "TOP CONTRIBUTORS", titleFont, TITLE_COLOR, "left"), "table-title"), "title")) },
      { weight: 42, node: paint(bindProp(tag(tcell(props.subtitle ?? "This week", subFont, LABEL_COLOR, "left"), "table-subtitle"), "subtitle")) },
    ]);
    const headerGapPx = Math.round(hInnerW * 0.015);
    const header = colSplit([
      { weight: headerHpx, node: iconBox }, // px weight == header height → square cell
      { weight: headerGapPx, node: EMPTY },
      { weight: Math.max(1, hInnerW - headerHpx - headerGapPx), node: titleStack },
    ]);
    const headerNode = wrapReveal(header, introDelay, rowDur);
    const colHeaderNode = wrapReveal(colHeader, introDelay + rowStagger * 0.5, rowDur);

    // ── Compose: content padded inside the card surface ──
    const content = showHeader
      ? rowSplit([
          { weight: 18, node: headerNode },
          { weight: 4, node: EMPTY },
          { weight: 8, node: colHeaderNode },
          { weight: 4, node: EMPTY },
          { weight: 66, node: rowsStack },
        ])
      : rowSplit([
          { weight: 9, node: colHeaderNode },
          { weight: 4, node: EMPTY },
          { weight: 87, node: rowsStack },
        ]);
    const innerW = Math.max(1, W - 2 * pad), innerH = Math.max(1, H - 2 * pad);
    const contentInset = rowSplit([
      { weight: pad, node: EMPTY },
      { weight: innerH, node: colSplit([{ weight: pad, node: EMPTY }, { weight: innerW, node: content }, { weight: pad, node: EMPTY }]) },
      { weight: pad, node: EMPTY },
    ]);
    // Card surface fades in from t=0 too, so nothing is visible before the cascade.
    // Skip it when transparent (see portrait note) so a parent backdrop shows through.
    const surface = wrapReveal(paint(bindProp(makeColorTile(cardBg, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.04 } } }) as MosaicSource, "backgroundColor")), 0, rowDur);
    root = surfaceSolid ? overlay([surface, contentInset]) : contentInset;
    }

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

    // Dev tripwire: every row/card must render the SAME size, the header icon
    // chip must paint square, and every avatar disc must stay headshot-shaped
    // (it's the future profile-picture slot — 0.2 tolerates quantization drift
    // but trips on the pill stretches). Falsy debugLayout (default) returns
    // the doc untouched at zero cost.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/contributor-table/v1",
        // tolerancePx 1 = the equal split's quantization guarantee; 2% catches
        // real starvation where a fraction is meaningful.
        relations: N >= 2 ? [{ label: "row", equal: "size", tolerance: 0.02, tolerancePx: 1 }] : [],
        constraints: [
          ...(showHeader ? [{ label: "header-icon", aspect: 1, aspectTolerance: 0.1 }] : []),
          // 0.25, not tighter: at tiny canvases the disc bottoms out ~25px,
          // where the engine's ±2-3px quantization drift alone is ~0.15 of
          // aspect (measured 1.23 at 607×401). The pills this guards against
          // are 3-8×.
          { label: "avatar", aspect: 1, aspectTolerance: 0.25 },
          // Text-fit tripwires. row-name at 0.6em = the tableNameFont cap's
          // own model; the rest at the pack's 0.62em. The col-header/rank
          // labels exist in BOTH layouts; title/subtitle only with the header.
          ...(showHeader ? [
            { label: "table-title", textFits: { charWidthEm: 0.62 } },
            { label: "table-subtitle", textFits: { charWidthEm: 0.62 } },
          ] : []),
          { label: "col-header", textFits: { charWidthEm: 0.62 } },
          { label: "rank", textFits: { charWidthEm: 0.62 } },
          { label: "row-name", textFits: { charWidthEm: 0.6 } },
          ...(columns.length > 0 ? [{ label: "row-value", textFits: { charWidthEm: 0.62 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: ContributorTableProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineContributorTable.render(
      {
        ...(AlpineContributorTable.defaultProps as ContributorTableProps),
        anim: { ...DEFAULT_ANIM, renderMode: "light", reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Contributor Table",
        title: "A contributor table.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(AlpineContributorTable);
