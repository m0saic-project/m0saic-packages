import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/line-chart/internal/chrome/v1
 * ============================================================================
 *
 * Renders the chart chrome as REAL m0 GEOMETRY — not a stack of full-canvas
 * drawtext/mask overlays. The ChromeSpec plan becomes a weightedSplit frame:
 *
 *     row: header(title/subtitle/legend) | body | x-gutter
 *     body(col): y-gutter(tick labels) | plot(gridlines + axis lines) | margin
 *
 * Each label is a text source that FILLS ITS OWN CELL (aligned in-cell); each
 * gridline set is the first-party `@m0saic/primitives/grid/v2` (composable
 * proportional-overlay grid) nested into the plot cell. The only thing NOT
 * expressed as m0 geometry is the animated line
 * (the parent overlays it). See
 * the internal rects-not-drawtext-real-geometry notes.
 *
 * Weights use a bounded basis (≤200 cells/split) to stay under the engine's
 * split-rounding cap; the plot rect is derived from those weights in frame.ts
 * so the data layer aligns to the geometry at every resolution.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
  MosaicTextSource,
} from "@m0saic/types";
import { definePropsSchema, registerTemplate, makeColorTile, makeErrorMosaic, renderNestedTemplate, transparentSlot, tag, bindProp, textEmUnits, fitEmUnits, latticeWeights } from "@m0saic/template-utils";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import type { ChromeSpec, FrameText, GridSpec, VAlign } from "./chrome-spec";
import type { TextAlign } from "./types";

export const CHROME_TEMPLATE_ID = asTemplateId("@m0saic/charts/line-chart/internal/chrome/v1");
const GRID_TEMPLATE_ID = "@m0saic/primitives/grid/v2";

export type ChromeProps = {
  spec: ChromeSpec;
};

// ---------------------------------------------------------------------------
// Tiny m0 composer — every node carries its m0 string + its sources IN
// EMISSION ORDER (weightedSplit preserves claimant order; overlays paint
// base→top). Null cells ("-") contribute no source.
// ---------------------------------------------------------------------------

type Node = { m0: string; sources: MosaicSource[] };
type Cell = { weight: number; node?: Node };

function leaf(source: MosaicSource): Node {
  return { m0: "1", sources: [source] };
}

function split(axis: "row" | "col", cells: Cell[]): Node | undefined {
  const live = cells.filter((c) => c.weight > 0);
  if (live.length === 0) return undefined;
  // A single live cell with no siblings collapses to that cell (avoid 1(...) noise).
  if (live.length === 1 && live[0].node) return live[0].node;
  const weights = live.map((c) => Math.max(1, Math.round(c.weight)));
  const claimants = live.map((c) => (c.node ? String(c.node.m0) : "-"));
  // Basis on the 5-smooth lattice (latticeWeights, @m0saic/template-utils): a
  // rough pixel sum (a 57 px gutter, a 101-unit rail) drifts ≤ 1 px onto the
  // nearest smooth basis, patterns keep their structure; smooth, tiny and
  // equal-weight splits keep theirs.
  const m0 = String(weightedSplit(latticeWeights(weights), axis, { claimants }));
  const sources = live.flatMap((c) => (c.node ? c.node.sources : []));
  return { m0, sources };
}

/** Stack nodes as nested overlays: base{next{…}}. */
function overlay(nodes: Node[]): Node | undefined {
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  let inner = "";
  for (let i = nodes.length - 1; i >= 0; i--) inner = inner ? `${nodes[i].m0}{${inner}}` : nodes[i].m0;
  return { m0: inner, sources: nodes.flatMap((n) => n.sources) };
}

// ---------------------------------------------------------------------------
// Leaf source builders
// ---------------------------------------------------------------------------

type BoxFrac = { top?: number; right?: number; bottom?: number; left?: number };

function alignH(a: TextAlign): "left" | "center" | "right" {
  return a === "left" ? "left" : a === "right" ? "right" : "center";
}
function alignV(v: VAlign): VAlign {
  return v;
}

function textLeaf(t: FrameText, padding: BoxFrac, label?: string): Node {
  const src: MosaicTextSource = {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: t.text || " " },
        style: { fontSize: t.size, fontColor: t.color },
        placement: { fit: "contain", hAlign: alignH(t.hAlign), vAlign: alignV(t.vAlign), padding } as never,
      },
    ],
  };
  // Blank (autoskipped) labels stay untagged so the layout contract only
  // judges real text.
  const tagged = label && t.text.trim() ? tag(src, label) : src;
  // The Make binding rides the spec (the PARENT names its prop); unlike the
  // tag it applies even to blank text, so the rect is a handle to ADD.
  return leaf(t.binding ? bindProp(tagged, t.binding.propKey, t.binding.index) : tagged);
}

