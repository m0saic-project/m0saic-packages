/**
 * ============================================================================
 * @m0saic/charts/stat-card/v2 — Canonical KPI Stat Card (data-viz primitive)
 * ============================================================================
 *
 * A single executive-summary KPI tile: category label, a dominant value, an
 * optional delta (arrow + signed change, green-up / red-down), and an optional
 * sublabel ("vs last week"). The building block of the GitHub repo-tracker
 * hero dashboard; appears 4x in the FFmpeg analytics mock.
 *
 * GEOMETRY (agreed in the sandbox session 2026-06-11-stat-card-kpi, candidate-002):
 *
 *   row split (label / content / sublabel — the floating-bands model):
 *     ├── label-band     ~12%   category label, thin "floating" band on top
 *     ├── content-band   ~76%   value + delta combined into ONE rect,
 *     │                          split by emphasis (value 3 : delta 1)
 *     └── sublabel-band  ~12%   sublabel, thin "floating" band on bottom
 *
 * The delta + sublabel bands are always allocated (even when empty) so the
 * VALUE stays vertically aligned across a row of cards — incl. the no-delta
 * case (e.g. "86% Activity Rate"), which simply renders blank delta/sublabel.
 *
 * The card surface (rounded dark tile) is the root `1`; the banded content is
 * an overlay on top. When composed into the dashboard under a dedicated
 * card-chrome primitive, pass backgroundColor: "none" to render transparent.
 *
 * ANIMATION — the card animates on intro: the value counts up (per-frame
 * drawtext `expr`), and the content cascade-reveals in eye order (label →
 * delta → sublabel) via a subtle slide-up. The reveal is built on the shared
 * F2 motion kit (`entrance({kind:"slide-up"})` — a scalar `yExpr` + native
 * `enable` gate, ~free per frame); it replaced an animated `overlay.alpha`
 * ramp that cost ~70% of the render (R4 — per-frame geq). See `slideIn`.
 * `anim.reduceMotion` / `anim.slideIn:false` disable it. (F4 U-C4, 2026-07-07.)
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicSource,
  MosaicTemplate,
  MosaicTextSource,
  MosaicThemeTokens,
} from "@m0saic/types";
import { toM0String, weightedSplit } from "@m0saic/dsl-stdlib";
import {
  animateNumbersInText,
  bindProp,
  definePropsSchema,
  entrance,
  fitEmUnits,
  makeColorTile,
  registerTemplate,
  resolveDocFrames,
  resolveThemeTokens,
  tag,
  textEmUnits,
  withLayoutContract,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type StatCardDirection = "up" | "down" | "flat";

type StatCardAnim = {
  /** Count the value up from 0 to its final number on intro. Default true. */
  countUp?: boolean;
  /** Fraction of the OUTPUT duration the intro fills (the rest holds). Default
   *  0.7 — so a longer render automatically gets a longer intro. */
  introFrac?: number;
  /** Absolute intro duration (ms). Overrides introFrac when set. */
  introMs?: number;
  /** Easing for the count-up. Default "easeOut". */
  easing?: EaseName;
  /**
   * Cascade-reveal the content in (label → delta → sublabel), in eye order, via
   * a subtle slide-up (see the `slideIn` helper). Default true. Was an animated
   * alpha fade until F4 U-C4 (2026-07-07) — swapped to a slide-up to drop the R4
   * per-frame-geq cost (~70% of render) at an equally premium read.
   */
  slideIn?: boolean;
  /** Disable all motion — render the final static value. Default false. */
  reduceMotion?: boolean;
};

