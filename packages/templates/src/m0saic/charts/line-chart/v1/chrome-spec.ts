/**
 * ============================================================================
 * @m0saic/charts/line-chart — chrome spec (the REAL-geometry plan)
 * ============================================================================
 *
 * Pure: turns the projected model + resolved axis/title/legend config into a
 * DECLARATIVE plan of frame REGIONS (header bands, y-gutter tick labels,
 * x-gutter category labels, gridlines, axis lines). chrome.ts encodes this plan
 * as REAL m0 geometry (weightedSplit cells + the grid primitive) — NOT a stack
 * of full-canvas drawtext/mask overlays.
 *
 * This file is "JS pixel-math → region intent"; chrome.ts is "intent → m0 DSL".
 * See the internal rects-not-drawtext-real-geometry notes.
 * ============================================================================
 */

import type { MosaicColor } from "@m0saic/types";
import { textEmUnits, fitEmUnits } from "@m0saic/template-utils";
import { project } from "../../_shared/scale";
import type { LineChartModel } from "../../_shared/line";
import { formatAxisValue } from "./format";
import type { ResolvedAxis, ResolvedLegend, ResolvedSeriesStyle, TextAlign } from "./types";
import type { FrameWeights } from "./frame";

export type VAlign = "top" | "middle" | "bottom";

export type FrameText = {
  text: string;
  size: number;
  color: MosaicColor;
  hAlign: TextAlign;
  vAlign: VAlign;
  /** Optional font weight (700 = bold title). */
  weight?: number;
  /** Optional CELL weight (half-band units) — set by the x autoskip so a shown
   *  label's cell spans the skipped neighbors instead of one narrow band. */
  cellWeight?: number;
  /** Make inline-edit binding: the PARENT line-chart prop this text DISPLAYS
   *  (dotted schema path; `index` = element of a list prop). Intent only —
   *  chrome.ts applies it via `bindProp`; it never touches the m0. */
  binding?: { propKey: string; index?: number };
};

export type GridSpec = {
  direction: "horizontal" | "vertical";
  count: number;
  color: MosaicColor;
  opacity: number;
};

export type LegendEntry = { swatch: MosaicColor; label: FrameText };

export type HeaderBandKind = "title" | "subtitle" | "legend";
export type HeaderBand = { kind: HeaderBandKind; weight: number };

export type ChromeSpec = {
  width: number;
  height: number;
  frame: FrameWeights;
  header: {
    bands: HeaderBand[];
    title?: FrameText;
    subtitle?: FrameText;
    legend?: { entries: LegendEntry[] };
  };
  /** legend.position === "bottom": the legend renders as a footer row inside
   *  the x-gutter band (the parent widens pad.bottom to make room). */
  footer?: { entries: LegendEntry[]; bandPx: number };
  /** Y tick labels top→bottom (vAlign already assigned for edge alignment). */
  yTicks: FrameText[];
  /** X category labels left→right (hAlign already assigned for edge alignment). */
  xLabels: FrameText[];
  /** Gridline sets drawn inside the plot cell via the grid primitive. */
  grids: GridSpec[];
  /** Axis-line colors (undefined ⇒ that axis line is hidden). */
  axis: { y?: MosaicColor; x?: MosaicColor };
  /** Tick-mark stubs at each label (undefined ⇒ that axis has no ticks). */
  tickMarks: {
    y?: { color: MosaicColor; length: number };
    x?: { color: MosaicColor; length: number };
  };
};

export type ChromeSpecOptions = {
  xAxis: ResolvedAxis;
  yAxis: ResolvedAxis;
  series: ResolvedSeriesStyle[];
  title?: string;
  subtitle?: string;
  titleColor: MosaicColor;
  titleSize: number;
  titleAlign: TextAlign;
  subtitleColor: MosaicColor;
  legend: ResolvedLegend;
  /** px the parent added to pad.bottom for a bottom-positioned legend. */
  legendBandPx?: number;
};

/** vAlign for the i-th of n stacked labels so edges hug the gridline. */
function vAlignFor(i: number, n: number): VAlign {
  if (n <= 1) return "middle";
  if (i === 0) return "top";
  if (i === n - 1) return "bottom";
  return "middle";
}

/** hAlign for the i-th of n side-by-side labels so edge labels hug the plot edge. */
function hAlignFor(i: number, n: number): TextAlign {
  if (n <= 1) return "center";
  if (i === 0) return "left";
  if (i === n - 1) return "right";
  return "center";
}

