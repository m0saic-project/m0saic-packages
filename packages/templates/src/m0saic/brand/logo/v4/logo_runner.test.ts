import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { TheMosaicMV3 } from "../v3/logo_runner";
import { TheMosaicMV4 } from "./logo_runner";

const D = TheMosaicMV4.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>) =>
  (await TheMosaicMV4.render({ ...D, ...props } as never, ctxFor(TheMosaicMV4))) as MosaicDocument;

const UNBOUND = {
  loopSec: "logo_loop animation",
  inEnd: "logo_loop animation",
  outStart: "logo_loop animation",
  startDelay: "logo_loop animation",
  endDelay: "logo_loop animation",
  progress: "progress_fill animation",
  progressSec: "progress_fill animation",
  blendInSec: "composite entry",
  blendDelaySec: "composite entry",
  blendFeather: "composite entry",
};

vnextSuite({
  next: TheMosaicMV4,
  prev: TheMosaicMV3,
  cases: [
    { name: "m-33 logo loop, radial, linear", props: { animation: "logo_loop", rankSet: "radial", easing: "linear", color: "#22d3ee" } },
    { name: "m0 logotype, progress fill at 40%", props: { size: "m0", animation: "progress_fill", progress: 0.4 } },
    { name: "m0 logotype, animated progress, one shot", props: { size: "m0", animation: "progress_fill", oneShot: true, progressSec: 3 } },
    { name: "pattern, loading shimmer, cascade", props: { size: "m0saic-pattern", animation: "loading_shimmer", rankSet: "cascade", shimmerSec: 2, shimmerWidth: 0.3 } },
    { name: "bad props are still the error card", props: { animation: "logo_loop", inEnd: 0.9, outStart: 0.1 } },
  ],
  bound: ["color", "feather", "shimmerSec", "shimmerWidth"],
  unbound: UNBOUND,
});

describe("@m0saic/brand/logo/v4 — handles", () => {
  type Tile = { type?: string; editor?: { bindings?: Array<{ propKey: string }> } };
  const keysOf = (doc: MosaicDocument): string[][] =>
    (doc.sources as Tile[]).filter((s) => s.type === "lavfi").map((s) => (s.editor?.bindings ?? []).map((b) => b.propKey));

  it("defaults: all 33 tiles of the M carry its colour, then the running animation's knobs (v3 bound nothing)", async () => {
    const tiles = keysOf(await render({}));
    expect(tiles).toHaveLength(33);
    for (const keys of tiles) expect(keys).toEqual(["color", "shimmerSec", "shimmerWidth", "feather"]);
  });

  it("a tile offers the knobs of the animation that is running — never another's", async () => {
    const want: Record<string, string[]> = {
      loading_ui_v2: ["color", "shimmerSec", "shimmerWidth", "feather"],
      loading_shimmer: ["color", "shimmerSec", "shimmerWidth", "feather"],
      progress_fill: ["color", "progress", "progressSec", "feather"],
      logo_loop: ["color", "loopSec", "inEnd", "outStart", "startDelay", "endDelay", "feather"],
    };
    for (const size of ["m-33", "m0", "m0saic-pattern"]) {
      for (const [animation, keys] of Object.entries(want)) {
        const tiles = keysOf(await render({ size, animation }));
        expect(tiles.length).toBeGreaterThan(0);
        expect(new Set(tiles.map((k) => k.join(",")))).toEqual(new Set([keys.join(",")]));
      }
    }
  });

  it("every declared key is bound in the animation that reads it; nothing is rejected", async () => {
    const ctx = ctxFor(TheMosaicMV4);
    const seen = new Set<string>();
    for (const animation of ["loading_ui_v2", "loading_shimmer", "progress_fill", "logo_loop"]) {
      const doc = await TheMosaicMV4.render({ ...D, animation } as never, ctx);
      const h = handlesOf(doc, TheMosaicMV4, ctx);
      expect(h.rejected).toEqual([]);
      for (const k of h.keys) seen.add(k);
    }
    for (const k of Object.keys(UNBOUND).filter((key) => !key.startsWith("blend"))) expect(seen.has(k)).toBe(true);
  });

  it("an error card carries no handles", async () => {
    const doc = await render({ animation: "logo_loop", inEnd: 0.9, outStart: 0.1 });
    expect(JSON.stringify(doc.sources)).not.toContain('"bindings"');
  });
});

describe("@m0saic/brand/logo/v4 — the bitmap mark (36,770 tiles)", () => {
  it("standalone bitmap: paints what v3 paints and is given NO handles", async () => {
    const ctx = ctxFor(TheMosaicMV4);
    const props = { ...D, size: "m-33_bitmap" };
    const next = (await TheMosaicMV4.render(props as never, ctx)) as MosaicDocument;
    const prev = (await TheMosaicMV3.render(props as never, ctx)) as MosaicDocument;
    expect(next.sources.length).toBe(36770);
    expect(next).toEqual(prev);
  });

  it("composite: the rect layer over the bitmap carries colour, the animation's knobs and the blend; the bitmap none", async () => {
    const ctx = ctxFor(TheMosaicMV4);
    const props = { ...D, size: "composite" };
    const next = (await TheMosaicMV4.render(props as never, ctx)) as MosaicDocument;
    const prev = (await TheMosaicMV3.render(props as never, ctx)) as MosaicDocument;
    const children = next.children as Record<string, MosaicDocument>;
    expect(children.bitmap).toEqual((prev.children as Record<string, MosaicDocument>).bitmap);
    const rects = children.rects.sources as Array<{ editor?: { bindings?: Array<{ propKey: string }> } }>;
    expect(rects).toHaveLength(33);
    for (const tile of rects) {
      expect(tile.editor?.bindings?.map((b) => b.propKey)).toEqual(["color", "shimmerSec", "shimmerWidth", "feather", "blendInSec", "blendDelaySec", "blendFeather"]);
    }
    // Same paint: strip the rect layer's handles and the composite is v3's.
    for (const tile of rects) delete tile.editor;
    expect(next).toEqual(prev);
    expect(handlesOf(await TheMosaicMV4.render(props as never, ctx), TheMosaicMV4, ctx).rejected).toEqual([]);
  });
});
