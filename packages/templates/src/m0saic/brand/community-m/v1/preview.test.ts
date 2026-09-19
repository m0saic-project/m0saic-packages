import type { CommunityMEntry, MosaicDocument } from "@m0saic/types";
import { isValidM0String, parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { PREVIEW_PIECE_LONG_MS, PREVIEW_PIECE_MS, previewPiece, previewTileLine, simulatedClaims, standInPhoto } from "./preview";
import { resolveProps } from "./props";

const OPTS = { claims: 0, style: "mix" as const, seed: 1, logoShare: 0.34, tile: null, piece: "off" as const, pieceAspect: "16:9" as const };
const entry = { claimOrder: [20, 0, 14, 6, 3, 17, 29, 26] } as unknown as CommunityMEntry;

describe("dev preview levers", () => {
  it("is inert at defaults — nothing simulated", () => {
    const r = resolveProps({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.preview).toEqual({ claims: 0, style: "mix", seed: 1, logoShare: 0.34, tile: null, piece: "off", pieceAspect: "16:9" });
    }
    expect(simulatedClaims(entry, new Set([32]), OPTS).size).toBe(0);
  });

  it("deals stand-ins in the M's own claim order, never over a real claim", () => {
    // One tile is already real (the root), so 3 more are dealt, in claimOrder.
    expect([...simulatedClaims(entry, new Set([32]), { ...OPTS, claims: 4 }).keys()]).toEqual([20, 0, 14]);
    expect([...simulatedClaims(entry, new Set([32, 20]), { ...OPTS, claims: 4 }).keys()]).toEqual([0, 14]);
    for (const c of simulatedClaims(entry, new Set([32]), { ...OPTS, claims: 4 }).values()) expect(c.image.kind).toBe("data-uri");
  });

  it("always includes the subject tile so any tile can be previewed", () => {
    expect([...simulatedClaims(entry, new Set([32]), { ...OPTS, tile: 7 }).keys()]).toEqual([7]);
    expect(simulatedClaims(entry, new Set([32, 7]), { ...OPTS, tile: 7 }).size).toBe(0); // a real claim wins
  });

  it("stand-in art is deterministic, square, and crops portraits above centre", () => {
    const a = standInPhoto(5, { style: "mix", seed: 1, logoShare: 0.34 });
    expect(a).toEqual(standInPhoto(5, { style: "mix", seed: 1, logoShare: 0.34 }));
    expect(a.size).toEqual({ width: 200, height: 200 });
    expect(a.image.kind).toBe("data-uri");
    expect(standInPhoto(5, { style: "faces", seed: 1, logoShare: 0.34 }).focus.y).toBe(0.42);
    expect(standInPhoto(5, { style: "logos", seed: 1, logoShare: 0.34 }).focus.y).toBe(0.5);
    expect(standInPhoto(5, { style: "mix", seed: 2, logoShare: 0.34 }).image).not.toEqual(a.image);
    expect(previewTileLine(7, "logos")).toBe("tile 7 - preview stand-in - logo, unclaimed");
    expect(previewTileLine(20, "mix", 1, 32)).toBe("tile 20 - claim 1 of 32 - preview stand-in - mixed, unclaimed");
  });

  it("generated canvases declare their own size and carry no assets", () => {
    const colors = { fps: 30, canvasColor: "#0E1220", accentColor: "#f97316", textColor: "#F4F4F5" };
    for (const style of ["lorem", "card", "bars", "reel", "grid"] as const) {
      const p = previewPiece({ style, aspect: "9:16", ...colors });
      expect(p.size).toEqual({ width: 1080, height: 1920 });
      expect(p.declaredMs).toBe(style === "reel" || style === "grid" ? PREVIEW_PIECE_LONG_MS : PREVIEW_PIECE_MS);
      expect(p.doc.assets).toEqual({});
      expect(isValidM0String(p.doc.m0)).toBe(true);
      expect(p.doc.sources.length).toBeGreaterThanOrEqual(2);
      // Every sample's m0 must emit exactly as many frames as it has sources
      // — one short and the last source silently becomes someone else's cell.
      expect(parseM0StringToLogicalFrames(p.doc.m0, 100, 100).length).toBe(p.doc.sources.length);
    }
    expect(previewPiece({ style: "lorem", aspect: "16:9", ...colors }).size).toEqual({ width: 1920, height: 1080 });
    expect(previewPiece({ style: "lorem", aspect: "1:1", ...colors }).size).toEqual({ width: 1080, height: 1080 });
  });

  it("the moving samples actually move: timed layers, no assets", () => {
    const colors = { fps: 30, canvasColor: "#0E1220", accentColor: "#f97316", textColor: "#F4F4F5" };
    // The reel hands over between three nested beat cards — and its frames
    // match its sources, the failure that made the grid's caption vanish.
    const reel = previewPiece({ style: "reel", aspect: "16:9", ...colors });
    expect(parseM0StringToLogicalFrames(reel.doc.m0, 100, 100).length).toBe(reel.doc.sources.length);
    expect(Object.keys(reel.doc.children ?? {})).toEqual(["beat0", "beat1", "beat2"]);
    const alphas = reel.doc.sources.map((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha).filter(Boolean);
    expect(alphas.length).toBe(3);
    // The first beat hands over (fades back out); the last holds to the end.
    expect(alphas[0]).toContain("0.00000");
    expect(alphas[2]).not.toBe(alphas[0]);
    // The grid builds on a stagger, then the caption lands.
    const g = previewPiece({ style: "grid", aspect: "1:1", ...colors });
    const cellsDoc = (g.doc.children ?? {}).cells as MosaicDocument;
    const cellAlphas = cellsDoc.sources.map((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(cellAlphas.length).toBe(12);
    expect(new Set(cellAlphas).size).toBe(12); // every cell lands at its own moment
    // The parent is exactly base + caption: one frame each, or the caption
    // silently becomes a thirteenth cell.
    expect(g.doc.sources.length).toBe(2);
    expect(parseM0StringToLogicalFrames(g.doc.m0, 100, 100).length).toBe(2);
    expect(parseM0StringToLogicalFrames(cellsDoc.m0, 100, 100).length).toBe(12);
    for (const p of [reel, g]) expect(p.doc.assets).toEqual({});
  });

  it("rejects out-of-range levers", () => {
    const r = resolveProps({ preview: { claims: 99, tile: 40, style: "nope" as never, piece: "wat" as never } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join("\n");
      expect(all).toMatch(/preview\.claims/);
      expect(all).toMatch(/preview\.tile/);
      expect(all).toMatch(/preview\.style/);
      expect(all).toMatch(/preview\.piece/);
    }
  });
});
