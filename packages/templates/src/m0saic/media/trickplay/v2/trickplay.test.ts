import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, docsOf, entriesOn, handlesOf, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { Trickplay } from "../v1/trickplay";
import { TrickplayV2 } from "./trickplay";

const D = TrickplayV2.defaultProps as Record<string, unknown>;
const A = "/abs/media/alpha.mp4";
const B = "/abs/media/beta.mp4";
const video = (durationMs: number) => ({ kind: "video", width: 1280, height: 720, hasVideo: true, hasAudio: true, durationMs, fps: 30 });
const MEDIA = { [A]: video(95_000), [B]: video(31_000) };
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await TrickplayV2.render({ ...D, ...props } as never, ctxFor(TrickplayV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: TrickplayV2,
  prev: Trickplay,
  // v1 showed a "missing source" card at defaults; v2 shows the stand-in slot.
  defaultsParity: false,
  cases: [
    { name: "one video, default sheets", props: { sourceIds: [A] }, media: MEDIA },
    { name: "two videos, jpeg, 5 × 4 sheets at 2 s", props: { sourceIds: [A, B], outputFormat: "jpeg", cols: 5, rowsPerSheet: 4, intervalSec: 2, tileWidth: 160 }, media: MEDIA },
    { name: "animated sheet", props: { sourceIds: [A], outputFormat: "mp4" }, media: MEDIA },
    { name: "an unprobed input beside a good one (error step in place)", props: { sourceIds: ["/abs/media/missing.mp4", A] }, media: MEDIA },
  ],
  bound: ["cols", "intervalSec", "rowsPerSheet", "sourceIds", "tileWidth"],
  unbound: {},
});

describe("@m0saic/media/trickplay/v2 — handles", () => {
  const ctx = ctxFor(TrickplayV2, { media: MEDIA });

  it("no source: a drop slot marked incomplete, carrying the sheet's shape (v1: an error card)", async () => {
    const doc = await render({});
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect(entriesOn(doc, "stand-in-slot")).toEqual([
      { propKey: "sourceIds", index: 0 },
      { propKey: "intervalSec" },
      { propKey: "tileWidth" },
      { propKey: "cols" },
      { propKey: "rowsPerSheet" },
    ]);
  });

  it("every frame tile takes a dropped file for ITS input and carries the sheet's shape", async () => {
    const file = await TrickplayV2.render({ ...D, sourceIds: [A, B] } as never, ctx);
    const docs = docsOf(file);
    expect(entriesOn(docs[0], "frame")[0]).toEqual({ propKey: "sourceIds", index: 0 });
    expect(entriesOn(docs[docs.length - 1], "frame")[0]).toEqual({ propKey: "sourceIds", index: 1 });
    expect(keysOn(docs[0], "frame")).toEqual(["sourceIds", "intervalSec", "tileWidth", "cols", "rowsPerSheet"]);
    expect(handlesOf(file, TrickplayV2, ctx).rejected).toEqual([]);
  });
});
