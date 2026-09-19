import {
  autoZoomForLegibility,
  centerFocus,
  followCamera,
  resolvePullBackEnvelope,
  cameraViewportRect,
  CAMERA_MAX_AUTO_ZOOM,
  type CameraTarget,
  type FollowCameraPullBack,
} from "./camera";
import { computeTimeline, type Timeline } from "./timing";

/**
 * Deep-parity goldens captured from dsl-tutorial's `buildCanvasCamera` /
 * `autoCanvasZoom` (pipeline/camera.ts) BEFORE the F2 extraction (Seam A).
 * `followCamera` fed the Seam-D adapter inputs must reproduce them
 * byte-for-byte — including the non-monotonic pull-back keys today's
 * envelope emits on short tails (a characterized quirk, NOT to be "fixed"
 * here). Do not clean these strings up.
 */
const CAM_2TILES_ZOOM2 = {
  zoom: "lt(t,1.40000)*(2.00000)+(gte(t,1.40000)*lt(t,1.70000))*(2.00000+(1.00000-2.00000)*(min(1,max(0,(t-1.40000)/0.30000)))*(min(1,max(0,(t-1.40000)/0.30000)))*(3-2*(min(1,max(0,(t-1.40000)/0.30000)))))+gte(t,1.70000)*(1.00000)",
  focusX:
    "lt(t,0.95000)*(0.00000)+(gte(t,0.95000)*lt(t,1.85000))*(0.00000+(1.00000-0.00000)*(min(1,max(0,(t-0.95000)/0.90000)))*(min(1,max(0,(t-0.95000)/0.90000)))*(3-2*(min(1,max(0,(t-0.95000)/0.90000)))))+(gte(t,1.85000)*lt(t,1.40000))*(1.00000+(1.00000-1.00000)*(min(1,max(0,(t-1.85000)/0.00010)))*(min(1,max(0,(t-1.85000)/0.00010)))*(3-2*(min(1,max(0,(t-1.85000)/0.00010)))))+(gte(t,1.40000)*lt(t,1.70000))*(1.00000+(0.50000-1.00000)*(min(1,max(0,(t-1.40000)/0.30000)))*(min(1,max(0,(t-1.40000)/0.30000)))*(3-2*(min(1,max(0,(t-1.40000)/0.30000)))))+gte(t,1.70000)*(0.50000)",
  focusY:
    "lt(t,0.95000)*(0.00000)+(gte(t,0.95000)*lt(t,1.85000))*(0.00000+(0.00000-0.00000)*(min(1,max(0,(t-0.95000)/0.90000)))*(min(1,max(0,(t-0.95000)/0.90000)))*(3-2*(min(1,max(0,(t-0.95000)/0.90000)))))+(gte(t,1.85000)*lt(t,1.40000))*(0.00000+(0.00000-0.00000)*(min(1,max(0,(t-1.85000)/0.00010)))*(min(1,max(0,(t-1.85000)/0.00010)))*(3-2*(min(1,max(0,(t-1.85000)/0.00010)))))+(gte(t,1.40000)*lt(t,1.70000))*(0.00000+(0.50000-0.00000)*(min(1,max(0,(t-1.40000)/0.30000)))*(min(1,max(0,(t-1.40000)/0.30000)))*(3-2*(min(1,max(0,(t-1.40000)/0.30000)))))+gte(t,1.70000)*(0.50000)",
};

const CAM_2TILES_ZOOM15_ZOOM =
  "lt(t,1.40000)*(1.50000)+(gte(t,1.40000)*lt(t,1.70000))*(1.50000+(1.00000-1.50000)*(min(1,max(0,(t-1.40000)/0.30000)))*(min(1,max(0,(t-1.40000)/0.30000)))*(3-2*(min(1,max(0,(t-1.40000)/0.30000)))))+gte(t,1.70000)*(1.00000)";

