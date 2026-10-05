import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/kpi-card/v3 — Alpine KPI / Stat Card, edited on the canvas
 * ============================================================================
 *
 * v2's card — the same picture, the same ratio sparkline band — held to the
 * 0.3.1 template conventions:
 *
 *  - Every value a person would change is a canvas HANDLE, or declared
 *    (`bindingsDeclared`). v2 bound what it drew; a title, subtitle, delta or
 *    sublabel it did NOT draw had no way back from the canvas. v3 hangs those
 *    as ADD handles on the nearest rect that exists: no header → `title` and
 *    `subtitle` ride the metric label; a title-only header carries
 *    `subtitle`; no delta pill → `delta` rides the value; no sublabel →
 *    `sublabel` rides the pill (else the value). The theme source, the intro
 *    timing and the sparkline series are declared (`bindings.unbound`).
 *  - What DESCRIBES it — label, description, tags, `primitive`, and every
 *    prop's label / hint / order — lives in `kpi-card.catalog.json` beside
 *    this file (`catalogSidecar`); the `anim` / `theme` groups come from the
 *    bare builders in `../../_shared/alpine-conventions`.
 *  - An empty value is an INPUT the card waits on (`makeIncompleteMosaic`).
 *
 * Animation: value counts up, pill/sublabel/sparkline cascade-fade; reduceMotion
 * → static. The delta arrow is a COLOR tile masked by an SVG triangle (crisp).
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
  withLayoutContract,
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeIncompleteMosaic,
  animateNumbersInText,
  fadeInExpr,
  bindProp,
  bindProps,
  type EaseName,
  type PropBindingEntry,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";

import type { Pt } from "../../../charts/_shared/line";
import {
  curvePolyline,
  polylineStrokePath,
  areaPolygonPath,
} from "../../../charts/line-chart/v1/geometry";

import {
  alpineCard,
  paint,
  EMPTY,
  rowSplit,
  colSplit,
  overlay,
  resolveColor,
  textCell,
  tag,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate } from "../../_shared/alpine-anim";
import {
  ALPINE_ANIM_FIELDS_BARE,
  ALPINE_ANIM_UNBOUND,
  ALPINE_THEME_GROUP_BARE,
  ALPINE_THEME_UNBOUND,
  bBool,
  bEnum,
  findCardHeader,
  withAddHandles,
  bindCardSurface,
} from "../../_shared/alpine-conventions";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Direction = "up" | "down" | "flat";
/** Reveal cost/quality dial. "premium" (default): soft alpha fades of the pill /
 *  sublabel / sparkline (a per-pixel geq each). "light": the same reveal via free
 *  enable-gate pops (constant-alpha tints kept) — no geq, composable. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; reduceMotion: boolean; introFrac: number; countUp: boolean; easing: EaseName };

export type AlpineKpiCardV3Props = {
  label: string;
  value: string;
  delta?: string;
  sublabel?: string;
  title?: string;
  subtitle?: string;
  direction?: Direction;
  preset?: AlpinePreset;
  valueColor?: MosaicColor;
  /** Optional trend series → a soft sparkline along the card bottom. Omit/empty to hide. */
  sparkline?: number[];
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert the delta pill painted at its intended aspect. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_DIRECTION: Direction = "up";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: false };

// Generic illustrative trend that MATCHES the delta direction, used when the
// caller doesn't supply explicit `sparkline` data. Deterministic.
const ASC_TREND = [10, 14, 12, 18, 16, 23, 21, 28, 26, 34];
function defaultSpark(dir: Direction): number[] {
  if (dir === "down") return ASC_TREND.slice().reverse();
  if (dir === "flat") return [20, 22, 19, 21, 20, 22, 19, 21, 20, 21];
  return ASC_TREND.slice();
}

// Body band proportions (label / value / delta / sparkline), as weights.
const LABEL_W = 13;
const VALUE_W = 34;
const DELTA_W = 14;
const SPARK_W = 30;
const GAP_W = 3;

// ---------------------------------------------------------------------------
// Text + shape helpers
// ---------------------------------------------------------------------------

function leftText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign: "left", vAlign: "middle" } as any }],
  };
}
function leftExprText(expr: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    renderMode: { kind: "video" },
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign: "left", vAlign: "middle" } as any }],
  };
}
function centerText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign: "center", vAlign: "middle" } as any }],
  };
}
function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}

/** Triangle arrow (up/down) as a COLOR tile masked by an SVG triangle — crisp,
 *  undistorted (the pack rule; a drawtext ▲/▼ would tofu). */
