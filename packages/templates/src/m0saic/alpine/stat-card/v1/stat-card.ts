import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/stat-card/v1 — Hero KPI Stat Card (Alpine pack, hero-styled)
 * ============================================================================
 *
 * The KPI tile for the FFmpeg Weekly Pulse hero dashboard. An Alpine-pack
 * sibling of `@m0saic/charts/stat-card/v1`, re-styled to the pulse hero vision:
 * a rounded dark #161b22 card with a hairline border, restrained GREEN accents,
 * and a top-left accent ICON beside the metric label — the storyboard look.
 *
 * LAYOUT (rowSplit, on a single overlaid content node over the card surface):
 *   ├── header band   icon (square accent chip / optional media glyph) + LABEL
 *   ├── value band    the dominant count-up value
 *   └── delta band    SVG-triangle arrow + signed delta (green-up / red-down)
 *                     + a muted sublabel ("vs last week")
 * The delta + sublabel are always allocated even when empty so the VALUE stays
 * vertically aligned across a row of cards.
 *
 * Animation mirrors the charts stat-card: the value counts up
 * (animateNumbersInText), the delta "flares" + fades, the label/sublabel
 * cascade-fade. `anim.reduceMotion` → fully static.
 *
 * Self-contained palette (no hero-pack import — keeps the Alpine layer below the
 * hero layer): the hero tokens are mirrored as local constants, overridable via
 * `accent` / `backgroundColor`. Sizes derive from the card's OWN canvas
 * (ctx.target — the slot when nested) so fonts fit whatever grid cell it lands in.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicSource,
  MosaicTextSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  animateNumbersInText,
  definePropsSchema,
  makeColorTile,
  registerTemplate,
  placeInsetPieces,
  withGeometryContract,
  textEmUnits,
  bindProp,
  type InsetPiece,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { paint, tag, fitEmUnits, rowSplit, overlay, textCell, EMPTY, type Node } from "../../_shared/alpine-card";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";
import { ALPINE_GLYPHS, ALPINE_GLYPH_NAMES, resolveAlpineGlyph } from "../../_shared/alpine-glyphs";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealSlideNode, revealFadeNode, ALPINE_ANIM_FIELDS, fBool, fStr } from "../../_shared/alpine-anim";

/** Reveal quality/cost dial (mirrors donut/v3 + bar-graph/v2). `premium` (default):
 *  the soft alpha crossfade — best look, a per-pixel geq. `light`: geq-free (header
 *  static, delta band slides). The FFmpeg pulse beats opt into `light`. */
type RenderMode = "premium" | "light";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Direction = "up" | "down" | "flat";
type StatCardAnim = { countUp?: boolean; introFrac?: number; introMs?: number; easing?: EaseName; fade?: boolean; reduceMotion?: boolean };

type AlpineStatCardProps = {
  label: string;
  value: string;
  delta?: string;
  direction?: Direction;
  sublabel?: string;
  /** Friendly named glyph for the accent chip (the human door — resolves via the
   *  shared alpine catalog). Raw `iconPath` wins when both are set. */
  icon?: string;
  /** Optional glyph: an SVG path `d` string (24×24 viewBox) drawn as a MASK on the
   *  accent chip (a lavfi tile — NOT a media image, which mis-lays-out the card).
   *  The RAW agent-side value — wins over `icon`. Omit both for the bare square. */
  iconPath?: string;
  /** Reveal quality/cost: "premium" (default, soft fade) | "light" (geq-free slide). */
  renderMode?: RenderMode;
  /** Alpine theme variant (light default; "dark" = night look). */
  preset?: AlpinePreset;
  /** Accent color (icon chip + up-delta). Defaults to the alpine primary. */
  accent?: MosaicColor;
  /** Card surface color. Pass "none"/"black@0" to render transparent when composed under a chrome. */
  backgroundColor?: MosaicColor;
  anim?: StatCardAnim;
  /** Opt-in producer theming. The local palette is the fallback; a producer's
   *  published tokens override it. Explicit `accent`/`backgroundColor` still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only geometry contract: assert every element's computed rect survived
   *  to the pixels at this canvas; on violation render a GEOMETRY_CONTRACT error
   *  mosaic. Deterministic default false — production never sets it. */
  debugGeometry?: boolean;
};

