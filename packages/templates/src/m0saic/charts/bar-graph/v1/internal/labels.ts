/**
 * ============================================================================
 * @m0saic/charts/bar-graph/internal/labels/v1
 * ============================================================================
 *
 * Labels owns the chart's BANDED CONTENT LAYOUT — title band, plot region,
 * category-label band, and value-axis tick rail. All structure is expressed
 * through m0 (weightedSplit + container); no FFmpeg xExpr/yExpr positioning,
 * no placement.inset gymnastics. The layout is described the way a human
 * would describe it ("title on top, ticks on the left, bars in the middle,
 * day labels on the bottom"); m0 carries the geometry.
 *
 * Vertical orientation (labelDock="bottom"):
 *
 *   row split (3 bands, weights derived from chart padding):
 *     ├── title-band:    "2[1,1]" if subtitle exists, else "1"
 *     │                     title text  (top sub-row)
 *     │                     subtitle    (bottom sub-row)
 *     ├── body:          2-col split  [tick-rail | plot]   when ticks on
 *     │                  else just     "1"                  (plot only)
 *     │                  tick rail = row split (M ticks + gaps)
 *     └── label-band:    2-col split  [empty | N-cat-rail]  when ticks on
 *                        else         "N(1,1,...)"           (labels span full width)
 *
 * Horizontal orientation (labelDock="left"):
 *
 *   row split (3 bands):
 *     ├── title-band:    same as vertical
 *     ├── body:          2-col split  [category-rail | plot]   if labels
 *     │                  else         "1"                       (plot only)
 *     └── tick-band:     2-col split  [empty | tick-rail]       when ticks on
 *                        (matches body's category-rail / plot weights so the
 *                         tick rail aligns under the plot, not the cat rail)
 *
 * Bands collapse out when their content is absent (no title → no title band,
 * no labels → no label band, no ticks → no tick rail in body / no tick band).
 *
 * Tick values are computed deterministically from props.minValue / maxValue /
 * gridCount: tickCount = gridCount + 1, evenly spaced from min..max. For
 * vertical bars the rail is ordered top-down (max → min). For horizontal,
 * left-to-right (min → max). Formatting honors props.valueLabels.format and
 * decimals (same surface as the per-bar value labels for consistency).
 *
 * NOTE — future builder candidate. The "banded split with optional before /
 * after sections" idiom keeps recurring; extract `bandedSplit({ before,
 * content, after, axis })` to dsl-stdlib once a second consumer arrives.
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplate,
  MosaicTextSource,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
} from "@m0saic/template-utils";
import { container, weightedSplit } from "@m0saic/dsl-stdlib";
import { isSmooth } from "@m0saic/template-utils";
import type { BarGraphPreset, LabelsProps } from "../types";
import { DEFAULT_VALUE_LABELS } from "../defaults";
import { formatValue } from "../format";

export const LABELS_TEMPLATE_ID = asTemplateId("@m0saic/charts/bar-graph/internal/labels/v1");

const propsSchema = definePropsSchema<LabelsProps>({
  axisConfig: {
    type: "group" as any,
    required: true,
    description: "Resolved axis configuration; drives orientation (vertical vs horizontal layout).",
  },
  title: { meta: { control: { placeholder: "none" } }, type: "string", required: false, description: "Chart title text." },
  subtitle: { meta: { control: { placeholder: "none" } }, type: "string", required: false, description: "Chart subtitle text." },
  labels: {
    type: "string[]",
    required: false,
    description: "Per-bar category labels (rendered in the layout-axis band).",
  },
  values: {
    type: "number[]",
    required: true,
    description: "Raw values (parallel to labels; bar count comes from values.length).",
  },
  minValue: { type: "number", required: true, description: "Resolved domain min." },
  maxValue: { type: "number", required: true, description: "Resolved domain max." },
  padding: {
    type: "group" as any,
    required: true,
    description: "Canvas-relative padding fractions; drive band weights in the m0 layout.",
  },
  gap: { type: "number", required: true, description: "Pixel gap between bars (forwarded)." },
  preset: {
    type: "string",
    required: true,
    description: "Theme preset; drives label text color so labels stay legible.",
    meta: { constraints: { oneOf: ["neutral", "dark", "terminal", "glass", "paper"] } },
  },
  valueLabels: {
    type: "group" as any,
    required: true,
    description: "Value label display config (drives tick formatting too).",
  },
  gridCount: {
    type: "number",
    required: true,
    description: "Number of grid intervals; tick rail emits gridCount+1 ticks.",
    meta: { constraints: { min: 1 } },
  },
  showValueTicks: {
    type: "boolean",
    required: true,
    description: "Whether to render the value-axis tick numbers in the rail.",
  },
  plotAreaRef: {
    type: "string",
    required: true,
    description: "Child renderable key for the plot area (BarsStack + grid + baseline + value axis).",
  },
});

// ---------------------------------------------------------------------------
// Preset text tokens.
// ---------------------------------------------------------------------------

type TextTokens = {
  title: MosaicColor;
  subtitle: MosaicColor;
  category: MosaicColor;
  tick: MosaicColor;
};

function textTokensForPreset(preset: BarGraphPreset): TextTokens {
  switch (preset) {
    case "dark":
      return { title: "#f1f5f9", subtitle: "#94a3b8", category: "#cbd5e1", tick: "#94a3b8" };
    case "terminal":
      return { title: "#22c55e", subtitle: "#15803d", category: "#22c55e", tick: "#15803d" };
    case "glass":
      return { title: "#f1f5f9", subtitle: "#cbd5e1", category: "#cbd5e1", tick: "#94a3b8" };
    case "paper":
      return { title: "#0f172a", subtitle: "#475569", category: "#334155", tick: "#64748b" };
    case "neutral":
    default:
      return { title: "#f1f5f9", subtitle: "#94a3b8", category: "#cbd5e1", tick: "#94a3b8" };
  }
}

// Font size fractions of canvas height.
const TITLE_FONT_FRAC = 0.046;
const SUBTITLE_FONT_FRAC = 0.022;
const CATEGORY_FONT_FRAC = 0.018;
const TICK_FONT_FRAC = 0.016;

// Convert a canvas-fraction (0..1) to a small integer band weight,
// clamped to a minimum of 1 (weightedSplit demands positive integers).
const toBandWeight = (frac: number): number =>
  Math.max(1, Math.round(frac * 100));

// Tick-rail column floor (canvas-percent units) — same idea as the horizontal
// category-rail floor: chart padding is too narrow for axis numbers.
const MIN_VERTICAL_TICK_RAIL_WEIGHT = 8;
const MIN_HORIZONTAL_CAT_RAIL_WEIGHT = 12;
const MIN_HORIZONTAL_TICK_BAND_WEIGHT = 6;

// Right-padding inside each vertical tick-label cell — fraction of the cell
// width. Pulls the right-aligned numbers leftward from the plot's left edge
// so they aren't crowding the data.
const VERTICAL_TICK_RIGHT_PAD = 0.18;

// Weights for the tick rail's internal layout.
//
// All tick cells share the same width — uniform tick label spacing across
// the rail, pitch T + G = 97 slots between consecutive label centres.
//
// Pattern (M=6 ticks, 5 gaps):
//   [T, G, T, G, T, G, T, G, T, G, T] = 6·T + 5·G = 6·15 + 5·82 = 500
//
// The total is the rail's split count, and the latticeSmooth convention holds
// every count above 12 to 5-smooth (2ᵃ3ᵇ5ᶜ): the original 6·14 + 5·83 = 499
// (prime — it once matched a 5·99 + 4 plot grid that no longer exists) cost
// LCM 59,880 against the 120 lattice. tickRailWeights keeps the pitch and the
// ≈ 14 % tick share, and nudges G (then the pitch) until M·T + (M−1)·G is
// 5-smooth for the tick count actually requested.
//
// Trade-off vs. the prior edge-pinned design (T_E=10, T_M=21, G=79): edge
// labels (top/bottom) drift up to ~1.5% of plot height from the value-axis
// and baseline edge lines. We accept that to eliminate the 5.8% spacing
// asymmetry between outer (94.5) and inner (100) tick gaps — uniform
// label spacing is what the eye reads as "well-laid-out".
const TICK_PITCH = 97;
const TICK_SHARE = 14 / 97;

/** `{ tick, gap }` slot weights for M ticks whose rail total M·tick + (M−1)·gap is 5-smooth. */
function tickRailWeights(M: number): { tick: number; gap: number } {
  const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4];
  for (const dp of steps) {
    const pitch = TICK_PITCH + dp;
    const tick0 = Math.round(pitch * TICK_SHARE);
    for (const dt of steps) {
      const tick = tick0 + dt;
      const gap = pitch - tick;
      if (tick < 1 || gap < 1) continue;
      if (isSmooth(M * tick + (M - 1) * gap)) return { tick, gap };
    }
  }
  return { tick: Math.round(TICK_PITCH * TICK_SHARE), gap: TICK_PITCH - Math.round(TICK_PITCH * TICK_SHARE) };
}