/** A short horizontal legend swatch, centered in its cell (≈30% band height). */
function swatchLeaf(color: MosaicColor): Node {
  const src: MosaicLavfiSource = {
    type: "lavfi",
    color,
    fitMode: "content",
    size: { wExpr: "TW", hExpr: "max(2, TH*0.3)" },
    placement: { fit: "contain", hAlign: "center", vAlign: "middle" },
  };
  return leaf(src);
}

/** A 1px-ish axis line strip at one edge of the plot cell. */
function axisLineLeaf(color: MosaicColor, edge: "left" | "bottom"): Node {
  const t = 0.004;
  const horizontal = edge === "bottom";
  const src: MosaicLavfiSource = {
    type: "lavfi",
    color,
    fitMode: "content",
    size: horizontal ? { wExpr: "TW", hExpr: `max(1, TH*${t})` } : { wExpr: `max(1, TW*${t})`, hExpr: "TH" },
    placement: { fit: "contain", hAlign: edge === "left" ? "left" : "center", vAlign: edge === "bottom" ? "bottom" : "middle" },
  };
  return leaf(src);
}

// Tick marks are tiny colored rects rendered as REAL GEOMETRY: a short `grid`
// (horizontal for y, vertical for x) nested in a narrow rail cell carved beside
// the labels. The grid's thin line-cells ARE the ticks; the rail constrains
// their length. (Built inline in render() — it needs renderGrid + child refs.)

