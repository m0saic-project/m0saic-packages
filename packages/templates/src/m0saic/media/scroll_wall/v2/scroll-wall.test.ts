import type { MosaicDocument } from "@m0saic/types";
import { countBound, ctxFor, entriesOn, handlesOf, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { ScrollWallV1 } from "../v1/scroll-wall";
import { ScrollWallV2 } from "./scroll-wall";

const D = ScrollWallV2.defaultProps as Record<string, unknown>;
const A = "/clips/a.mp4";
const B = "/clips/b.png";
const C = "/clips/c.jpg";
const MEDIA = {
  [A]: { kind: "video", width: 1280, height: 720, durationMs: 9000, fps: 30 },
  [B]: { kind: "image", width: 1200, height: 800 },
  [C]: { kind: "image", width: 800, height: 1200 },
};
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await ScrollWallV2.render({ ...D, ...props } as never, ctxFor(ScrollWallV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: ScrollWallV2,
  prev: ScrollWallV1,
  cases: [
    { name: "three clips (a video, two images), two rows", props: { clips: [A, B, C], rows: 2 }, media: MEDIA },
    { name: "one row, rightward, fixed speed, gap 24", props: { clips: [A, B], rows: 1, direction: "right", motion: { speedMode: "pxPerSec", pxPerSec: 240, cycles: 1, rowOffsetFrac: 0.5, alternateRowDirection: true, snapVelocityToFrameGrid: true }, tiles: { gapPx: 24, marginPx: 40, fit: "contain", backgroundColor: "#101820", clipWindowMs: 1000 } }, media: MEDIA },
    { name: "demo wall, portrait, no shuffle", props: { rows: 3, variation: { seed: 7, shuffle: false, staggerRepeats: false } }, w: 720, h: 1280 },
  ],
  bound: ["clips", "motion.cycles", "motion.pxPerSec", "motion.rowOffsetFrac", "rows", "tiles.clipWindowMs", "tiles.gapPx", "tiles.marginPx", "variation.seed", "visibleCount"],
  unbound: {},
});

describe("@m0saic/media/scroll_wall/v2 — handles", () => {
  it("demo wall: every tile is the ADD handle for the first clip and carries the wall's shape and motion", async () => {
    const doc = await render({});
    expect(entriesOn(doc, "clip:r0:i0")).toEqual([
      { propKey: "clips", index: 0 },
      { propKey: "rows" },
      { propKey: "visibleCount" },
      { propKey: "tiles.gapPx" },
      { propKey: "tiles.marginPx" },
      { propKey: "tiles.clipWindowMs" },
      { propKey: "motion.cycles" },
      { propKey: "motion.pxPerSec" },
      { propKey: "motion.rowOffsetFrac" },
      { propKey: "variation.seed" },
    ]);
    expect(countBound(doc, "clips")).toBe(doc.sources.length);
  });

  // Founder 2026-10-01: "dragging one video into one cell sets it for ALL
  // cells". The wall cycles its list, so one clip fills every slot — and with
  // every showing bound to the same element a second drop could only replace
  // it. The FIRST showing of a clip edits that clip; every repeat ADDS.
  it("with clips: the first tile showing a clip edits THAT clip; every repeat is the ADD handle", async () => {
    const ctx = ctxFor(ScrollWallV2, { media: MEDIA });
    const doc = (await ScrollWallV2.render({ ...D, clips: [A, B, C], variation: { seed: 1, shuffle: false, staggerRepeats: false } } as never, ctx)) as MosaicDocument;
    const tiles = sourcesOf(doc).filter((x) => /^clip:r\d+:/.test(x.editor?.label ?? ""));
    const own = new Map<string, number>();
    let adds = 0;
    for (const t of tiles) {
      const index = (t.editor?.bindings as Array<{ propKey: string; index?: number }>)[0].index!;
      const shown = (doc.assets as Record<string, { path: string }>)[(t as unknown as { assetId: string }).assetId].path;
      if (index === 3) { adds++; continue; }
      expect([A, B, C][index]).toBe(shown);
      expect(own.has(shown)).toBe(false);
      own.set(shown, index);
    }
    // Each clip is owned by exactly one tile; the rest of the wall adds.
    expect([...own.keys()].sort()).toEqual([A, B, C].sort());
    expect(adds).toBe(tiles.length - 3);
    expect(handlesOf(doc, ScrollWallV2, ctx).rejected).toEqual([]);
  });

  it("one clip: the first tile edits it, every other tile adds the second (the wall never stops at one)", async () => {
    const ctx = ctxFor(ScrollWallV2, { media: MEDIA });
    const doc = (await ScrollWallV2.render({ ...D, clips: [A], variation: { seed: 1, shuffle: false, staggerRepeats: false } } as never, ctx)) as MosaicDocument;
    const indices = sourcesOf(doc)
      .filter((x) => /^clip:r\d+:/.test(x.editor?.label ?? ""))
      .map((t) => (t.editor?.bindings as Array<{ propKey: string; index?: number }>)[0].index);
    expect(indices.filter((i) => i === 0)).toHaveLength(1);
    expect(indices.filter((i) => i === 1)).toHaveLength(indices.length - 1);
  });
});
