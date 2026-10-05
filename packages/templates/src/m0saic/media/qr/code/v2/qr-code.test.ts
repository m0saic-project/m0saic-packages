import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../../../__tests__/vnextSuite";
import { QrCode } from "../v1/qr-code";
import { QrCodeV2 } from "./qr-code";

const D = QrCodeV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>) =>
  (await QrCodeV2.render({ ...D, ...props } as never, ctxFor(QrCodeV2))) as MosaicDocument;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect x="0" y="0" width="1" height="1"/><rect x="2" y="1" width="1" height="1"/><rect x="3" y="3" width="1" height="1"/></svg>';
const UNBOUND = {
  "animation.spawnDurMs": "timing",
  "animation.tileFadeMs": "timing",
  "animation.holdDurMs": "timing",
  "animation.fadeOutDurMs": "timing",
  "animation.tileOffsetPx": "spawn animation (Output mp4)",
  "advanced.svg": "SVG input mode",
  "advanced.driftPercent": "SVG input mode",
};

vnextSuite({
  next: QrCodeV2,
  prev: QrCode,
  capability: true, // fs caps are for a centre asset; the defaults need none
  cases: [
    { name: "the classic square code (plain path), dark", props: { moduleStyle: "square", mode: "dark", center: { show: false }, text: "https://m0saic.io/parity" } },
    { name: "plain path, spawn animation", props: { moduleStyle: "square", center: { show: false }, outputFormat: "mp4" } },
    { name: "rounded squares, no centre, transparent, own radii", props: { moduleStyle: "roundedSquare", mode: "transparent", center: { show: false }, style: { moduleBorderRadius: 0.2, eyeOuterBorderRadius: 0.1, eyeInnerDotBorderRadius: 1 } } },
    { name: "own centre asset, forced version, own colours", props: { center: { show: true, assetPath: "/art/logo.png", width: 200, height: 160, paddingPct: 4 }, version: 9, moduleColor: "#112233", backgroundColor: "#FFEEDD" } },
    { name: "styled path, spawn + fade out + gleam", props: { outputFormat: "mp4", animation: { spawnDurMs: 800, tileFadeMs: 200, holdDurMs: 500, fadeOutDurMs: 300, tileOffsetPx: 2, gleam: true } } },
    { name: "SVG input", props: { advanced: { svg: SVG, driftPercent: 0 } } },
  ],
  bound: [
    "backgroundColor", "center.assetPath", "center.height", "center.paddingPct", "center.width",
    "moduleColor", "style.eyeInnerDotBorderRadius", "style.eyeOuterBorderRadius", "style.moduleBorderRadius", "text", "version",
  ],
  unbound: UNBOUND,
});

describe("@m0saic/media/qr/code/v2 — handles", () => {
  type Tile = { type?: string; ref?: string; editor?: { bindings?: Array<{ propKey: string }> } };
  const keys = (s: Tile) => (s.editor?.bindings ?? []).map((b) => b.propKey);
  const MODULE = ["text", "moduleColor", "style.moduleBorderRadius"];
  const EYE = ["text", "moduleColor", "backgroundColor", "style.eyeOuterBorderRadius", "style.eyeInnerDotBorderRadius", "version"];
  const CENTER = ["center.assetPath", "center.width", "center.height", "center.paddingPct"];

  it("defaults: every module takes the payload; the three eyes (9 layers) and the centre carry their own (v1 bound nothing)", async () => {
    const tiles = (await render({})).sources as Tile[];
    const center = tiles[tiles.length - 1];
    expect(center.type).toBe("mosaic");
    expect(keys(center)).toEqual(CENTER);
    const eyes = tiles.slice(tiles.length - 10, tiles.length - 1);
    for (const eye of eyes) expect(keys(eye)).toEqual(EYE);
    const modules = tiles.slice(0, tiles.length - 10);
    expect(modules.length).toBeGreaterThan(100);
    for (const module of modules) expect(keys(module)).toEqual(MODULE);
  });

  it("no centre: the last nine sources are the eyes, everything before them modules", async () => {
    const tiles = (await render({ center: { show: false } })).sources as Tile[];
    for (const eye of tiles.slice(-9)) expect(keys(eye)).toEqual(EYE);
    expect(keys(tiles[0])).toEqual(MODULE);
    expect(tiles.some((t) => t.type === "mosaic")).toBe(false);
  });

  it("the classic square code: every tile is a module of the matrix — payload and ink", async () => {
    const tiles = (await render({ moduleStyle: "square", center: { show: false } })).sources as Tile[];
    for (const tile of tiles) expect(keys(tile)).toEqual(["text", "moduleColor"]);
  });

  it("SVG input: a tile carries the SVG it was traced from, its ink and the trace tolerance — not the text it never encoded", async () => {
    const tiles = (await render({ advanced: { svg: SVG } })).sources as Tile[];
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) expect(keys(tile)).toEqual(["advanced.svg", "moduleColor", "advanced.driftPercent"]);
  });

  it("nothing is rejected on any path; a helper's tiles are never written into", async () => {
    const ctx = ctxFor(QrCodeV2);
    for (const props of [{}, { moduleStyle: "square", center: { show: false } }, { advanced: { svg: SVG } }, { outputFormat: "mp4" }, { center: { show: true, assetPath: "/art/logo.png" } }]) {
      const doc = await QrCodeV2.render({ ...D, ...props } as never, ctx);
      expect(handlesOf(doc, QrCodeV2, ctx).rejected).toEqual([]);
    }
    // v1 rendered after v2 still paints tiles with no editor block.
    const v1 = (await QrCode.render({ ...D } as never, ctx)) as MosaicDocument;
    expect(JSON.stringify(v1.sources)).not.toContain('"bindings"');
  });
});
