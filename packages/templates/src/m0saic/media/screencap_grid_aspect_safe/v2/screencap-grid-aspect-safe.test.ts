import { ctxFor, docsOf, entriesOn, handlesOf, keysOn, paintSansChips, vnextSuite } from "../../../../__tests__/vnextSuite";
import "../../../index"; // registers the info-pane child the sheets compose
import { ScreencapGridAspectSafe } from "../v1/screencap-grid-aspect-safe";
import { ScreencapGridAspectSafeV2 } from "./screencap-grid-aspect-safe";

const D = ScreencapGridAspectSafeV2.defaultProps as Record<string, unknown>;
const VIDEO = "/clips/sample.mp4";
const IMAGE = "/clips/still.png";
const MEDIA = {
  [VIDEO]: { kind: "video", width: 1920, height: 1080, durationMs: 60000, fps: 30, originalFileName: "sample.mp4" },
  [IMAGE]: { kind: "image", width: 1200, height: 800, originalFileName: "still.png" },
};
const CASES = [
    { name: "one video, both sheets", props: { sourceIds: [VIDEO] }, media: MEDIA },
    { name: "animated, no pane, gap 8, portrait cells", props: { sourceIds: [VIDEO], outputFormat: "mp4", cellShape: "portrait", infoPane: { show: false, align: "left" }, tiles: { gapPx: 8, fit: "contain" } }, media: MEDIA },
    { name: "two inputs, second grid choice, no timestamps", props: { sourceIds: [VIDEO, IMAGE], gridChoice: 1, timestamps: { show: false, corner: "tl", color: "#ffffff", bgColor: "none" } }, media: MEDIA },
];

vnextSuite({
  next: ScreencapGridAspectSafeV2,
  prev: ScreencapGridAspectSafe,
  cases: CASES,
  // The look deliberately moved in one place: a timestamp chip now has a rect
  // of its own instead of sharing its tile's (screencap_grid/v3's
  // timestampChipRect; founder, 2026-10-01) — the parity test below holds
  // everything else to v1.
  parity: false,
  bound: ["canvas.landscapeH", "canvas.landscapeW", "canvas.portraitH", "canvas.portraitW", "gridChoice", "search.cellAspect", "search.maxCells", "search.minCells", "sourceIds", "tiles.gapPx", "timestamps.bgColor", "timestamps.color"],
  unbound: {},
});

describe("@m0saic/media/screencap_grid_aspect_safe/v2 — paints what v1 paints, except where the chips sit", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const prev = paintSansChips(await ScreencapGridAspectSafe.render({ ...(ScreencapGridAspectSafe.defaultProps as object), ...c.props } as never, ctxFor(ScreencapGridAspectSafe as never, { media: c.media })));
    const next = paintSansChips(await ScreencapGridAspectSafeV2.render({ ...D, ...c.props } as never, ctxFor(ScreencapGridAspectSafeV2, { media: c.media })));
    expect(next).toEqual(prev);
  });

  it("on both sheets, every chip is placed by inset (its own rect), centred in it", async () => {
    const docs = docsOf(await ScreencapGridAspectSafeV2.render({ ...D, sourceIds: [VIDEO] } as never, ctxFor(ScreencapGridAspectSafeV2, { media: MEDIA })));
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      const chips = (doc.sources as Array<{ editor?: { label?: string }; placement?: { inset?: unknown }; layers?: Array<{ placement?: unknown }> }>).filter((s) => s.editor?.label === "timestamp");
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) {
        expect(chip.placement?.inset).toBeDefined();
        expect(chip.layers?.[0]?.placement).toEqual({ hAlign: "center", vAlign: "middle" });
      }
    }
  });
});

describe("@m0saic/media/screencap_grid_aspect_safe/v2 — the slot before the footage", () => {
  it("no source: both sheets with stand-in tiles, each marked incomplete (v1: one error card)", async () => {
    const docs = docsOf(await ScreencapGridAspectSafeV2.render({ ...D } as never, ctxFor(ScreencapGridAspectSafeV2)));
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.size)).toEqual([{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]);
    for (const doc of docs) {
      expect(doc.sources.filter((s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus === "incomplete")).toHaveLength(1);
      expect(doc.sources.some((s) => (s as { type?: string }).type === "media")).toBe(false);
      expect(Object.keys(doc.assets ?? {})).toEqual([]);
      expect(entriesOn(doc, "tile")[0]).toEqual({ propKey: "sourceIds", index: 0 });
    }
  });

  it("each sheet's header carries ITS canvas; with the pane off the tiles do", async () => {
    const [land, port] = docsOf(await ScreencapGridAspectSafeV2.render({ ...D } as never, ctxFor(ScreencapGridAspectSafeV2)));
    expect(keysOn(land, "info-pane")).toEqual(["canvas.landscapeW", "canvas.landscapeH"]);
    expect(keysOn(port, "info-pane")).toEqual(["canvas.portraitW", "canvas.portraitH"]);
    const [bare] = docsOf(await ScreencapGridAspectSafeV2.render({ ...D, infoPane: { show: false, align: "left" } } as never, ctxFor(ScreencapGridAspectSafeV2)));
    expect(keysOn(bare, "tile").slice(-2)).toEqual(["canvas.landscapeW", "canvas.landscapeH"]);
  });
});

describe("@m0saic/media/screencap_grid_aspect_safe/v2 — handles with footage", () => {
  const ctx = ctxFor(ScreencapGridAspectSafeV2, { media: MEDIA });

  it("tiles take a dropped file for their input and carry the search knobs; nothing incomplete, nothing rejected", async () => {
    const file = await ScreencapGridAspectSafeV2.render({ ...D, sourceIds: [VIDEO, IMAGE] } as never, ctx);
    const docs = docsOf(file);
    expect(docs).toHaveLength(4);
    expect(docs.every((d) => d.sources.every((s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus !== "incomplete"))).toBe(true);
    expect(keysOn(docs[0], "tile")).toEqual(["sourceIds", "gridChoice", "search.cellAspect", "search.minCells", "search.maxCells", "tiles.gapPx"]);
    expect(entriesOn(docs[2], "tile")[0]).toEqual({ propKey: "sourceIds", index: 1 });
    expect(keysOn(docs[0], "timestamp")).toEqual(["timestamps.color", "timestamps.bgColor"]);
    expect(handlesOf(file, ScreencapGridAspectSafeV2, ctx).rejected).toEqual([]);
  });
});
