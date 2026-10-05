import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, docsOf, entriesOn, handlesOf, keysOn, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { WatermarkV1 } from "../v1/watermark";
import { WatermarkV2 } from "./watermark";

const D = WatermarkV2.defaultProps as Record<string, unknown>;
const VIDEO = "/tmp/in/clip.mp4";
const IMAGE = "/tmp/in/photo.jpg";
const LOGO = "/tmp/brand/logo.png";
const MEDIA = {
  [VIDEO]: { kind: "video", width: 1280, height: 720, durationMs: 8000, fps: 30 },
  [IMAGE]: { kind: "image", width: 3000, height: 2000 },
  [LOGO]: { kind: "image", width: 400, height: 100 },
};
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await WatermarkV2.render({ ...D, ...props } as never, ctxFor(WatermarkV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: WatermarkV2,
  prev: WatermarkV1,
  // v1 showed a "missing source" card at defaults; v2 shows the stamp over a drop slot.
  defaultsParity: false,
  cases: [
    { name: "video + logo, static", props: { sourceIds: [VIDEO], image: LOGO }, media: MEDIA },
    { name: "image + text, top-left, 40% opacity", props: { sourceIds: [IMAGE], content: "text", text: "studio.example", position: "top-left", opacity: 0.4 }, media: MEDIA },
    { name: "batch, lockup, text below", props: { sourceIds: [VIDEO, IMAGE], content: "lockup", image: LOGO, lockupLayout: "text-below" }, media: MEDIA },
    { name: "page pattern of text", props: { sourceIds: [IMAGE], mode: "page", content: "text", text: "DRAFT", angleDeg: -30 }, media: MEDIA },
    { name: "adaptive text (single variant)", props: { sourceIds: [VIDEO], mode: "adaptive", content: "text", variant: "single" }, media: MEDIA },
  ],
  bound: ["image", "marginRatio", "opacity", "sizeRatio", "sourceIds"],
  unbound: {
    text: "text content (the wordmark carries it)",
    textColor: "text content (the wordmark carries it)",
    textColorOnLight: "adaptive mode",
    imageDark: "adaptive mode",
    coverageOverride: "adaptive mode",
    fadeMs: "adaptive mode",
    crossfadeMs: "adaptive mode",
    lumaThreshold: "adaptive mode",
    minGapMs: "adaptive mode",
    angleDeg: "page mode",
    tileGapRatio: "page mode",
    maxTiles: "page mode",
  },
});

describe("@m0saic/media/watermark/v2 — waiting on inputs", () => {
  it("defaults (no source, no logo): a drop slot for the footage AND a placeholder where the logo goes (v1: an error card)", async () => {
    const doc = await render({});
    expect(doc.sources.filter((x) => (x as { engine?: { renderStatus?: string } }).engine?.renderStatus === "incomplete")).toHaveLength(1);
    expect(entriesOn(doc, "wm:base")).toEqual([{ propKey: "sourceIds", index: 0 }]);
    expect(keysOn(doc, "wm:logo")).toEqual(["image", "opacity", "sizeRatio", "marginRatio"]);
    const logo = sourcesOf(doc).find((x) => x.editor?.label === "wm:logo") as unknown as { type: string; color?: string };
    expect(logo.type).toBe("lavfi"); // the placeholder tile, not a media source
    expect(JSON.stringify(doc)).not.toContain("stand-in-logo");
  });

  it("footage but no logo: the footage shows with the logo placeholder, marked incomplete (v1: an error card)", async () => {
    const ctx = ctxFor(WatermarkV2, { media: MEDIA });
    const file = await WatermarkV2.render({ ...D, sourceIds: [VIDEO] } as never, ctx);
    const [doc] = docsOf(file);
    expect(doc.sources.some((x) => (x as { engine?: { renderStatus?: string } }).engine?.renderStatus === "incomplete")).toBe(true);
    expect(keysOn(doc, "wm:logo")[0]).toBe("image");
    expect(handlesOf(file, WatermarkV2, ctx).rejected).toEqual([]);
  });
});

describe("@m0saic/media/watermark/v2 — handles with footage", () => {
  const ctx = ctxFor(WatermarkV2, { media: MEDIA });
  const first = async (props: Record<string, unknown>) => docsOf(await WatermarkV2.render({ ...D, ...props } as never, ctx))[0];

  it("static logo: the footage takes its input; the logo takes an image and carries opacity / size / margin", async () => {
    const doc = await first({ sourceIds: [VIDEO], image: LOGO });
    expect(entriesOn(doc, "wm:base")).toEqual([{ propKey: "sourceIds", index: 0 }]);
    expect(keysOn(doc, "wm:logo")).toEqual(["image", "opacity", "sizeRatio", "marginRatio"]);
    expect(doc.sources.some((x) => (x as { engine?: { renderStatus?: string } }).engine?.renderStatus === "incomplete")).toBe(false);
    expect(handlesOf(doc, WatermarkV2, ctx).rejected).toEqual([]);
  });

  it("a lockup: the wordmark carries the placement, the logo just its image", async () => {
    const doc = await first({ sourceIds: [VIDEO], content: "lockup", image: LOGO });
    expect(keysOn(doc, "wm:text")).toEqual(["text", "textColor", "opacity", "sizeRatio", "marginRatio"]);
    expect(keysOn(doc, "wm:logo")).toEqual(["image"]);
  });

  it("page mode: the pattern's art carries the text, ink, angle and density (v1 bound nothing)", async () => {
    const doc = await first({ sourceIds: [IMAGE], mode: "page", content: "text", text: "DRAFT" });
    expect(keysOn(doc, "wm:text")).toEqual(["text", "textColor", "opacity", "sizeRatio", "angleDeg", "tileGapRatio", "maxTiles"]);
    expect(handlesOf(doc, WatermarkV2, ctx).rejected).toEqual([]);
  });

  it("adaptive: the wordmark carries the fade knobs of its mode", async () => {
    const doc = await first({ sourceIds: [VIDEO], mode: "adaptive", content: "text", variant: "single" });
    expect(keysOn(doc, "wm:text")).toEqual(["text", "textColor", "opacity", "sizeRatio", "marginRatio", "fadeMs", "crossfadeMs", "lumaThreshold", "minGapMs", "coverageOverride"]);
    expect(handlesOf(doc, WatermarkV2, ctx).rejected).toEqual([]);
  });
});
