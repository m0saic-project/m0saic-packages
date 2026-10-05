import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, docsOf, entriesOn, handlesOf, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { Highlights } from "../v1/highlights";
import { HighlightsV2 } from "./highlights";

const D = HighlightsV2.defaultProps as Record<string, unknown>;
const VIDEO = "/clips/sample.mp4";
const MEDIA = { [VIDEO]: { kind: "video", width: 1280, height: 720, durationMs: 60000, fps: 30, originalFileName: "sample.mp4" } };
const RANGES = [{ startMs: 1000, endMs: 4000, label: "Intro" }, { startMs: 10000, endMs: 12500 }];
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await HighlightsV2.render({ ...D, ...props } as never, ctxFor(HighlightsV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: HighlightsV2,
  prev: Highlights,
  // v1 showed a "missing source" card at defaults; v2 shows the stand-in slot.
  defaultsParity: false,
  cases: [
    { name: "two ranges", props: { sourceId: VIDEO, ranges: RANGES }, media: MEDIA },
    { name: "one range, webm, muted, width cap", props: { sourceId: VIDEO, ranges: [RANGES[0]], outputFormat: "webm", muteAudio: true, maxWidth: 640 }, media: MEDIA },
    { name: "a bad range beside a good one (error step in place)", props: { sourceId: VIDEO, ranges: [{ startMs: 99000, endMs: 99500 }, RANGES[1]] }, media: MEDIA },
  ],
  bound: ["maxWidth", "sourceId"],
  unbound: { ranges: "marked on the footage" },
});

describe("@m0saic/media/highlights/v2 — waiting on inputs", () => {
  const ctx = ctxFor(HighlightsV2, { media: MEDIA });

  it("no source: a drop slot marked incomplete (v1: an error card)", async () => {
    const doc = await render({});
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect(entriesOn(doc, "stand-in-slot")).toEqual([{ propKey: "sourceId" }, { propKey: "maxWidth" }]);
  });

  it("a source but no ranges: the FOOTAGE, incomplete, offering the first range's fields (v1: an error card)", async () => {
    const doc = (await HighlightsV2.render({ ...D, sourceId: VIDEO } as never, ctx)) as MosaicDocument;
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect((doc.sources[0] as { type?: string }).type).toBe("media");
    expect(entriesOn(doc, "footage")).toEqual([
      { propKey: "sourceId" },
      { propKey: "ranges", path: [0, "label"], kind: "string" },
      { propKey: "ranges", path: [0, "startMs"], kind: "number" },
      { propKey: "ranges", path: [0, "endMs"], kind: "number" },
      { propKey: "maxWidth" },
    ]);
    expect(handlesOf(doc, HighlightsV2, ctx).rejected).toEqual([]);
  });
});

describe("@m0saic/media/highlights/v2 — handles with footage", () => {
  const ctx = ctxFor(HighlightsV2, { media: MEDIA });

  it("clip i carries range i's label and bounds, takes a dropped file, shows the width cap", async () => {
    const file = await HighlightsV2.render({ ...D, sourceId: VIDEO, ranges: RANGES } as never, ctx);
    const docs = docsOf(file);
    expect(docs).toHaveLength(2);
    expect(entriesOn(docs[1], "clip")).toEqual([
      { propKey: "ranges", path: [1, "label"], kind: "string" },
      { propKey: "ranges", path: [1, "startMs"], kind: "number" },
      { propKey: "ranges", path: [1, "endMs"], kind: "number" },
      { propKey: "sourceId" },
      { propKey: "maxWidth" },
    ]);
    expect(handlesOf(file, HighlightsV2, ctx).rejected).toEqual([]);
    expect(renderStatusOf(docs[0])).toBeUndefined();
  });
});
