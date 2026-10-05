import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, docsOf, entriesOn, handlesOf, renderStatusOf, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { BlurRegions } from "../v1/blur-regions";
import { BlurRegionsV2 } from "./blur-regions";

const D = BlurRegionsV2.defaultProps as Record<string, unknown>;
const VIDEO = "/clips/sample.mp4";
const IMAGE = "/clips/still.png";
const MEDIA = {
  [VIDEO]: { kind: "video", width: 1280, height: 720, durationMs: 4000, fps: 30, originalFileName: "sample.mp4" },
  [IMAGE]: { kind: "image", width: 1200, height: 800, originalFileName: "still.png" },
};
const REGIONS = [{ x: 100, y: 80, w: 240, h: 160 }, { x: 640, y: 300, w: 200, h: 200 }];
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await BlurRegionsV2.render({ ...D, ...props } as never, ctxFor(BlurRegionsV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: BlurRegionsV2,
  prev: BlurRegions,
  // v1 showed a "missing source" card at defaults; v2 shows the stand-in slot.
  defaultsParity: false,
  cases: [
    { name: "video, no regions (the drawing surface)", props: { sourceId: VIDEO }, media: MEDIA },
    { name: "video, two regions, inset", props: { sourceId: VIDEO, regions: { regions: REGIONS } }, media: MEDIA },
    { name: "image, pixelate, exact", props: { sourceId: IMAGE, regions: REGIONS, mode: "pixelate", strength: 16, geometry: "exact" }, media: MEDIA },
    { name: "video, mask geometry", props: { sourceId: VIDEO, regions: { regions: REGIONS }, geometry: "mask" }, media: MEDIA },
    { name: "m0 layout regions", props: { sourceId: VIDEO, regions: "2(F,-)" }, media: MEDIA },
  ],
  bound: ["sourceId", "strength"],
  unbound: { regions: "drawn on the footage" },
});

describe("@m0saic/media/blur-regions/v2 — the slot before the footage", () => {
  it("no source: a drop slot marked incomplete (v1: an error card)", async () => {
    const doc = await render({});
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect(entriesOn(doc, "stand-in-slot")).toEqual([{ propKey: "sourceId" }, { propKey: "strength" }]);
    expect(Object.keys(doc.assets ?? {})).toEqual([]);
  });
});

describe("@m0saic/media/blur-regions/v2 — handles with footage", () => {
  const ctx = ctxFor(BlurRegionsV2, { media: MEDIA });
  const step = async (props: Record<string, unknown>) => docsOf(await BlurRegionsV2.render({ ...D, ...props } as never, ctx))[0];

  it("the footage takes a dropped file, opens the region draw session, and shows the strength", async () => {
    const doc = await step({ sourceId: VIDEO });
    // index 0 of an empty list = the handle to draw the FIRST region
    expect(entriesOn(doc, "blur-regions:base")).toEqual([{ propKey: "sourceId" }, { propKey: "regions", index: 0, kind: "rect" }, { propKey: "strength" }]);
    expect(handlesOf(doc, BlurRegionsV2, ctx).rejected).toEqual([]);
  });

  it("each region cell is the handle for ITS element of the list (matched by rect, not by paint order)", async () => {
    const doc = await step({ sourceId: VIDEO, regions: { regions: REGIONS } });
    const cells = sourcesOf(doc).filter((s) => s.editor?.label === "blur-regions:region");
    expect(cells).toHaveLength(2);
    const byIndex = cells.map((c) => ({
      index: (c.editor?.bindings as Array<{ propKey: string; index?: number }>)[0].index,
      rect: (c as unknown as { placement: { sourceRect: { x: number } } }).placement.sourceRect.x,
    }));
    for (const b of byIndex) expect(REGIONS[b.index!].x).toBe(b.rect);
    expect(handlesOf(doc, BlurRegionsV2, ctx).rejected).toEqual([]);
  });

  it("with regions the footage offers the NEXT one; an m0 layout (no list) carries the strength alone", async () => {
    const two = await step({ sourceId: VIDEO, regions: { regions: REGIONS } });
    expect(entriesOn(two, "blur-regions:base")[1]).toEqual({ propKey: "regions", index: 2, kind: "rect" });
    const m0 = await step({ sourceId: VIDEO, regions: "2(F,-)" });
    expect(entriesOn(m0, "blur-regions:region")).toEqual([{ propKey: "strength" }]);
    expect(handlesOf(m0, BlurRegionsV2, ctx).rejected).toEqual([]);
    const mask = await step({ sourceId: VIDEO, regions: { regions: REGIONS }, geometry: "mask" });
    expect(handlesOf(mask, BlurRegionsV2, ctx).rejected).toEqual([]);
  });
});
