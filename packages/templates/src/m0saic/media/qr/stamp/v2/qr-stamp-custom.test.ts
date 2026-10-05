import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, handlesOf, renderStatusOf, vnextSuite } from "../../../../../__tests__/vnextSuite";
import { isStandIn } from "../../../../_shared/stand-in";
import { QrStampCustom } from "../v1/qr-stamp-custom";
import { QrStampCustomV2 } from "./qr-stamp-custom";

const D = QrStampCustomV2.defaultProps as Record<string, unknown>;
const CLIP = "/footage/clip.mp4";
const STILL = "/footage/still.jpg";
const MEDIA = { [CLIP]: { kind: "video", width: 1920, height: 1080, durationMs: 8000 }, [STILL]: { kind: "image", width: 1600, height: 1200 } };
const UNBOUND = {
  luminanceBuckets: "luminance override (programmatic; auto mode probes the footage itself)",
  centerAsset: "centre = asset (the stamp carries it then)",
};

vnextSuite({
  next: QrStampCustomV2,
  prev: QrStampCustom,
  capability: true, // fs caps are for the media; the defaults render the stand-in
  // No media: v1 drew a "mediaPath is required" error card, v2 the stamp over a drop slot.
  defaultsParity: false,
  cases: [
    { name: "a video, auto card", props: { mediaPath: CLIP }, media: MEDIA },
    { name: "a still, dark card, top-left, bigger, square modules, no entrance", props: { mediaPath: STILL, mode: "dark", position: "tl", sizePct: 34, marginPct: 4, moduleStyle: "square", animation: "none", text: "https://example.com/x" }, media: MEDIA },
    { name: "own centre asset, transparent card", props: { mediaPath: CLIP, center: "asset", centerAsset: "/art/logo.png", mode: "transparent" }, media: MEDIA },
    { name: "plain code (centre off), luminance override", props: { mediaPath: CLIP, center: "off", luminanceBuckets: [{ tMs: 0, luma: 40 }, { tMs: 4000, luma: 210 }] }, media: MEDIA },
    { name: "centre = asset with no asset is still the error card", props: { mediaPath: CLIP, center: "asset" }, media: MEDIA },
  ],
  bound: ["marginPct", "mediaPath", "sizePct", "text"],
  unbound: UNBOUND,
});

describe("@m0saic/media/qr/stamp/v2 — the slot before the footage", () => {
  type Rect = { type?: string; ref?: string; engine?: { renderStatus?: string }; editor?: { bindings?: Array<{ propKey: string }> } };
  const keys = (s: Rect) => (s.editor?.bindings ?? []).map((b) => b.propKey);

  it("no media: the real stamp over a drop slot, marked incomplete (v1: an error card with nothing to click)", async () => {
    const ctx = ctxFor(QrStampCustomV2);
    const doc = (await QrStampCustomV2.render({ ...D } as never, ctx)) as MosaicDocument;
    expect(isStandIn(doc)).toBe(true);
    expect(renderStatusOf(doc)).toBe("incomplete");
    const [base, ...stamps] = doc.sources as Rect[];
    expect(base).toMatchObject({ type: "mosaic", ref: "stand-in" });
    expect(keys(base)).toEqual(["mediaPath"]);
    expect(stamps).toHaveLength(1); // auto, with nothing to adapt to: the one light card
    for (const stamp of stamps) {
      expect(stamp.type).toBe("mosaic");
      expect(stamp.engine?.renderStatus).not.toBe("incomplete");
      expect(keys(stamp)).toEqual(["text", "sizePct", "marginPct"]);
    }
    const children = doc.children as Record<string, MosaicDocument>;
    expect(Object.keys(children)).toEqual(expect.arrayContaining(["stand-in", "qr_stamp_light"]));
    expect(renderStatusOf(children["stand-in"])).not.toBe("incomplete"); // the marker lives on the root only
    expect(handlesOf(doc, QrStampCustomV2, ctx).rejected).toEqual([]);
    const before = (await QrStampCustom.render({ ...D } as never, ctx)) as MosaicDocument;
    expect(renderStatusOf(before)).toBe("error");
  });

  it("the stand-in is the stamp the footage will get: same stamp rects as with media", async () => {
    const empty = (await QrStampCustomV2.render({ ...D, mode: "light" } as never, ctxFor(QrStampCustomV2))) as MosaicDocument;
    const full = (await QrStampCustomV2.render({ ...D, mode: "light", mediaPath: CLIP } as never, ctxFor(QrStampCustomV2, { media: MEDIA }))) as MosaicDocument;
    expect(String(empty.m0)).toBe(String(full.m0));
    expect(empty.sources.slice(1)).toEqual(full.sources.slice(1));
  });

  it("with media: the base takes a dropped file; the stamp carries its payload, size and margin — and the centre asset when the centre is one", async () => {
    const ctx = ctxFor(QrStampCustomV2, { media: MEDIA });
    const doc = (await QrStampCustomV2.render({ ...D, mediaPath: CLIP } as never, ctx)) as MosaicDocument;
    expect(isStandIn(doc)).toBe(false);
    const [base, ...stamps] = doc.sources as Rect[];
    expect(base.type).toBe("media");
    expect(keys(base)).toEqual(["mediaPath"]);
    for (const stamp of stamps) expect(keys(stamp)).toEqual(["text", "sizePct", "marginPct"]);
    expect(handlesOf(doc, QrStampCustomV2, ctx).rejected).toEqual([]);

    const own = (await QrStampCustomV2.render({ ...D, mediaPath: CLIP, center: "asset", centerAsset: "/art/logo.png" } as never, ctx)) as MosaicDocument;
    for (const stamp of (own.sources as Rect[]).slice(1)) expect(keys(stamp)).toEqual(["text", "sizePct", "marginPct", "centerAsset"]);
    expect(handlesOf(own, QrStampCustomV2, ctx).rejected).toEqual([]);
  });
});
