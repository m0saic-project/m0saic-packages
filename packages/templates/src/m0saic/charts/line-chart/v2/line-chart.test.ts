import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, handlesOf, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import "../../../index"; // registers the chrome + grid children this chart composes
import { ChartsLineChart } from "../v1/line-chart";
import { ChartsLineChartV2 } from "./line-chart";

const D = ChartsLineChartV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await ChartsLineChartV2.render({ ...D, ...props } as never, ctxFor(ChartsLineChartV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: ChartsLineChartV2,
  prev: ChartsLineChart,
  catalog: { primitive: true },
  // v1 painted its canvas as a full-frame tile; v2 paints it as the document
  // background, and a nesting parent asks for the tile back — which is v1's paint.
  parityNextProps: { useNestedBackgroundColor: true },
  cases: [
    { name: "two series, smooth, dark, static", props: { values: [[3, 9, 4, 12], [5, 2, 8, 6]], seriesLabels: ["A", "B"], labels: ["a", "b", "c", "d"], line: { curve: "smooth", lineColor: ["#22cc88", "#aa33ff"], strokeWidth: [2, 4], area: { show: false, opacity: 0.2 }, lineStyle: "solid", lineCap: "round", lineJoin: "round" }, appearance: { preset: "dark", cornerRadius: 0.04 }, anim: { reduceMotion: true, intro: { durationSec: 1, delaySec: 0, staggerSec: 0.1, ease: "linear" } } } },
    { name: "ticks + both grids + value labels + point borders", props: { axes: { xAxis: { show: true, showLabels: true, fontSize: 13, showTicks: true, tickLength: 6, showGrid: true, gridOpacity: 0.5 }, yAxis: { show: true, showLabels: true, fontSize: 13, showTicks: true, tickLength: 6, showGrid: true, gridOpacity: 1, format: "raw", decimals: 0 } }, valueLabels: { show: true, format: "compact", decimals: 0, fontSize: 12 }, points: { showPoints: true, pointRadius: 4, pointShape: "circle", pointBorder: { color: "#ffffff", width: 2 }, highlightLast: true } } },
    { name: "no titles, no legend, transparent, portrait", props: { titles: { titleAlign: "center", titleSize: 22 }, legend: { show: false, position: "top", fontSize: 13 }, appearance: { backgroundColor: "none", cornerRadius: 0.04, preset: "neutral" } }, w: 720, h: 1280 },
    { name: "solid card colour, bottom legend", props: { appearance: { backgroundColor: "#203040", cornerRadius: 0.1, preset: "neutral" }, legend: { show: true, position: "bottom", fontSize: 13 } } },
  ],
  bound: [
    "appearance.backgroundColor", "appearance.backgroundImage", "appearance.border.alpha", "appearance.border.color", "appearance.cornerRadius",
    "axes.xAxis.color", "axes.xAxis.fontSize", "axes.xAxis.labelColor",
    "axes.yAxis.color", "axes.yAxis.decimals", "axes.yAxis.fontSize", "axes.yAxis.gridColor", "axes.yAxis.gridOpacity", "axes.yAxis.labelColor", "axes.yAxis.prefix", "axes.yAxis.suffix", "axes.yAxis.tickCount",
    "domain.maxValue", "domain.maxX", "domain.minValue", "domain.minX",
    "labels", "legend.color", "legend.fontSize", "line.area.color", "line.area.opacity",
    "points.highlightIndex", "points.pointBorder.color", "points.pointBorder.width", "points.pointColor", "points.pointRadius",
    "seriesLabels", "titles.subtitle", "titles.title", "titles.titleColor", "titles.titleSize", "values",
  ],
  unbound: {
    "line.lineColor": "single value (a list binds per series)",
    "line.strokeWidth": "single value (a list binds per series)",
    "domain.xValues": "derived by default (its elements ride the x labels once set)",
    "appearance.padding": "geometry",
    "axes.xAxis.tickLength": "tick marks are off by default",
    "axes.xAxis.tickColor": "tick marks are off by default",
    "axes.yAxis.tickLength": "tick marks are off by default",
    "axes.yAxis.tickColor": "tick marks are off by default",
    "axes.xAxis.gridColor": "x gridlines are off by default",
    "axes.xAxis.gridOpacity": "x gridlines are off by default",
    "valueLabels.decimals": "value labels are off by default",
    "valueLabels.color": "value labels are off by default",
    "valueLabels.fontSize": "value labels are off by default",
    "anim.intro.durationSec": "timing",
    "anim.intro.delaySec": "timing",
    "anim.intro.staggerSec": "timing",
    "theme.slug": "theme source",
    "theme.preset": "theme source",
    "theme.namespace": "theme source",
  },
});