type VAlign = "top" | "middle" | "bottom";
type HAlign = "left" | "center" | "right";

type TextPaddingFrac = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

function makeTextSource(
  text: string,
  fontSize: number,
  color: MosaicColor,
  hAlign: HAlign = "center",
  vAlign: VAlign = "middle",
  padding?: TextPaddingFrac,
): MosaicTextSource {
  const placement: any = { fit: "contain", hAlign, vAlign };
  if (padding) placement.padding = padding;
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text },
        style: { fontSize, fontColor: color },
        placement,
      },
    ],
  };
}

// Title + subtitle in a SINGLE rect via two text layers. Layout-DSL is wrong for
// this — stacking is a text concern, so subtitle sits below title in the same
// title-band rect using vAlign top/bottom on independent layers.
function makeTitleSubtitleSource(opts: {
  title: string;
  titleFontSize: number;
  titleColor: MosaicColor;
  subtitle: string;
  subtitleFontSize: number;
  subtitleColor: MosaicColor;
}): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: opts.title },
        style: { fontSize: opts.titleFontSize, fontColor: opts.titleColor },
        placement: { fit: "contain", hAlign: "center", vAlign: "top" } as any,
      },
      {
        content: { kind: "literal", text: opts.subtitle },
        style: { fontSize: opts.subtitleFontSize, fontColor: opts.subtitleColor },
        placement: { fit: "contain", hAlign: "center", vAlign: "bottom" } as any,
      },
    ],
  };
}

