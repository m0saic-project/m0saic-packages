import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, docsOf, entriesOn, handlesOf, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { FrameStripper } from "../v1/video-to-png-sequence";
import { FrameStripperV2 } from "./video-to-png-sequence";

const D = FrameStripperV2.defaultProps as Record<string, unknown>;
const A = "/abs/media/alpha.mp4";
const B = "/abs/media/beta.mp4";
const video = (durationMs: number) => ({ kind: "video", width: 640, height: 360, hasVideo: true, hasAudio: false, durationMs, fps: 30 });
const MEDIA = { [A]: video(1000), [B]: video(700) };
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await FrameStripperV2.render({ ...D, ...props } as never, ctxFor(FrameStripperV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: FrameStripperV2,
  prev: FrameStripper,
  // v1 showed a "missing source" card at defaults; v2 shows the stand-in slot.
  defaultsParity: false,
  cases: [
    { name: "one video, capped at 6 frames", props: { sourceIds: [A], maxFrames: 6 }, media: MEDIA },
    { name: "two videos, a clip window", props: { sourceIds: [A, B], clipStartMs: 200, clipEndMs: 500 }, media: MEDIA },
    { name: "an inverted clip window (the error card)", props: { sourceIds: [A], clipStartMs: 500, clipEndMs: 100 }, media: MEDIA },
  ],
  bound: ["maxFrames", "sourceIds"],
  unbound: {},
});

describe("@m0saic/media/video_to_png_sequence/v2 — handles", () => {
  const ctx = ctxFor(FrameStripperV2, { media: MEDIA });

  it("no source: a drop slot marked incomplete (v1: an error card)", async () => {
    const doc = await render({});
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect(entriesOn(doc, "stand-in-slot")).toEqual([{ propKey: "sourceIds", index: 0 }, { propKey: "maxFrames" }]);
  });

  it("every frame takes a dropped file for ITS input and carries the frame cap", async () => {
    const file = await FrameStripperV2.render({ ...D, sourceIds: [A, B], maxFrames: 3 } as never, ctx);
    const docs = docsOf(file);
    expect(docs).toHaveLength(6);
    expect(entriesOn(docs[0], "frame")).toEqual([{ propKey: "sourceIds", index: 0 }, { propKey: "maxFrames" }]);
    expect(entriesOn(docs[5], "frame")[0]).toEqual({ propKey: "sourceIds", index: 1 });
    expect(handlesOf(file, FrameStripperV2, ctx).rejected).toEqual([]);
  });
});
