import * as fs from "fs";
import * as path from "path";
import type { MosaicDocument } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { loadMosaicDocument } from "@m0saic/platform/mosaic/loadMosaicDocument";
import { COMMUNITY_PIECE_DEFAULT_LIMITS, validateCommunityPiece } from "@m0saic/platform/communityM/node";
import { seedCommunityDir } from "./paths";
import { M_RECTS } from "@m0saic/template-utils";
import { SEED_PIECE_DURATION_MS, SEED_PIECE_LINE, SEED_PIECE_SIDE, buildSeedPiece, mLegPaths, seedPieceJson, seedPieceLayout } from "./seedPiece";

const SEED_PIECE = path.join(seedCommunityDir(), "ms", "001", "root", "piece.mosaic");

describe("the founder's seed piece", () => {
  it("is a data-only piece any contributor could have sent", () => {
    const doc = buildSeedPiece();
    expect(isValidM0String(doc.m0)).toBe(true);
    expect(doc.size).toEqual({ width: SEED_PIECE_SIDE, height: SEED_PIECE_SIDE });
    expect(doc.durationMs).toBe(SEED_PIECE_DURATION_MS);
    expect(doc.assets).toEqual({});
    const types = doc.sources.map((s) => (s as { type: string }).type);
    expect(new Set(types)).toEqual(new Set(["lavfi", "text"]));
    // The validator the harness runs on every PR'd piece, against the real seed folder.
    const loaded = loadMosaicDocument(JSON.stringify(doc), SEED_PIECE);
    expect(validateCommunityPiece(loaded, { pieceDir: path.dirname(SEED_PIECE), ...COMMUNITY_PIECE_DEFAULT_LIMITS })).toEqual({ ok: true, assetBytes: 0 });
  });

  it("the V-legs are exactly the 7 silhouette pieces that are not assembly rects", () => {
    const legs = mLegPaths();
    expect(legs.length).toBe(7);
    expect(legs.length + M_RECTS.length).toBe(33);
    // Every leg has a diagonal; the one rect drawn with L segments is NOT here.
    for (const d of legs) expect(d).toMatch(/L/);
    expect(legs.some((d) => d.startsWith("M182.185 104.088"))).toBe(false);
  });

  it("assembles the M from its rects, fades the V-legs in as they land (never a snap), then raises the line", () => {
    const doc = buildSeedPiece();
    const tracks = doc.sources.filter((s) => typeof (s as { lavfi?: string }).lavfi === "string") as { lavfi: string }[];
    expect(tracks.length).toBeGreaterThanOrEqual(1);
    expect(tracks.every((t) => t.lavfi.startsWith("color=black@0,drawbox="))).toBe(true);
    const legs = doc.sources.find((s) => (s as { mask?: unknown }).mask) as { mask: { localPath: string }; overlay?: { alpha?: string; startAtSec?: number } };
    expect(legs.mask.localPath.split(/(?=M)/).filter((d) => d.trim()).length).toBe(7);
    expect(legs.overlay?.startAtSec).toBe(1.05);
    // smoothstep over 0.6 s — a real fade, not a 3-frame stamp.
    expect(legs.overlay?.alpha).toContain("(t-1.05)/0.6");
    expect(legs.overlay?.alpha).toMatch(/\*\(3-2\*/);
    const text = doc.sources.find((s) => (s as { type: string }).type === "text") as { overlay?: { yExpr?: string; startAtSec?: number }; layers: { content: { text: string } }[] };
    expect(text.layers[0].content.text).toBe(SEED_PIECE_LINE);
    expect(text.overlay?.startAtSec).toBe(1.9);
    expect(text.overlay?.yExpr).toContain("*32");
    // The line sits below the mark, both inside the canvas.
    const g = seedPieceLayout();
    expect(g.line.y).toBeGreaterThan(g.mark.y + g.mark.h);
    expect(g.line.y + g.line.h).toBeLessThanOrEqual(SEED_PIECE_SIDE);
  });

  it("is deterministic and the committed seed file is exactly this builder's output", () => {
    expect(seedPieceJson()).toBe(seedPieceJson());
    const committed = fs.readFileSync(SEED_PIECE, "utf8");
    expect(committed).toBe(seedPieceJson());
    expect((JSON.parse(committed) as MosaicDocument).durationMs).toBe(SEED_PIECE_DURATION_MS);
  });
});
