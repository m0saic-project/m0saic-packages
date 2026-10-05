import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/leaderboard/v2 — Alpine Leaderboard (friendly mobile-marketing)
 * ============================================================================
 *
 * A ranked list inside the Alpine white card: each row is a RANK BADGE (gold /
 * silver / bronze for the podium, muted for the rest) + a name + a value. Rows
 * auto-sort by value (descending) so the rank reflects the score; the top three
 * get a soft medal-tinted row wash. STANDALONE Alpine brand flavor.
 *
 * Construction follows the bar-graph / progress-card model — real m0 cells via
 * row/col splits + rounded `makeColorTile`s, NO inline-mask geometry. Every
 * height weight is snapped to a multiple of 8 so the nested row splits stay
 * quantization-feasible at any resolution. Animation: rows cascade-fade in and
 * the values count up; `anim.reduceMotion` → the static final board.
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
  withLayoutContract,
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeIncompleteMosaic,
  animateNumbersInText,
  fadeInExpr,
  bindPropPath,
  bindProps,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";

import {
  alpineCard,
  paint,
  EMPTY,
  rowSplit,
  colSplit,
  overlay,
  textCell,
  tag,
  resolveColor,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate } from "../../_shared/alpine-anim";
import { bBool, bStr, bEnum, ALPINE_ANIM_FIELDS_BARE, ALPINE_ANIM_UNBOUND, ALPINE_THEME_UNBOUND, bindHeaderAddHandles, bindCardSurface } from "../../_shared/alpine-conventions";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type LeaderItem = { name: string; value: number; valueLabel?: string; color?: MosaicColor };
/** Reveal cost/quality dial. "premium" (default): rows cascade in via `overlay.alpha`
 *  (a geq per faded leaf). "light": the same cascade via free enable-gate pops — no
 *  geq, composable, cheap when nested. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; reduceMotion: boolean; introFrac: number; countUp: boolean; easing: EaseName };

type AlpineLeaderboardV2Props = {
  // ── Primary props (flat) ──
  items: LeaderItem[];
  title?: string;
  subtitle?: string;
  valuePrefix?: string;
  valueSuffix?: string;
  preset?: AlpinePreset;
  /** Keep the caller's order instead of auto-sorting by value (descending). */
  preSorted?: boolean;
  /** Tint the podium (top-3) rows with their medal color. */
  podiumTint?: boolean;
  showValue?: boolean;
  // ── Grouped props ──
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert every row rendered the same size. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: false };
const MAX_ROWS = 8;

// Rank badge / row-wash colors: gold · grey · brown for the podium, a neutral for
// everyone below. THEME-AWARE — on the light card the 2nd-place + rest tones are
// DARK (read on white); on the dark card they flip to LIGHT (read on navy), so the
// row washes never glare or vanish.
const MEDALS_LIGHT: MosaicColor[] = ["#F59E0B", "#1E293B", "#B45309"]; // gold · near-black · brown
const MEDALS_DARK: MosaicColor[] = ["#F59E0B", "#64748B", "#D97706"]; //  gold · muted slate silver · light bronze
const REST_LIGHT: MosaicColor = "#E2E8F0"; // light grey on white
const REST_DARK: MosaicColor = "#334155"; //  dark slate on navy

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tcell(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign, vAlign: "middle" } as any }] };
}
function exprCell(expr: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right"): MosaicTextSource {
  return { type: "text", renderMode: { kind: "video" }, visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign, vAlign: "middle" } as any }] };
}
function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}

/** Relative luminance test → readable text color on a colored badge. */
function onColor(hex: MosaicColor, light: MosaicColor, dark: MosaicColor): MosaicColor {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return light;
  const v = parseInt(m[1], 16);
  const lum = (0.2126 * ((v >> 16) & 0xff) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)) / 255;
  return lum > 0.6 ? dark : light;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineLeaderboardV2Props>({
  items: { type: "array" as any, required: true, meta: { control: { flavor: "objectRows", columns: [{ label: "Name", key: "name", kind: "text", placeholder: "Entry" }, { label: "Value", key: "value", kind: "number" }, { label: "Display", key: "valueLabel", kind: "text", placeholder: "auto" }, { label: "Color", key: "color", kind: "color" }] } } },
  // ── Flat props grouped by control type (text → enum → toggles). ──
  title: { type: "string", required: false },
  subtitle: { type: "string", required: false },
  valuePrefix: { type: "string", required: false },
  valueSuffix: { type: "string", required: false },
  preset: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "dark"] } } },
  showValue: { type: "boolean", required: false },
  podiumTint: { type: "boolean", required: false },
  preSorted: { type: "boolean", required: false },

  // ── Collapsible groups. ──
  anim: {
    type: "group" as any, required: false,
    fields: {
      renderMode: bEnum(["premium", "light"]),
      reduceMotion: ALPINE_ANIM_FIELDS_BARE.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS_BARE.introFrac,
      countUp: bBool(),
      easing: ALPINE_ANIM_FIELDS_BARE.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false,
    fields: { slug: bStr(), preset: bStr(), namespace: bStr(), forceFetch: bBool() },
  } as any,
  debugLayout: { type: "boolean", required: false },
});

