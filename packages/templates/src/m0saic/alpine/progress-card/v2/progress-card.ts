import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/progress-card/v2 — Alpine Progress Card (friendly mobile-marketing)
 * ============================================================================
 *
 * A goal-tracker card: a vertical list of progress rows, each a label + value
 * over a rounded TRACK with a colored FILL grown to its fraction. STANDALONE
 * Alpine brand flavor (white rounded card chrome + soft palette).
 *
 * Construction follows the bar-graph model — real m0 cells via row/col splits +
 * rounded `makeColorTile`s, NO inline-mask geometry. The fill grows left→right
 * via an overlay translate clipped by a plot child doc (the proven bar-graph
 * grow); the value counts up. `anim.reduceMotion` → the static final card.
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
  makeIncompleteMosaic,
  animateNumbersInText,
  u01,
  easingExpr,
  withLayoutContract,
  textEmUnits,
  bindProp,
  bindProps,
  bindPropPath,
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
import { resolveAlpineTheme, ALPINE_PALETTE, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate } from "../../_shared/alpine-anim";
import { bBool, bStr, bFrac, ALPINE_ANIM_FIELDS_BARE, ALPINE_ANIM_UNBOUND, ALPINE_THEME_UNBOUND, bindHeaderAddHandles, bindCardSurface } from "../../_shared/alpine-conventions";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type ProgressItem = { label: string; value: number; max?: number; valueLabel?: string; color?: MosaicColor };
type AnimConfig = { introFrac: number; countUp: boolean; easing: EaseName; reduceMotion: boolean };

type AlpineProgressCardV2Props = {
  // ── Primary props (flat) ──
  items: ProgressItem[];
  title?: string;
  subtitle?: string;
  preset?: AlpinePreset;
  showValue?: boolean;
  /** Override the per-item bar color for ALL rows (per-item `color` still wins). */
  barColor?: MosaicColor;
  trackColor?: MosaicColor;
  // ── Grouped props ──
  /** Bar/track rounding (0..1). */
  bars?: { cornerRadius?: number };
  anim?: AnimConfig;
  /** Opt-in producer theming (mirrors the charts). Preset is the fallback; a
   *  producer's published tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert tracks equal-size + text fits its slot. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RADIUS = 0.5;
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: false };
const MAX_ITEMS = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rightText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign: "right", vAlign: "middle" } as any }] };
}
function rightExprText(expr: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", renderMode: { kind: "video" }, visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign: "right", vAlign: "middle" } as any }] };
}
function leftText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign: "left", vAlign: "middle" } as any }] };
}
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Pre-format an item's value display when `valueLabel` isn't given. */
function deriveValueLabel(item: ProgressItem, frac: number): string {
  if (item.valueLabel != null && item.valueLabel !== "") return item.valueLabel;
  return `${Math.round(frac * 100)}%`;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineProgressCardV2Props>({
  items: { type: "array" as any, required: true, meta: { control: { flavor: "objectRows", columns: [{ label: "Label", key: "label", kind: "text", placeholder: "Goal" }, { label: "Value", key: "value", kind: "number" }, { label: "Max", key: "max", kind: "number" }, { label: "Display", key: "valueLabel", kind: "text", placeholder: "auto (%)" }, { label: "Color", key: "color", kind: "color" }], palette: ALPINE_PALETTE as unknown as string[] } } },
  // ── Flat props grouped by control type (text → enum → toggle → colors). ──
  title: { type: "string", required: false },
  subtitle: { type: "string", required: false },
  preset: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "dark"] } } },
  showValue: { type: "boolean", required: false },
  barColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true, defaultColor: "#2563EB" } } },
  trackColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true, defaultColor: "#E2E8F0" } } },

  // ── Collapsible groups (the slider lives here, not intermixed with the flat props). ──
  bars: {
    type: "group" as any, required: false,
    fields: { cornerRadius: bFrac() },
  } as any,
  anim: {
    type: "group" as any, required: false,
    fields: { ...ALPINE_ANIM_FIELDS_BARE, countUp: bBool() },
  } as any,
  theme: {
    type: "group" as any, required: false,
    fields: { slug: bStr(), preset: bStr(), namespace: bStr(), forceFetch: bBool() },
  } as any,
  debugLayout: { type: "boolean", required: false },
});

