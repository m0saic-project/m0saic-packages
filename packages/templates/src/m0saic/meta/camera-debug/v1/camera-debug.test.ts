import { CameraDebug } from "./camera-debug";
import { buildOverlayStack, computeTimeline } from "@m0saic/template-utils";

// Loose-typed test ctx (avoids `import type` — this package's jest/babel
// transform rejects the named `import type { ... }` form).
function ctx(w: number, h: number, over?: Record<string, unknown>): any {
  return {
    mode: "render",
    output: { width: w, height: h, fps: 30, durationMs: 5000, workspaceDir: "/tmp" },
    target: { width: w, height: h, fps: 30, durationMs: 5000 },
    media: {},
    ...(over ?? {}),
  };
}

const GRID_2X2 = "2(2[1,1],2[1,1])"; // 4 tiles, 640×360 each at 1280×720
const VIEWPORT = "#FF3B30";
const TILE = "#2A3140";
const TILE_BORDER = "#4E5B76";

// At 1280×720: ringT = max(2, round(720·0.005)) = 4. Natural timeline for 4
// steps: lead 0.5 + 4·0.9 + trail 0.9 = 5.0s; envelope: outStart clamps to
// the last reveal (3.2), zoomEnd = 3.5 (the +0.3 minimum ease).
const RING_T = 4;

const trackOf = (doc: any): any =>
  (doc.sources as any[]).find((s) => s?.type === "lavfi" && typeof s?.lavfi === "string" && s.lavfi.includes("drawbox="));
const atlasOf = (doc: any): any =>
  (doc.sources as any[]).find((s) => s?.type === "lavfi" && s?.color === TILE && s?.mask?.kind === "inline-mask");
const borderAtlasOf = (doc: any): any =>
  (doc.sources as any[]).find(
    (s) => s?.type === "lavfi" && s?.color === TILE_BORDER && s?.mask?.kind === "inline-mask",
  );
const smoothRingOf = (doc: any): any =>
  (doc.sources as any[]).find((s) => s?.type === "lavfi" && s?.color === VIEWPORT && s?.mask?.kind === "inline-mask");

describe("CameraDebug — smooth mode (walk recipe filmstrip)", () => {
  test("three layers: border atlas, inset fill atlas, ONE filmstrip track", async () => {
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, zoom: 2, mode: "smooth" },
      ctx(1280, 720),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.sources).toHaveLength(3);
    expect(doc.m0).toBe(buildOverlayStack(3));
    expect(doc.backgroundColor).toBe("#0E1220");
    expect(atlasOf(doc)).toBeDefined();
    expect(borderAtlasOf(doc)).toBeDefined();
  });

  test("borders are the dsl-canvas two-atlas idiom: full rects below, hairline-inset fills above", async () => {
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, zoom: 2, mode: "smooth" },
      ctx(1280, 720),
    );
    const border = borderAtlasOf(doc);
    const fill = atlasOf(doc);
    // Border atlas comes FIRST (painted beneath the fill).
    expect(doc.sources.indexOf(border)).toBeLessThan(doc.sources.indexOf(fill));
    // 640×360 tile: outer radius 14 → border path starts at the full rect…
    expect(border.mask.localPath.startsWith("M14 0 ")).toBe(true);
    // …fill inset by the 1px hairline (radius 13, concentric).
    expect(fill.mask.localPath.startsWith("M14 1 ")).toBe(true);
    expect(fill.mask.localPath).toContain("A13 13");
  });

  test("the filmstrip is ONLY the red rect: starts on tile 1, ends holding the full frame", async () => {
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, zoom: 2, mode: "smooth" },
      ctx(1280, 720),
    );
    expect(smoothRingOf(doc)).toBeUndefined(); // no expression ring, no guides
    const ops = trackOf(doc).lavfi.split(",drawbox=").slice(1);
    // Holds merge, motion samples at fps: many boxes but well under budget.
    expect(ops.length).toBeGreaterThan(5);
    expect(ops.length).toBeLessThanOrEqual(500);
    // Opens settled on tile 1 (top-left viewport) …
    expect(ops[0]).toContain("x=0:y=0:w=640:h=360");
    expect(ops[0]).toContain(":enable=lt(t\\,");
    // … and ends holding the FULL FRAME after the pull-back (no transit gap).
    expect(ops[ops.length - 1]).toContain("x=0:y=0:w=1280:h=720");
    expect(ops[ops.length - 1]).toContain(":enable=gte(t\\,");
    for (const op of ops) expect(op).toContain(`:t=${RING_T}:replace=1`);
  });
});