export const AlpineLeaderboardV2: MosaicTemplate<AlpineLeaderboardV2Props> = {
  id: asTemplateId("@m0saic/alpine/leaderboard/v2"),
  version: 2,
  capabilities: { tier: "core" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000, posterTimeMs: 1900 },
  bindings: { unbound: { ...ALPINE_THEME_UNBOUND, ...ALPINE_ANIM_UNBOUND } },
  propsSchema,

  defaultProps: {
    preSorted: false,
    debugLayout: false,
    theme: { forceFetch: false },
    items: [
      { name: "Ava Chen", value: 2840 },
      { name: "Liam Patel", value: 2615 },
      { name: "Noah Kim", value: 2390 },
      { name: "Mia Garcia", value: 1975 },
      { name: "Ethan Wright", value: 1640 },
    ],
    title: "TOP CONTRIBUTORS",
    subtitle: "This month",
    preset: DEFAULT_PRESET,
    podiumTint: true,
    showValue: true,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineLeaderboardV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    // Keep each item's ORIGINAL index into props.items: the board auto-sorts by
    // value (and filters / truncates), so the leaf bindings (Make's double-click
    // edit of items[i].name / value) must address the prop value, never the
    // drawn rank order.
    const rawEntries = (props.items ?? [])
      .map((it, srcIndex) => ({ it, srcIndex }))
      .filter(({ it }) => it && typeof it.name === "string" && Number.isFinite(it.value));
    if (rawEntries.length === 0) {
      return makeIncompleteMosaic("Add a row — each one needs a name and a value.", { title: "Leaderboard", width: W, height: H });
    }

    // Theming: the shared alpine theme (light default). A producer overrides tokens
    // via props.theme; explicit colors still win. Unthemed → byte-identical.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    const showValue = props.showValue ?? true;
    const podiumTint = props.podiumTint ?? true;

    const isDark = (props.preset ?? DEFAULT_PRESET) === "dark";
    const medals = isDark ? MEDALS_DARK : MEDALS_LIGHT;
    const restGrey = isDark ? REST_DARK : REST_LIGHT;

    const entries = (props.preSorted ? rawEntries.slice() : rawEntries.slice().sort((a, b) => b.it.value - a.it.value)).slice(0, MAX_ROWS);
    const items = entries.map((e) => e.it);
    const N = items.length;
    // Leaf binding into the `items` prop for the rect that shows a field (ORIGINAL index).
    const bindItem = <T extends MosaicSource>(src: T, i: number, field: string, kind: "string" | "number"): T =>
      bindPropPath(src, "items", [entries[i].srcIndex, field], kind);
    const valueText = (it: LeaderItem) =>
      it.valueLabel != null && it.valueLabel !== "" ? it.valueLabel : `${props.valuePrefix ?? ""}${Math.round(it.value).toLocaleString("en-US")}${props.valueSuffix ?? ""}`;
    const badgeColor = (i: number): MosaicColor => resolveColor(items[i].color, i < 3 ? medals[i] : restGrey);

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelay = Math.min(0.12, introT * 0.08);
    const CASCADE = 0.5;
    const rowDur = Math.max(0.05, (introT - introDelay) / (1 + CASCADE * Math.max(0, N - 1)));
    const rowStagger = CASCADE * rowDur;

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;
    const CH = cr.h;

    const nameFont = Math.max(13, Math.round(H * 0.03));
    // Width-capped to the value column (20% of content width): the H-scaled
    // font left-clipped values at narrow canvases ("900 kg" → "00 kg" at
    // 480×1040). Binds only when the longest formatted value would overflow.
    const longestValue = Math.max(1, ...items.map((it) => valueText(it).length));
    const valueColPx = (W - 2 * Math.round(Math.min(W, H) * 0.055)) * 0.20 * 0.92;
    const valueFont = Math.max(11, Math.min(Math.round(H * 0.032), Math.floor(valueColPx / (longestValue * 0.62))));
    const rankFont = Math.max(11, Math.round(H * 0.026));

    // Snap height weights to 8 → the nested row splits GCD-collapse and stay
    // quantization-feasible at any resolution (the progress-card lesson).
    const snap8 = (v: number) => Math.max(8, Math.round(v / 8) * 8);
    const rowH = snap8(Math.min(H * 0.11, (CH - snap8(CH * 0.02) * (N - 1)) / N));
    const rowGap = snap8(Math.max(8, rowH * 0.22));
    const stackH = N * (rowH + rowGap);
    const margin = Math.max(0, snap8((CH - stackH) / 2));

    // Width weights are proportions of the content width (basis ~100). The badge
    // column is sized to ~one row-height so the badge reads as a small square,
    // NOT a pixel weight (which would eat half the row).
    const wWeight = (px: number) => Math.max(1, Math.round((px / cr.w) * 100));
    const padW = wWeight(rowH * 0.2);
    const badgeColW = wWeight(rowH * 0.78);
    const gapW = wWeight(rowH * 0.42);
    const valueW = showValue ? 20 : 0;
    const nameW = Math.max(10, 100 - padW * 2 - badgeColW - gapW - valueW);
    // Width-cap the name font to its column (the valueFont cap's twin —
    // uncapped, "Ethan Wright" @ 720×1280 ran flush into the value column:
    // the text-fit tripwire's catch on the shipped stress-04 render). Binds
    // only when the longest name would overflow.
    const longestName = Math.max(1, ...items.map((it) => (it.name ?? "").length));
    // 0.88, not 0.95: the realized name cell runs a few % under its authored
    // weight share (6-cell split remainder distribution), so the cap targets
    // the realized floor, not the model.
    const nameFontFit = Math.max(11, Math.min(nameFont, Math.floor(((cr.w * nameW) / 100) * 0.88 / (longestName * 0.62))));

    const row = (i: number): Node => {
      const startAtSec = introDelay + i * rowStagger;
      const bc = badgeColor(i);
      const numColor = i < 3 ? onColor(bc, "#FFFFFF", theme.title) : theme.label;
      // rank badge: a rounded medal tile + centered rank number, inset to a square
      // (~64% of the row height, vertically centered).
      const badge = overlay([
        // v2: the badge's FILL is the row's own `color` (else the medal) → a colour handle to set one.
        paint(bindPropPath(tag(makeColorTile(bc, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.32 } } }) as MosaicSource, "badge"), "items", [entries[i].srcIndex, "color"], "color")),
        paint(tag(tcell(String(i + 1), rankFont, numColor, "center"), "rank")),
      ]);
      const badgeCell = rowSplit([{ weight: 1, node: EMPTY }, { weight: 3, node: badge }, { weight: 1, node: EMPTY }]);

      const nameNode = paint(bindItem(tag(tcell(items[i].name, nameFontFit, theme.title, "left"), "row-name"), i, "name", "string"));
      // The countUp path is expr content — textFits skips it by design (nothing
      // static to measure); the static path carries the same tag and IS checked.
      // One rect, one binding: it may SHOW `valueLabel`, but the primary leaf it
      // displays is the raw `value` (the sort key; Make seeds from the number).
      // v2: the rect also carries what ELSE it shows — the row's Display string
      // when it has one, else the shared prefix / suffix around the number.
      const hasDisplay = items[i].valueLabel != null && items[i].valueLabel !== "";
      const bindValue = <T extends MosaicSource>(src: T): T => bindProps(src, [
        { propKey: "items", path: [entries[i].srcIndex, "value"], kind: "number" },
        ...(hasDisplay
          ? [{ propKey: "items", path: [entries[i].srcIndex, "valueLabel"], kind: "string" as const }]
          : [{ propKey: "valuePrefix" }, { propKey: "valueSuffix" }]),
      ]);
      const valueNode = showValue
        ? (anim.countUp && animate && /\d/.test(valueText(items[i]))
            ? paint(bindValue(tag(exprCell(animateNumbersInText(valueText(items[i]), { startSec: startAtSec, durationSec: rowDur, ease: anim.easing }), valueFont, theme.subtitle, "right"), "row-value")))
            : paint(bindValue(tag(tcell(valueText(items[i]), valueFont, theme.subtitle, "right"), "row-value"))))
        : EMPTY;

      // [pad | badge | gap | name | value | pad] — proportional width weights.
      const content = colSplit([
        { weight: padW, node: EMPTY },
        { weight: badgeColW, node: badgeCell },
        { weight: gapW, node: EMPTY },
        { weight: nameW, node: nameNode },
        ...(showValue ? [{ weight: valueW, node: valueNode }] : []),
        { weight: padW, node: EMPTY },
      ]);

      // Every row gets a soft wash: the podium its medal color (low alpha), the
      // rest a light grey (higher alpha — light grey needs more to read on white).
      // Opacity rides on overlay.alpha (makeColorTile ignores `visual`).
      const washAlpha = i < 3 ? 0.12 : 0.55;
      const washTile = makeColorTile(bc, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.18 } }, overlay: { alpha: `${washAlpha}` } }) as MosaicSource;
      // "row" tag = the layout contract's join key (equal-size relation).
      (washTile as MosaicSource & { editor?: { label?: string } }).editor = { label: "row" };
      const rowNode = podiumTint
        ? overlay([paint(washTile), content])
        : content;

      // Cascade-fade the whole row in by fading its painted leaves. We re-walk
      // the row's sources and stamp the fade; simplest is to fade the content's
      // leaves at build time — done above per-leaf via the value count-up + here
      // for name/badge.
      // premium fades the row leaves (geq); light enable-gates them (no geq); static otherwise.
      return animate ? (light ? wrapGate(rowNode, startAtSec) : wrapFade(rowNode, startAtSec, rowDur)) : rowNode;
    };

    // One EQUAL band per row, half-gap carved INSIDE by a [1, rowU, 1] split —
    // the interleaved [margin,row,gap,row,…] stack starves the CENTER rows
    // under ancestor drift (the pack-wide outside-in class; equal split
    // guarantees ≤1px, verified by the contract below).
    const rowU = Math.max(2, Math.round((2 * rowH) / Math.max(1, rowGap)));
    const stack = rowSplit(Array.from({ length: N }, (_, i) => ({
      weight: 1,
      node: rowSplit([
        { weight: 1, node: EMPTY },
        { weight: rowU, node: row(i) },
        { weight: 1, node: EMPTY },
      ]),
    })));
    const bands: Band[] = [];
    if (margin > 0) bands.push({ weight: margin, node: EMPTY });
    bands.push({ weight: N * (rowH + rowGap), node: stack });
    if (margin > 0) bands.push({ weight: margin, node: EMPTY });

    const root = card.compose(rowSplit(bands));
    // v2: a header that is missing (or half there) can be added from the canvas.
    bindHeaderAddHandles(root.sources as MosaicSource[], props, "row-name");

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

    // Dev tripwire: every row must render the SAME size (equal-band promise;
    // podiumTint off = no wash tiles → no relation members, trivially green).
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/leaderboard/v2",
        relations: podiumTint && N >= 2 ? [{ label: "row", equal: "size", tolerance: 0.02, tolerancePx: 1 }] : [],
        // Text-fit tripwires at the pack's 0.62em width model (the same model
        // the valueFont cap is built on).
        constraints: [
          ...card.constraints,
          { label: "rank", textFits: { charWidthEm: 0.62 } },
          { label: "row-name", textFits: { charWidthEm: 0.62 } },
          ...(showValue ? [{ label: "row-value", textFits: { charWidthEm: 0.62 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );

    // Fade every painted leaf of a row Node (stamps overlay.alpha; preserves an
    // existing per-leaf overlay like the value count-up alpha if present).
    function wrapFade(node: Node, startSec: number, durSec: number): Node {
      return { m0: node.m0, sources: node.sources.map((s) => ((s as { overlay?: { alpha?: string } }).overlay?.alpha ? s : fadeIn(s, startSec, durSec, true))) };
    }
    // The geq-free analog: enable-gate each leaf at `startSec` (no per-pixel alpha
    // fold) so the row pops in. Constant-alpha row washes are gated too.
    function wrapGate(node: Node, startSec: number): Node {
      return { m0: node.m0, sources: node.sources.map((s) => ((s as { overlay?: { enable?: string } }).overlay?.enable ? s : revealGate(s, startSec, true))) };
    }
  },
  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineLeaderboardV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineLeaderboardV2.render(
      {
        ...(AlpineLeaderboardV2.defaultProps as AlpineLeaderboardV2Props),
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
        productName: "Leaderboard",
        title: "A leaderboard.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(AlpineLeaderboardV2);