const CAM_CENTERED_ZOOM2 = {
  zoom: "lt(t,0.60000)*(2.00000)+(gte(t,0.60000)*lt(t,1.20000))*(2.00000+(1.00000-2.00000)*(min(1,max(0,(t-0.60000)/0.60000)))*(min(1,max(0,(t-0.60000)/0.60000)))*(3-2*(min(1,max(0,(t-0.60000)/0.60000)))))+gte(t,1.20000)*(1.00000)",
  focusX:
    "lt(t,0.95000)*(0.50000)+(gte(t,0.95000)*lt(t,0.60000))*(0.50000+(0.50000-0.50000)*(min(1,max(0,(t-0.95000)/0.00010)))*(min(1,max(0,(t-0.95000)/0.00010)))*(3-2*(min(1,max(0,(t-0.95000)/0.00010)))))+(gte(t,0.60000)*lt(t,1.20000))*(0.50000+(0.50000-0.50000)*(min(1,max(0,(t-0.60000)/0.60000)))*(min(1,max(0,(t-0.60000)/0.60000)))*(3-2*(min(1,max(0,(t-0.60000)/0.60000)))))+gte(t,1.20000)*(0.50000)",
  focusY:
    "lt(t,0.95000)*(0.50000)+(gte(t,0.95000)*lt(t,0.60000))*(0.50000+(0.50000-0.50000)*(min(1,max(0,(t-0.95000)/0.00010)))*(min(1,max(0,(t-0.95000)/0.00010)))*(3-2*(min(1,max(0,(t-0.95000)/0.00010)))))+(gte(t,0.60000)*lt(t,1.20000))*(0.50000+(0.50000-0.50000)*(min(1,max(0,(t-0.60000)/0.60000)))*(min(1,max(0,(t-0.60000)/0.60000)))*(3-2*(min(1,max(0,(t-0.60000)/0.60000)))))+gte(t,1.20000)*(0.50000)",
};

const CAM_EDGE_ZOOM2_FOCUSX =
  "lt(t,0.95000)*(0.00000)+(gte(t,0.95000)*lt(t,0.60000))*(0.00000+(0.00000-0.00000)*(min(1,max(0,(t-0.95000)/0.00010)))*(min(1,max(0,(t-0.95000)/0.00010)))*(3-2*(min(1,max(0,(t-0.95000)/0.00010)))))+(gte(t,0.60000)*lt(t,1.20000))*(0.00000+(0.50000-0.00000)*(min(1,max(0,(t-0.60000)/0.60000)))*(min(1,max(0,(t-0.60000)/0.60000)))*(3-2*(min(1,max(0,(t-0.60000)/0.60000)))))+gte(t,1.20000)*(0.50000)";

const CAM_MIXED_ZOOM2 = {
  zoom: "lt(t,2.30000)*(2.00000)+(gte(t,2.30000)*lt(t,2.60000))*(2.00000+(1.00000-2.00000)*(min(1,max(0,(t-2.30000)/0.30000)))*(min(1,max(0,(t-2.30000)/0.30000)))*(3-2*(min(1,max(0,(t-2.30000)/0.30000)))))+gte(t,2.60000)*(1.00000)",
  focusX:
    "lt(t,0.95000)*(0.00000)+(gte(t,0.95000)*lt(t,1.85000))*(0.00000+(1.00000-0.00000)*(min(1,max(0,(t-0.95000)/0.90000)))*(min(1,max(0,(t-0.95000)/0.90000)))*(3-2*(min(1,max(0,(t-0.95000)/0.90000)))))+(gte(t,1.85000)*lt(t,2.75000))*(1.00000+(1.00000-1.00000)*(min(1,max(0,(t-1.85000)/0.90000)))*(min(1,max(0,(t-1.85000)/0.90000)))*(3-2*(min(1,max(0,(t-1.85000)/0.90000)))))+(gte(t,2.75000)*lt(t,2.30000))*(1.00000+(1.00000-1.00000)*(min(1,max(0,(t-2.75000)/0.00010)))*(min(1,max(0,(t-2.75000)/0.00010)))*(3-2*(min(1,max(0,(t-2.75000)/0.00010)))))+(gte(t,2.30000)*lt(t,2.60000))*(1.00000+(0.50000-1.00000)*(min(1,max(0,(t-2.30000)/0.30000)))*(min(1,max(0,(t-2.30000)/0.30000)))*(3-2*(min(1,max(0,(t-2.30000)/0.30000)))))+gte(t,2.60000)*(0.50000)",
  focusY:
    "lt(t,0.95000)*(0.00000)+(gte(t,0.95000)*lt(t,1.85000))*(0.00000+(0.00000-0.00000)*(min(1,max(0,(t-0.95000)/0.90000)))*(min(1,max(0,(t-0.95000)/0.90000)))*(3-2*(min(1,max(0,(t-0.95000)/0.90000)))))+(gte(t,1.85000)*lt(t,2.75000))*(0.00000+(1.00000-0.00000)*(min(1,max(0,(t-1.85000)/0.90000)))*(min(1,max(0,(t-1.85000)/0.90000)))*(3-2*(min(1,max(0,(t-1.85000)/0.90000)))))+(gte(t,2.75000)*lt(t,2.30000))*(1.00000+(1.00000-1.00000)*(min(1,max(0,(t-2.75000)/0.00010)))*(min(1,max(0,(t-2.75000)/0.00010)))*(3-2*(min(1,max(0,(t-2.75000)/0.00010)))))+(gte(t,2.30000)*lt(t,2.60000))*(1.00000+(0.50000-1.00000)*(min(1,max(0,(t-2.30000)/0.30000)))*(min(1,max(0,(t-2.30000)/0.30000)))*(3-2*(min(1,max(0,(t-2.30000)/0.30000)))))+gte(t,2.60000)*(0.50000)",
};

