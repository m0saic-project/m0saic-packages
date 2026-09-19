import { DslCanvas } from "./dsl-canvas";

// Loose-typed test ctx (avoids `import type` — this package's jest/babel
// transform rejects the named `import type { ... }` form).
function ctx(w: number, h: number): any {
  return {
    mode: "render",
    output: { width: w, height: h, fps: 30, durationMs: 12000, workspaceDir: "/tmp" },
    target: { width: w, height: h, fps: 30, durationMs: 12000 },
    media: {},
  };
}

// Dark preset tokens (theme/tokens.ts) — the canvas identifies its collapsed
// sources by color, so the tests do too (mirrors the cursor test's #FF8A3D).
const TILE = "#EEF1F8";
const TILE_BORDER = "#C9D1E4";
const SURFACE = "#111726";
const FRAME_OUTLINE = "#4A597C";

// A masked color tile whose fill is `color` (the atlas sources are lavfi color
// tiles clipped by an inline-mask silhouette).
const maskedTilesOf = (doc: any, color: string) =>
  (doc.sources as any[]).filter(
    (s) => s?.type === "lavfi" && s?.color === color && s?.mask?.kind === "inline-mask",
  );
// The single lavfi source carrying a hand-rolled `drawbox` chain matching `needle`.
const drawboxTrack = (doc: any, needle: string) =>
  (doc.sources as any[]).find(
    (s) => s?.type === "lavfi" && typeof s?.lavfi === "string" && s.lavfi.includes("drawbox=") && s.lavfi.includes(needle),
  );
const timedTiles = [
  { order: 1, w: 500, h: 500, revealAtSec: 0, activeStartSec: 0, activeEndSec: 1 },
  { order: 2, w: 500, h: 500, revealAtSec: 1.5, activeStartSec: 1.5, activeEndSec: 2.5 },
];