function triangleSource(dir: "up" | "down", color: MosaicColor, cellW: number, cellH: number): MosaicLavfiSource {
  const S = Math.min(cellW, cellH) * 0.7;
  const cx = cellW / 2, cy = cellH / 2;
  const half = S / 2, ht = S * 0.866;
  const top = cy - ht / 2, bot = cy + ht / 2;
  const n = (x: number) => Math.round(x * 10) / 10;
  const localPath =
    dir === "up"
      ? `M ${n(cx)} ${n(top)} L ${n(cx + half)} ${n(bot)} L ${n(cx - half)} ${n(bot)} Z`
      : `M ${n(cx - half)} ${n(top)} L ${n(cx + half)} ${n(top)} L ${n(cx)} ${n(bot)} Z`;
  return makeColorTile(color, { mask: { kind: "inline-mask", localPath, bounds: { x: 0, y: 0, width: cellW, height: cellH } } as any });
}

/**
 * Sparkline as a RATIO band: two inline-masks (soft area + line) that FILL the
 * band cell, with the curve authored in band-local coords [0..bandW,0..bandH].
 * Both masks share the cell's coordinate system, so they register exactly — no
 * placeRects, no per-mask pixel bbox (that's what pinned v1 to the canvas).
 */
function sparklineBand(opts: { bandW: number; bandH: number; values: number[]; color: MosaicColor; introSec: number; animate: boolean; light: boolean }): Node {
  const { bandW, bandH, color } = opts;
  const v = opts.values.filter((n) => Number.isFinite(n));
  if (v.length < 2 || bandW <= 0 || bandH <= 0) return EMPTY;
  const min = Math.min(...v), max = Math.max(...v), denom = max - min || 1;
  const strokeW = Math.max(2, Math.round(bandH * 0.06));
  const padY = strokeW + 2;
  const xAt = (i: number) => (i / (v.length - 1)) * bandW;
  const yAt = (val: number) => padY + (1 - (val - min) / denom) * (bandH - 2 * padY);
  const pts: Pt[] = v.map((val, i) => ({ x: xAt(i), y: yAt(val) }));
  const baselineY = bandH;
  const { poly: raw } = curvePolyline(pts, "smooth");
  const poly = raw.map((p) => ({ x: p.x, y: Math.max(0, Math.min(baselineY, p.y)) }));
  // premium: fade the area + line in (a geq each). light / reduceMotion: static tints.
  const fade = opts.animate && !opts.light;
  const aAlpha = fade ? `(${fadeInExpr(0, Math.max(0.12, opts.introSec * 0.5))})*0.16` : "0.16";
  const lAlpha = fade ? fadeInExpr(0, Math.max(0.12, opts.introSec * 0.5)) : undefined;
  const bounds = { x: 0, y: 0, width: bandW, height: bandH } as const;
  const areaMask = makeColorTile(color, { mask: { kind: "inline-mask", localPath: areaPolygonPath(poly, baselineY), bounds } as any, overlay: { alpha: aAlpha } }) as MosaicSource;
  const lineMask = makeColorTile(color, { mask: { kind: "inline-mask", localPath: polylineStrokePath(poly, strokeW), bounds } as any, ...(lAlpha ? { overlay: { alpha: lAlpha } } : {}) }) as MosaicSource;
  return overlay([paint(areaMask), paint(lineMask)]);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

// What each value IS. How Make presents it (label, hint, order, placeholder,
// collapsed) is the catalog sidecar's — kpi-card.catalog.json.
const propsSchema = definePropsSchema<AlpineKpiCardV3Props>({
  label: { type: "string", required: true },
  value: { type: "string", required: true },
  delta: { type: "string", required: false },
  sublabel: { type: "string", required: false },
  title: { type: "string", required: false },
  subtitle: { type: "string", required: false },
  direction: { type: "string", required: false, meta: { constraints: { oneOf: ["up", "down", "flat"] } } },
  preset: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "dark"] } } },
  valueColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true, defaultColor: "#0F172A" } } },
  sparkline: { type: "number[]", required: false, meta: { control: { flavor: "numberList" } } },
  anim: {
    type: "group" as any,
    required: false,
    fields: {
      renderMode: bEnum(["premium", "light"]),
      reduceMotion: ALPINE_ANIM_FIELDS_BARE.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS_BARE.introFrac,
      countUp: bBool(),
      easing: ALPINE_ANIM_FIELDS_BARE.easing,
    },
  } as any,
  theme: ALPINE_THEME_GROUP_BARE,
  debugLayout: { type: "boolean", required: false },
});