type StatCardV2Props = {
  label: string;
  value: string;
  delta?: string;
  direction?: StatCardDirection;
  sublabel?: string;
  backgroundColor?: MosaicColor;
  /**
   * Opt into a theme SOURCE. Omit → the card reads the default "theme" namespace
   * off ctx and falls back to its own palette (auto-themes as a child, byte-
   * identical standalone). Provide a `slug` to self-seed from a producer template
   * when nothing is upstream (the head case) — swap the slug to swap the theme,
   * no code change. See `resolveThemeTokens`.
   */
  theme?: ThemeSourceConfig;
  anim?: StatCardAnim;
  debugLayout?: boolean;
  /** Compose-time (hidden): also paint the surface as a full-frame tile, for a parent that nests this card. */
  useNestedBackgroundColor?: boolean;
};

const propsSchema = definePropsSchema<StatCardV2Props>({
  label: {
    type: "string",
    required: true,
  },
  value: {
    type: "string",
    required: true,
  },
  delta: {
    type: "string",
    required: false,
  },
  direction: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["up", "down", "flat"] } },
  },
  sublabel: {
    type: "string",
    required: false,
  },
  backgroundColor: {
    type: "string",
    required: false,
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },
  debugLayout: { type: "boolean", required: false },
  // A flag a composing parent sets programmatically, never a human knob.
  useNestedBackgroundColor: { type: "boolean", required: false, meta: { ui: { hidden: true } } },
  theme: {
    type: "group" as any,
    required: false,
    fields: {
      slug: { type: "string", required: false },
      preset: { type: "string", required: false },
      namespace: { type: "string", required: false },
      forceFetch: { type: "boolean", required: false },
    },
  },
  anim: {
    type: "group" as any,
    required: false,
    fields: {
      countUp: { type: "boolean", required: false },
      slideIn: { type: "boolean", required: false },
      introFrac: { type: "number", required: false, meta: { constraints: { min: 0.1, max: 1 }, control: { flavor: "slider", step: 0.05 } } },
      introMs: { type: "number", required: false, meta: { constraints: { min: 0, max: 20000 } } },
      easing: { type: "string", required: false, meta: { constraints: { oneOf: ["easeOut", "smoothstep", "easeInOut", "linear"] } } },
      reduceMotion: { type: "boolean", required: false },
    },
  },
});

// ---------------------------------------------------------------------------
// Theme (dark — GitHub-palette aligned, fitting the repo-tracker hero)
// ---------------------------------------------------------------------------
//
// The card's constants declared as a full MosaicThemeTokens fallback — the
// FIRST `applyTheme` consumer in the codebase (F4 U-C4). `applyTheme(LOCAL_THEME,
// ctx)` overlays a producer's published tokens per-key; un-themed (no producer
// ahead of it) it returns LOCAL_THEME unchanged → the standalone render is
// byte-identical to before theming. The six keys this card actually READS carry
// their previous hexes verbatim (that's what guarantees byte-identity); the
// other 15 keys are defensible GitHub-dark locals present only to satisfy the
// token shape — stat-card never reads them (marked ✗ below). We deliberately do
// NOT import the producer's `resolveTheme` — coupling the fallback to the
// producer's dark preset would risk a drift that breaks byte-identity.
const LOCAL_THEME: MosaicThemeTokens = {
  // ── Surfaces ──
  surfaceApp: "#0d1117", //     ✗ not read (GitHub canvas)
  surface: "#161b22", //        ✓ card tile IS the surface (was CARD_BG)
  surfaceRaised: "#1c2128", //  ✗
  surfaceInset: "#010409", //   ✗
  border: "#30363d", //         ✗
  borderStrong: "#484f58", //   ✗
  // ── Text ──
  textPrimary: "#e6edf3", //    ✓ the dominant value (was VALUE_COLOR)
  textSecondary: "#8b949e", //  ✓ label + flat-delta (was LABEL_COLOR / DELTA_FLAT)
  textMuted: "#6e7681", //      ✓ sublabel (was SUBLABEL_COLOR)
  eyebrow: "#8b949e", //        ✗
  // ── Accent ──
  accent: "#2f81f7", //         ✗
  accentSoft: "#388bfd", //     ✗
  accentGlow: "#1f6feb", //     ✗
  // ── Status ──
  positive: "#3fb950", //       ✓ up-delta arrow + text (was DELTA_UP)
  negative: "#f85149", //       ✓ down-delta arrow + text (was DELTA_DOWN)
  // ── Chart chrome (✗ — stat-card has no grid/axis) ──
  grid: "#30363d",
  gridAlpha: 1,
  axis: "#484f58",
  axisAlpha: 1,
  // ── Shape ── (✗ — the card is a flat rect; no rounding, no scope creep)
  radius: 0,
  // ── Data marks ── (✗ — stat-card renders no categorical series)
  dataPalette: ["#3fb950", "#f85149", "#2f81f7", "#d29922", "#a371f7", "#db61a2"],
};