// Alpine pack citizen: all colors come from the shared alpine theme (light by
// default, `preset:"dark"` for the night look). The FFmpeg Weekly Pulse hero
// keeps its exact dark KPI look by passing `preset:"dark"` + its own `accent`
// (bright green) + `backgroundColor` (#161b22) as overrides — explicit props win.
const GLYPH_COLOR: MosaicColor = "#0d1117"; // dark glyph cut into the accent chip
const STAT_CARD_ID = "@m0saic/alpine/stat-card/v1";

// Band weights (header / value / delta) + inner gaps, as row weights.
const BANDS = { padY: 9, header: 22, gap1: 4, value: 42, gap2: 4, delta: 18, padYb: 9 };
// Font sizes as a fraction of card height; capped by fit:"contain".
const LABEL_FRAC = 0.11, VALUE_FRAC = 0.30, DELTA_FRAC = 0.115, SUB_FRAC = 0.085;
const PAD_FRAC = 0.085; // card inner padding (fraction of min dimension)
// Placement laundering: the card's elements ride placeInsetPieces — cells
// quantize outward to a divisor lattice (precision bounds at ~120, the modern
// canvas-family gcd) and each source carries a placement.inset that paints it
// back on the EXACT computed rect. Zero visual drift (the previous
// placeOptimizedPieces drift budget moved edges ≈1–2px); same escape from the
// coprime-pixel precision blowup (exact placeRects pins the card to 100%
// precision / a huge m0 at odd canvases). Hostile prime-dim cells degrade to
// exact placement on that axis (the same degradation drift had there).

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

function txt(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "right" | "center" = "left"): MosaicTextSource {
  // FIXED font (NO fit:"contain" — contain scales text to the cell HEIGHT and then
  // clips the width on a long line, which cut off the "%" / "vs last week"). Callers
  // size each font to fit its cell WIDTH up front (capFont), so a fixed font never clips.
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}
function exprTxt(expr: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", renderMode: { kind: "video" }, visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign: "left", vAlign: "middle" } as any }] };
}
/** SVG-triangle arrow (color tile masked by an equilateral path; crisp + undistorted). */
function triangle(dir: "up" | "down", color: MosaicColor, cellW: number, cellH: number): MosaicLavfiSource {
  const S = Math.min(cellW, cellH) * 0.72, cx = cellW / 2, cy = cellH / 2, half = S / 2, ht = S * 0.866;
  const top = cy - ht / 2, bot = cy + ht / 2, n = (x: number) => Math.round(x * 10) / 10;
  const localPath = dir === "up"
    ? `M ${n(cx)} ${n(top)} L ${n(cx + half)} ${n(bot)} L ${n(cx - half)} ${n(bot)} Z`
    : `M ${n(cx - half)} ${n(top)} L ${n(cx + half)} ${n(top)} L ${n(cx)} ${n(bot)} Z`;
  return makeColorTile(color, { mask: { kind: "inline-mask", localPath, bounds: { x: 0, y: 0, width: cellW, height: cellH } } });
}

