import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicDocument } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { COMMUNITY_PIECE_DEFAULT_LIMITS, validateCommunityPiece } from "./validateCommunityPiece";

function piece(over: Partial<MosaicDocument> = {}): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "1" as unknown as MosaicDocument["m0"],
    size: { width: 544, height: 544 },
    fps: 30,
    durationMs: 2000,
    assets: {},
    sources: [{ type: "lavfi", filter: "color=c=black" } as never],
    ...over,
  };
}

describe("validateCommunityPiece", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-piece-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const limits = () => ({ pieceDir: dir, ...COMMUNITY_PIECE_DEFAULT_LIMITS });

  it("accepts a data-only piece with local assets", () => {
    const img = path.join(dir, "assets", "a.png");
    fs.mkdirSync(path.dirname(img), { recursive: true });
    fs.writeFileSync(img, Buffer.alloc(1024));
    const doc = piece({
      assets: { [asAssetId("a")]: { kind: "file", path: img, mediaType: "image" } },
      sources: [{ type: "media", mediaType: "image", assetId: asAssetId("a") } as never],
    });
    expect(validateCommunityPiece(doc, limits())).toEqual({ ok: true, assetBytes: 1024 });
  });

  it("rejects non-document kinds, forbidden sources and non-file assets", () => {
    const r1 = validateCommunityPiece({ kind: "mosaic_pipeline" } as never, limits());
    expect(r1.ok).toBe(false);
    const r2 = validateCommunityPiece(
      piece({ sources: [{ type: "data" } as never, { type: "template_invocation" } as never, { type: "ref" } as never] }),
      limits(),
    );
    expect(r2).toMatchObject({ ok: false });
    if (!r2.ok) expect(r2.errors.length).toBe(3);
    const r3 = validateCommunityPiece(
      piece({ assets: { [asAssetId("u")]: { kind: "url", url: "https://x/y.png" }, [asAssetId("d")]: { kind: "data-uri", uri: "data:x" } } }),
      limits(),
    );
    expect(r3).toMatchObject({ ok: false });
    if (!r3.ok) expect(r3.errors.join("\n")).toMatch(/only kind "file"/);
  });

  it("rejects assets outside the piece folder, missing files and size caps", () => {
    const outside = path.join(os.tmpdir(), "m0saic-outside.png");
    fs.writeFileSync(outside, Buffer.alloc(8));
    const big = path.join(dir, "big.bin");
    fs.writeFileSync(big, Buffer.alloc(64));
    const doc = piece({
      assets: {
        [asAssetId("o")]: { kind: "file", path: outside },
        [asAssetId("m")]: { kind: "file", path: path.join(dir, "missing.png") },
        [asAssetId("b")]: { kind: "file", path: big },
      },
    });
    const r = validateCommunityPiece(doc, { ...limits(), maxAssetFileBytes: 32 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/outside the piece folder/);
      expect(r.errors.join("\n")).toMatch(/not found/);
      expect(r.errors.join("\n")).toMatch(/per-file cap/);
    }
    fs.rmSync(outside, { force: true });
  });

  it("rejects missing/oversized duration and canvas, recursing into children", () => {
    const r = validateCommunityPiece(
      piece({
        durationMs: 60_000,
        children: { kid: piece({ size: { width: 4000, height: 10 } }) },
      }),
      limits(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/durationMs 60000 exceeds/);
      expect(r.errors.join("\n")).toMatch(/children\.kid: size 4000×10/);
    }
    const r2 = validateCommunityPiece(piece({ durationMs: undefined }), limits());
    expect(r2).toMatchObject({ ok: false });
  });
});
