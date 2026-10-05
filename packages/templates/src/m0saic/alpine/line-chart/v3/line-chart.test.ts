import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineLineChartV2 } from "../v2/line-chart";
import { AlpineLineChartV3 } from "./line-chart";

const D = AlpineLineChartV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineLineChartV3.render({ ...D, ...props } as never, ctxFor(AlpineLineChartV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineLineChartV3,
  prev: AlpineLineChartV2,
  catalog: { primitive: true },
  cases: [
    { name: "dark, stepped, no header, static", props: { preset: "dark", curve: "stepped", title: "", subtitle: "", anim: { reduceMotion: true } } },
    { name: "no labels, no area, no points, no grid", props: { labels: [], area: { show: false, opacity: 0.2 }, points: { show: false }, grid: { show: false, count: 4 } } },
    { name: "portrait, linear, domain, colour", props: { curve: "linear", domain: { minValue: 0, maxValue: 200 }, lineColor: "#22cc88", showTicks: false }, w: 720, h: 1280 },
  ],
  bound: ["area.opacity", "domain.maxValue", "domain.minValue", "grid.count", "labels", "lineColor", "preset", "subtitle", "title", "values"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/line-chart/v3 — handles", () => {
  it("an x label stands for its data point: it carries the label and the VALUE (v2 bound no value at all)", async () => {
    expect(entriesOn(await render({}), "x-label")).toEqual([
      { propKey: "labels", index: 0 },
      { propKey: "values", index: 0 },
    ]);
  });

  it("a y tick carries the grid density and the domain", async () => {
    expect(keysOn(await render({}), "y-tick-label")).toEqual(["grid.count", "domain.minValue", "domain.maxValue"]);
  });

  it("no header: title + subtitle ride the first x label", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "x-label")).toEqual(["labels", "values", "title", "subtitle"]);
  });

  it("no values is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ values: [] }))).toBe("incomplete");
  });
});
