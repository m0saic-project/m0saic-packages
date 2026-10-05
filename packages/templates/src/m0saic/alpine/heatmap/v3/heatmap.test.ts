import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineHeatmapV2 } from "../v2/heatmap";
import { AlpineHeatmapV3 } from "./heatmap";

const D = AlpineHeatmapV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineHeatmapV3.render({ ...D, ...props } as never, ctxFor(AlpineHeatmapV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineHeatmapV3,
  prev: AlpineHeatmapV2,
  catalog: { primitive: true },
  cases: [
    { name: "dark, no header, static, values shown", props: { preset: "dark", title: "", subtitle: "", showValues: true, anim: { reduceMotion: true } } },
    { name: "no legend, no labels, light mode", props: { showLegend: false, colLabels: [], rows: [{ values: [1, 2, 3] }, { values: [4, 0, 9] }], anim: { renderMode: "light" } } },
    { name: "portrait, 3 levels, custom scale + hue", props: { levels: 3, color: "#22cc88", scale: { min: 1, max: 8, emptyColor: "#eeeeee", cellRadius: 0.5 } }, w: 720, h: 1280 },
  ],
  bound: ["colLabels", "color", "levels", "preset", "rows", "scale.cellRadius", "scale.emptyColor", "scale.max", "scale.min", "subtitle", "title"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/heatmap/v3 — handles", () => {
  it("the legend is the scale: its first swatch carries the low end, its last the high end, all of them the bucket count and rounding", async () => {
    const doc = await render({});
    const swatches = (doc.sources as Array<{ editor?: { label?: string; binding?: { propKey: string }; bindings?: Array<{ propKey: string }> } }>)
      .filter((s) => s.editor?.label === "legend-swatch")
      .map((s) => (s.editor?.bindings ?? (s.editor?.binding ? [s.editor.binding] : [])).map((b) => b.propKey));
    expect(swatches[0]).toEqual(["scale.emptyColor", "scale.min", "levels", "scale.cellRadius"]);
    expect(swatches[1]).toEqual(["levels", "scale.cellRadius"]);
    expect(swatches[swatches.length - 1]).toEqual(["color", "scale.max", "levels", "scale.cellRadius"]);
  });

  it("no header: title + subtitle ride the first row label", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "row-label")).toEqual(["rows", "title", "subtitle"]);
  });

  it("no rows is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ rows: [] }))).toBe("incomplete");
  });
});
