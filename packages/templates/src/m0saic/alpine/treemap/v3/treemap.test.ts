import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineTreemapV2 } from "../v2/treemap";
import { AlpineTreemapV3 } from "./treemap";

const D = AlpineTreemapV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineTreemapV3.render({ ...D, ...props } as never, ctxFor(AlpineTreemapV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineTreemapV3,
  prev: AlpineTreemapV2,
  catalog: { primitive: true },
  cases: [
    { name: "dark, no header, static, raw values", props: { preset: "dark", title: "", subtitle: "", valueMode: "value", anim: { reduceMotion: true } } },
    { name: "no values, light mode, square corners", props: { showValue: false, tiles: { cornerRadius: 0 }, anim: { renderMode: "light" } } },
    { name: "portrait, own colours", props: { items: [{ label: "A", value: 30, color: "#22cc88" }, { label: "B", value: 9 }, { label: "C", value: 4 }] }, w: 720, h: 1280 },
  ],
  bound: ["items", "preset", "subtitle", "tiles.cornerRadius", "title"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/treemap/v3 — handles", () => {
  it("a tile carries its value (v2), then its own colour and the shared rounding", async () => {
    const doc = await render({ items: [{ label: "small", value: 1 }, { label: "big", value: 9 }] });
    expect(entriesOn(doc, "tile")).toEqual([
      { propKey: "items", path: [1, "value"], kind: "number" },
      { propKey: "items", path: [1, "color"], kind: "color" },
      { propKey: "tiles.cornerRadius" },
    ]);
  });

  it("no header: title + subtitle ride the first tile's name", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "tile-name")).toEqual(["items", "title", "subtitle"]);
  });

  it("no items is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ items: [] }))).toBe("incomplete");
  });
});
