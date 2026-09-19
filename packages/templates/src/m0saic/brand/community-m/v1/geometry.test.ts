import { COMMUNITY_M_TIP_STABLE_KEY, COMMUNITY_M_TIP_TILE_INDEX } from "@m0saic/types";
import { registry as dictionaryRegistry } from "@m0saic/dictionary";
import { M_GEOMETRY_M0 } from "@m0saic/platform";
import { markGeometry, markSideFor } from "./geometry";

describe("markGeometry", () => {
  const geo = markGeometry();
  it("joins the dictionary's 33 sources to the 33 Community M tiles by stableKey", () => {
    expect(geo.keys.length).toBe(33);
    expect(geo.sourceRects.length).toBe(33);
    expect([...geo.sourceToTile].sort((a, b) => a - b)).toEqual(Array.from({ length: 33 }, (_, i) => i));
    geo.sourceToTile.forEach((t, s) => expect(geo.tileToSource[t]).toBe(s));
  });
  it("finds the root at the tip with its triangle mask", () => {
    const s = geo.tileToSource[COMMUNITY_M_TIP_TILE_INDEX];
    expect(geo.keys[s]).toBe(COMMUNITY_M_TIP_STABLE_KEY);
    expect(geo.sourceRects[s]).toEqual({ x: 110, y: 168, width: 50, height: 34 });
    expect(geo.maskFor(s)?.kind).toBe("inline-mask");
    expect(geo.keys.map((_k, i) => geo.maskFor(i)).filter(Boolean).length).toBe(7);
  });
});

describe("markSideFor", () => {
  it("is always a multiple of 272 and matches the hero canvases", () => {
    expect(markSideFor(3840, 2160)).toBe(1904);
    expect(markSideFor(2176, 2176)).toBe(1904);
    expect(markSideFor(1280, 720)).toBe(544);
    expect(markSideFor(640, 360)).toBe(272);
    expect(markSideFor(100, 100)).toBe(272);
  });

  it("the baked m0 is byte-identical to the dictionary's (the browser build reads the bake)", () => {
    // The browser dictionary ships `m0: ""` + a lazily-fetched `m0File` the
    // web app does not serve, so the mark reads M_GEOMETRY_M0. This pins the
    // two together; re-run `node tools/bake-community-m-tiles.mjs` if it trips.
    const entry = dictionaryRegistry.byId["brand/m-33"];
    expect(entry).toBeDefined();
    expect(M_GEOMETRY_M0).toBe(entry.m0);
    expect(markGeometry().m0).toBe(entry.m0);
  });
});