const CAM_2TILES_ZOOM2_LONG = {
  zoom: "lt(t,14.37500)*(2.00000)+(gte(t,14.37500)*lt(t,18.00000))*(2.00000+(1.00000-2.00000)*(min(1,max(0,(t-14.37500)/3.62500)))*(min(1,max(0,(t-14.37500)/3.62500)))*(3-2*(min(1,max(0,(t-14.37500)/3.62500)))))+gte(t,18.00000)*(1.00000)",
  focusX:
    "lt(t,5.93750)*(0.00000)+(gte(t,5.93750)*lt(t,11.56250))*(0.00000+(1.00000-0.00000)*(min(1,max(0,(t-5.93750)/5.62500)))*(min(1,max(0,(t-5.93750)/5.62500)))*(3-2*(min(1,max(0,(t-5.93750)/5.62500)))))+(gte(t,11.56250)*lt(t,14.37500))*(1.00000+(1.00000-1.00000)*(min(1,max(0,(t-11.56250)/2.81250)))*(min(1,max(0,(t-11.56250)/2.81250)))*(3-2*(min(1,max(0,(t-11.56250)/2.81250)))))+(gte(t,14.37500)*lt(t,18.00000))*(1.00000+(0.50000-1.00000)*(min(1,max(0,(t-14.37500)/3.62500)))*(min(1,max(0,(t-14.37500)/3.62500)))*(3-2*(min(1,max(0,(t-14.37500)/3.62500)))))+gte(t,18.00000)*(0.50000)",
  focusY:
    "lt(t,5.93750)*(0.00000)+(gte(t,5.93750)*lt(t,11.56250))*(0.00000+(0.00000-0.00000)*(min(1,max(0,(t-5.93750)/5.62500)))*(min(1,max(0,(t-5.93750)/5.62500)))*(3-2*(min(1,max(0,(t-5.93750)/5.62500)))))+(gte(t,11.56250)*lt(t,14.37500))*(0.00000+(0.00000-0.00000)*(min(1,max(0,(t-11.56250)/2.81250)))*(min(1,max(0,(t-11.56250)/2.81250)))*(3-2*(min(1,max(0,(t-11.56250)/2.81250)))))+(gte(t,14.37500)*lt(t,18.00000))*(0.00000+(0.50000-0.00000)*(min(1,max(0,(t-14.37500)/3.62500)))*(min(1,max(0,(t-14.37500)/3.62500)))*(3-2*(min(1,max(0,(t-14.37500)/3.62500)))))+gte(t,18.00000)*(0.50000)",
};