describe("CameraDebug — snap mode", () => {
  test("one enable-gated viewport ring per settle window + the arrival ring", async () => {
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, zoom: 2, mode: "snap" },
      ctx(1280, 720),
    );
    expect(doc.sources).toHaveLength(3); // border+fill atlases + ONE track (rings collapse)
    const ops = trackOf(doc).lavfi.split(",drawbox=").slice(1);
    expect(ops).toHaveLength(5); // 4 settle rings + full-frame arrival
    // Tile 1 (top-left): focus clamps to the corner → viewport at (0,0) 640×360.
    expect(ops[0]).toContain("x=0:y=0:w=640:h=360");
    expect(ops[0]).toContain(`t=${RING_T}:replace=1:enable=between(t\\,0.500\\,1.400)`);
    // Tile 2 (bottom-left — logical order is column-major here): the
    // viewport slides DOWN to y=360.
    expect(ops[1]).toContain("x=0:y=360:w=640:h=360");
    // Tile 3 (top-right): viewport slides to x=640.
    expect(ops[2]).toContain("x=640:y=0:w=640:h=360");
    // Arrival ring gates on at zoomEnd.
    expect(ops[4]).toContain(`x=0:y=0:w=1280:h=720`);
    expect(ops[4]).toContain("enable=gte(t\\,3.500)");
  });
});

describe("CameraDebug — zoom policy", () => {
  test("auto zoom on an already-legible layout → static full-frame ring, no pan", async () => {
    const doc: any = await CameraDebug.render({ M0String: GRID_2X2 as any }, ctx(1280, 720));
    expect(doc.sources).toHaveLength(3); // border+fill atlases + static ring
    expect(smoothRingOf(doc)).toBeUndefined();
    const track = trackOf(doc);
    expect(track.lavfi).not.toContain(":enable="); // always on — camera never moves
    expect(track.lavfi).toContain("x=0:y=0:w=1280:h=720");
  });

  test("auto zoom kicks in when tiles drop below legibility", async () => {
    // 4×4 grid at 700×380 → 175×95 tiles → min dim 95 < 104 → auto > 1.
    const doc: any = await CameraDebug.render(
      { M0String: "4[4(1,1,1,1),4(1,1,1,1),4(1,1,1,1),4(1,1,1,1)]" as any, mode: "smooth" },
      ctx(700, 380),
    );
    // A moving filmstrip (many gated boxes), not the single static ring.
    const ops = trackOf(doc).lavfi.split(",drawbox=").slice(1);
    expect(ops.length).toBeGreaterThan(5);
    expect(ops[0]).toContain(":enable=");
  });

  test("explicit zoom 1 forces the static camera even on a dense layout", async () => {
    const doc: any = await CameraDebug.render(
      { M0String: "4[4(1,1,1,1),4(1,1,1,1),4(1,1,1,1),4(1,1,1,1)]" as any, zoom: 1 },
      ctx(700, 380),
    );
    expect(smoothRingOf(doc)).toBeUndefined();
    expect(trackOf(doc).lavfi).not.toContain(":enable=");
  });
});