export const AlpineProgressCardV2: MosaicTemplate<AlpineProgressCardV2Props> = {
  id: asTemplateId("@m0saic/alpine/progress-card/v2"),
  version: 2,
  capabilities: { tier: "core" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000, posterTimeMs: 1900 },
  propsSchema,
  bindings: { unbound: { ...ALPINE_THEME_UNBOUND, ...ALPINE_ANIM_UNBOUND } },

  defaultProps: {
    debugLayout: false,
    theme: { forceFetch: false },
    items: [
      { label: "Q4 Sales", value: 68 },
      { label: "New Users", value: 84 },
      { label: "Retention", value: 92 },
      { label: "NPS Target", value: 45 },
    ],
    title: "QUARTERLY GOALS",
    subtitle: "Progress to target",
    preset: DEFAULT_PRESET,
    bars: { cornerRadius: DEFAULT_RADIUS },
    showValue: true,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineProgressCardV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    // Keep each drawn item's ORIGINAL index into props.items: the leaf bindings
    // (Make's double-click edit of items[i].label / value) must address the prop
    // value, not the filtered / truncated draw order.
    const itemEntries = (props.items ?? [])
      .map((it, srcIndex) => ({ it, srcIndex }))
      .filter(({ it }) => it && typeof it.label === "string")
      .slice(0, MAX_ITEMS);
    const items = itemEntries.map((e) => e.it);
    if (items.length === 0) {
      return Promise.resolve(makeIncompleteMosaic("Add a row — each one needs a label and a value.", { title: "Progress Card", width: W, height: H }));
    }

    // Theming: preset is the fallback; a producer's published tokens override it.
    // Unthemed → byte-identical to the old alpineTheme(preset) path.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const radius = Math.max(0, Math.min(1, props.bars?.cornerRadius ?? DEFAULT_RADIUS));
    const showValue = props.showValue ?? true;
    const trackColor = resolveColor(props.trackColor, theme.grid);
    const animate = !anim.reduceMotion;

    const N = items.length;
    const fracs = items.map((it) => (it.max && it.max > 0 ? clamp01(it.value / it.max) : clamp01(it.value / 100)));
    const colors: MosaicColor[] = items.map((it, i) => resolveColor(it.color ?? props.barColor, ALPINE_PALETTE[i % ALPINE_PALETTE.length]));
    const valueLabels = items.map((it, i) => deriveValueLabel(it, fracs[i]));

    // Leaf binding into the `items` prop for the rect that shows a field, at the
    // item's ORIGINAL index. The value text binds the leaf it actually SHOWS: an
    // explicit Display (valueLabel) → that string; a bare value → the number (its
    // "68%" is a formatting of that one leaf); a value/max percentage merges TWO
    // leaves → no binding (those edit in the panel).
    const bindItem = <T extends MosaicSource>(src: T, i: number, field: string, kind: "string" | "number"): T =>
      bindPropPath(src, "items", [itemEntries[i].srcIndex, field], kind);
    const valueLeaf = (it: ProgressItem): { field: "valueLabel" | "value"; kind: "string" | "number" } | null => {
      if (it.valueLabel != null && it.valueLabel !== "") return { field: "valueLabel", kind: "string" };
      if (it.max && it.max > 0) return null;
      return { field: "value", kind: "number" };
    };
    // v2: a value/max percentage shows TWO leaves, so its rect carries both
    // (a stacked value + max form) instead of none.
    const bindValueText = <T extends MosaicSource>(src: T, i: number): T => {
      const leaf = valueLeaf(items[i]);
      if (leaf) return bindItem(src, i, leaf.field, leaf.kind);
      const at = itemEntries[i].srcIndex;
      return bindProps(src, [
        { propKey: "items", path: [at, "value"], kind: "number" },
        { propKey: "items", path: [at, "max"], kind: "number" },
      ]);
    };

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelay = Math.min(0.15, introT * 0.08);
    const CASCADE = 0.45;
    const fillDur = Math.max(0.05, (introT - introDelay) / (1 + CASCADE * Math.max(0, N - 1)));
    const fillStagger = CASCADE * fillDur;

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;
    const CH = cr.h;
    if (cr.w < 60 || CH < 40) {
      return Promise.resolve(makeErrorMosaic("content area too small", { title: `${this.id}`, width: W, height: H }));
    }

    // Width-capped fonts (the pack's 0.62em model, script-aware via
    // textEmUnits — flat .length let "620 из 1000 клиентов" clip its column):
    // the label owns 7/10 of the head row (all of it with showValue off), the
    // value 3/10. ×0.88 targets the REALIZED cell (split quantization runs a
    // few % under the weight model). Floor-bound text ELLIPSIZES — truncated
    // text must FIT, never clip.
    const longestLabel = Math.max(1, ...items.map((it) => textEmUnits(it.label)));
    const longestValue = Math.max(1, ...valueLabels.map((v) => textEmUnits(v)));
    const labelSlotPx = cr.w * (showValue ? 0.7 : 1) * 0.88;
    const valueSlotPx = cr.w * 0.3 * 0.88;
    const labelFont = Math.max(11, Math.min(Math.round(H * 0.026), Math.floor(labelSlotPx / (longestLabel * 0.62))));
    const valueFont = Math.max(11, Math.min(Math.round(H * 0.026), Math.floor(valueSlotPx / (longestValue * 0.62))));
    const fitTo = (t: string, slotPx: number, font: number): string => {
      const maxUnits = Math.max(2, slotPx / (font * 0.62));
      if (textEmUnits(t) <= maxUnits) return t;
      let out = "";
      let used = 1; // reserve one unit for the ellipsis
      for (const ch of t) {
        const u = textEmUnits(ch);
        if (used + u > maxUnits) break;
        out += ch;
        used += u;
      }
      return `${out}…`;
    };
    const fitLabel = (t: string): string => fitTo(t, labelSlotPx, labelFont);
    const fitValue = (t: string): string => fitTo(t, valueSlotPx, valueFont);

    // Row geometry: each item is a stacked block [label+value row | gap | bar].
    // Rows share the content height with inter-row gaps; the bar is a fixed-height
    // band so thickness is consistent regardless of row count.
    // SNAP every height weight to a multiple of 8 so the deeply-nested row splits
    // share a common factor and GCD-collapse — otherwise a coprime pixel weight
    // (e.g. barH=31) blows the engine's minimum-feasible resolution past common
    // sizes (the 1280×800 default rendered fine, but 1024×1024 went infeasible).
    const snap8 = (v: number) => Math.max(8, Math.round(v / 8) * 8);
    const barH = snap8(H * 0.03);
    const headH = snap8(labelFont * 1.5);
    const innerGap = snap8(H * 0.012); //  label↕bar
    const rowH = headH + innerGap + barH;
    const rowGap = snap8(Math.max(rowH * 0.4, (CH - N * rowH) / Math.max(1, N + 1)));
    const stackH = N * rowH + (N - 1) * rowGap;
    const margin = Math.max(0, snap8((CH - stackH) / 2));

    // Quantize the fill split (mirrors bar-graph's Q=100 — finer was unnecessary
    // and worsened feasibility).
    const Q = 100;
    const eased = easingExpr(anim.easing, u01(fillDur));

    // One row's filled bar: track (rounded) with the colored fill overlaid on the
    // left `frac`. The fill grows left→right (overlay translate, clipped by the
    // plot child); reduceMotion → a static fill.
    // The fill's LENGTH is the value — one tile per item — so it binds
    // items[i].value (the primary) with its FILL color as a SECOND entry (Make
    // opens a stacked value + color form). The color entry mirrors the paint
    // expression `it.color ?? props.barColor` above: an item with its own
    // `color` leaf (non-nullish — even blank, that is the leaf resolveColor reads
    // before the palette fallback) binds items[i].color; otherwise `barColor`
    // is what paints every fill and binds here, at its default too (a handle
    // to SET one).
    const fillTile = (i: number, startAtSec: number): Node => {
      const color = colors[i];
      const effects = { rounding: { cornerStyle: "rounded" as const, borderRadius: radius } };
      const tile = animate
        // Grow left→right via the overlay translate (the slide IS the grow); no
        // `alpha` — the fade was a redundant per-pixel geq (R3/R4). Opaque grow.
        ? makeColorTile(color, { effects, overlay: { startAtSec, xExpr: `-(w*(1-(${eased})))` } })
        : makeColorTile(color, { effects });
      const srcIndex = itemEntries[i].srcIndex;
      return paint(bindProps(tile as MosaicSource, [
        { propKey: "items", path: [srcIndex, "value"], kind: "number" },
        items[i].color != null
          ? { propKey: "items", path: [srcIndex, "color"], kind: "color" }
          : { propKey: "barColor" },
      ]));
    };

    const barRow = (i: number): Node => {
      const startAtSec = introDelay + i * fillStagger;
      const fillU = Math.max(0, Math.min(Q, Math.round(fracs[i] * Q)));
      const restU = Q - fillU;
      // "track" tag = the layout contract's join key (equal-size relation). Every
      // track's FILL is `trackColor` (1:N) → each binds it (Make's color picker).
      // v2: the track also SHOWS the bar rounding → `bars.cornerRadius` rides it.
      const track = paint(bindProps(tag(makeColorTile(trackColor, { effects: { rounding: { cornerStyle: "rounded", borderRadius: radius } } }) as MosaicSource, "track"), [{ propKey: "trackColor" }, { propKey: "bars.cornerRadius" }]));
      const fill = fillU > 0
        ? colSplit([{ weight: fillU, node: fillTile(i, startAtSec) }, ...(restU > 0 ? [{ weight: restU, node: EMPTY as Node }] : [])])
        : EMPTY;
      return overlay([track, fill]);
    };

    const rowBlock = (i: number): Node => {
      const startAtSec = introDelay + i * fillStagger;
      const labelNode = paint(bindItem(revealGate(tag(leftText(fitLabel(items[i].label), labelFont, theme.label), "row-label"), startAtSec, animate), i, "label", "string"));
      // The countUp path is expr content — textFits skips it by design; the
      // static path carries the same tag and IS checked.
      const valueNode = showValue
        ? (anim.countUp && animate && /\d/.test(valueLabels[i])
            ? paint(bindValueText(tag(rightExprText(animateNumbersInText(fitValue(valueLabels[i]), { startSec: startAtSec, durationSec: fillDur, ease: anim.easing }), valueFont, theme.title), "row-value"), i))
            : paint(bindValueText(revealGate(tag(rightText(fitValue(valueLabels[i]), valueFont, theme.title), "row-value"), startAtSec, animate), i)))
        : EMPTY;
      const head = showValue
        ? colSplit([{ weight: 7, node: labelNode }, { weight: 3, node: valueNode }])
        : labelNode;
      return rowSplit([
        { weight: headH, node: head },
        { weight: innerGap, node: EMPTY },
        { weight: barH, node: barRow(i) },
      ]);
    };

    // One EQUAL band per row, half-gap carved INSIDE via a [1, rowU, 1] split —
    // the interleaved [margin, rowH, rowGap, rowH, …] px stack let the engine's
    // outside-in remainder starve rows unevenly (track heights spread 16% at
    // 900×900 defaults; the equal-size tripwire's catch). The established
    // pack pattern (donut legend / leaderboard / contributor cards).
    const rowU = Math.max(2, Math.round((2 * rowH) / Math.max(1, rowGap)));
    const rowBand = (i: number): Node => rowSplit([
      { weight: 1, node: EMPTY },
      { weight: rowU, node: rowBlock(i) },
      { weight: 1, node: EMPTY },
    ]);
    const stack = rowSplit(Array.from({ length: N }, (_, i): Band => ({ weight: 1, node: rowBand(i) })));
    const content = margin > 0
      ? rowSplit([{ weight: margin, node: EMPTY }, { weight: stackH, node: stack }, { weight: margin, node: EMPTY }])
      : stack;

    // Clip the growing fills to the content box (the translate would otherwise
    // overflow the card's left edge). Static skips the child doc.
    const childDocs: Record<string, MosaicDocument> = {};
    let contentNode: Node = content;
    if (animate) {
      childDocs.plot = { kind: "mosaic_document", version: 1, assets: {} as any, m0: content.m0 as any, sources: content.sources, fps: ctx.target.fps, durationMs: ctx.target.durationMs } as MosaicDocument;
      contentNode = { m0: "F", sources: [{ type: "mosaic", ref: "plot" } as unknown as MosaicSource] };
    }

    const root = card.compose(contentNode);
    // v2: a header that is missing (or half there) can be added from the canvas.
    bindHeaderAddHandles([...root.sources, ...content.sources], props, "row-label");

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      // The card surface is a handle for `preset` (bindCardSurface) — a full-canvas
      // card that nothing binds is a dead click target (founder, 2026-10-01).
      sources: bindCardSurface(root.sources),
      ...(Object.keys(childDocs).length ? { children: childDocs } : {}),
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire: every track paints the same size (the row lattice's core
    // promise), and label/value text FITS its slot at the CLI's metrics.
    // Falsy debugLayout (default) returns the doc untouched at zero cost.
    // Text-fit is GATED on the doc being expr-free: countUp mints one
    // expr-text source per row, which shifts the contract's frames↔sources
    // zip (the internal contract-frame-zip-misalignment notes) —
    // static docs (reduceMotion / countUp off / no digits) get the full checks.
    const hasExprText = anim.countUp && animate && showValue && valueLabels.some((v) => /\d/.test(v));
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/progress-card/v2",
        relations: N >= 2 ? [{ label: "track", equal: "size", tolerance: 0.02, tolerancePx: 1 }] : [],
        constraints: hasExprText ? [] : [
          ...card.constraints,
          { label: "row-label", textFits: { charWidthEm: 0.62 } },
          ...(showValue ? [{ label: "row-value", textFits: { charWidthEm: 0.62 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineProgressCardV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineProgressCardV2.render(
      {
        ...(AlpineProgressCardV2.defaultProps as AlpineProgressCardV2Props),
        anim: { ...DEFAULT_ANIM, reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Progress Card",
        title: "A progress card.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(AlpineProgressCardV2);
