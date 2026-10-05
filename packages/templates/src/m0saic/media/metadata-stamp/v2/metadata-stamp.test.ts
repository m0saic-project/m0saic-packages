import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, docsOf, entriesOn, handlesOf, keysOn, renderStatusOf, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { MetadataStampV1 } from "../v1/metadata-stamp";
import { MetadataStampV2 } from "./metadata-stamp";

const D = MetadataStampV2.defaultProps as Record<string, unknown>;
const TAGGED = "/tmp/in/holiday.mp4";
const BARE = "/tmp/in/stripped.mp4";
const IMAGE = "/tmp/in/photo.jpg";
const MEDIA = {
  [TAGGED]: { kind: "video", width: 1280, height: 720, durationMs: 4000, fps: 30, originalFileName: "holiday.mp4", tags: { creation_time: "2024-03-11T18:22:04.000000Z" } },
  [BARE]: { kind: "video", width: 1280, height: 720, durationMs: 3000, fps: 30, originalFileName: "stripped.mp4" },
  [IMAGE]: { kind: "image", width: 800, height: 600, originalFileName: "photo.jpg" },
};
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await MetadataStampV2.render({ ...D, ...props } as never, ctxFor(MetadataStampV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: MetadataStampV2,
  prev: MetadataStampV1,
  // v1 showed a "missing source" card at defaults; v2 shows the stamp over a drop slot.
  defaultsParity: false,
  cases: [
    { name: "tagged video, default stamp", props: { sourceIds: [TAGGED] }, media: MEDIA },
    { name: "batch: tagged + bare (pass-through) + an image (error step)", props: { sourceIds: [TAGGED, BARE, IMAGE] }, media: MEDIA },
    { name: "custom text, top-right, no chip, styled", props: { sourceIds: [TAGGED], stampField: "custom", customText: "REC ●", position: "top-right", chipOpacity: 0, fontColor: "#ffee00", sizeRatio: 0.08 }, media: MEDIA },
    { name: "filename, fallback text for the bare one", props: { sourceIds: [BARE], stampField: "creation-date", fallbackText: "undated" }, media: MEDIA },
  ],
  bound: ["chipColor", "chipOpacity", "customText", "fallbackText", "fontColor", "marginRatio", "sizeRatio", "sourceIds", "utcOffsetMinutes"],
  unbound: {},
});

describe("@m0saic/media/metadata-stamp/v2 — waiting on inputs", () => {
  it("no source: the real stamp over a drop slot, marked incomplete (v1: an error card)", async () => {
    const doc = await render({});
    expect(doc.sources.filter((x) => (x as { engine?: { renderStatus?: string } }).engine?.renderStatus === "incomplete")).toHaveLength(1);
    expect(entriesOn(doc, "mstamp:base")).toEqual([{ propKey: "sourceIds", index: 0 }]);
    expect(keysOn(doc, "mstamp:text")).toEqual(["customText", "fontColor", "fallbackText", "sizeRatio", "marginRatio", "utcOffsetMinutes"]);
    expect(keysOn(doc, "mstamp:chip")).toEqual(["chipColor", "chipOpacity"]);
    const text = sourcesOf(doc).find((x) => x.editor?.label === "mstamp:text") as unknown as { layers: Array<{ content: { text: string } }> };
    expect(text.layers[0].content.text).toBe("2026-01-31"); // the chosen date format, on a sample date
  });

  it("the stand-in follows the knobs: another format, a custom line, no chip", async () => {
    const stamped = (props: Record<string, unknown>) => render(props).then((d) => (sourcesOf(d).find((x) => x.editor?.label === "mstamp:text") as unknown as { layers: Array<{ content: { text: string } }> }).layers[0].content.text);
    expect(await stamped({ stampField: "custom", customText: "REC" })).toBe("REC");
    expect(await stamped({ stampField: "filename" })).toBe("your-video");
    expect(keysOn(await render({ chipOpacity: 0 }), "mstamp:text").slice(-2)).toEqual(["chipColor", "chipOpacity"]);
  });

  it('"custom" with no text yet: the footage shows, incomplete, and takes the text (v1: an error card)', async () => {
    const ctx = ctxFor(MetadataStampV2, { media: MEDIA });
    const file = await MetadataStampV2.render({ ...D, sourceIds: [TAGGED], stampField: "custom", customText: "" } as never, ctx);
    const [doc] = docsOf(file);
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect(keysOn(doc, "mstamp:base").slice(0, 2)).toEqual(["sourceIds", "customText"]);
    expect(handlesOf(file, MetadataStampV2, ctx).rejected).toEqual([]);
  });
});

describe("@m0saic/media/metadata-stamp/v2 — handles with footage", () => {
  const ctx = ctxFor(MetadataStampV2, { media: MEDIA });

  it("the footage takes a dropped file for ITS input; the stamp carries its placement; the chip its opacity", async () => {
    const file = await MetadataStampV2.render({ ...D, sourceIds: [BARE, TAGGED] } as never, ctx);
    const docs = docsOf(file);
    // BARE has no date and no fallback → passes through: the footage carries the text knobs.
    expect(keysOn(docs[0], "mstamp:base")).toEqual(["sourceIds", "customText", "fontColor", "fallbackText", "sizeRatio", "marginRatio", "utcOffsetMinutes", "chipColor", "chipOpacity"]);
    expect(entriesOn(docs[1], "mstamp:base")).toEqual([{ propKey: "sourceIds", index: 1 }]);
    expect(keysOn(docs[1], "mstamp:text")).toEqual(["customText", "fontColor", "fallbackText", "sizeRatio", "marginRatio", "utcOffsetMinutes"]);
    expect(keysOn(docs[1], "mstamp:chip")).toEqual(["chipColor", "chipOpacity"]);
    expect(handlesOf(file, MetadataStampV2, ctx).rejected).toEqual([]);
    expect(renderStatusOf(docs[1])).not.toBe("incomplete");
  });
});