describe("DslCanvas — source validity", () => {
  test("no text source has empty layers[] (engine rejects those)", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(2[1,1],2[1,1])" as any, preset: "dark" },
      ctx(1280, 760),
    );
    for (const s of doc.sources as any[]) {
      if (s?.type === "text") {
        expect(Array.isArray(s.layers)).toBe(true);
        expect(s.layers.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("DslCanvas — W1: the tiles collapse to a CONSTANT source set (no per-tile PNG/geq)", () => {
  test("2 tiles and 16 tiles both emit ONE label atlas + TWO masked tile sources (fills+borders)", async () => {
    const small: any = await DslCanvas.render({ M0String: "2(1,1)" as any, preset: "dark" }, ctx(1000, 500));
    const big: any = await DslCanvas.render(
      { M0String: "4[4(1,1,1,1),4(1,1,1,1),4(1,1,1,1),4(1,1,1,1)]" as any, preset: "dark" },
      ctx(1000, 500),
    );
    for (const doc of [small, big]) {
      // exactly one static text atlas regardless of tile count.
      const texts = (doc.sources as any[]).filter((s) => s?.type === "text");
      expect(texts.length).toBe(1);
      // exactly two masked tile sources: the border fill + the inset color fill.
      expect(maskedTilesOf(doc, TILE).length).toBe(1);
      expect(maskedTilesOf(doc, TILE_BORDER).length).toBe(1);
    }
  });

  test("a 400-tile grid (20×20) still paints its tiles: fills + borders + curtain — the old 260-subpath guard blanked the canvas (2026-09-05)", async () => {
    const grid = (n: number) => `${n}(${Array(n).fill(`${n}[${Array(n).fill("1").join(",")}]`).join(",")})`;
    const tiles = Array.from({ length: 400 }, (_, i) => ({ order: i + 1, w: 96, h: 54, revealAtSec: 1 + i * 0.1 }));
    const doc: any = await DslCanvas.render({ M0String: grid(20) as any, preset: "dark", tiles: tiles as any }, ctx(1920, 1080));
    expect(maskedTilesOf(doc, TILE).length).toBe(1); // the fill atlas is present…
    expect(maskedTilesOf(doc, TILE_BORDER).length).toBe(1); // …with its hairline borders
    expect((doc.sources as any[]).filter((s) => s?.type === "text").length).toBe(1); // labels still fit 400 tiles
    expect(drawboxTrack(doc, "enable=lt(t")).toBeTruthy(); // and the reveal curtain gates them
    // 625 tiles (76×43 px): the tiles, the curtain AND the size-fitted numbers stay.
    const big: any = await DslCanvas.render({ M0String: grid(25) as any, preset: "dark" }, ctx(1920, 1080));
    expect(maskedTilesOf(big, TILE).length).toBe(1);
    expect(maskedTilesOf(big, TILE_BORDER).length).toBe(1);
    expect((big.sources as any[]).filter((s) => s?.type === "text").length).toBe(1);
  });

  test("NO source carries an overlay alpha/opacity — the geq fold that dominated 10x10 is gone", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(1,1)" as any, preset: "dark", tiles: timedTiles as any },
      ctx(1000, 500),
    );
    for (const s of doc.sources as any[]) {
      // the enable-only fast path requires !alpha && opacity==null && !opacityExpr.
      expect(s?.overlay?.alpha).toBeUndefined();
      expect(s?.overlay?.opacity).toBeUndefined();
      expect(s?.overlay?.opacityExpr).toBeUndefined();
      // and no source builds a per-pixel geq in its lavfi.
      if (typeof s?.lavfi === "string") expect(s.lavfi.includes("geq=")).toBe(false);
    }
  });

  test("tile FILLS are ONE inline-mask atlas of rounded-rect subpaths (crisp corners, no geq)", async () => {
    const doc: any = await DslCanvas.render({ M0String: "2(1,1)" as any, preset: "dark" }, ctx(1000, 500));
    const fills = maskedTilesOf(doc, TILE);
    expect(fills.length).toBe(1);
    const d = fills[0].mask.localPath as string;
    // one subpath (one "M" move) per tile.
    expect((d.match(/M/g) || []).length).toBe(2);
    // rounded → arc commands present (SVG "A"); mask authored at full-canvas bounds.
    expect(d).toContain("A");
    expect(d.includes("geq")).toBe(false);
    expect(fills[0].mask.bounds.width).toBe(1000);
    expect(fills[0].mask.bounds.height).toBe(500);
    // border source is the same shape in the border color.
    expect(maskedTilesOf(doc, TILE_BORDER)[0].mask.localPath).toContain("A");
  });

  test("the label ATLAS is a single STATIC still — no renderMode:video, no per-layer enable", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(1,1)" as any, preset: "dark", tiles: timedTiles as any },
      ctx(1000, 500),
    );
    const atlas = (doc.sources as any[]).find((s) => s?.type === "text");
    expect(atlas).toBeDefined();
    expect(atlas.renderMode?.kind).not.toBe("video");
    // 2 layers per tile (order number + WxH), none time-gated (the curtain reveals).
    expect(atlas.layers.length).toBe(4);
    for (const l of atlas.layers) expect(l.overlay).toBeUndefined();
  });
});

describe("DslCanvas — hard-cut reveal curtain", () => {
  test("timing → ONE drawbox curtain: an enable=lt(t,revealAt) box per not-yet-visible tile, surface-colored", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(1,1)" as any, preset: "dark", tiles: timedTiles as any },
      ctx(1000, 500),
    );
    const curtain = drawboxTrack(doc, "lt(t\\,");
    expect(curtain).toBeDefined();
    // only tile 2 has revealAtSec > 0 → exactly one curtain box.
    expect((curtain.lavfi.match(/drawbox=/g) || []).length).toBe(1);
    expect(curtain.lavfi).toContain("enable=lt(t\\,1.500)");
    expect(curtain.lavfi).toContain(`color=${SURFACE}`); // covered tile reads as empty canvas
    expect(curtain.lavfi).toContain("replace=1");
    expect(curtain.lavfi.includes("geq=")).toBe(false);
  });

  test("no timing → no curtain (all tiles visible from t=0); fills + atlas still present", async () => {
    const doc: any = await DslCanvas.render({ M0String: "2(1,1)" as any, preset: "dark" }, ctx(1000, 500));
    expect(drawboxTrack(doc, "lt(t\\,")).toBeUndefined();
    expect(maskedTilesOf(doc, TILE).length).toBe(1);
    expect((doc.sources as any[]).some((s) => s?.type === "text")).toBe(true);
  });
});

describe("DslCanvas — Frame outline", () => {
  test("default → a hollow ring: the frame-colored lavfi tile carries the full-canvas inline-mask", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(1,1)" as any, preset: "dark" },
      ctx(1000, 500),
    );
    const frame = (doc.sources as any[]).find(
      (s) => s?.type === "lavfi" && s?.color === FRAME_OUTLINE && s?.mask?.kind === "inline-mask",
    );
    expect(frame).toBeDefined();
    // ring authored in the frame's own pixel space → uniform border, no distortion.
    expect(frame.mask.localPath).toContain("M0 0");
    expect(frame.mask.bounds.width).toBe(1000);
    expect(frame.mask.bounds.height).toBe(500);
  });

  test("showFrame:false → no frame ring", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(1,1)" as any, preset: "dark", showFrame: false },
      ctx(1000, 500),
    );
    const frame = (doc.sources as any[]).find((s) => s?.color === FRAME_OUTLINE);
    expect(frame).toBeUndefined();
  });
});

