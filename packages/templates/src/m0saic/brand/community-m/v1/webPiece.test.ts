import { acceptWebPiece } from "./webPiece";

const ok = {
  kind: "mosaic_document",
  version: 1,
  m0: "1",
  size: { width: 544, height: 544 },
  fps: 30,
  durationMs: 2000,
  sources: [{ type: "lavfi", color: "#000000" }, { type: "text" }],
};

describe("acceptWebPiece — a served piece is untrusted data", () => {
  it("accepts the shape the seed ships", () => {
    const r = acceptWebPiece(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.piece.size).toEqual({ width: 544, height: 544 });
      expect(r.piece.declaredMs).toBe(2000);
    }
  });

  it("declines anything it cannot honestly render in a browser", () => {
    const cases: [string, unknown, RegExp][] = [
      ["not an object", "nope", /not an object/],
      ["wrong kind", { ...ok, kind: "mosaic_pipeline" }, /kind/],
      ["no size", { ...ok, size: undefined }, /size/],
      ["no duration", { ...ok, durationMs: 0 }, /durationMs/],
      ["own media", { ...ok, assets: { a: { kind: "file", path: "/x.png" } } }, /own media/],
      ["no sources", { ...ok, sources: [] }, /no sources/],
      ["a media source", { ...ok, sources: [{ type: "media" }] }, /cannot render/],
      ["a template invocation", { ...ok, sources: [{ type: "template_invocation" }] }, /cannot render/],
    ];
    for (const [what, input, match] of cases) {
      const r = acceptWebPiece(input);
      expect([what, r.ok]).toEqual([what, false]);
      if (!r.ok) expect(r.error).toMatch(match);
    }
  });
});