/** Half-band weights so N labels center on evenly-spaced gridlines, edges hugging. */
function halfBandWeights(n: number): number[] {
  if (n <= 1) return [1];
  const w: number[] = [1];
  for (let i = 1; i < n - 1; i++) w.push(2);
  w.push(1);
  return w;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<ChromeProps>({
  spec: { type: "json" as never, required: true, description: "Declarative chrome plan (frame weights + labels + gridlines)." },
});

export const Chrome: MosaicTemplate<ChromeProps> = {
  id: CHROME_TEMPLATE_ID,
  label: "Line Chart — Chrome (internal)",
  version: 1,
  internal: true,
  description: "Internal: real-geometry chart frame (weightedSplit cells + grid primitive + in-cell text).",
  capabilities: { tier: "core" },
  tags: ["data-viz", "line-chart", "internal", "chrome"],
  propsSchema,

  defaultProps: { spec: undefined as never },

  async render(props: ChromeProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const spec = props.spec;
    if (!spec) {
      // Internal template: `spec` is injected by the line-chart parent.
      // Invoked standalone (no spec) → render the usage-card placeholder
      // instead of crashing, same pattern as screencap_grid.
      return makeErrorMosaic("spec is required — injected by the line-chart parent template", {
        title: `${this.id} props`,
        width: Math.max(1, Math.round(ctx.target.width)),
        height: Math.max(1, Math.round(ctx.target.height)),
      });
    }
    const { width: W, height: H, frame } = spec;

    const children: Record<string, MosaicRenderableFile> = {};

    // ── plot cell content: gridlines (grid primitive) + axis lines ──
    const plotW = Math.max(1, Math.round(frame.plot.right - frame.plot.left));
    const plotH = Math.max(1, Math.round(frame.plot.bottom - frame.plot.top));
    const plotLayers: Node[] = [];
    let gridIndex = 0;
    for (const g of spec.grids) {
      const refId = `grid${gridIndex++}`;
      children[refId] = await renderGrid(g, plotW, plotH, ctx);
      plotLayers.push(leaf({ type: "mosaic", ref: refId }));
    }
    if (spec.axis.y) plotLayers.push(axisLineLeaf(spec.axis.y, "left"));
    if (spec.axis.x) plotLayers.push(axisLineLeaf(spec.axis.x, "bottom"));
    const plotNode = overlay(plotLayers);

    // ── y-gutter: tick labels (top→bottom) on half-band cells. With ticks on,
    //    carve a narrow rail at the plot edge holding a short horizontal grid —
    //    its thin line-cells are the tick rects, aligned to the same fractions. ──
    const yTick = spec.tickMarks.y;
    const labelCol =
      spec.yTicks.length > 0
        ? split(
            "row",
            spec.yTicks.map((t, i) => ({
              weight: halfBandWeights(spec.yTicks.length)[i],
              node: textLeaf(t, { right: yTick ? 0.08 : 0.16, left: 0.04 }, "y-tick"),
            })),
          )
        : undefined;
    let yGutterNode = labelCol;
    if (yTick && labelCol && spec.yTicks.length > 1) {
      children["tickGridY"] = await renderGrid(
        { direction: "horizontal", count: spec.yTicks.length - 1, color: yTick.color, opacity: 1 },
        Math.max(1, Math.round(yTick.length)),
        plotH,
        ctx,
      );
      const railW = Math.max(1, Math.round((yTick.length / Math.max(1, frame.plot.left)) * 100));
      yGutterNode = split("col", [
        { weight: 100 - railW, node: labelCol },
        { weight: railW, node: leaf({ type: "mosaic", ref: "tickGridY" }) },
      ]);
    }

    // ── body row: y-gutter | plot | right-margin ──
    const bodyNode = split("col", [
      { weight: frame.bodyCol[0], node: yGutterNode },
      { weight: frame.bodyCol[1], node: plotNode },
      { weight: frame.bodyCol[2] }, // right margin (null)
    ]);

    // ── header: title / subtitle / legend bands (centered full-width) ──
    const headerCells: Cell[] = spec.header.bands.map((b) => {
      if (b.kind === "title" && spec.header.title) return { weight: b.weight, node: textLeaf(spec.header.title, { left: 0.02, right: 0.02 }, "chart-title") };
      if (b.kind === "subtitle" && spec.header.subtitle) return { weight: b.weight, node: textLeaf(spec.header.subtitle, { left: 0.02, right: 0.02 }, "chart-subtitle") };
      if (b.kind === "legend" && spec.header.legend) return { weight: b.weight, node: buildLegend(spec.header.legend.entries, W) };
      return { weight: b.weight };
    });
    const headerNode = headerCells.length > 0 ? split("row", headerCells) : undefined;

    // ── x-gutter: category labels under the plot (offset by the y-gutter width),
    //    each optionally overlaid with a tick-mark stub at the plot edge ──
    const xTick = spec.tickMarks.x;
    // Autoskipped rows carry explicit cellWeights (wide label cells + blank
    // fillers); dense rows fall back to the half-band pattern.
    const anyCellWeight = spec.xLabels.some((t) => t.cellWeight != null);
    const labelRow =
      spec.xLabels.length > 0
        ? split(
            "col",
            spec.xLabels.map((t, i) => ({
              weight: t.cellWeight ?? halfBandWeights(spec.xLabels.length)[i],
              node: textLeaf(t, { top: xTick ? 0.1 : 0.18, left: 0.02, right: 0.02 }, "x-label"),
            })),
          )
        : undefined;
    void anyCellWeight;
    let xContent = labelRow;
    if (xTick && labelRow && spec.xLabels.length > 1) {
      children["tickGridX"] = await renderGrid(
        { direction: "vertical", count: spec.xLabels.length - 1, color: xTick.color, opacity: 1 },
        plotW,
        Math.max(1, Math.round(xTick.length)),
        ctx,
      );
      const railH = Math.max(1, Math.round((xTick.length / Math.max(1, H - frame.plot.bottom)) * 100));
      xContent = split("row", [
        { weight: railH, node: leaf({ type: "mosaic", ref: "tickGridX" }) },
        { weight: 100 - railH, node: labelRow },
      ]);
    }
    let xGutterNode = xContent
      ? split("col", [
          { weight: frame.bodyCol[0] }, // under the y-gutter (null)
          { weight: frame.bodyCol[1], node: xContent },
          { weight: frame.bodyCol[2] }, // right margin (null)
        ])
      : undefined;
    // Bottom-positioned legend: a full-width footer band under the x labels.
    // The parent widened pad.bottom by footer.bandPx, so the x-gutter row has
    // the room; split it [labels | legend] in px weights.
    if (spec.footer) {
      const gutterPx = Math.max(1, Math.round(H - frame.plot.bottom));
      const bandPx = Math.min(spec.footer.bandPx, Math.max(1, gutterPx - 1));
      const legendRow = buildLegend(spec.footer.entries, W);
      if (legendRow) {
        xGutterNode = split("row", [
          { weight: Math.max(1, gutterPx - bandPx), node: xGutterNode },
          { weight: bandPx, node: legendRow },
        ]);
      }
    }

    // ── root row: header | body | x-gutter ──
    const root = split("row", [
      { weight: frame.rootRow[0], node: headerNode },
      { weight: frame.rootRow[1], node: bodyNode },
      { weight: frame.rootRow[2], node: xGutterNode },
    ]);

    if (!root) {
      return {
        kind: "mosaic_document",
        version: 1,
        assets: {} as never,
        m0: "1" as never,
        sources: [transparentSlot()],
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
      };
    }

    return {
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: root.m0 as never,
      sources: root.sources,
      children: Object.keys(children).length ? children : undefined,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers needing async / W
// ---------------------------------------------------------------------------

async function renderGrid(g: GridSpec, plotW: number, plotH: number, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
  return renderNestedTemplate(
    GRID_TEMPLATE_ID,
    {
      show: true,
      direction: g.direction,
      count: g.count,
      excludeEdges: false, // chart convention: lines at every tick incl. min/max
      origin: g.direction === "horizontal" ? "bottom" : "left",
      color: g.color,
      opacity: g.opacity,
    },
    ctx,
    { slot: { width: plotW, height: plotH } },
  );
}

/** Centered legend row: spacer | (swatch label){gap…} | spacer, basis ≈ 100.
 *  Label widths are SCRIPT-AWARE (textEmUnits — a flat .length under-sized
 *  Cyrillic labels ~40% and the CLI clipped them). When the row would overflow
 *  the basis, the label font steps down (fit-first) so every entry still fits. */
function buildLegend(entries: { swatch: MosaicColor; label: FrameText }[], W: number): Node | undefined {
  if (entries.length === 0) return undefined;
  const pctW = (px: number) => Math.max(1, Math.round((px / W) * 100));
  const SWATCH = pctW(24);
  const GAP = pctW(8); // swatch→label
  const SEP = pctW(26); // between entries
  const fixed = SWATCH * entries.length + GAP * entries.length + SEP * (entries.length - 1);

  // Fit-first: at the requested font, does the row fit the 100 basis? If not,
  // shrink the label font toward the floor so the text widths scale down.
  // ceil + 0.62em (the CLI checker's metric) + headroom: round() at 1%-of-W
  // granularity shaved narrow-canvas cells under the text width.
  const labelPct = (text: string, size: number) => Math.max(3, Math.ceil(((Math.max(1, textEmUnits(text)) * 0.62 * size * 1.2 + 6) / W) * 100));
  const baseFont = entries[0]?.label.size ?? 13;
  let font = baseFont;
  for (let pass = 0; pass < 2; pass++) {
    const content = fixed + entries.reduce((a, e) => a + labelPct(e.label.text, font), 0);
    if (content <= 100) break;
    const textPct = content - fixed;
    font = Math.max(8, Math.floor(font * Math.max(0.35, (100 - fixed - entries.length) / Math.max(1, textPct))));
  }

  // Fit-first last resort: past the font floor the row can still overflow the
  // basis — the engine then normalizes every cell down by 100/content, so
  // ellipsize each label to its SCALED cell (never clip).
  const contentAtFloor = fixed + entries.reduce((a, e) => a + labelPct(e.label.text, font), 0);
  const squeeze = contentAtFloor > 100 ? 100 / contentAtFloor : 1;

  const cells: Cell[] = [];
  let content = 0;
  const entryCells: Cell[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const labelW = labelPct(e.label.text, font);
    // 0.85 safety: the engine's weight rounding squeezes a touch further than
    // the ideal 100/content ratio predicts.
    const usablePx = ((labelW * squeeze) / 100) * W - 8;
    const text = squeeze < 1 ? fitEmUnits(e.label.text, Math.max(1, Math.floor((usablePx * 0.85) / (0.62 * font)))) : e.label.text;
    if (i > 0) {
      entryCells.push({ weight: SEP });
      content += SEP;
    }
    entryCells.push({ weight: SWATCH, node: swatchLeaf(e.swatch) });
    entryCells.push({ weight: GAP });
    entryCells.push({ weight: labelW, node: textLeaf({ ...e.label, text, size: font, hAlign: "left" }, {}, "legend-label") });
    content += SWATCH + GAP + labelW;
  }
  const spacer = Math.max(1, Math.round((100 - content) / 2));
  cells.push({ weight: spacer });
  cells.push(...entryCells);
  cells.push({ weight: spacer });
  return split("col", cells);
}

/** Script-aware text width estimate (avg Latin glyph ≈ 0.55em; wide scripts
 *  scale by their measured multipliers via textEmUnits). */
function estTextW(s: string, size: number): number {
  return Math.max(1, textEmUnits(s)) * size * 0.55;
}

registerTemplate(Chrome);