describe("DslCanvas — overlay layouts (real-geometry per-tile reveal)", () => {
  test("an OVERLAPPING layout ({…}) reveals per-tile via the layout m0 — valid nested m0 (no OVERLAY_CHAIN), enable-only (no geq fade), no full-canvas curtain", async () => {
    // 3 base cells + a full-frame {F} overlay → 4 leaves. The overlay overlaps the
    // base, so a curtain would occlude the base cells until the overlay's reveal
    // (the regression). The per-tile path places each cell in its layout leaf so
    // the engine z-orders them, each revealed at its OWN time.
    const tiles = [
      { order: 1, w: 640, h: 1080, revealAtSec: 0.5, activeStartSec: 0.5, activeEndSec: 1 },
      { order: 2, w: 640, h: 1080, revealAtSec: 1.0, activeStartSec: 1.0, activeEndSec: 1.5 },
      { order: 3, w: 640, h: 1080, revealAtSec: 1.5, activeStartSec: 1.5, activeEndSec: 2 },
      { order: 4, w: 1920, h: 1080, revealAtSec: 2.5, activeStartSec: 2.5, activeEndSec: 3 },
    ];
    const doc: any = await DslCanvas.render(
      { M0String: "3(F,F,F){F}" as any, preset: "dark", tiles: tiles as any },
      ctx(1920, 1080),
    );
    expect(typeof doc.m0).toBe("string"); // reaching here = toM0String validated OK
    expect(doc.m0).not.toMatch(/\}\{/); // guides NEST into the layout — no overlay chain
    // Per-tile text cells, each revealed ENABLE-ONLY (hard cut, NO alpha → no geq).
    const cells = (doc.sources as any[]).filter((s) => s?.type === "text" && s?.overlay?.enable);
    expect(cells.length).toBe(4);
    for (const s of doc.sources as any[]) expect(s?.overlay?.alpha).toBeUndefined();
    // Base cells reveal at their OWN times (0.5…1.5), the overlay at its later time
    // (2.5) — NOT all-at-once when the overlay lands.
    expect(cells.some((s) => s.overlay.enable === "gte(t,0.500)")).toBe(true);
    expect(cells.some((s) => s.overlay.enable === "gte(t,2.500)")).toBe(true);
    // NOT the atlas curtain: no lavfi drawbox with a full-canvas lt(t,…) hide box.
    expect((doc.sources as any[]).find((s) => typeof s?.lavfi === "string" && s.lavfi.includes("lt(t\\,"))).toBeUndefined();
  });

  test("an OVERLAPPING layout with MORE than 24 tiles takes the atlas path too — per-tile cells past the overlay ceiling never finish (QR, 09-05)", async () => {
    // 30 tiles in a 5×6 grid, each carrying a full-tile overlay → 60 overlapping frames.
    const cell = "1{1}";
    const m0 = `5(${Array(5).fill(`6[${Array(6).fill(cell).join(",")}]`).join(",")})`;
    const doc: any = await DslCanvas.render({ M0String: m0 as any, preset: "dark" }, ctx(1200, 600));
    expect((doc.sources as any[]).filter((s) => s?.type === "text").length).toBeLessThanOrEqual(1); // the ONE label atlas at most
    expect(maskedTilesOf(doc, TILE).length).toBe(1); // the union fill atlas
    expect(doc.children ?? {}).toEqual({}); // no per-tile nested cells
  });

  test("a NON-overlapping grid still takes the collapsed atlas (masked tiles, no per-tile text cells)", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(1,1)" as any, preset: "dark" },
      ctx(1000, 500),
    );
    const cells = (doc.sources as any[]).filter((s) => s?.type === "text" && s?.overlay?.enable);
    expect(cells.length).toBe(0); // no per-tile enable-gated text cells
    expect(maskedTilesOf(doc, TILE).length).toBe(1); // the atlas fill
  });
});