const propsSchema = definePropsSchema<AlpineStatCardProps>({
  // ── Primary props — flat, always visible (declaration order = display order). ──
  label: { type: "string", required: true, description: "Metric label (e.g. \"Commits\").", meta: { ui: { label: "Label", order: 1 } } },
  value: { type: "string", required: true, description: "Headline value, pre-formatted (e.g. \"1,243\", \"96.7%\").", meta: { ui: { label: "Value", order: 2 } } },
  // Text inputs together, then the enum toggles together, then the color pickers
  // together — like controls near like controls.
  delta: { type: "string", required: false, description: "Signed change, pre-formatted (e.g. \"+12.4%\"). Omit for no delta.", meta: { ui: { label: "Delta", order: 3 } } },
  sublabel: { type: "string", required: false, description: "Muted caption next to the delta (e.g. \"vs last week\").", meta: { ui: { label: "Sublabel", order: 4 } } },
  direction: { type: "string", required: false, description: "Delta direction — arrow + color (green up / red down / muted flat).", meta: { constraints: { oneOf: ["up", "down", "flat"] }, ui: { label: "Direction", order: 5 } } },
  icon: { type: "string", required: false, description: "Named glyph for the accent chip (shared alpine catalog). A derived HUMAN view of the raw iconPath agent prop: picking a name WRITES the SVG path into iconPath (the stored, code-friendly value); a bespoke agent-written path shows as no selection.", meta: { constraints: { oneOf: ALPINE_GLYPH_NAMES }, ui: { label: "Icon", order: 6, consumer: "human" }, control: { syncsTo: [{ prop: "iconPath", map: { kind: "lookup", table: ALPINE_GLYPHS } }] } } },
  renderMode: { type: "string", required: false, description: "Reveal quality/cost. \"premium\" (default): soft alpha crossfade — best look, a per-pixel geq. \"light\": geq-free (header static, delta band slides). The FFmpeg pulse hero opts into light.", meta: { constraints: { oneOf: ["premium", "light"] }, ui: { label: "Render Mode", order: 7 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 8 } } },
  accent: { type: "string", required: false, description: "Accent color (icon chip + up-delta). Defaults to the alpine primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Accent", order: 9 } } },
  backgroundColor: { type: "string", required: false, description: "Card surface color. \"black@0\" → transparent (composed under a chrome).", meta: { constraints: { isColor: true }, control: { placeholder: "theme card", colorPicker: true, defaultColor: "#FFFFFF" }, ui: { label: "Card color", order: 10 } } },

  // ── Collapsible groups (surfaced — nice human controls, NOT agent props). ──
  anim: { type: "group" as any, required: false, description: "Intro reveal: reduceMotion, intro length, easing, count-up.", meta: { ui: { label: "Animation", order: 11, collapsedByDefault: true } }, fields: { ...ALPINE_ANIM_FIELDS, countUp: fBool("Count up", "Count the value up on intro.") } } as any,
  theme: { type: "group" as any, required: false, description: "Opt into a theme source. Uses the local palette by default; set a producer slug + namespace to pull shared design tokens. Explicit accent/card color still win.", meta: { ui: { label: "Theme", order: 12, collapsedByDefault: true } }, fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") } } as any,

  // ── Agent prop — the RAW SVG path (code-friendly storage; wins over `icon`). ──
  iconPath: { type: "string", required: false, description: "Glyph SVG path d (24×24 viewBox), drawn as a mask on the accent chip — the raw value behind the friendly `icon` knob, and the override that wins. Omit both for the bare colored square.", meta: { control: { placeholder: "from Icon (catalog glyph)" }, ui: { label: "Icon path (SVG d)", order: 13, consumer: "agent" } } },

  // ── Debug — hidden by default; the sandbox / matrix / Make iteration flip it true. ──
  debugGeometry: { type: "boolean", required: false, description: "Dev-only geometry contract view: renders the contract wireframe instead of the card — every element GREEN when its computed rect survived to the pixels at this canvas, realized RED + intended amber ghost when not. Deterministic default false; production never sets it.", meta: { ui: { label: "Debug geometry", order: 14, collapsedByDefault: true } } },
});