// Band geometry (sandbox candidate-002).
const OUTER_WEIGHTS = [12, 76, 12]; // label / content / sublabel
const CONTENT_WEIGHTS = [3, 1]; //     value / delta (emphasis split)

// Font sizes as a fraction of card height; fit:"contain" caps each to its band.
const LABEL_FONT_FRAC = 0.11;
const VALUE_FONT_FRAC = 0.46;
const DELTA_FONT_FRAC = 0.13;
const SUBLABEL_FONT_FRAC = 0.08;

// Consistent left inset so every line shares one left edge (the mock is
// strongly left-aligned).
const LEFT_PAD = 0.06;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function leftText(
  text: string,
  fontSize: number,
  color: MosaicColor,
  leftPad: number = LEFT_PAD,
): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: text || " " },
        style: { fontSize, fontColor: color },
        placement: { fit: "contain", hAlign: "left", vAlign: "middle", padding: { left: leftPad } } as any,
      },
    ],
  };
}

// Animated value: an expr text layer evaluated per-frame on a video-renderMode
// source — drives the count-up. FIXED fontSize (no `fit`) so the digits don't
// rescale as the number grows; left-aligned. Mirrors the screencap-grid idiom.
function exprText(
  expr: string,
  fontSize: number,
  color: MosaicColor,
  leftPad: number = LEFT_PAD,
): MosaicTextSource {
  return {
    type: "text",
    renderMode: { kind: "video" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "expr", expr, eval: "frame" },
        style: { fontSize, fontColor: color },
        placement: { hAlign: "left", vAlign: "middle", padding: { left: leftPad } } as any,
      },
    ],
  };
}

// Premium content reveal: each element slides up into place over its cue window
// via the shared F2 motion kit. `entrance({kind:"slide-up"})` emits a `yExpr`
// offset + a native `enable` gate — the overlay fast path, scalar per frame
// (~free). This replaced an animated `overlay.alpha` ramp (R4: a per-frame geq
// fold, ~5.7s / 70% of render on this 5-source card) with an identical premium
// read at ~⅓ the render cost (F4 U-C4, founder-approved 2026-07-07). Linear
// ease — the look signed off in the reveal-comparison. reduceMotion / slideIn:false
// → returned untouched (no motion). Only one motion (entrance, no exit), so we
// spread it directly; `composeMotion` is for combining an entrance AND an exit.
function slideIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return {
    ...src,
    overlay: { ...prev, ...entrance({ kind: "slide-up", atSec: startSec, durationMs: Math.round(durSec * 1000) }) },
  } as T;
}