describe("DslCanvas — split subdivisions", () => {
  const split = {
    xFrac: 0,
    yFrac: 0,
    wFrac: 1,
    hFrac: 1,
    axis: "col" as const,
    dividers: [{ frac: 0.5, clearSec: 1.5 }],
    activeStartSec: 1,
    clearAtSec: 2,
  };

  test("a split → ONE lavfi drawbox track; each divider clears on its OWN tile claim", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2(1,1)" as any, preset: "dark", splits: [split] },
      ctx(1000, 500),
    );
    // Dividers are a single drawbox lavfi source — NOT a per-split inline-mask
    // (that's what overflowed argv on dense grids). The tile fills/borders/frame
    // are masks, but the divider track is found by its own gate window.
    const track = drawboxTrack(doc, "between(t\\,1.000\\,1.500)");
    expect(track).toBeDefined();
    // The divider clears at its own clearSec (1.5), NOT the region's clearAtSec (2).
    expect(track.lavfi).toContain("between(t\\,1.000\\,1.500)");
    expect(track.lavfi).toContain("replace=1"); // writes alpha on the transparent base
    expect(track.lavfi.includes("geq=")).toBe(false);
  });
});

describe("DslCanvas — dividers clear per DASH on their own cover (brand M, 09-05) + tier alpha", () => {
  const split = (covers: any[]) => [{ xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1, axis: "row", activeStartSec: 1, clearAtSec: 50, dividers: [{ frac: 0.5, clearSec: 50, covers }] }];
  const dashEnds = (doc: any) => {
    const src = drawboxTrack(doc, "t=fill");
    return src ? [...src.lavfi.matchAll(/between\(t\\,1\.000\\,([\d.]+)\)/g)].map((m: any) => +m[1]) : [];
  };
  test("an INTERIOR cover (the divider runs through a passthrough-absorbed tile) clears its dashes at that tile's paint; a shared edge waits for the later neighbour", async () => {
    const doc: any = await DslCanvas.render(
      { M0String: "2[1,1]" as any, preset: "dark", splits: split([{ lo: 0, hi: 500, sec: 3, interior: true }, { lo: 500, hi: 1000, sec: 8, interior: false }, { lo: 500, hi: 1000, sec: 12, interior: false }]) as any },
      ctx(1000, 500),
    );
    const ends = dashEnds(doc);
    expect(ends.length).toBeGreaterThan(4);
    expect(ends.filter((e) => e === 3).length).toBeGreaterThan(0); // left half: the absorbing tile painted
    expect(ends.filter((e) => e === 12).length).toBeGreaterThan(0); // right half: both neighbours must paint
    expect(ends.some((e) => e === 8 || e === 50)).toBe(false);
  });
  test("summarize draws the scaffolding at 35% alpha; teach at 90%", async () => {
    const teach: any = await DslCanvas.render({ M0String: "2[1,1]" as any, preset: "dark", splits: split([]) as any }, ctx(1000, 500));
    const summ: any = await DslCanvas.render({ M0String: "2[1,1]" as any, preset: "dark", splits: split([]) as any, tier: "summarize" }, ctx(1000, 500));
    expect(drawboxTrack(teach, "t=fill").lavfi).toContain("@0.9:t=fill");
    expect(drawboxTrack(summ, "t=fill").lavfi).toContain("@0.35:t=fill");
  });
});

describe("DslCanvas — tile labels are SIZE-driven (founder, 09-05): number wherever it fits, dims when they fit, nothing when nothing fits", () => {
  const textLayers = (doc: any) => (doc.sources as any[]).filter((s) => s?.type === "text").flatMap((s) => s.layers ?? []);
  test("big tiles: number + dims; narrow tiles: number only; hairline tiles: no label at all (and no empty text source)", async () => {
    const big: any = await DslCanvas.render({ M0String: "2(1,1)" as any, preset: "dark" }, ctx(1000, 500));
    expect(textLayers(big).length).toBe(4); // 2 tiles × (number + dims)
    const cols = (n: number) => `${n}(${Array(n).fill("1").join(",")})`;
    const narrow: any = await DslCanvas.render({ M0String: cols(50) as any, preset: "dark" }, ctx(1000, 500)); // 20 px wide
    const narrowLayers = textLayers(narrow);
    expect(narrowLayers.length).toBe(50); // numbers only — the dims line cannot fit 20 px
    expect(narrowLayers.every((l: any) => /^\d+$/.test(l.content?.text ?? ""))).toBe(true);
    const hairline: any = await DslCanvas.render({ M0String: cols(200) as any, preset: "dark" }, ctx(1000, 500)); // 5 px wide
    expect(textLayers(hairline).length).toBe(0);
    expect((hairline.sources as any[]).some((s) => s?.type === "text")).toBe(false); // the engine rejects an empty text source
    expect(maskedTilesOf(hairline, TILE).length).toBe(1); // the tiles themselves still paint
  });
  test("sloth keeps the size-driven labels (it only loses the split scaffolding)", async () => {
    const doc: any = await DslCanvas.render({ M0String: "2(1,1)" as any, preset: "dark", tier: "sloth" }, ctx(1000, 500));
    expect(textLayers(doc).length).toBe(4);
  });
});