/** The Seam-D adapter math dsl-tutorial keeps: which rects become targets is
 *  domain policy; HERE we just mirror it to prove followCamera reproduces
 *  buildCanvasCamera when fed the same decisions. */
type Rect = { x: number; y: number; width: number; height: number };
function adapterInputs(
  rectsByIndex: { index: number; rect: Rect }[],
  tl: Timeline,
): { targets: CameraTarget[]; pullBack: FollowCameraPullBack } {
  const sorted = rectsByIndex.slice().sort((a, b) => a.index - b.index);
  const settle = (i: number) => tl.stepStartSec(i) + tl.stepDurSec / 2;
  const targets = sorted.map((s) => ({ rect: s.rect, atSec: settle(s.index) }));
  const last = sorted[sorted.length - 1].index;
  const endSec = tl.durationMs / 1000;
  return {
    targets,
    pullBack: {
      endSec,
      earliestStartSec: tl.stepStartSec(last),
      settleOutSec: Math.min(settle(last) + tl.stepDurSec / 2, endSec),
    },
  };
}

const W = 1000;
const H = 1000;
const twoTiles = [
  { index: 1, rect: { x: 0, y: 0, width: 500, height: 500 } },
  { index: 2, rect: { x: 500, y: 0, width: 500, height: 500 } },
];

describe("followCamera — deep parity vs captured buildCanvasCamera", () => {
  test("two tiles, zoom 2", () => {
    const tl = computeTimeline({ stepCount: 2 });
    const { targets, pullBack } = adapterInputs(twoTiles, tl);
    expect(followCamera(targets, W, H, 2, pullBack)).toEqual(CAM_2TILES_ZOOM2);
  });

  test("two tiles, zoom 1.5 (zoom expr tracks the zoom level)", () => {
    const tl = computeTimeline({ stepCount: 2 });
    const { targets, pullBack } = adapterInputs(twoTiles, tl);
    expect(followCamera(targets, W, H, 1.5, pullBack)!.zoom).toBe(CAM_2TILES_ZOOM15_ZOOM);
  });

  test("single centered tile → focus holds 0.5 through the pull-back", () => {
    const tl = computeTimeline({ stepCount: 2 });
    const { targets, pullBack } = adapterInputs(
      [{ index: 1, rect: { x: 250, y: 250, width: 500, height: 500 } }],
      tl,
    );
    expect(followCamera(targets, W, H, 2, pullBack)).toEqual(CAM_CENTERED_ZOOM2);
  });

  test("edge tile → focus clamps to 0, then pans to center", () => {
    const tl = computeTimeline({ stepCount: 2 });
    const { targets, pullBack } = adapterInputs(
      [{ index: 1, rect: { x: 0, y: 450, width: 200, height: 100 } }],
      tl,
    );
    expect(followCamera(targets, W, H, 2, pullBack)!.focusX).toBe(CAM_EDGE_ZOOM2_FOCUSX);
  });

  test("passthrough mixed in, unsorted input → adapter sorts, parity holds", () => {
    const tl = computeTimeline({ stepCount: 3 });
    const { targets, pullBack } = adapterInputs(
      [
        { index: 3, rect: { x: 500, y: 500, width: 500, height: 500 } },
        { index: 2, rect: { x: 500, y: 0, width: 500, height: 500 } }, // the donating `>` slot
        { index: 1, rect: { x: 0, y: 0, width: 500, height: 250 } },
      ],
      tl,
    );
    expect(followCamera(targets, W, H, 2, pullBack)).toEqual(CAM_MIXED_ZOOM2);
  });

  test("long pinned timeline → the endSec-hold-lead branch drives outStart", () => {
    const tl = computeTimeline({ stepCount: 2, targetDurationMs: 20000 });
    const { targets, pullBack } = adapterInputs(twoTiles, tl);
    expect(followCamera(targets, W, H, 2, pullBack)).toEqual(CAM_2TILES_ZOOM2_LONG);
  });
});