// Drawn arrow indicator. ffmpeg drawtext drops ▲/▼ glyphs as tofu, and a
// text-masked rect distorts — so draw it the right way: a COLOR source
// (makeColorTile, lavfi — ffmpeg composes) masked by an SVG triangle (SVG
// draws). The mask `bounds` match the cell's px aspect, so the engine's scale
// is uniform (scaleX===scaleY) → crisp + undistorted at any resolution. The
// path is a TRUE equilateral authored in the cell's own coordinate space.
// (Future: a `triangleMask` helper in dsl-stdlib/mask-shapes.)
function triangleSource(dir: "up" | "down", color: MosaicColor, cellW: number, cellH: number): MosaicLavfiSource {
  const S = Math.min(cellW, cellH) * 0.74; // equilateral side
  const cx = cellW / 2;
  const cy = cellH / 2;
  const half = S / 2;
  const ht = S * 0.866; // equilateral height = side·√3/2
  const top = cy - ht / 2;
  const bot = cy + ht / 2;
  const n = (x: number) => Math.round(x * 10) / 10;
  const localPath =
    dir === "up"
      ? `M ${n(cx)} ${n(top)} L ${n(cx + half)} ${n(bot)} L ${n(cx - half)} ${n(bot)} Z`
      : `M ${n(cx - half)} ${n(top)} L ${n(cx + half)} ${n(top)} L ${n(cx)} ${n(bot)} Z`;
  return makeColorTile(color, {
    mask: { kind: "inline-mask", localPath, bounds: { x: 0, y: 0, width: cellW, height: cellH } },
  });
}