export const AlpineStatCard: MosaicTemplate<AlpineStatCardProps> = {
  id: asTemplateId(STAT_CARD_ID),
  label: "Alpine Stat Card",
  version: 1,
  description: "Alpine KPI stat card — friendly mobile-marketing card: accent icon + muted label, dominant count-up value, SVG-triangle delta (green up / red down) + sublabel. Light by default; \"dark\" preset for the night look (the FFmpeg Weekly Pulse hero passes preset:\"dark\" + its own accent/card).",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "stat-card", "kpi", "animated", "analysts", "marketers", "metric", "number"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 3000 }, // landscape 16:10 — matches the Alpine pack siblings (donut/timeline/kpi). The vertical band stack fills wide canvases cleanly; nested tile usage (pulse beats) passes its own ctx.target and is unaffected.
  propsSchema,

  defaultProps: {
    anim: { reduceMotion: false, introFrac: 0.7, easing: "easeOut", countUp: true },
    debugGeometry: false,
    theme: { forceFetch: false },
    label: "Commits",
    value: "1,243",
    delta: "+12.4%",
    direction: "up",
    sublabel: "vs last week",
    icon: "commits",
    renderMode: "premium",
    preset: "light",
  },

  async render(props: AlpineStatCardProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    // Theming: the shared alpine theme (light default). A producer overrides
    // per-key; explicit accent/backgroundColor win (the hero passes both + dark).
    const theme = await resolveAlpineTheme(props.preset ?? "light", ctx, props.theme);
    const accent = props.accent ?? theme.primary;
    const cardBg = props.backgroundColor ?? theme.card;

    const anim = props.anim ?? {};
    const reduceMotion = anim.reduceMotion ?? false;
    const animOn = !reduceMotion;
    const totalSec = (ctx.target.durationMs ?? 3000) / 1000;
    const introSec = anim.introMs != null ? anim.introMs / 1000 : totalSec * (anim.introFrac ?? 0.7);
    const doFade = (anim.fade ?? true) && animOn;
    const animateValue = (anim.countUp ?? true) && animOn && /\d/.test(props.value);
    const isLight = (props.renderMode ?? "premium") === "light";
    // Reveal cascade timing. premium fades the header too; light keeps it static.
    const labelFade: [number, number] = [0, introSec * 0.3];
    const deltaFade: [number, number] = [introSec * 0.4, introSec * 0.4];
    const subFade: [number, number] = [introSec * 0.6, introSec * 0.35];

    const pad = Math.round(Math.min(W, H) * PAD_FRAC);
    const innerW = Math.max(1, W - 2 * pad), innerH = Math.max(1, H - 2 * pad);
    const sum = Object.values(BANDS).reduce((a, b) => a + b, 0);
    const px = (w: number) => Math.round((w / sum) * innerH);
    const headerH = px(BANDS.header), deltaH = px(BANDS.delta);

    // ── Cell widths FIRST, so every font can be capped to fit its own cell ──
    // iconSide caps at 0.18·min-dim: bands are FRACTIONS of height, so at tall
    // portrait cards an uncapped header band minted a ~195px chip towering
    // over its width-capped label (gate-10 sweep catch). Landscape defaults
    // sit under the cap — byte-identical.
    const iconSide = Math.min(headerH, Math.round(Math.min(W, H) * 0.18));
    const gapW = Math.round(iconSide * 0.42);
    const labelCellW = Math.max(1, innerW - iconSide - gapW);
    const dir = props.direction ?? "flat";
    const hasDelta = !!(props.delta && props.delta.trim() !== "");
    const hasArrow = hasDelta && (dir === "up" || dir === "down");
    // TWO-PASS arrow sizing: the arrow must track the DELTA TEXT, not the band
    // (the band is a height fraction — at portrait it minted a 73px triangle
    // beside 17px text). Pass 1 sizes the font against the band-derived arrow;
    // pass 2 shrinks the arrow to ≤1.25× that font and re-derives the cells
    // (fonts only ever GROW when the arrow shrinks — monotone-safe).
    const arrowSide0 = Math.round(H * DELTA_FRAC * 0.85);
    const cellsFor = (arrow: number) => {
      const gg = Math.max(2, Math.round(arrow * 0.4));
      const space = hasArrow ? arrow + gg : 0;
      const rest = Math.max(2, innerW - space - gg);
      const dW = Math.max(1, Math.round(rest * 0.5));
      return { g: gg, arrowSpace: space, deltaW: dW, subW: Math.max(1, rest - dW) };
    };
    let { g, arrowSpace, deltaW, subW } = cellsFor(arrowSide0);

    // Fixed font sized to fit the cell WIDTH → never clips, never rescales per frame.
    // `em` is em-per-char: it sets how much SLACK the text leaves in its cell. The
    // delta uses a big em (0.82) so "+12.4%" sits well inside its cell with a wide
    // safety margin — the CLI renderer fit it at a tight margin but the app
    // renderer's font metrics ran a hair wider and clipped the "%". Generous slack
    // is robust across both render paths; the band-height fraction still caps size.
    // Script-aware length (textEmUnits): the CLI face draws Cyrillic ~0.95em /
    // CJK ~0.98em — a flat .length under-measures wide scripts ~1.5× and clips.
    // Floor-bound text ELLIPSIZES (fitEmUnits) — truncated text must FIT.
    const capFont = (frac: number, text: string, cellW: number, minPx: number, em = 0.7) =>
      Math.max(minPx, Math.min(Math.round(H * frac), Math.floor(cellW / Math.max(1, textEmUnits(text || " ") * em))));
    const fitTo = (text: string, cellW: number, font: number, em: number) => fitEmUnits(text, Math.max(2, cellW / (font * em)));
    const labelText0 = props.label.toUpperCase();
    const labelFont = capFont(LABEL_FRAC, labelText0, labelCellW, 10, 0.7);
    const labelText = fitTo(labelText0, labelCellW, labelFont, 0.7);
    const valueFont = capFont(VALUE_FRAC, props.value, innerW, 16, 0.66);
    const valueText = fitTo(props.value, innerW, valueFont, 0.66);
    const deltaFont0 = capFont(DELTA_FRAC, props.delta ?? "", deltaW, 10, 0.88);
    const arrowSide = Math.min(arrowSide0, Math.round(deltaFont0 * 1.25));
    ({ g, arrowSpace, deltaW, subW } = cellsFor(arrowSide));
    const deltaFont = capFont(DELTA_FRAC, props.delta ?? "", deltaW, 10, 0.88);
    const deltaText = hasDelta ? fitTo(props.delta!, deltaW, deltaFont, 0.88) : " ";
    const subFont = capFont(SUB_FRAC, props.sublabel ?? "", subW, 9, 0.62);
    const subText = fitTo(props.sublabel ?? " ", subW, subFont, 0.62);

    // ── Build EACH element as its own top-level overlay layer (the title-beat
    // pattern), positioned by pixel rect. A monolithic content split with a MEDIA
    // source in one cell makes the renderer re-lay-out the whole content (clipping
    // the text); independent per-element layers keep the media chip isolated and
    // render correctly. ──
    const before = (w: number) => pad + Math.round((w / sum) * innerH);
    const headerTop = before(BANDS.padY);
    const valueTop = before(BANDS.padY + BANDS.header + BANDS.gap1);
    const deltaTop = before(BANDS.padY + BANDS.header + BANDS.gap1 + BANDS.value + BANDS.gap2);
    const valueH = px(BANDS.value);
    // Every element is positioned with placeRects (exact-pixel rects + null-tile margins),
    // NOT insetNode. insetNode's real-split margins spread the quantization remainder INTO
    // the placed rect, shrinking/shifting it at sizes that don't divide evenly — that
    // clipped the value (band crushed 59→38px) and shoved the icon glyph off-center on the
    // desktop rail. placeRects packs the rects onto few layers (light m0) with `importance`
    // for z-order; null margins never distort a placed rect.
    // Two-mode reveal. premium = soft alpha crossfade (header + delta band cascade,
    // a per-pixel geq — the default, best look). light = geq-free: header static,
    // only the delta band (below the number) slides up. Value always count-up.
    const slideDist = Math.round(H * 0.06);
    const revealHeader = (n: Node): Node => (isLight ? n : revealFadeNode(n, labelFade[0], labelFade[1], doFade));
    const revealDelta = (n: Node, f: [number, number]): Node =>
      isLight ? revealSlideNode(n, f[0], f[1], slideDist, doFade) : revealFadeNode(n, f[0], f[1], doFade);
    const Z = { surface: 0, chip: 1, ink: 2 };
    const pieces: InsetPiece[] = [];
    const addP = (node: Node, x: number, y: number, w: number, h: number, importance: number) => {
      const xi = Math.max(0, Math.min(W - 1, Math.round(x))), yi = Math.max(0, Math.min(H - 1, Math.round(y)));
      const wi = Math.max(1, Math.min(Math.round(w), W - xi)), hi = Math.max(1, Math.min(Math.round(h), H - yi));
      pieces.push({ rect: { x: xi, y: yi, w: wi, h: hi, importance }, source: node.sources[0] });
    };

    // chip: the colored accent tile, with an optional GLYPH drawn as an SVG MASK on
    // top (a lavfi tile, NOT a media image — a media source mis-lays-out the card).
    // Both are independent per-element layers, so neither needs an in-cell overlay.
    // The chip's FILL is `accent` → bound to it (Make's color picker); the card
    // surface's fill is `backgroundColor`. Both bind at their theme defaults
    // too — double-click is the handle to SET one.
    const chipTile: Node = paint(bindProp(makeColorTile(accent, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.28 } } }) as MosaicSource, "accent"));
    const glyphSide = Math.round(iconSide * 0.56);
    const glyphX = pad + Math.round((iconSide - glyphSide) / 2);
    const glyphY = headerTop + Math.round((headerH - glyphSide) / 2);
    // Friendly `icon` name → shared catalog path; raw `iconPath` wins.
    const glyphPath = resolveAlpineGlyph(props.icon, props.iconPath, STAT_CARD_ID);
    const glyphNode: Node | null = glyphPath
      ? paint(makeColorTile(GLYPH_COLOR, { mask: { kind: "inline-mask", localPath: glyphPath, bounds: { x: 0, y: 0, width: 24, height: 24 } } }) as MosaicSource)
      : null;
    // Each text rect is bound to the prop it displays (Make's double-click edit);
    // the delta + sublabel rects are ALWAYS allocated, so they stay bound even
    // when empty — a handle to ADD one.
    const valueNode: Node = animateValue
      ? paint(bindProp(tag(exprTxt(animateNumbersInText(valueText, { durationSec: introSec, ease: anim.easing ?? "easeOut" }), valueFont, theme.title), "stat-value"), "value"))
      : paint(bindProp(tag(txt(valueText, valueFont, theme.title, "left"), "stat-value"), "value"));
    const dColor = dir === "up" ? theme.positive : dir === "down" ? theme.negative : theme.muted;
    const surface: Node = paint(bindProp(makeColorTile(cardBg, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.08 } } }) as MosaicSource, "backgroundColor"));

    addP(surface, 0, 0, W, H, Z.surface);
    // Header (chip + label): premium fades, light static. Value always count-up.
    // The chip is a SQUARE (iconSide can now be < headerH), centered in the band.
    const chipY = headerTop + Math.round((headerH - iconSide) / 2);
    addP(revealHeader(chipTile), pad, chipY, iconSide, iconSide, Z.chip);
    if (glyphNode) addP(revealHeader(glyphNode), glyphX, glyphY, glyphSide, glyphSide, Z.ink);
    addP(revealHeader(paint(bindProp(tag(txt(labelText, labelFont, theme.label, "left"), "stat-label"), "label"))), pad + iconSide + gapW, headerTop, labelCellW, headerH, Z.ink);
    // Value fades with the header (premium) so the count-up doesn't sit at full
    // opacity before the labels appear; light keeps it static (count-up only).
    addP(revealHeader(valueNode), pad, valueTop, innerW, valueH, Z.ink);
    // Below the number (delta arrow + delta + sublabel): premium fades, light slides.
    if (hasArrow) addP(revealDelta(paint(triangle(dir as "up" | "down", dColor, arrowSide, deltaH)), deltaFade), pad, deltaTop, arrowSide, deltaH, Z.ink);
    addP(revealDelta(paint(bindProp(tag(txt(deltaText, deltaFont, dColor, "left"), "stat-delta"), "delta")), deltaFade), pad + arrowSpace, deltaTop, deltaW, deltaH, Z.ink);
    addP(revealDelta(paint(bindProp(tag(txt(subText, subFont, theme.muted, "left"), "stat-sublabel"), "sublabel")), subFade), pad + arrowSpace + deltaW + g, deltaTop, subW, deltaH, Z.ink);

    // Zero-drift laundered placement: the friendly helper packs the pieces (as
    // placeRects) over lattice-quantized cells and wires a recovery
    // placement.inset onto each source, so every element paints on its EXACT
    // computed rect while the m0's precision stays bounded (~120 basis). The
    // returned `expectations` declare each element's intent for the geometry
    // contract below (nearly free — no extra parse here).
    const { m0: placedM0, sources, expectations } = placeInsetPieces({ rootW: W, rootH: H, pieces });

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: String(placedM0) as any,
      sources,
      backgroundColor: "black@0",
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      // Pin the canvas (the glyph media source otherwise lets the renderer infer
      // size from the image, scaling the whole composition and clipping the text).
      size: { width: W, height: H },
    } as MosaicDocument;

    // Dev tripwire: `debugGeometry` falsy (the default) → returns `doc` untouched
    // at zero cost. True → checks every element's computed rect survived to the
    // pixels at THIS canvas, stamps `editor.geometryContract`, and on a violation
    // returns a GEOMETRY_CONTRACT error mosaic at exactly the canvas that broke.
    return Promise.resolve(
      withGeometryContract(doc, ctx, {
        templateId: STAT_CARD_ID,
        expectations,
        debug: props.debugGeometry === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // static default card INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineStatCardProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const card = (await AlpineStatCard.render(
      {
        ...(AlpineStatCard.defaultProps as AlpineStatCardProps),
        anim: { reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Stat Card",
        title: "A KPI tile.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(card), theme.borderStrong),
      heroAssets: card.assets,
    });
  },
};

registerTemplate(AlpineStatCard);