describe("followCamera — behavior (ported from dsl-tutorial camera.test.ts)", () => {
  const tl = computeTimeline({ stepCount: 2 });
  const { targets, pullBack } = adapterInputs(twoTiles, tl);

  test("zoom <= 1 → undefined (stays fit-to-panel)", () => {
    expect(followCamera(targets, W, H, 1, pullBack)).toBeUndefined();
    expect(followCamera(targets, W, H, 0.5, pullBack)).toBeUndefined();
  });

  test("no targets / degenerate frame → undefined", () => {
    expect(followCamera([], W, H, 2, pullBack)).toBeUndefined();
    expect(followCamera(targets, 0, H, 2, pullBack)).toBeUndefined();
    expect(followCamera(targets, W, -1, 2, pullBack)).toBeUndefined();
  });

  test("zoom > 1 → animated exprs: gated pans, smoothstep ease, zoom-out tail", () => {
    const cam = followCamera(targets, W, H, 2, pullBack)!;
    expect(typeof cam.zoom).toBe("string");
    expect(cam.zoom as string).toContain("2"); // the held zoom level
    expect(cam.zoom as string).toContain("3-2*"); // smoothstep down to 1
    expect(cam.focusX as string).toContain("gte(t,"); // gated segments
    expect(cam.focusX as string).toContain("3-2*"); // eased
  });

  test("without pullBack → constant numeric zoom, focus still keyframed", () => {
    const cam = followCamera(targets, W, H, 2)!;
    expect(cam.zoom).toBe(2);
    // Focus ends on the LAST SETTLE hold — no pan-to-center tail was added.
    expect((cam.focusX as string).endsWith("gte(t,1.85000)*(1.00000)")).toBe(true);
    expect((cam.focusY as string).endsWith("gte(t,1.85000)*(0.00000)")).toBe(true);
  });

  test("deterministic", () => {
    expect(JSON.stringify(followCamera(targets, W, H, 1.5, pullBack))).toBe(
      JSON.stringify(followCamera(targets, W, H, 1.5, pullBack)),
    );
  });
});

describe("resolvePullBackEnvelope", () => {
  test("matches the moments baked into the parity goldens (short and long tails)", () => {
    // Two tiles, natural 3.2s clip: outStart clamps to earliestStart (1.4),
    // zoomEnd = outStart + the 0.3 minimum ease (see CAM_2TILES_ZOOM2).
    const short = resolvePullBackEnvelope({ endSec: 3.2, earliestStartSec: 1.4, settleOutSec: 2.3 });
    expect(short).toEqual({ outStartSec: 1.4, zoomEndSec: 1.7, active: true });
    // Pinned 20s clip: the endSec - hold - 0.6 branch wins (CAM_2TILES_ZOOM2_LONG).
    const long = resolvePullBackEnvelope({ endSec: 20, earliestStartSec: 5, settleOutSec: 14.375 });
    expect(long).toEqual({ outStartSec: 14.375, zoomEndSec: 18, active: true });
  });

  test("inactive when the tail can't fit any pull-back", () => {
    const env = resolvePullBackEnvelope({ endSec: 1.0, earliestStartSec: 1.0, settleOutSec: 1.0 });
    expect(env.active).toBe(false);
  });

  test("holdTargetSec override shifts both moments", () => {
    const env = resolvePullBackEnvelope({
      endSec: 20,
      earliestStartSec: 5,
      settleOutSec: 14.375,
      holdTargetSec: 4,
    });
    expect(env).toEqual({ outStartSec: 14.375, zoomEndSec: 16, active: true });
  });
});

