import type { MosaicDocument } from "@m0saic/types";
import { countBound, ctxFor, docsOf, entriesOn, handlesOf, keysOn, paintSansChips, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import "../../../index"; // registers the info-pane child the sheet composes
import { ScreencapGridV2 } from "../v2/screencap-grid";
import { ScreencapGridV3, timestampChipRect } from "./screencap-grid";

const D = ScreencapGridV3.defaultProps as Record<string, unknown>;
const VIDEO = "/clips/sample.mp4";
const IMAGE = "/clips/still.png";
const MEDIA = {
  [VIDEO]: { kind: "video", width: 1920, height: 1080, durationMs: 60000, fps: 30, originalFileName: "sample.mp4" },
  [IMAGE]: { kind: "image", width: 1200, height: 800, originalFileName: "still.png" },
};
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await ScreencapGridV3.render({ ...D, ...props } as never, ctxFor(ScreencapGridV3, { w, h }))) as MosaicDocument;

const CASES = [
    { name: "one video, contact sheet", props: { sourceIds: [VIDEO] }, media: MEDIA },
    { name: "one video, animated, no pane, gap 8", props: { sourceIds: [VIDEO], outputFormat: "mp4", infoPane: { show: false, align: "left" }, tiles: { gapPx: 8, fit: "contain" } }, media: MEDIA },
    { name: "an image, 2×3, no timestamps", props: { sourceIds: [IMAGE], rows: 2, cols: 3, timestamps: { show: false, corner: "tl", color: "#ffffff", bgColor: "none" } }, media: MEDIA },
    { name: "two inputs (one sheet each), custom grid", props: { sourceIds: [VIDEO, IMAGE], customGrid: "2(3(F,F,F),3(F,>,F))" }, media: MEDIA, w: 1280, h: 720 },
];

vnextSuite({
  next: ScreencapGridV3,
  prev: ScreencapGridV2,
  cases: CASES,
  // The look deliberately moved in one place: a timestamp chip now has a rect
  // of its own instead of sharing its tile's (founder, 2026-10-01) — the
  // parity test below holds everything else to v2.
  parity: false,
  bound: ["cols", "rows", "sourceIds", "tiles.gapPx", "timestamps.bgColor", "timestamps.color"],
  unbound: {},
});

describe("@m0saic/media/screencap_grid/v3 — paints what v2 paints, except where the chips sit", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const ctx = (t: typeof ScreencapGridV3) => ctxFor(t, { w: c.w, h: c.h, media: c.media });
    const prev = paintSansChips(await ScreencapGridV2.render({ ...(ScreencapGridV2.defaultProps as object), ...c.props } as never, ctx(ScreencapGridV2 as never)));
    const next = paintSansChips(await ScreencapGridV3.render({ ...D, ...c.props } as never, ctx(ScreencapGridV3)));
    expect(next).toEqual(prev);
  });

  it("a chip's rect is its plate, tucked into the tile's corner — never the tile", () => {
    const tile = { x: 100, y: 200, w: 480, h: 270 };
    for (const corner of ["br", "bl", "tr", "tl"] as const) {
      const chip = timestampChipRect(tile, corner);
      expect(chip.w).toBeGreaterThan(80);
      expect(chip.w).toBeLessThan(tile.w / 2);
      expect(chip.h).toBeGreaterThan(18);
      expect(chip.h).toBeLessThan(tile.h / 4);
      expect(chip.x).toBeGreaterThanOrEqual(tile.x);
      expect(chip.y).toBeGreaterThanOrEqual(tile.y);
      expect(chip.x + chip.w).toBeLessThanOrEqual(tile.x + tile.w);
      expect(chip.y + chip.h).toBeLessThanOrEqual(tile.y + tile.h);
      // In the corner it names, within v2's corner padding.
      if (corner.endsWith("r")) expect(tile.x + tile.w - (chip.x + chip.w)).toBeLessThanOrEqual(Math.round(tile.w * 0.02));
      else expect(chip.x - tile.x).toBeLessThanOrEqual(Math.round(tile.w * 0.02));
      if (corner.startsWith("b")) expect(tile.y + tile.h - (chip.y + chip.h)).toBeLessThanOrEqual(Math.round(tile.h * 0.03));
      else expect(chip.y - tile.y).toBeLessThanOrEqual(Math.round(tile.h * 0.03));
    }
    // A tiny tile keeps the chip, clipped to the tile.
    expect(timestampChipRect({ x: 0, y: 0, w: 40, h: 12 }, "br")).toEqual({ x: 0, y: 0, w: 40, h: 12 });
  });

  it("on the sheet, every chip is placed by inset (its own rect), centred in it", async () => {
    const doc = await render({ sourceIds: [VIDEO] });
    const chips = (doc.sources as Array<{ editor?: { label?: string }; placement?: { inset?: unknown }; layers?: Array<{ placement?: { hAlign?: string; vAlign?: string } }> }>)
      .filter((s) => s.editor?.label === "timestamp");
    expect(chips).toHaveLength(16);
    for (const chip of chips) {
      expect(chip.placement?.inset).toBeDefined();
      expect(chip.layers?.[0]?.placement).toEqual({ hAlign: "center", vAlign: "middle" });
    }
  });
});