/** Width-cap a font so `text` fits `maxPx` at the CLI's glyph metrics
 *  (script-aware em units; the app's fit:contain shrinks, the CLI CLIPS —
 *  the cap closes that gap). Binds only on overflow; ASCII-in-slot renders
 *  byte-identical. */
function capW(px: number, text: string, maxPx: number, min: number, em = 0.62): number {
  return Math.max(min, Math.min(px, Math.floor(maxPx / (Math.max(1, textEmUnits(text)) * em))));
}
/** Fit-first last resort: when the min-font floor still overflows the slot,
 *  ellipsize to the units that fit (never clip). No-op when the text fits. */
function fitTo(text: string, size: number, maxPx: number, em = 0.62): string {
  const maxUnits = maxPx / (em * size);
  if (textEmUnits(text) <= maxUnits + 0.5) return text;
  return fitEmUnits(text, Math.max(1, Math.floor(maxUnits)));
}

export function buildChromeSpec(model: LineChartModel, frame: FrameWeights, o: ChromeSpecOptions): ChromeSpec {
  const { width: W, height: H } = model.layout;

  // ---- header bands (title / subtitle / legend), present-only ----
  const bands: HeaderBand[] = [];
  let title: FrameText | undefined;
  let subtitle: FrameText | undefined;
  let legend: { entries: LegendEntry[] } | undefined;

  if (o.title) {
    bands.push({ kind: "title", weight: 46 });
    // 0.66em: the title renders bold-ish and mixed-case (wider than body text).
    const tSize = capW(o.titleSize, o.title, W * 0.94, 11, 0.66);
    title = { text: fitTo(o.title, tSize, W * 0.94, 0.66), size: tSize, color: o.titleColor, hAlign: o.titleAlign, vAlign: "middle", weight: 700, binding: { propKey: "titles.title" } };
  }
  if (o.subtitle) {
    bands.push({ kind: "subtitle", weight: 28 });
    const sSize = capW(13, o.subtitle, W * 0.94, 9);
    subtitle = { text: fitTo(o.subtitle, sSize, W * 0.94), size: sSize, color: o.subtitleColor, hAlign: o.titleAlign, vAlign: "middle", binding: { propKey: "titles.subtitle" } };
  }
  let footer: { entries: LegendEntry[]; bandPx: number } | undefined;
  if (o.legend.show && model.series.length > 0) {
    // Each legend label binds `seriesLabels[i]` (an absent prop shows the
    // derived "Series N" — the rect is the handle to name it).
    const entries = model.series.map((s, i) => ({
      swatch: (o.series[i]?.color ?? s.color) as MosaicColor,
      label: { text: s.name, size: o.legend.fontSize, color: o.legend.color, hAlign: "left" as TextAlign, vAlign: "middle" as VAlign, binding: { propKey: "seriesLabels", index: i } },
    }));
    if (o.legend.position === "bottom") {
      footer = { entries, bandPx: Math.max(16, o.legendBandPx ?? 36) };
    } else {
      bands.push({ kind: "legend", weight: 40 });
      legend = { entries };
    }
  }

  // ---- y tick labels (top→bottom: ticks are emitted low→high, so reverse) ----
  const yTicks: FrameText[] = [];
  if (o.yAxis.showLabels) {
    const ticks = model.scale.ticks;
    // ticks[] runs min→max; gutter cells run top→bottom = max→min, so reverse.
    const ordered = [...ticks].reverse();
    const texts = ordered.map((v) => formatAxisValue(v, o.yAxis.format, o.yAxis.decimals, model.scale.max, o.yAxis.prefix, o.yAxis.suffix));
    // One shared cap from the longest label so the column stays uniform. The
    // gutter auto-widens upstream when padding isn't explicit; this cap is the
    // backstop for explicit (too-narrow) padding.
    const longestY = texts.reduce((a, b) => (textEmUnits(b) > textEmUnits(a) ? b : a), "");
    const gutterPx = Math.max(8, frame.plot.left * 0.88);
    const yFont = capW(o.yAxis.fontSize, longestY, gutterPx, 8);
    for (let i = 0; i < texts.length; i++) {
      yTicks.push({
        text: texts[i],
        size: yFont,
        color: o.yAxis.labelColor,
        hAlign: "right",
        vAlign: vAlignFor(i, ordered.length),
      });
    }
  }

  // ---- x category labels (left→right) ----
  const xLabels: FrameText[] = [];
  if (o.xAxis.showLabels) {
    const n = model.labels.length;
    // Chart.js-style AUTOSKIP with WIDENED cells: when a label can't fit its
    // half-band cell, show every k-th label and give each shown label a cell
    // spanning the skipped span (blank filler cells hold the geometry). k keys
    // to the EDGE half-cell (the binding constraint — edge labels get pitch/2),
    // so shown labels keep their full font instead of shrinking to the floor.
    const plotW = Math.max(1, frame.plot.right - frame.plot.left);
    const pitch = n > 1 ? plotW / (n - 1) : plotW;
    const longestX = model.labels.reduce((a, b) => (textEmUnits(b ?? "") > textEmUnits(a) ? b ?? "" : a), "");
    const needPx = Math.max(1, textEmUnits(longestX)) * 0.62 * o.xAxis.fontSize + 6;
    const skip = Math.max(1, Math.ceil(needPx / Math.max(1, pitch / 2)));
    const xFont = capW(o.xAxis.fontSize, longestX, Math.max(8, (pitch * skip) / 2 - 4), 8);
    // Every SHOWN category label binds `labels[i]` (autoskip fillers span
    // several skipped labels, so they name no index and stay unbound).
    if (skip === 1 || n <= 2) {
      for (let i = 0; i < n; i++) {
        xLabels.push({
          text: model.labels[i] ?? "",
          size: xFont,
          color: o.xAxis.labelColor,
          hAlign: hAlignFor(i, n),
          vAlign: "top",
          binding: { propKey: "labels", index: i },
        });
      }
    } else {
      // Half-unit axis of length T = 2(n-1); shown label i owns [2i-k, 2i+k]
      // clamped to the axis; gaps become blank cells. Tail: always show the
      // last label, dropping a prior shown one that would collide.
      const T = 2 * (n - 1);
      const shownIdx: number[] = [];
      for (let i = 0; i < n; i += skip) shownIdx.push(i);
      if (shownIdx[shownIdx.length - 1] !== n - 1) {
        if (n - 1 - shownIdx[shownIdx.length - 1] < skip) shownIdx.pop();
        shownIdx.push(n - 1);
      }
      let cursor = 0;
      for (const i of shownIdx) {
        const lo = Math.max(cursor, 2 * i - skip);
        const hi = Math.min(T, 2 * i + skip);
        if (lo > cursor) xLabels.push({ text: "", size: xFont, color: o.xAxis.labelColor, hAlign: "center", vAlign: "top", cellWeight: lo - cursor });
        xLabels.push({
          text: model.labels[i] ?? "",
          size: xFont,
          color: o.xAxis.labelColor,
          hAlign: hAlignFor(i, n),
          vAlign: "top",
          cellWeight: Math.max(1, hi - lo),
          binding: { propKey: "labels", index: i },
        });
        cursor = hi;
      }
      if (cursor < T) xLabels.push({ text: "", size: xFont, color: o.xAxis.labelColor, hAlign: "center", vAlign: "top", cellWeight: T - cursor });
    }
  }

  // ---- gridlines (drawn inside the plot cell via the grid primitive) ----
  const grids: GridSpec[] = [];
  if (o.yAxis.showGrid && model.scale.ticks.length > 1) {
    grids.push({ direction: "horizontal", count: model.scale.ticks.length - 1, color: o.yAxis.gridColor, opacity: o.yAxis.gridOpacity });
  }
  if (o.xAxis.showGrid && model.labels.length > 1) {
    grids.push({ direction: "vertical", count: model.labels.length - 1, color: o.xAxis.gridColor, opacity: o.xAxis.gridOpacity });
  }

  return {
    width: W,
    height: H,
    frame,
    header: { bands, title, subtitle, legend },
    footer,
    yTicks,
    xLabels,
    grids,
    axis: { y: o.yAxis.show ? o.yAxis.color : undefined, x: o.xAxis.show ? o.xAxis.color : undefined },
    tickMarks: {
      y: o.yAxis.showTicks ? { color: o.yAxis.tickColor, length: Math.max(1, o.yAxis.tickLength) } : undefined,
      x: o.xAxis.showTicks ? { color: o.xAxis.tickColor, length: Math.max(1, o.xAxis.tickLength) } : undefined,
    },
  };
}

// `project` re-exported usage kept implicit; the model already carries projected
// points. (Tick Y positions are even fractions, so the gutter half-band split
// in chrome.ts aligns labels to gridlines without per-pixel projection here.)
void project;
