import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineDonutV3 } from "../v3/donut";
import { AlpineDonutV4 } from "./donut";

const D = AlpineDonutV4.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineDonutV4.render({ ...D, ...props } as never, ctxFor(AlpineDonutV4, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineDonutV4,
  prev: AlpineDonutV3,
  catalog: { primitive: true },
  cases: [
    { name: "dark, no header, static, no legend", props: { preset: "dark", title: "", subtitle: "", legend: "none", anim: { reduceMotion: true } } },
    { name: "light mode, no slice labels, caption", props: { anim: { renderMode: "light" }, segmentLabels: "none", centerValue: "128", centerLabel: "orders" } },
    { name: "portrait, thin ring, palette colours", props: { ringThicknessFrac: 0.2, segments: [{ label: "A", value: 3 }, { label: "B", value: 9 }, { label: "C", value: 1 }] }, w: 720, h: 1280 },
  ],
  bound: ["centerLabel", "centerValue", "preset", "ringThicknessFrac", "segments", "subtitle", "title"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/donut/v4 — handles", () => {
  it("a slice carries its colour (v3), then the ring thickness it shows", async () => {
    expect(entriesOn(await render({}), "sector")).toEqual([
      { propKey: "segments", path: [0, "color"], kind: "color" },
      { propKey: "ringThicknessFrac" },
    ]);
  });

  it("the centre value offers the caption only while there is none", async () => {
    expect(keysOn(await render({ centerLabel: "" }), "center-value")).toEqual(["centerValue", "centerLabel"]);
    const doc = await render({ centerLabel: "orders" });
    expect(keysOn(doc, "center-value")).toEqual(["centerValue"]);
    expect(keysOn(doc, "center-label")).toEqual(["centerLabel"]);
  });

  it("no header: title + subtitle ride the centre value", async () => {
    expect(keysOn(await render({ title: "", subtitle: "", centerLabel: "orders" }), "center-value")).toEqual(["centerValue", "title", "subtitle"]);
  });

  it("no segments is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ segments: [] }))).toBe("incomplete");
  });
});