// N-cell split of identical "1" slots along an axis. Used for the category rail.
function uniformRail(N: number, axis: "col" | "row"): string {
  const tokens = Array.from({ length: N }, () => "1");
  return container(tokens, axis) as unknown as string;
}

// Tick rail m0: M ticks separated by (M-1) gaps. All tick cells share the
// same width (tick) so label centers are uniformly spaced across the rail
// (see the TICK_PITCH comment above).
function tickRail(M: number, axis: "col" | "row"): string {
  if (M <= 0) return "-";
  if (M === 1) return "1";
  const { tick, gap } = tickRailWeights(M);
  const weights: number[] = [];
  const claimants: string[] = [];
  for (let i = 0; i < M; i++) {
    weights.push(tick);
    claimants.push("1");
    if (i < M - 1) {
      weights.push(gap);
      claimants.push("-");
    }
  }
  return weightedSplit(weights, axis, { claimants, mode: "literal" }) as unknown as string;
}

// Compute the M tick values evenly spanning [min..max].
// For vertical (`order="topDown"`) the rail emits max→min; for horizontal
// (`order="leftRight"`) it emits min→max.
function tickValues(min: number, max: number, M: number, order: "topDown" | "leftRight"): number[] {
  if (M <= 1) return [max];
  const step = (max - min) / (M - 1);
  const out: number[] = [];
  for (let i = 0; i < M; i++) {
    const ascending = min + step * i;
    out.push(order === "leftRight" ? ascending : (max - step * i));
  }
  return out;
}