export const AlpineKpiCardV3: MosaicTemplate<AlpineKpiCardV3Props> = {
  id: asTemplateId("@m0saic/alpine/kpi-card/v3"),
  version: 3,
  capabilities: { tier: "core" },
  // posterTimeMs: the settled card — the intro fills 70% of the 2 s default clip.
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000, posterTimeMs: 1900 },
  propsSchema,
  bindings: {
    unbound: {
      ...ALPINE_THEME_UNBOUND,
      ...ALPINE_ANIM_UNBOUND,
      // One curve through every point — no per-point rect to hang a handle on.
      sparkline: "series",
    },
  },

  defaultProps: {
    debugLayout: false,
    theme: { forceFetch: false },
    label: "MONTHLY REVENUE",
    value: "$48,250",
    delta: "+12.5%",
    direction: "up",
    sublabel: "vs last month",
    preset: DEFAULT_PRESET,
    // sparkline intentionally omitted → auto-generates a trend matching `direction`.
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineKpiCardV3Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    if (!props.value || !String(props.value).trim()) {
      return makeIncompleteMosaic("Type the headline value — the number this card is about.", { title: "KPI Card", width: W, height: H });
    }

    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    const direction: Direction = props.direction ?? DEFAULT_DIRECTION;
    const valueColor = resolveColor(props.valueColor, theme.title);
    const deltaColor = direction === "up" ? theme.positive : direction === "down" ? theme.negative : theme.subtitle;
    const hasDelta = !!(props.delta && props.delta.trim());
    const hasArrow = hasDelta && (direction === "up" || direction === "down");
    const hasSub = !!(props.sublabel && props.sublabel.trim());
    const explicitSpark = props.sparkline !== undefined;
    const spark = (explicitSpark ? (props.sparkline ?? []) : defaultSpark(direction)).filter((n) => Number.isFinite(n));
    const hasSpark = spark.length >= 2;

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const animate = !anim.reduceMotion;
    const countUp = anim.countUp && animate && /\d/.test(props.value);

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    // Fonts off card height.
    const labelFont = Math.max(11, Math.round(H * 0.032));
    // Width-capped: the H-scaled value clips at narrow canvases ("$48,25" at
    // 720×1280). Binds only when the string would overflow the content width.
    const valueFont = Math.max(28, Math.min(Math.round(H * 0.15), Math.floor((cr.w * 0.94) / (Math.max(1, props.value.length) * 0.62))));
    const deltaFont = Math.max(12, Math.round(H * 0.034));
    const subFont = Math.max(10, Math.round(H * 0.026));

    // ── ADD handles: a prop whose rect does not exist yet rides the nearest
    //    rect that does (the value, the pill, the label, the header). ──
    const hasHeader = !!(props.title && props.title.trim()) || !!(props.subtitle && props.subtitle.trim());
    const addOnValue: PropBindingEntry[] = [
      ...(hasDelta ? [] : [{ propKey: "delta" }]),
      ...(hasSub || hasDelta ? [] : [{ propKey: "sublabel" }]),
    ];

    // ── Value (count-up or static), left-aligned ──
    // Bound to `value` either way (Make's double-click edit) with `valueColor` —
    // the rect's INK — as a second entry: Make opens a stacked value + color
    // form (value first = the primary). The tag stays on the static rect only
    // (the layout-contract join).
    const valueSrc = bindProps(
      countUp
        ? leftExprText(animateNumbersInText(props.value, { durationSec: introSec, ease: anim.easing }), valueFont, valueColor)
        : tag(leftText(props.value, valueFont, valueColor), "kpi-value"),
      [{ propKey: "value" }, { propKey: "valueColor" }, ...addOnValue],
    );

    // ── Delta pill: [arrow?][delta text] on a soft tinted rounded badge ──
    const dFadeAt = introSec * 0.5, dFadeDur = Math.max(0.1, introSec * 0.35);
    const ff = <T extends MosaicSource>(s: T) => !animate ? s : light ? revealGate(s, dFadeAt) : fadeIn(s, dFadeAt, dFadeDur, true);
    let deltaRow: Node = EMPTY;
    let pillWFrac = 0; // intended pill width / canvas width — the contract's tripwire (0 = no pill)
    if (hasDelta) {
      const pillH = Math.round(deltaFont * 1.9);
      const arrowW = hasArrow ? Math.round(pillH * 0.8) : 0;
      const arrowGap = hasArrow ? Math.round(deltaFont * 0.3) : 0;
      const textW = Math.round(deltaFont * 0.62 * props.delta!.length + deltaFont);
      const padX = Math.round(deltaFont * 0.6);
      // Quantize the pill-inner weights to a 100 basis OURSELVES (commit-feed's
      // wOf convention): the serializer re-quantizes large px-weight splits to
      // a small basis NON-proportionally (measured [74,113,14] → yields
      // 85/100/16), which stretched the arrow cell ~15% and defeated every
      // px-intent model. With an explicit 100 basis the yields ARE the intent.
      const arrowBoxPx = hasArrow ? 2 * padX + pillH : 0;
      const pillWpx = (hasArrow ? arrowBoxPx : padX) + textW + padX;
      const wq = (px: number) => Math.max(1, Math.round((px / pillWpx) * 100));
      let arrowCell: Band[] = [];
      if (hasArrow) {
        // Square-ish painted arrow: the box carries its own pads via a
        // symmetric {x} inset; the triangle centers at 70%, so the padding is
        // the gap. A leading EMPTY pad cell is NOT used — it would donate
        // forward into the arrow's painted box (engine law).
        const arrowTile = triangleSource(direction as "up" | "down", deltaColor, pillH, pillH);
        const insetX = padX / arrowBoxPx;
        (arrowTile as MosaicLavfiSource & { placement?: unknown }).placement = { inset: { x: insetX } };
        // "delta-arrow" tag = the layout contract's join key. Intent from the
        // QUANTIZED yield: cell = wq/100·pillW, painted = cell·(1−2·inset).
        (arrowTile as MosaicLavfiSource & { editor?: { label?: string } }).editor = { label: "delta-arrow" };
        arrowCell = [{ weight: wq(arrowBoxPx), node: paint(ff(arrowTile)) }];
      }
      const pillInner = colSplit([
        ...(hasArrow ? [] : [{ weight: wq(padX), node: EMPTY }]),
        ...arrowCell,
        { weight: wq(textW), node: paint(ff(bindProps(tag(centerText(props.delta!, deltaFont, deltaColor), "kpi-delta"), [{ propKey: "delta" }, ...(hasSub ? [] : [{ propKey: "sublabel" }])]))) },
        { weight: wq(padX), node: EMPTY },
      ]);
      const pillOverlay: Record<string, unknown> = animate
        ? (light ? { alpha: "0.14", enable: `gte(t,${dFadeAt.toFixed(3)})` } : { alpha: `(${fadeInExpr(dFadeAt, dFadeDur)})*0.14` })
        : { alpha: "0.14" };
      const pillBgTile = makeColorTile(deltaColor, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.5 } }, overlay: pillOverlay }) as MosaicSource;
      // "delta-pill" tag = the layout contract's join key (intended-aspect rule).
      (pillBgTile as MosaicSource & { editor?: { label?: string } }).editor = { label: "delta-pill" };
      const pillBg = paint(pillBgTile);
      const pillW = pillWpx;
      pillWFrac = pillW / Math.max(1, W);
      // Pill height PINNED to pillH px: [1, pillH, 1] made the pads negligible
      // (46/48 of an ~84px band → the pill painted 1.7× its intent and the
      // triangle mask, whose bounds are arrowW×pillH, stretched with it —
      // the founder's "squashed" arrow). Band height mirrors the REAL body
      // stack (drops the spark band when absent); q2 grain for feasibility.
      const stackTotal = LABEL_W + GAP_W + VALUE_W + GAP_W + DELTA_W + (hasSpark ? GAP_W + SPARK_W : 0);
      const deltaBandH = Math.max(pillH, Math.round((DELTA_W / stackTotal) * cr.h));
      const q2 = (px: number) => Math.max(1, Math.round(px / 2));
      const vpadT = Math.max(0, Math.round((deltaBandH - pillH) / 2));
      const vpadB = Math.max(0, deltaBandH - pillH - vpadT);
      const pillBand = rowSplit([
        ...(vpadT > 2 ? [{ weight: q2(vpadT), node: EMPTY }] : []),
        { weight: q2(pillH), node: overlay([pillBg, pillInner]) },
        ...(vpadB > 2 ? [{ weight: q2(vpadB), node: EMPTY }] : []),
      ]);
      const subGap = Math.round(deltaFont * 0.6);
      const subW = Math.round(subFont * 0.62 * (props.sublabel ?? "").length + subFont);
      const subNode: Band[] = hasSub
        ? [{ weight: subGap, node: EMPTY }, { weight: subW, node: paint(ff(bindProp(tag(leftText(props.sublabel!, subFont, theme.muted), "kpi-sublabel"), "sublabel"))) }]
        : [];
      // The trailing filler must be the REMAINING PIXELS, not weight 1 — px
      // weights against a unit filler become ratios of the full row, which
      // stretched the pill to ~60% of wide canvases (arrow ~400px from text).
      const rest = Math.max(1, Math.round(cr.w) - pillW - (hasSub ? subGap + subW : 0));
      deltaRow = colSplit([{ weight: pillW, node: pillBand }, ...subNode, { weight: rest, node: EMPTY }]);
    } else if (hasSub) {
      deltaRow = colSplit([{ weight: 1, node: paint(ff(bindProp(tag(leftText(props.sublabel!, subFont, theme.muted), "kpi-sublabel"), "sublabel"))) }]);
    }

    // ── Sparkline band (ratio): masks fill the band cell in band-local coords ──
    let sparkBand: Node = EMPTY;
    if (hasSpark) {
      const totalW = LABEL_W + VALUE_W + DELTA_W + SPARK_W + GAP_W * 3;
      const bandH = Math.max(1, Math.round((SPARK_W / totalW) * cr.h));
      const sparkColor = direction === "up" ? theme.positive : direction === "down" ? theme.negative : theme.primary;
      sparkBand = sparklineBand({ bandW: Math.round(cr.w), bandH, values: spark, color: sparkColor, introSec, animate, light });
    }

    // ── Body stack: label / value / delta / (sparkline band) ──
    const labelSrc = bindProps(tag(leftText(props.label, labelFont, theme.subtitle), "kpi-label"), [
      { propKey: "label" },
      ...(hasHeader ? [] : [{ propKey: "title" }, { propKey: "subtitle" }]),
    ]);
    const bands: Band[] = [
      { weight: LABEL_W, node: paint(animate && !light ? fadeIn(labelSrc, 0, Math.max(0.1, introSec * 0.25), true) : labelSrc) },
      { weight: GAP_W, node: EMPTY },
      { weight: VALUE_W, node: paint(valueSrc) },
      { weight: GAP_W, node: EMPTY },
      { weight: DELTA_W, node: deltaRow },
    ];
    if (hasSpark) {
      bands.push({ weight: GAP_W, node: EMPTY });
      bands.push({ weight: SPARK_W, node: sparkBand });
    }
    const body = rowSplit(bands);

    const root = card.compose(body);
    // A header that shows only one of title / subtitle carries the other.
    const header = findCardHeader(root.sources as MosaicSource[]);
    if (header) {
      withAddHandles(header, [
        ...(props.title && props.title.trim() ? [] : [{ propKey: "title" }]),
        ...(props.subtitle && props.subtitle.trim() ? [] : [{ propKey: "subtitle" }]),
      ]);
    }

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      // The card surface is a handle for `preset` (bindCardSurface) — a full-canvas
      // card that nothing binds is a dead click target (founder, 2026-10-01).
      sources: bindCardSurface(root.sources),
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire: the delta pill must paint at its INTENDED aspect — the
    // px-weights-vs-unit-filler stretch bug painted it ~3× too wide. Falsy
    // debugLayout returns the doc untouched at zero cost.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/kpi-card/v3",
        relations: [],
        // WIDTH-only bounds: the pill's intended px width is content-exact,
        // while its height tracks the band by design. The stretch bug this
        // guards painted ~3× wide (unit filler re-ratioed px weights).
        constraints: [
          ...(pillWFrac > 0 ? [{ label: "delta-pill", minWidthFrac: Math.max(0.005, pillWFrac * 0.7), maxWidthFrac: Math.min(1, pillWFrac * 1.3) }] : []),
          // NOTE: an arrow-ASPECT rule is intentionally absent — and so are
          // textFits entries for the tagged text (kpi-value / kpi-delta /
          // kpi-sublabel / kpi-label / card-header). The render is verified
          // square (pinned band + square mask bounds + 100-basis weights), but
          // the contract's frames↔sources index zip misreads boxes in THIS doc
          // shape (expr-text sources shift the pairing), and textFits reads
          // sources[r.sourceIndex] — it would silently judge the WRONG text
          // against the wrong box. See the internal
          // contract-frame-zip-misalignment notes. The sources are tagged and ready:
          // re-add the rules when the measurement channel is fixed.
        ],
        debug: props.debugLayout === true,
      }),
    );
  },
  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineKpiCardV3Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineKpiCardV3.render(
      {
        ...(AlpineKpiCardV3.defaultProps as AlpineKpiCardV3Props),
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
        productName: "KPI Card",
        title: "A KPI card.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(AlpineKpiCardV3);