describe("CameraDebug — duration model (dogfoods the motion kit)", () => {
  test("unpinned → the natural computeTimeline recommendation", async () => {
    const doc: any = await CameraDebug.render({ M0String: GRID_2X2 as any }, ctx(1280, 720));
    expect(doc.durationMs).toBe(computeTimeline({ stepCount: 4 }).durationMs);
  });

  test("a pinned render duration rescales the walk to fit exactly", async () => {
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any },
      ctx(1280, 720, { userIntent: { durationMs: 12500 } }),
    );
    expect(doc.durationMs).toBe(12500);
  });

  test("speedMultiplier shortens the natural walk", async () => {
    const fast: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, speedMultiplier: 2 },
      ctx(1280, 720),
    );
    const normal: any = await CameraDebug.render({ M0String: GRID_2X2 as any }, ctx(1280, 720));
    expect(fast.durationMs).toBeLessThan(normal.durationMs);
  });
});

describe("CameraDebug — raw camera (verify-your-math mode)", () => {
  test("constant zoom + arbitrary focus exprs → closed ring driven by EXACTLY those exprs", async () => {
    const focusX = "lt(t,1)*(0.2)+gte(t,1)*(0.8)";
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, camera: { zoom: 2, focusX, focusY: 0.5 } as any },
      ctx(1280, 720),
    );
    expect(doc.sources).toHaveLength(3); // atlases + ring — no walk gating, no arrival track
    const ring = smoothRingOf(doc);
    // ≤32 additive terms pass through rebalance byte-identical.
    expect(ring.overlay.xExpr).toBe(`(640.0000)*(${focusX})`);
    expect(ring.overlay.yExpr).toBe("(360.0000)*(0.50000)"); // numeric focus normalizes
    expect(ring.overlay.enable).toBeUndefined(); // full duration — exprs carry the timing
  });

  test("raw camera WINS over the walk-recipe knobs; a static camera merges to ONE ring", async () => {
    const doc: any = await CameraDebug.render(
      {
        M0String: GRID_2X2 as any,
        camera: { zoom: 3, focusX: 0.5, focusY: 0.5 } as any,
        zoom: 2,
        mode: "snap",
      },
      ctx(1280, 720),
    );
    // All values static → the whole filmstrip merges into a single
    // always-on ring at the exact 1280/3 × 720/3 centered viewport —
    // despite mode:"snap" (recipe knobs are ignored).
    expect(trackOf(doc).lavfi).toBe(
      `color=black@0,drawbox=x=427:y=240:w=427:h=240:color=${VIEWPORT}:t=${RING_T}:replace=1`,
    );
  });

  test("animated (expression) zoom → four full-length guide lines, offsets carry the zoom expr", async () => {
    const zoomExpr = "lt(t,2)*(2.00000)+gte(t,2)*(1.00000)";
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, camera: { zoom: zoomExpr, focusX: 0.25, focusY: "0.5" } as any },
      ctx(1280, 720),
    );
    const guides = (doc.sources as any[]).filter(
      (s) => s?.color === VIEWPORT && s?.mask?.kind === "inline-mask",
    );
    expect(guides).toHaveLength(4);
    const [left, right, top, bottom] = guides;
    expect(left.mask.localPath).toBe(`M0 0 H${RING_T} V720 H0 Z`); // full-height stripe
    expect(top.mask.localPath).toBe(`M0 0 H1280 V${RING_T} H0 Z`); // full-width stripe
    // Left/top at the window origin focus·(frame − frame/zoom)… (the
    // rebalance funnel normalizes redundant double-parens on re-emit).
    expect(left.overlay.xExpr).toBe(`(0.25000)*(1280-1280/(${zoomExpr}))`);
    expect(top.overlay.yExpr).toBe(`(0.5)*(720-720/(${zoomExpr}))`);
    // …right/bottom add the window extent frame/zoom (minus the line width).
    expect(right.overlay.xExpr).toBe(
      `(0.25000)*(1280-1280/(${zoomExpr}))+1280/(${zoomExpr})-${RING_T}`,
    );
    expect(bottom.overlay.yExpr).toBe(
      `(0.5)*(720-720/(${zoomExpr}))+720/(${zoomExpr})-${RING_T}`,
    );
  });

  test("declarative KEYFRAMES: the rect holds, swings across the assigned window, holds", async () => {
    const kf = [
      { t: 1, v: 0 },
      { t: 2, v: 1 },
    ];
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, camera: { zoom: 2, focusX: kf, focusY: 0.5 } as any },
      ctx(1280, 720),
    );
    const ops = trackOf(doc).lavfi.split(",drawbox=").slice(1);
    // Hold before the first key merges into one box covering [0, 1.0).
    expect(ops[0]).toContain("x=0:y=180:w=640:h=360");
    expect(ops[0]).toContain(":enable=lt(t\\,1.000)");
    // Mid-swing slice [1.233, 1.267): smoothstep(0.25) = 0.15625 → x = 100.
    expect(ops.some((op: string) => op.includes("x=100:y=180") && op.includes("1.233"))).toBe(true);
    // Hold after the last key: settled right, gte-gated to the end.
    expect(ops[ops.length - 1]).toContain("x=640:y=180:w=640:h=360");
    expect(ops[ops.length - 1]).toContain(":enable=gte(t\\,2.000)");
  });

  test("per-key ease changes the sampled path (linear vs smoothstep at the quarter point)", async () => {
    const kf = [
      { t: 1, v: 0, ease: "linear" as const },
      { t: 2, v: 1 },
    ];
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, camera: { zoom: 2, focusX: kf, focusY: 0.5 } as any },
      ctx(1280, 720),
    );
    const ops = trackOf(doc).lavfi.split(",drawbox=").slice(1);
    // Same slice as above, linear: u(0.25) = 0.25 → x = 160 (not 100).
    expect(ops.some((op: string) => op.includes("x=160:y=180") && op.includes("1.233"))).toBe(true);
  });

  test("keyframed zoom RESIZES the rect: viewport-sized before, full-frame after", async () => {
    const zkf = [
      { t: 2, v: 2 },
      { t: 3, v: 1 },
    ];
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, camera: { zoom: zkf, focusX: 0.5, focusY: 0.5 } as any },
      ctx(1280, 720),
    );
    expect(smoothRingOf(doc)).toBeUndefined(); // closed rects, never guides
    const ops = trackOf(doc).lavfi.split(",drawbox=").slice(1);
    expect(ops[0]).toContain("x=320:y=180:w=640:h=360"); // centered zoom-2 window
    // Held until the zoom-out; the merge runs one slice past t=2 because the
    // first eased sample still ROUNDS to the same pixel rect (fps slicing).
    expect(ops[0]).toContain(":enable=lt(t\\,2.033)");
    expect(ops[ops.length - 1]).toContain("x=0:y=0:w=1280:h=720"); // grown to full frame
    expect(ops[ops.length - 1]).toContain(":enable=gte(t\\,");
  });

  test("no-op raw camera (zoom ≤ 1 / absent) → static full-frame ring", async () => {
    const doc: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, camera: { zoom: 1, focusX: 0.5 } as any },
      ctx(1280, 720),
    );
    expect(smoothRingOf(doc)).toBeUndefined();
    expect(trackOf(doc).lavfi).not.toContain(":enable=");
    const absent: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, camera: {} as any },
      ctx(1280, 720),
    );
    expect(trackOf(absent).lavfi).toContain("x=0:y=0:w=1280:h=720");
  });
});

describe("CameraDebug — contract", () => {
  test("invalid m0 fails fast (synchronously, like dsl-canvas)", () => {
    expect(() => CameraDebug.render({ M0String: "((((" as any }, ctx(1280, 720))).toThrow(
      /m0 parse failed/,
    );
  });

  test("deterministic: identical inputs → identical documents", async () => {
    const a: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, zoom: 2, mode: "snap" },
      ctx(1280, 720),
    );
    const b: any = await CameraDebug.render(
      { M0String: GRID_2X2 as any, zoom: 2, mode: "snap" },
      ctx(1280, 720),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