export const Labels: MosaicTemplate<LabelsProps> = {
  id: LABELS_TEMPLATE_ID,
  label: "Bar Graph — Content Layout (internal)",
  version: 1,
  internal: true,
  // Building block of the DEPRECATED @m0saic/charts/bar-graph/v1 composition —
  // superseded with it (v2 is a flat single document and needs none of these).
  deprecated: {
    reason: "Internal piece of the deprecated 5-deep bar-graph/v1 nested composition; bar-graph/v2 renders the same chart as one flat document.",
    replacement: asTemplateId("@m0saic/charts/bar-graph/v2"),
    since: "2026-09-16",
  },
  description: "Internal: composes title, subtitle, category labels, value-axis ticks, and the plot area into the chart's banded m0 layout.",
  capabilities: { tier: "core" },
  tags: ["data-viz", "bar-graph", "internal", "labels", "content-layout"],
  propsSchema,

  defaultProps: {
    axisConfig: {
      fillAxis: "y",
      layoutAxis: "x",
      labelDock: "bottom",
      valueDock: "top",
      gridDirection: "horizontal",
      baselineEdge: "bottom",
    },
    title: undefined,
    subtitle: undefined,
    labels: undefined,
    values: [35, 60, 85, 45, 70],
    minValue: 0,
    maxValue: 85,
    padding: { top: 0.067, right: 0.0375, bottom: 0.067, left: 0.0375 },
    gap: 18,
    preset: "neutral",
    valueLabels: DEFAULT_VALUE_LABELS,
    gridCount: 5,
    showValueTicks: true,
    plotAreaRef: "plot-area",
  },

  async render(props: LabelsProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const tokens = textTokensForPreset(props.preset);
    const canvasH = ctx.output.height;

    const titleFontSize = Math.max(12, Math.round(canvasH * TITLE_FONT_FRAC));
    const subtitleFontSize = Math.max(10, Math.round(canvasH * SUBTITLE_FONT_FRAC));
    const categoryFontSize = Math.max(10, Math.round(canvasH * CATEGORY_FONT_FRAC));
    const tickFontSize = Math.max(9, Math.round(canvasH * TICK_FONT_FRAC));

    const hasTitle = !!(props.title && props.title.trim() !== "");
    const hasSubtitle = !!(props.subtitle && props.subtitle.trim() !== "");
    const hasTitleBand = hasTitle || hasSubtitle;
    const hasLabels = !!(props.labels && props.labels.length > 0);
    const hasTicks = props.showValueTicks && props.gridCount >= 1;
    const tickCount = props.gridCount + 1;
    const isVertical = props.axisConfig.fillAxis === "y";
    const labelDock = props.axisConfig.labelDock;

    // Sources are appended in m0 slot order — title sources first, then the
    // body row's sources in row-major / col-major order, then the bottom band.
    const sources: MosaicSource[] = [];

    // ---- Title band ----
    // Title + subtitle live in a SINGLE rect; stacking is a text concern, not a
    // layout-DSL concern. A 2-layer text source pins title to top and subtitle
    // to bottom within the same band.
    let titleBandClaimant: string | null = null;
    if (hasTitleBand) {
      titleBandClaimant = "1";
      if (hasTitle && hasSubtitle) {
        sources.push(
          makeTitleSubtitleSource({
            title: props.title!,
            titleFontSize,
            titleColor: tokens.title,
            subtitle: props.subtitle!,
            subtitleFontSize,
            subtitleColor: tokens.subtitle,
          }),
        );
      } else if (hasTitle) {
        sources.push(makeTextSource(props.title!, titleFontSize, tokens.title));
      } else {
        sources.push(makeTextSource(props.subtitle!, subtitleFontSize, tokens.subtitle));
      }
    }

    function pushTicks(order: "topDown" | "leftRight") {
      const values = tickValues(props.minValue, props.maxValue, tickCount, order);
      const M = values.length;
      for (let i = 0; i < M; i++) {
        const v = values[i];
        const text = formatValue(
          v,
          props.valueLabels.format,
          props.valueLabels.decimals,
          { max: props.maxValue },
          props.valueLabels.suffix,
        );
        if (order === "topDown") {
          // Vertical chart: uniform vAlign="middle" so every label is
          // visually treated the same — keeps the *spacing between labels*
          // even (which is what the eye actually reads). The 5% mixed-vAlign
          // asymmetry that read as "lines not evenly spaced" goes away.
          //
          // The small label-vs-line offset for the edge ticks (label at
          // y ≈ T_edge/(2*total) for the top, mirrored for the bottom) sits
          // inside the chart-frame padding band and is barely perceptible.
          // hAlign="right" + right-padding pin labels to the plot edge with
          // breathing room.
          sources.push(
            makeTextSource(
              text,
              tickFontSize,
              tokens.tick,
              "right",
              "middle",
              { right: VERTICAL_TICK_RIGHT_PAD },
            ),
          );
        } else {
          // Horizontal chart: rail runs left-to-right under the plot.
          // Uniform vAlign="top" pins text to the plot's bottom edge.
          const isFirst = i === 0;
          const isLast = i === M - 1;
          const hAlign: HAlign = isFirst ? "left" : isLast ? "right" : "center";
          sources.push(makeTextSource(text, tickFontSize, tokens.tick, hAlign, "top"));
        }
      }
    }

    function pushCategorySources(N: number) {
      for (let i = 0; i < N; i++) {
        const text = props.labels?.[i] ?? "";
        sources.push(makeTextSource(text, categoryFontSize, tokens.category));
      }
    }

    // ============== VERTICAL CHART ==============
    if (isVertical) {
      // Body row claimant:
      //   ticks on  → 2-col [tick-rail | plot]
      //   ticks off → "1" (plot only)
      let bodyClaimant: string;
      const tickRailWeight = hasTicks ? MIN_VERTICAL_TICK_RAIL_WEIGHT : 0;
      const bodyPlotColWeight = 100 - tickRailWeight;

      if (hasTicks) {
        bodyClaimant = weightedSplit(
          [tickRailWeight, bodyPlotColWeight],
          "col",
          { claimants: [tickRail(tickCount, "row"), "1"] },
        ) as unknown as string;
        // Body left-col sources (M ticks, top-down) come BEFORE the plot ref.
        pushTicks("topDown");
        sources.push({ type: "mosaic", ref: props.plotAreaRef });
      } else {
        bodyClaimant = "1";
        sources.push({ type: "mosaic", ref: props.plotAreaRef });
      }

      // Bottom band claimant (category labels, aligned with the plot col):
      //   labels + ticks → 2-col [empty | N-cat-rail]
      //   labels only    → "N(1,1,...)"
      //   no labels      → no bottom band
      let bottomBandClaimant: string | null = null;
      if (hasLabels) {
        const N = props.labels!.length;
        if (hasTicks) {
          bottomBandClaimant = weightedSplit(
            [tickRailWeight, bodyPlotColWeight],
            "col",
            { claimants: ["-", uniformRail(N, "col")] },
          ) as unknown as string;
        } else {
          bottomBandClaimant = uniformRail(N, "col");
        }
        pushCategorySources(N);
      }

      // Assemble outer row split.
      const outerBands: Array<{ weight: number; claimant: string }> = [];
      if (titleBandClaimant) {
        outerBands.push({
          weight: toBandWeight(props.padding.top),
          claimant: titleBandClaimant,
        });
      }
      const bodyWeight = Math.max(
        1,
        100
          - (titleBandClaimant ? toBandWeight(props.padding.top) : 0)
          - (bottomBandClaimant ? toBandWeight(props.padding.bottom) : 0),
      );
      outerBands.push({ weight: bodyWeight, claimant: bodyClaimant });
      if (bottomBandClaimant) {
        outerBands.push({
          weight: toBandWeight(props.padding.bottom),
          claimant: bottomBandClaimant,
        });
      }

      const m0 =
        outerBands.length === 1
          ? outerBands[0].claimant
          : (weightedSplit(
              outerBands.map((b) => b.weight),
              "row",
              { claimants: outerBands.map((b) => b.claimant) },
            ) as unknown as string);

      return {
        kind: "mosaic_document",
        version: 1,
        assets: {} as any,
        m0: m0 as any,
        sources,
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
      } as MosaicDocument;
    }

    // ============== HORIZONTAL CHART ==============
    const bodyHasCatRail = hasLabels && labelDock === "left";
    const catRailWeight = bodyHasCatRail ? MIN_HORIZONTAL_CAT_RAIL_WEIGHT : 0;
    const bodyPlotColWeight = 100 - catRailWeight;

    let bodyClaimant: string;
    if (bodyHasCatRail) {
      const N = props.labels!.length;
      bodyClaimant = weightedSplit(
        [catRailWeight, bodyPlotColWeight],
        "col",
        { claimants: [uniformRail(N, "row"), "1"] },
      ) as unknown as string;
      // Body left col first, then plot.
      pushCategorySources(N);
      sources.push({ type: "mosaic", ref: props.plotAreaRef });
    } else {
      bodyClaimant = "1";
      sources.push({ type: "mosaic", ref: props.plotAreaRef });
    }

    // Bottom tick band:
    //   ticks + cat rail → 2-col [empty | tick-rail], same col weights as body
    //   ticks only       → "tick-rail" (full width)
    //   no ticks         → no bottom band
    let tickBandClaimant: string | null = null;
    if (hasTicks) {
      if (bodyHasCatRail) {
        tickBandClaimant = weightedSplit(
          [catRailWeight, bodyPlotColWeight],
          "col",
          { claimants: ["-", tickRail(tickCount, "col")] },
        ) as unknown as string;
      } else {
        tickBandClaimant = tickRail(tickCount, "col");
      }
      pushTicks("leftRight");
    }

    // Assemble outer row split.
    const outerBands: Array<{ weight: number; claimant: string }> = [];
    if (titleBandClaimant) {
      outerBands.push({
        weight: toBandWeight(props.padding.top),
        claimant: titleBandClaimant,
      });
    }
    const tickBandWeight = tickBandClaimant
      ? Math.max(MIN_HORIZONTAL_TICK_BAND_WEIGHT, toBandWeight(props.padding.bottom))
      : 0;
    const bodyWeight = Math.max(
      1,
      100
        - (titleBandClaimant ? toBandWeight(props.padding.top) : 0)
        - tickBandWeight,
    );
    outerBands.push({ weight: bodyWeight, claimant: bodyClaimant });
    if (tickBandClaimant) {
      outerBands.push({ weight: tickBandWeight, claimant: tickBandClaimant });
    }

    const m0 =
      outerBands.length === 1
        ? outerBands[0].claimant
        : (weightedSplit(
            outerBands.map((b) => b.weight),
            "row",
            { claimants: outerBands.map((b) => b.claimant) },
          ) as unknown as string);

    return {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: m0 as any,
      sources,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;
  },
};

registerTemplate(Labels);