describe("@m0saic/media/screencap_grid/v3 — the slot before the footage", () => {
  it("no source: the real sheet with stand-in tiles, marked incomplete (v2: an error card)", async () => {
    const doc = await render({});
    expect(renderStatusOf(doc)).toBeUndefined(); // sources[0] is the info pane, not a card
    const flagged = doc.sources.filter((s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus === "incomplete");
    expect(flagged).toHaveLength(1);
    expect(countBound(doc, "sourceIds")).toBe(16); // 4 × 4 drop targets
    expect(Object.keys(doc.assets ?? {})).toEqual([]);
    expect(doc.sources.some((s) => (s as { type?: string }).type === "media")).toBe(false);
  });

  it("the stand-in follows the knobs: rows × cols tiles, chips only when shown", async () => {
    const doc = await render({ rows: 2, cols: 5, timestamps: { show: false, corner: "br", color: "#ffffff", bgColor: "#000000" } });
    expect(countBound(doc, "sourceIds")).toBe(10);
    expect(countBound(doc, "timestamps.color")).toBe(0);
  });

  it("every stand-in tile is the ADD handle for the first source (index 0 of an empty list)", async () => {
    expect(entriesOn(await render({}), "tile")).toEqual([
      { propKey: "sourceIds", index: 0 },
      { propKey: "rows" },
      { propKey: "cols" },
      { propKey: "tiles.gapPx" },
    ]);
  });
});

describe("@m0saic/media/screencap_grid/v3 — handles with footage", () => {
  const ctx = ctxFor(ScreencapGridV3, { media: MEDIA });
  const withMedia = async (props: Record<string, unknown>) => (await ScreencapGridV3.render({ ...D, ...props } as never, ctx)) as MosaicDocument;

  it("every tile takes a dropped file for ITS input, and carries the sheet's shape; chips carry their colours", async () => {
    const doc = await withMedia({ sourceIds: [VIDEO] });
    expect(renderStatusOf(doc)).toBeUndefined();
    expect(doc.sources.some((s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus === "incomplete")).toBe(false);
    expect(keysOn(doc, "tile")).toEqual(["sourceIds", "rows", "cols", "tiles.gapPx"]);
    expect(keysOn(doc, "timestamp")).toEqual(["timestamps.color", "timestamps.bgColor"]);
    expect(handlesOf(doc, ScreencapGridV3, ctx).rejected).toEqual([]);
  });

  it("a second input's sheet binds index 1; a custom grid does not offer rows / cols", async () => {
    const file = await ScreencapGridV3.render({ ...D, sourceIds: [VIDEO, IMAGE], customGrid: "2(3(F,F,F),3(F,>,F))" } as never, ctx);
    const second = docsOf(file)[1];
    expect(entriesOn(second, "tile")).toEqual([{ propKey: "sourceIds", index: 1 }, { propKey: "tiles.gapPx" }]);
  });
});
