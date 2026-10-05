import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { ChartsBarGraphV2 } from "../v2/bar-graph";
import { ChartsBarGraphV3 } from "./bar-graph";

const D = ChartsBarGraphV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await ChartsBarGraphV3.render({ ...D, ...props } as never, ctxFor(ChartsBarGraphV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: ChartsBarGraphV3,
  prev: ChartsBarGraphV2,
  catalog: { primitive: true },
  cases: [
    { name: "horizontal, titled, static", props: { layout: { orientation: "horizontal", gap: 0.3, padding: 48, cornerRadius: 0.05 }, titles: { title: "Revenue", subtitle: "by month" }, anim: { renderMode: "premium", reduceMotion: true } } },
    { name: "paper preset, palette array, light mode", props: { appearance: { preset: "paper", barColor: ["#22cc88", "#aa33ff"] }, anim: { renderMode: "light" } } },
    { name: "no labels, no grid, no value labels, portrait", props: { labels: [], grid: { show: false, count: 4 }, valueLabels: { show: false, format: "raw", decimals: 0 } }, w: 720, h: 1280 },
  ],
  bound: ["domain.maxValue", "domain.minValue", "grid.count", "labels", "layout.barThickness", "layout.cornerRadius", "layout.padding", "titles.subtitle", "titles.title", "valueLabels.decimals", "valueLabels.suffix", "values"],
  unbound: {
    "layout.gap": "geometry",
    "appearance.barColor": "single value (a list binds per bar)",
    "anim.intro.durationSec": "timing",
    "anim.intro.delaySec": "timing",
    "anim.intro.staggerSec": "timing",
    "theme.slug": "theme source",
    "theme.preset": "theme source",
    "theme.namespace": "theme source",
  },
});

describe("@m0saic/charts/bar-graph/v3 — handles", () => {
  it("a bar carries its value (v2), then its thickness", async () => {
    expect(entriesOn(await render({}), "bar")).toEqual([{ propKey: "values", index: 0 }, { propKey: "layout.barThickness" }]);
  });

  it("a palette array: each bar carries the element that paints it", async () => {
    const doc = await render({ appearance: { preset: "dark", barColor: ["#22cc88", "#aa33ff"] }, anim: { reduceMotion: true } });
    const bars = sourcesOf(doc).filter((s) => s.editor?.label === "bar");
    expect(bars.map((b) => (b.editor?.bindings as Array<{ propKey: string; path?: unknown[] }> | undefined)?.find((e) => e.propKey === "appearance.barColor")?.path)).toEqual([[0], [1], [0], [1], [0]]);
  });

  it("the card carries its rounding and padding; ticks the grid and the domain; value labels their format", async () => {
    const doc = await render({});
    expect(keysOn(doc, "card")).toEqual(["layout.cornerRadius", "layout.padding"]);
    expect(keysOn(doc, "axis-tick")).toEqual(["grid.count", "domain.minValue", "domain.maxValue"]);
    expect(keysOn(doc, "value-label")).toEqual(["values", "valueLabels.suffix", "valueLabels.decimals"]);
  });

  it("no title band: the first category label offers one; a title-only header carries the subtitle", async () => {
    expect(keysOn(await render({}), "cat-label")).toEqual(["labels", "titles.title", "titles.subtitle"]);
    expect(keysOn(await render({ titles: { title: "Revenue" } }), "chart-header")).toEqual(["titles.title", "titles.subtitle"]);
  });

  it("no values is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ values: [] }))).toBe("incomplete");
  });
});
