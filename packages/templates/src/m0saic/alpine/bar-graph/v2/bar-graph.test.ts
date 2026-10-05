import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineBarGraph } from "../v1/bar-graph";
import { AlpineBarGraphV2 } from "./bar-graph";

const D = AlpineBarGraphV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineBarGraphV2.render({ ...D, ...props } as never, ctxFor(AlpineBarGraphV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineBarGraphV2,
  prev: AlpineBarGraph,
  cases: [
    { name: "vertical, dark, static", props: { orientation: "vertical", preset: "dark", anim: { reduceMotion: true } } },
    { name: "no header, no labels, light mode", props: { title: "", subtitle: "", labels: [], anim: { renderMode: "light" } } },
    { name: "portrait, thick bars, suffix", props: { bars: { gap: 0.4, cornerRadius: 0.2, thickness: 0.8 }, valueLabels: { show: true, format: "plain", decimals: 1, suffix: "%" }, barColor: "#22cc88" }, w: 720, h: 1280 },
    { name: "no grid, no value labels", props: { grid: { show: false, count: 4 }, valueLabels: { show: false, format: "compact", decimals: 0 } } },
  ],
  bound: ["barColor", "bars.cornerRadius", "bars.thickness", "domain.maxValue", "domain.minValue", "grid.count", "labels", "preset", "subtitle", "title", "valueLabels.decimals", "valueLabels.suffix", "values"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing", "bars.gap": "geometry" },
});

describe("@m0saic/alpine/bar-graph/v2 — handles", () => {
  it("a bar carries its value and colour (v1), then its rounding and thickness", async () => {
    expect(entriesOn(await render({}), "bar")).toEqual([
      { propKey: "values", index: 0 },
      { propKey: "barColor" },
      { propKey: "bars.cornerRadius" },
      { propKey: "bars.thickness" },
    ]);
  });

  it("a value label carries its suffix and precision; an axis tick the grid density and the domain", async () => {
    const doc = await render({});
    expect(keysOn(doc, "value-label")).toEqual(["values", "valueLabels.suffix", "valueLabels.decimals"]);
    expect(keysOn(doc, "axis-tick")).toEqual(["grid.count", "domain.minValue", "domain.maxValue"]);
  });

  it("no header: title + subtitle ride the first category label — or the first bar when there are no labels", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "cat-label")).toEqual(["labels", "title", "subtitle"]);
    expect(keysOn(await render({ title: "", subtitle: "", labels: [] }), "bar")).toEqual(["values", "barColor", "bars.cornerRadius", "bars.thickness", "title", "subtitle"]);
  });

  it("no values is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ values: [] }))).toBe("incomplete");
  });
});