// up → positive, down → negative, flat → textSecondary (the muted label color,
// as DELTA_FLAT was === LABEL_COLOR). Reads the resolved theme so a producer can
// re-skin the delta colors.
function deltaColor(direction: StatCardDirection, theme: MosaicThemeTokens): MosaicColor {
  return direction === "up" ? theme.positive : direction === "down" ? theme.negative : theme.textSecondary;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const StatCardV2: MosaicTemplate<StatCardV2Props> = {
  id: asTemplateId("@m0saic/charts/stat-card/v2"),
  version: 2,
  capabilities: { tier: "core" },
  aspectRatio: { ideal: 2.6, min: 1.6, max: 4.0, mode: "warn" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 768, height: 288, fps: 30, durationMs: 1500, posterTimeMs: 1400, note: "Single KPI tile (8:3)" }, // 768×288 not 760×290: 5-smooth axes (latticeSmooth)
  propsSchema,
  bindings: {
    unbound: {
      // The surface IS document.backgroundColor — there is no rect to hang a swatch on.
      backgroundColor: "document background",
      "theme.slug": "theme source",
      "theme.preset": "theme source",
      "theme.namespace": "theme source",
      "anim.introFrac": "timing",
      "anim.introMs": "timing",
    },
  },

  defaultProps: {
    debugLayout: false,
    theme: { forceFetch: false },
    label: "Total Commits",
    value: "246",
    delta: "+18 (+7.9%)",
    direction: "up",
    sublabel: "vs last week",
    // backgroundColor intentionally UNSET — it resolves to theme.surface (the
    // producer's surface when themed, else LOCAL_THEME.surface === "#161b22", so
    // the un-themed render is byte-identical). An explicit "none" still wins to
    // render transparent when composed under a card-chrome primitive.
    anim: { countUp: true, introFrac: 0.7, easing: "easeOut", slideIn: true, reduceMotion: false },
  },

  async render(props: StatCardV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    // Theme: resolve tokens for this card — read the configured namespace off
    // ctx (auto-themes as a child, default namespace "theme") and, when a
    // producer `slug` is configured but nothing is upstream (the head case),
    // self-seed by invoking that producer. Un-configured + un-themed → returns
    // LOCAL_THEME unchanged → byte-identical standalone render. Swap the theme by
    // swapping props.theme.slug — no code change here.
    const theme = await resolveThemeTokens(LOCAL_THEME, ctx, props.theme);

    // Size off the template's OWN canvas (ctx.target — the slot when nested),
    // not ctx.output (the top-level render envelope). Using ctx.output made a
    // nested stat-card size its fonts to the parent canvas and overflow its
    // cell; at top level ctx.target === ctx.output so this is a no-op there.
    const H = ctx.target.height;
    const W = ctx.target.width;
    // Width-cap every font to its cell at the CLI's glyph metrics (the alpine
    // stat-card idiom): H-scaled fonts clip long text — the VALUE is a FIXED
    // fontSize expr layer (no fit), and fit:contain on the rest shrinks in-app
    // but CLIPS in the CLI. Script-aware (textEmUnits); floor-bound text
    // ellipsizes (fitEmUnits) — truncated text must FIT.
    const innerW = W * (1 - LEFT_PAD - 0.02);
    const capFont = (frac: number, text: string, cellW: number, minPx: number, em: number) =>
      Math.max(minPx, Math.min(Math.round(H * frac), Math.floor(cellW / Math.max(1, textEmUnits(text || " ") * em))));
    const fitTo = (text: string, cellW: number, font: number, em: number) => fitEmUnits(text, Math.max(2, cellW / (font * em)));

    const labelFont = capFont(LABEL_FONT_FRAC, props.label, innerW, 10, 0.7);
    const labelText = fitTo(props.label, innerW, labelFont, 0.7);
    const valueFont = capFont(VALUE_FONT_FRAC, props.value, innerW, 16, 0.66);
    const valueText = fitTo(props.value, innerW, valueFont, 0.66);
    const sublabelFont = capFont(SUBLABEL_FONT_FRAC, props.sublabel ?? "", innerW, 9, 0.7);
    const sublabelText = fitTo(props.sublabel ?? "", innerW, sublabelFont, 0.7);


    // ── Intro animation timing (eye order: number counts, then delta, then sublabel) ──
    const anim = props.anim ?? {};
    const reduceMotion = anim.reduceMotion ?? false;
    // Intro length derives from the OUTPUT duration (the §10 time source): it
    // fills `introFrac` of it, leaving a hold — so rendering longer lengthens the
    // animation. An explicit `introMs` overrides for absolute control.
    const totalSec = ctx.target.durationMs / 1000;
    const introSec = anim.introMs != null ? anim.introMs / 1000 : totalSec * (anim.introFrac ?? 0.7);
    const doSlideIn = (anim.slideIn ?? true) && !reduceMotion;
    // debugLayout forces the literal (non-expr) paths: geometry is identical
    // (fonts derive from the text either way) and with no expr sources the
    // frames-to-sources zip is safe, so the contract checks EVERY text group.
    const animateValue = (anim.countUp ?? true) && !reduceMotion && /\d/.test(props.value) && props.debugLayout !== true;
    // Short numeric "flare" on the delta numbers (+18, 7.9) — ticks while the
    // delta slides in. Independent of the value being a clean integer.
    const doFlare = (anim.countUp ?? true) && !reduceMotion && props.debugLayout !== true;
    // Cascade reveal windows [startSec, durSec], all relative to the intro so the
    // whole reveal scales with the output duration: delta reveals once the count
    // is well underway; sublabel last — a clean top-to-bottom read.
    const deltaFade: [number, number] = [introSec * 0.55, introSec * 0.35];
    const sublabelFade: [number, number] = [introSec * 0.85, introSec * 0.15];

    const direction = props.direction ?? "flat";
    const hasDelta = !!(props.delta && props.delta.trim() !== "");
    const hasArrow = hasDelta && (direction === "up" || direction === "down");
    const dColor = deltaColor(direction, theme);

    // delta text: count its numbers up ("flare") while it slides in; else static.
    const makeDeltaText = (text: string, font: number, pad: number): MosaicSource =>
      doFlare && /\d/.test(text)
        ? exprText(
            animateNumbersInText(text, {
              startSec: deltaFade[0],
              durationSec: deltaFade[1],
              ease: anim.easing ?? "easeOut",
            }),
            font,
            dColor,
            pad,
          )
        : leftText(text, font, dColor, pad);

    // delta band: [left-null | SQUARE arrow | text] when an arrow applies, else
    // a single text cell. The arrow tile is square (= the delta band height) so
    // the triangle mask is undistorted; a leading null aligns it to the value's
    // left edge, and the text fills the rest. (The band is always kept, even
    // empty, so the value stays aligned across a row of cards.)
    const deltaSources: MosaicSource[] = [];
    let deltaBand: string;
    if (hasArrow) {
      const outerSum = OUTER_WEIGHTS[0] + OUTER_WEIGHTS[1] + OUTER_WEIGHTS[2];
      const contentSum = CONTENT_WEIGHTS[0] + CONTENT_WEIGHTS[1];
      const deltaBandFrac = (OUTER_WEIGHTS[1] / outerSum) * (CONTENT_WEIGHTS[1] / contentSum);
      // ~square arrow cell = the delta band height. Weights are percent-of-width
      // (sum 100) so the literal split stays ~100 cells — well under the engine's
      // ~200-cell split-rounding limit. The triangle itself is a true equilateral
      // authored in the cell's px space, so exact squareness isn't required.
      const cellH = deltaBandFrac * H; //                                 arrow cell height px
      // TWO-PASS ARROW (the alpine stat-card fix, gate 10): a band-height
      // square arrow dwarfs the text at extreme portrait aspects — cap the
      // arrow cell width to ~1.5× the delta font and re-derive. At the ideal
      // ~2.6:1 aspect the cap doesn't bind (byte-identical).
      const squareW0 = Math.max(1, Math.round((cellH / W) * 100));
      const leftW = Math.max(1, Math.round(LEFT_PAD * 100)); //            align to value edge
      const dTextCellW0 = ((100 - leftW - squareW0) / 100) * W * 0.94;
      const deltaFont0 = capFont(DELTA_FONT_FRAC, props.delta!, dTextCellW0, 10, 0.7);
      const arrowSide = Math.min(cellH, deltaFont0 * 1.5);
      const squareW = Math.max(1, Math.round((arrowSide / W) * 100)); //   cell width as %W
      const textW = Math.max(1, 100 - leftW - squareW);
      const cellW = (squareW / 100) * W; //                               arrow cell width px
      const dTextCellW = (textW / 100) * W * 0.94;
      const deltaFont = capFont(DELTA_FONT_FRAC, props.delta!, dTextCellW, 10, 0.7);
      const deltaText = fitTo(props.delta!, dTextCellW, deltaFont, 0.7);
      deltaBand = weightedSplit([leftW, squareW, textW], "col", { claimants: ["-", "1", "1"] }) as unknown as string;
      deltaSources.push(slideIn(triangleSource(direction as "up" | "down", dColor, cellW, cellH), deltaFade[0], deltaFade[1], doSlideIn));
      deltaSources.push(slideIn(bindProp(tag(makeDeltaText(deltaText, deltaFont, 0.04), "kpi-delta"), "delta"), deltaFade[0], deltaFade[1], doSlideIn));
    } else {
      deltaBand = "1";
      const deltaFont = capFont(DELTA_FONT_FRAC, hasDelta ? props.delta! : " ", innerW, 10, 0.7);
      const deltaText = fitTo(hasDelta ? props.delta! : "", innerW, deltaFont, 0.7);
      const dSrc = makeDeltaText(deltaText, deltaFont, LEFT_PAD);
      // Bound even when empty: the delta band is always allocated, so the rect
      // stays a double-click handle to ADD a delta (the tag stays conditional —
      // it is the layout-contract join, meaningless on " ").
      deltaSources.push(slideIn(bindProp(hasDelta ? tag(dSrc, "kpi-delta") : dSrc, "delta"), deltaFade[0], deltaFade[1], doSlideIn));
    }

    // content = value (top, dominant) + delta band (bottom).
    const contentM0 = weightedSplit(CONTENT_WEIGHTS, "row", { claimants: ["1", deltaBand] }) as unknown as string;
    const outerM0 = weightedSplit(OUTER_WEIGHTS, "row", { claimants: ["1", contentM0, "1"] }) as unknown as string;
    // v2 (`canvasFill`): the card surface is `document.backgroundColor` — no
    // full-canvas tile (in Make it would be a click target over every line).
    // The engine still ignores a NESTED document's own background,
    // so a parent that composes this card into a cell passes the hidden
    // `useNestedBackgroundColor: true` and gets v1's base tile back. "none"
    // keeps the flat single-layer doc (transparent for card-chrome composition).
    const bgRaw = ((props.backgroundColor as string | undefined) ?? "").trim();
    const surfaceColor: MosaicColor | undefined = bgRaw.toLowerCase() === "none" ? undefined : ((bgRaw || theme.surface) as MosaicColor);
    const surface = props.useNestedBackgroundColor === true ? surfaceColor : undefined;
    const m0 = toM0String(surface ? `1{${outerM0}}` : outerM0, "StatCard");

    // Value: count-up (the number's own reveal). Uses animateNumbersInText so
    // suffixed values like "86%" animate too (the literal "%" is escaped).
    // reduceMotion → static.
    const valueSource = animateValue
      ? exprText(
          animateNumbersInText(valueText, {
            durationSec: introSec,
            ease: anim.easing ?? "easeOut",
          }),
          valueFont,
          theme.textPrimary,
        )
      : leftText(valueText, valueFont, theme.textPrimary);

    // Sublabel: tagged only when present (layout-contract join), but ALWAYS
    // bound so an empty sublabel rect is a double-click handle to add one.
    const sublabelSrc = leftText(sublabelText, sublabelFont, theme.textMuted);
    if ((props.sublabel ?? "").trim()) tag(sublabelSrc, "kpi-sublabel");
    bindProp(sublabelSrc, "sublabel");

    // Sources in m0 frame order: (surface) / label / value / delta / sublabel.
    // Cascade-slide the static elements in; the value reveals via its count-up.
    // Each text rect is bound to the prop it displays (Make's inline edit).
    const sources: MosaicSource[] = [
      // The surface tile's FILL is `backgroundColor` (kind color via the
      // schema's isColor → Make opens a picker). Bound on the theme fallback
      // too — the handle to ADD an explicit color. "none" → no tile → no binding.
      ...(surface ? [bindProp(makeColorTile(surface) as MosaicSource, "backgroundColor")] : []),
      slideIn(bindProp(tag(leftText(labelText, labelFont, theme.textSecondary), "kpi-label"), "label"), 0, 0.25, doSlideIn),
      bindProp(tag(valueSource, "kpi-value"), "value"),
      ...deltaSources,
      slideIn(sublabelSrc, sublabelFade[0], sublabelFade[1], doSlideIn),
    ];

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0,
      sources,
      backgroundColor: props.backgroundColor ?? theme.surface,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire: every text group fits its cell at the CLI's glyph metrics.
    // debugLayout forces the literal paths above, so coverage is unconditional.
    return withLayoutContract(doc, ctx, {
      templateId: "@m0saic/charts/stat-card/v2",
      relations: [],
      constraints: [
        { label: "kpi-label", textFits: { charWidthEm: 0.7 } },
        { label: "kpi-value", textFits: { charWidthEm: 0.66 } },
        ...(hasDelta ? [{ label: "kpi-delta", textFits: { charWidthEm: 0.7 } }] : []),
        ...((props.sublabel ?? "").trim() ? [{ label: "kpi-sublabel", textFits: { charWidthEm: 0.7 } }] : []),
      ],
      debug: props.debugLayout === true,
    });
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // static default card INLINED flat. The kit's tiny-canvas band fallback
  // carries this template's OWN gate-17 lesson (px-clamped band at the 290px
  // native hint canvas — a %-pane would cull the whole doc).
  async renderCover(_props: StatCardV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const card = (await StatCardV2.render(
      {
        ...(StatCardV2.defaultProps as StatCardV2Props),
        anim: { ...((StatCardV2.defaultProps as StatCardV2Props).anim ?? {}), reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "KPI Stat Card",
        title: "A KPI card.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(card), theme.borderStrong),
      heroAssets: card.assets,
    });
  },
};

registerTemplate(StatCardV2);