describe("DslCanvas — geometry cursor", () => {
  // Find the single lavfi source that carries the drawbox cursor track (by its
  // cursor color, so it's not confused with the split/curtain drawbox tracks).
  const trackOf = (doc: any) =>
    (doc.sources as any[]).find((s) => s?.type === "lavfi" && typeof s?.lavfi === "string" && s.lavfi.includes("color=#FF8A3D"));

  test("the whole cursor track is ONE lavfi source: a drawbox per step, NOT N masked overlays or geq", async () => {
    const doc: any = await DslCanvas.render(
      {
        M0String: "2(1,1)" as any,
        preset: "dark",
        cursorRects: [
          { xFrac: 0, yFrac: 0, wFrac: 0.5, hFrac: 1, activeStartSec: 0.5, activeEndSec: 1.4 },
          { xFrac: 0.5, yFrac: 0, wFrac: 0.5, hFrac: 1, activeStartSec: 1.4, activeEndSec: 2.3 },
        ],
      },
      ctx(1000, 500),
    );
    const track = trackOf(doc);
    expect(track).toBeDefined();
    // no geq (per-pixel/frame) and no inline-mask ring for the cursor.
    expect(track.lavfi.includes("geq=")).toBe(false);
    // one drawbox per cursor rect, on a transparent base.
    expect(track.lavfi.startsWith("color=black@0")).toBe(true);
    expect((track.lavfi.match(/drawbox=/g) || []).length).toBe(2);
    // replace=1 on every drawbox — without it, drawbox leaves the alpha channel
    // at the transparent base's 0 and the orange edges vanish under compositing.
    expect((track.lavfi.match(/replace=1/g) || []).length).toBe(2);
    // each drawbox gated to its window; commas inside between() are \-escaped for
    // the ffmpeg filtergraph parser.
    expect(track.lavfi).toContain("enable=between(t\\,0.500\\,1.400)");
    expect(track.lavfi).toContain("enable=between(t\\,1.400\\,2.300)");
    expect(track.lavfi).toContain("color=#FF8A3D"); // theme.cursor (dark)
  });

  test("a full-canvas cursor box is inset off the perimeter (not clipped by the edge)", async () => {
    const doc: any = await DslCanvas.render(
      {
        M0String: "2(1,1)" as any,
        preset: "dark",
        // the root frame: a cursor covering the WHOLE canvas — its edges would
        // otherwise sit exactly on the boundary and get clipped.
        cursorRects: [{ xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1, activeStartSec: 0.5, activeEndSec: 1.5 }],
      },
      ctx(1000, 500),
    );
    const box = trackOf(doc).lavfi;
    // the box origin is nudged inward by the stroke — not at x=0:y=0.
    expect(box).not.toContain("drawbox=x=0:y=0:");
    expect(box).toMatch(/drawbox=x=[1-9]/);
  });

  test("no cursor rects → no cursor source", async () => {
    const doc: any = await DslCanvas.render({ M0String: "2(1,1)" as any, preset: "dark" }, ctx(1000, 500));
    expect(trackOf(doc)).toBeUndefined();
  });
});

describe("DslCanvas — a layout past the slot's feasibility floor is refused naming the floor (founder, 09-05)", () => {
  test("a 1080-row split in a 1344×756 slot names the floor vs the slot, not just the parser line", () => {
    const m0 = `1080[${Array(1080).fill("F").join(",")}]`;
    // render() refuses synchronously (it only wraps its RESULT in a promise).
    expect(() => DslCanvas.render({ M0String: m0 as any, preset: "dark" }, ctx(1344, 756))).toThrow(
      "dsl-tutorial/canvas: m0 parse failed - Split produced a 0-size frame (infeasible at given width/height). (the layout needs at least 1 x 1080 px; this canvas slot is 1344 x 756 px)",
    );
  });

  test("an invalid string keeps the bare parser message (no floor to name)", () => {
    expect(() => DslCanvas.render({ M0String: "2(1,0)" as any, preset: "dark" }, ctx(1000, 500))).toThrow(
      /^dsl-tutorial\/canvas: m0 parse failed - Passthrough/,
    );
  });
});
