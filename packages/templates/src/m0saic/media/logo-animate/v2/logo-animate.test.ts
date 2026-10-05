import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { LogoAnimateV1 } from "../v1/logo-animate";
import { LogoAnimateV2 } from "./logo-animate";

const D = LogoAnimateV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await LogoAnimateV2.render({ ...D, ...props } as never, ctxFor(LogoAnimateV2, { w, h }))) as MosaicDocument;

// Hand-authored mini SVG: 4 rects in a 2×2 pattern — hermetic, rectilinear.
const MINI_SVG = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="4" height="4"/><rect x="6" y="0" width="4" height="4"/><rect x="0" y="6" width="4" height="4"/><rect x="6" y="6" width="4" height="4"/></svg>`;
const UNBOUND = {
  svg: "inline SVG markup (pasted in the form; the file handle is on the mark)",
  backgroundColor: "document background",
  loopSec: "logo_loop animation",
  progress: "progress_fill animation",
  progressSec: "progress_fill animation",
  shimmerSec: "breathing / shimmer animation",
  shimmerWidth: "breathing / shimmer animation",
};
const ASSEMBLE = ["svgPath", "color", "spawnDurMs", "tileFadeMs", "holdDurMs", "fadeOutDurMs", "tileOffsetPx", "driftPercent"];

vnextSuite({
  next: LogoAnimateV2,
  prev: LogoAnimateV1,
  capability: true, // fs.read is for svgPath; the defaults render the built-in mark
  cases: [
    { name: "inline SVG, dark, own ink, radial", props: { svg: MINI_SVG, preset: "dark", color: "#22d3ee", rankSet: "radial" } },
    { name: "logo loop, letterboxed on 16:9", props: { svg: MINI_SVG, animation: "logo_loop", loopSec: 2 }, w: 1920, h: 1080 },
    { name: "progress fill frozen at 40%, fill fit on 16:9", props: { animation: "progress_fill", progress: 0.4, fit: "fill" }, w: 1920, h: 1080 },
    { name: "breathing, scatter", props: { animation: "breathing", rankSet: "scatter", shimmerSec: 2, shimmerWidth: 0.3 } },
    { name: "shimmer, cascade, own background", props: { animation: "shimmer", rankSet: "cascade", backgroundColor: "#101014" } },
    { name: "bad props are still the error card", props: { loopSec: 0.1 } },
  ],
  bound: [...ASSEMBLE].sort(),
  unbound: UNBOUND,
});

describe("@m0saic/media/logo-animate/v2 — handles", () => {
  type Tile = { type?: string; ref?: string; editor?: { bindings?: Array<{ propKey: string }> } };
  const keys = (s: Tile) => (s.editor?.bindings ?? []).map((b) => b.propKey);

  it("defaults: every shape of the mark takes the SVG file, the ink, the assemble knobs and the trace tolerance (v1 bound nothing)", async () => {
    const tiles = (await render({})).sources as Tile[];
    expect(tiles.length).toBeGreaterThan(1);
    for (const tile of tiles) expect(keys(tile)).toEqual(ASSEMBLE);
  });

  it("a shape offers the knobs of the animation that is running — never another's", async () => {
    const want: Record<string, string[]> = {
      assemble: ["spawnDurMs", "tileFadeMs", "holdDurMs", "fadeOutDurMs", "tileOffsetPx"],
      logo_loop: ["loopSec"],
      progress_fill: ["progress", "progressSec"],
      breathing: ["shimmerSec", "shimmerWidth"],
      shimmer: ["shimmerSec", "shimmerWidth"],
    };
    const ctx = ctxFor(LogoAnimateV2);
    const seen = new Set<string>();
    for (const [animation, knobs] of Object.entries(want)) {
      const doc = (await LogoAnimateV2.render({ ...D, svg: MINI_SVG, animation } as never, ctx)) as MosaicDocument;
      const tiles = doc.sources as Tile[];
      expect(tiles).toHaveLength(4);
      for (const tile of tiles) expect(keys(tile)).toEqual(["svgPath", "color", ...knobs, "driftPercent"]);
      const h = handlesOf(doc, LogoAnimateV2, ctx);
      expect(h.rejected).toEqual([]);
      for (const k of h.keys) seen.add(k);
    }
    // Every knob declared "in its animation" IS bound there.
    for (const k of ["loopSec", "progress", "progressSec", "shimmerSec", "shimmerWidth"]) expect(seen.has(k)).toBe(true);
  });

  it("letterboxed: the shapes inside the nested logo are the handles; the wrapper rect stays out of the way", async () => {
    const doc = await render({ svg: MINI_SVG }, 1920, 1080);
    expect(doc.sources).toHaveLength(1);
    expect(keys(doc.sources[0] as Tile)).toEqual([]);
    const logo = (doc.children as Record<string, MosaicDocument>).logo;
    for (const tile of logo.sources as Tile[]) expect(keys(tile)).toEqual(ASSEMBLE);
    const ctx = ctxFor(LogoAnimateV2, { w: 1920, h: 1080 });
    expect(handlesOf(await LogoAnimateV2.render({ ...D, svg: MINI_SVG } as never, ctx), LogoAnimateV2, ctx).rejected).toEqual([]);
  });

  it("an error card carries no handles", async () => {
    const doc = await render({ loopSec: 0.1 });
    expect(JSON.stringify(doc.sources)).not.toContain('"bindings"');
  });
});

describe("@m0saic/media/logo-animate/v2 — bitmap mode (a cell per pixel)", () => {
  type Tile = { type?: string; ref?: string; editor?: { bindings?: Array<{ propKey: string }> } };
  const keys = (s: Tile) => (s.editor?.bindings ?? []).map((b) => b.propKey);
  const BITMAP = ["svgPath", "color", "spawnDurMs", "tileFadeMs", "holdDurMs", "fadeOutDurMs", "tileOffsetPx"];

  it("a small raster: the cells are the handles (no trace tolerance — nothing is traced); paints what v1 paints", async () => {
    const ctx = ctxFor(LogoAnimateV2);
    const props = { ...D, svg: MINI_SVG, bitmap: true, bitmapPrecision: "draft" };
    const next = (await LogoAnimateV2.render(props as never, ctx)) as MosaicDocument;
    const prev = (await LogoAnimateV1.render(props as never, ctx)) as MosaicDocument;
    const tiles = next.sources as Tile[];
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.length).toBeLessThanOrEqual(1024);
    for (const tile of tiles) expect(keys(tile)).toEqual(BITMAP);
    for (const tile of tiles) delete tile.editor;
    expect(next).toEqual(prev);
  });

  it("a big raster, letterboxed: the cells carry nothing; the logo's one rect carries the handles", async () => {
    const ctx = ctxFor(LogoAnimateV2, { w: 1920, h: 1080 });
    const props = { ...D, bitmap: true, bitmapPrecision: "crisp" };
    const next = (await LogoAnimateV2.render(props as never, ctx)) as MosaicDocument;
    const logo = (next.children as Record<string, MosaicDocument>).logo;
    expect(logo.sources.length).toBeGreaterThan(1024);
    expect(JSON.stringify(logo.sources)).not.toContain('"bindings"');
    expect(keys(next.sources[0] as Tile)).toEqual(BITMAP);
    expect(handlesOf(next, LogoAnimateV2, ctx).rejected).toEqual([]);
  });
});

// Founder 2026-10-02: the brand pattern SVG (edges a hair apart — 862.143 vs
// 862.133) traced exactly needs a canvas as wide as the SVG, so at 1080×1080
// every cell collapsed: "no visible tiles". v2 snaps the trace instead.
describe("@m0saic/media/logo-animate/v2 — a trace too fine for the canvas snaps", () => {
  type Tile = { editor?: { bindings?: Array<{ propKey: string }> } };
  const keys = (s: Tile) => (s.editor?.bindings ?? []).map((b) => b.propKey);
  // A one-unit seam between the left block and the right pair: traced exactly
  // the grid is 1,200 columns; at 0.25% the seam merges and it is 2×2.
  const SEAM_SVG = `<svg viewBox="0 0 1200 600"><rect x="0" y="0" width="600" height="600"/><rect x="601" y="0" width="599" height="300"/><rect x="601" y="300" width="599" height="300"/></svg>`;
  // No near-duplicate edge to merge: 601 + 600 has no common step, so the grid
  // stays 1,200 columns at every tolerance.
  const COPRIME_SVG = `<svg viewBox="0 0 1201 600"><rect x="0" y="0" width="601" height="600"/><rect x="601" y="0" width="600" height="300"/><rect x="601" y="300" width="600" height="300"/></svg>`;

  it("v1 shows the error card; v2 snaps the seam and every shape is there, each a handle", async () => {
    const ctx = ctxFor(LogoAnimateV2, { w: 1080, h: 1080 });
    const prev = await LogoAnimateV1.render({ ...LogoAnimateV1.defaultProps, svg: SEAM_SVG } as never, ctx);
    expect(JSON.stringify(prev)).toContain("no visible tiles");

    const doc = await render({ svg: SEAM_SVG }, 1080, 1080);
    const logo = (doc.children as Record<string, MosaicDocument>).logo;
    expect(logo.sources).toHaveLength(3);
    for (const tile of logo.sources as Tile[]) expect(keys(tile)).toEqual(ASSEMBLE);
    expect(handlesOf(doc, LogoAnimateV2, ctx).rejected).toEqual([]);
  });

  it("a canvas the exact trace fits keeps the exact trace — the snap never touches a trace that fits", async () => {
    const doc = await render({ svg: SEAM_SVG }, 2400, 1200);
    expect(doc.m0).toContain("1200(");
  });

  it("nothing fits even at 5%: the error card names the fix", async () => {
    const doc = await render({ svg: COPRIME_SVG }, 1080, 1080);
    const text = JSON.stringify(doc);
    expect(text).toContain("too close together");
    expect(text).toContain("Bitmap mode");
    expect(text).not.toContain('"bindings"');
  });
});