describe("@m0saic/charts/line-chart/v2 — handles", () => {
  const FULL = {
    axes: { xAxis: { show: true, showLabels: true, fontSize: 13, showTicks: true, tickLength: 6, showGrid: true, gridOpacity: 0.5 }, yAxis: { show: true, showLabels: true, fontSize: 13, showTicks: true, tickLength: 6, showGrid: true, gridOpacity: 1, format: "raw", decimals: 0 } },
    valueLabels: { show: true, format: "compact", decimals: 0, fontSize: 12 },
  };

  it("v1 bound 5 props at defaults; v2 binds 37 — and nothing is rejected", async () => {
    const ctx = ctxFor(ChartsLineChartV2);
    const before = handlesOf(await ChartsLineChart.render({ ...ChartsLineChart.defaultProps } as never, ctx), ChartsLineChart, ctx).keys;
    const after = handlesOf(await render({}), ChartsLineChartV2, ctx);
    expect(before).toEqual(["labels", "seriesLabels", "titles.subtitle", "titles.title"]);
    expect(after.keys).toHaveLength(37);
    expect(after.rejected).toEqual([]);
  });

  it("what is off by default is bound the moment it is shown (ticks, x grid, value labels)", async () => {
    const ctx = ctxFor(ChartsLineChartV2);
    const h = handlesOf(await render(FULL), ChartsLineChartV2, ctx);
    expect(h.rejected).toEqual([]);
    for (const key of ["axes.xAxis.tickColor", "axes.xAxis.tickLength", "axes.yAxis.tickColor", "axes.yAxis.tickLength", "axes.xAxis.gridColor", "axes.xAxis.gridOpacity", "valueLabels.decimals", "valueLabels.color", "valueLabels.fontSize"]) {
      expect(h.keys).toContain(key);
    }
  });

  it("an x label stands for its data point: it carries the label, then the value", async () => {
    expect(entriesOn(await render({}), "x-label").slice(0, 2)).toEqual([
      { propKey: "labels", index: 0 },
      { propKey: "values", path: [0], kind: "number" },
    ]);
    const multi = await render({ values: [[3, 9], [5, 2]], labels: ["a", "b"] });
    expect(entriesOn(multi, "x-label")[1]).toEqual({ propKey: "values", path: [0, 0], kind: "number" });
  });

  const SERIES_STYLE = ["points.pointRadius", "points.pointColor", "points.pointBorder.color", "points.pointBorder.width", "points.highlightIndex", "line.area.color", "line.area.opacity"];

  it("a list of line colours / widths rides the legend swatches, then the series' styling; the single form is declared", async () => {
    const one = await render({ line: { ...(ChartsLineChartV2.defaultProps as { line: object }).line, lineColor: ["#22cc88"], strokeWidth: [3] } });
    expect(keysOn(one, "legend-swatch")).toEqual(["line.lineColor", "line.strokeWidth", ...SERIES_STYLE]);
    expect(keysOn(await render({}), "legend-swatch")).toEqual(SERIES_STYLE);
  });

  it("the full-frame data layers carry no handle — a click looks through them to the chrome (2026-10-04)", async () => {
    for (const props of [{}, FULL, { values: [[3, 9, 4], [5, 2, 8]], labels: ["a", "b", "c"], seriesLabels: ["A", "B"] }]) {
      const doc = await render(props);
      const series = (doc.sources as Array<{ editor?: { label?: string; bindings?: unknown[]; binding?: unknown } }>).filter((s) => s.editor?.label === "series");
      expect(series.length).toBeGreaterThan(0);
      expect(series.every((s) => !s.editor?.bindings?.length && !s.editor?.binding)).toBe(true);
    }
  });

  it("the card carries its colour, rounding, border and image", async () => {
    expect(keysOn(await render({}), "card")).toEqual(["appearance.backgroundColor", "appearance.cornerRadius", "appearance.border.color", "appearance.border.alpha", "appearance.backgroundImage"]);
  });

  it("standalone has no full-canvas tile; nested restores it", async () => {
    const solo = await render({});
    const nested = await render({ useNestedBackgroundColor: true });
    expect(nested.sources.length).toBe(solo.sources.length + 1);
    expect((nested.sources[0] as { color?: string }).color).toBe(solo.backgroundColor);
    expect(keysOn(solo, "card").length).toBeGreaterThan(0); // the card, not a canvas tile, is the first rect
    expect((solo.sources[0] as { editor?: { label?: string } }).editor?.label).toBe("card");
  });

  it("no values is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ values: [] }))).toBe("incomplete");
  });
});
