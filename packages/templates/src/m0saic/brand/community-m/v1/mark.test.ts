import type { MosaicDocument } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { buildMarkDoc, claimedEdgesSvg } from "./mark";
import { markGeometry } from "./geometry";
import { resolveTarget } from "./manifest";

describe("buildMarkDoc", () => {
  const r = resolveTarget({ communityDir: "", m: "001", tile: "root", asOf: "now" });
  if (!r.ok) throw new Error(r.error);
  const claims = new Map([...r.target.claimedTiles].map(([i, c]) => [i, { image: c.image, focus: c.slot.focus }]));
  const doc = buildMarkDoc({ side: 544, fps: 30, durationMs: 1000, claims, dormantColor: "#34343A", canvasColor: "#0E1220", accentColor: "#f97316", rootReserved: false });

  it("nests the dictionary M (one source per tile) under a single claimed-edge overlay", () => {
    expect(doc.m0).toBe("1{1}");
    expect(doc.sources.length).toBe(2);
    expect(doc.size).toEqual({ width: 544, height: 544 });
    const edge = doc.assets[Object.keys(doc.assets)[0] as never] as { kind: string; uri: string };
    expect(edge.kind).toBe("data-uri");
    // URL-encoded, not base64 — the module must stay browser-safe (no Buffer).
    expect(edge.uri.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(edge.uri.slice("data:image/svg+xml,".length));
    expect(svg).toContain('width="544"');
    expect((svg.match(/<path|<rect/g) ?? []).length).toBe(1); // one claimed tile → one outline
    const tiles = doc.children?.tiles as MosaicDocument;
    expect(isValidM0String(tiles.m0)).toBe(true);
    expect(tiles.sources.length).toBe(33);
    const geo = markGeometry();
    const rootSource = tiles.sources[geo.tileToSource[32]] as { type: string; mask?: unknown; placement?: { fit: string; focusY: number } };
    expect(rootSource.type).toBe("media");
    expect(rootSource.placement?.fit).toBe("cover");
    expect(rootSource.placement?.focusY).toBeCloseTo(0.443);
    expect((rootSource.mask as { kind: string }).kind).toBe("inline-mask");
    expect(Object.keys(tiles.assets).length).toBe(1);
    expect(tiles.sources.filter((s) => s.type === "lavfi").length).toBe(32);
  });

  it("outlines rects as <rect> and diagonals as their mask path", () => {
    const svg = claimedEdgesSvg([0, 32], "#f97316", 272);
    expect(svg).toContain("<rect");
    expect(svg).toContain('<path d="M 25.054 34');
    expect(svg).toContain('translate(110 168)');
  });

  it("refuses a side that would stretch the masks", () => {
    expect(() => buildMarkDoc({ side: 500, fps: 30, durationMs: 1000, claims, dormantColor: "#34343A", canvasColor: "#0E1220", accentColor: "#f97316", rootReserved: false })).toThrow(/multiple of 272/);
  });

  it("spotlights one tile by dimming the others", () => {
    const lit = buildMarkDoc({ side: 272, fps: 30, durationMs: 1000, claims, dormantColor: "#34343A", canvasColor: "#0E1220", accentColor: "#f97316", rootReserved: false, spotlight: { tileIndex: 32, alphaExpr: "0.4" } });
    const geo = markGeometry();
    const tiles = lit.children?.tiles as MosaicDocument;
    const withAlpha = tiles.sources.filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha === "0.4").length;
    expect(withAlpha).toBe(32);
    expect((tiles.sources[geo.tileToSource[32]] as { overlay?: unknown }).overlay).toBeUndefined();
  });
});