describe("cameraViewportRect", () => {
  test("inverse of centerFocus: window centers on the original fraction", () => {
    const f = 0.6;
    const zoom = 3;
    const focus = centerFocus(f, zoom);
    const vp = cameraViewportRect(focus, focus, zoom, 1200, 900);
    expect(vp.width).toBe(400);
    expect(vp.height).toBe(300);
    expect((vp.x + vp.width / 2) / 1200).toBeCloseTo(f, 12);
    expect((vp.y + vp.height / 2) / 900).toBeCloseTo(f, 12);
  });

  test("focus 0 / 1 pin the window to the edges; zoom 1 is the full frame", () => {
    expect(cameraViewportRect(0, 0, 2, 1000, 800)).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    expect(cameraViewportRect(1, 1, 2, 1000, 800)).toEqual({ x: 500, y: 400, width: 500, height: 400 });
    expect(cameraViewportRect(0.5, 0.5, 1, 1000, 800)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });
});

describe("centerFocus", () => {
  test("a centered fraction maps to 0.5 at any zoom", () => {
    expect(centerFocus(0.5, 2)).toBe(0.5);
    expect(centerFocus(0.5, 4)).toBe(0.5);
  });

  test("edge fractions clamp so the crop window stays in-bounds", () => {
    expect(centerFocus(0.1, 2)).toBe(0); // unclamped would be -0.3
    expect(centerFocus(0.9, 2)).toBe(1); // unclamped would be 1.3
  });

  test("solves the crop-center equation inside the clamp range", () => {
    // ((zoom-1)/zoom)*focus + 1/(2*zoom) === f
    const f = 0.6;
    const zoom = 3;
    const focus = centerFocus(f, zoom);
    expect(((zoom - 1) / zoom) * focus + 1 / (2 * zoom)).toBeCloseTo(f, 12);
  });
});

describe("autoZoomForLegibility — parity vs captured autoCanvasZoom", () => {
  const cellW = 1400;
  const cellH = 700;
  const grid = (n: number): { width: number; height: number }[] => {
    const s = 1000 / n;
    return Array.from({ length: n * n }, () => ({ width: s, height: s }));
  };

  test("captured golden values", () => {
    expect(autoZoomForLegibility(grid(2), W, H, cellW, cellH)).toBe(1);
    expect(autoZoomForLegibility(grid(6), W, H, cellW, cellH)).toBe(1);
    expect(autoZoomForLegibility(grid(8), W, H, cellW, cellH)).toBe(1.1885714285714286);
    expect(autoZoomForLegibility(grid(12), W, H, cellW, cellH)).toBe(1.7828571428571429);
    expect(autoZoomForLegibility(grid(40), W, H, cellW, cellH)).toBe(4); // capped
  });

  test("a full-bleed rect pins zoom to 1 (fitZoom branch)", () => {
    expect(
      autoZoomForLegibility(
        [
          { width: 1000, height: 1000 },
          { width: 50, height: 50 },
        ],
        W,
        H,
        cellW,
        cellH,
      ),
    ).toBe(1);
  });

  test("denser zooms more; cap holds", () => {
    expect(autoZoomForLegibility(grid(12), W, H, cellW, cellH)).toBeGreaterThan(
      autoZoomForLegibility(grid(8), W, H, cellW, cellH),
    );
    expect(autoZoomForLegibility(grid(40), W, H, cellW, cellH)).toBeLessThanOrEqual(
      CAMERA_MAX_AUTO_ZOOM,
    );
  });

  test("no rects / degenerate sizes → 1", () => {
    expect(autoZoomForLegibility([], W, H, cellW, cellH)).toBe(1);
    expect(autoZoomForLegibility(grid(4), 0, H, cellW, cellH)).toBe(1);
    expect(autoZoomForLegibility(grid(4), W, H, 0, 0)).toBe(1);
    expect(autoZoomForLegibility([{ width: 0, height: 0 }], W, H, cellW, cellH)).toBe(1);
  });

  test("opts override the policy constants", () => {
    // grid(8): min on-screen px = 87.5 → legiblePx 175 doubles the zoom ask.
    expect(autoZoomForLegibility(grid(8), W, H, cellW, cellH, { legiblePx: 175 })).toBe(2);
    expect(
      autoZoomForLegibility(grid(8), W, H, cellW, cellH, { legiblePx: 175, maxZoom: 1.5 }),
    ).toBe(1.5);
    // Not worth it under a raised threshold.
    expect(autoZoomForLegibility(grid(8), W, H, cellW, cellH, { minWorthZoom: 1.2 })).toBe(1);
  });

  test("deterministic", () => {
    expect(autoZoomForLegibility(grid(10), W, H, cellW, cellH)).toBe(
      autoZoomForLegibility(grid(10), W, H, cellW, cellH),
    );
  });
});
