import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { DonutV4 } from "../v4/donut";
import { DonutV5 } from "./donut";

const D = DonutV5.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await DonutV5.render({ ...D, ...props } as never, ctxFor(DonutV5, { w, h }))) as MosaicDocument;

vnextSuite({
  next: DonutV5,
  prev: DonutV4,
  catalog: { primitive: true },
  // v4 painted its canvas as a full-frame tile; v5 paints it as the document
  // background, and a nesting parent asks for the tile back — which is v4's paint.
  parityNextProps: { useNestedBackgroundColor: true },
  cases: [
    { name: "light mode, static, no slice labels", props: { renderMode: "light", segmentLabels: "none", anim: { reduceMotion: true } } },
    { name: "fade, no caption, palette colours", props: { centerLabel: "", anim: { mode: "fade" }, segments: [{ label: "A", value: 3 }, { label: "B", value: 9 }] } },
    { name: "transparent (none), wide canvas, thin ring", props: { backgroundColor: "none", ringThicknessFrac: 0.15 }, w: 640, h: 360 },
    { name: "light mode, custom canvas colour", props: { renderMode: "light", backgroundColor: "#203040" } },
  ],
  bound: ["centerLabel", "centerValue", "ringThicknessFrac", "segments"],
  unbound: { backgroundColor: "document background", "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing", "anim.introMs": "timing" },
});

describe("@m0saic/charts/donut/v5 — handles + canvas", () => {
  it.each(["premium", "light"])("%s: standalone has no full-canvas tile; the canvas is document.backgroundColor", async (renderMode) => {
    const doc = await render({ renderMode });
    expect(doc.backgroundColor).toBe("#161b22");
    expect((doc.sources as Array<{ type?: string; color?: string; mask?: unknown }>).some((s) => s.type === "lavfi" && s.color === "#161b22" && !s.mask)).toBe(false);
  });

  it("nested: the hidden flag restores the base tile, bound to the colour it paints", async () => {
    const doc = await render({ useNestedBackgroundColor: true });
    expect((doc.sources[0] as { color?: string; editor?: { binding?: unknown } }).color).toBe("#161b22");
    expect((doc.sources[0] as { editor?: { binding?: unknown } }).editor?.binding).toEqual({ propKey: "backgroundColor" });
  });

  it.each(["premium", "light"])("%s: a slice carries its colour, then the ring thickness", async (renderMode) => {
    expect(entriesOn(await render({ renderMode, anim: { reduceMotion: true } }), "sector")).toEqual([
      { propKey: "segments", path: [0, "color"], kind: "color" },
      { propKey: "ringThicknessFrac" },
    ]);
  });

  it("the centre value offers the caption only while there is none", async () => {
    expect(keysOn(await render({ centerLabel: "" }), "center-value")).toEqual(["centerValue", "centerLabel"]);
    expect(keysOn(await render({}), "center-value")).toEqual(["centerValue"]);
  });

  it("no segments is an input the chart waits on, never a throw", async () => {
    expect(renderStatusOf(await render({ segments: [] }))).toBe("incomplete");
  });
});
