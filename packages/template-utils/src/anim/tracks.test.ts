import {
  gatedBoxTrackSource,
  curtainSource,
  dashedGuideBoxes,
  gatedEnableExpr,
  roundedRectPathD,
  maskAtlasSource,
  GATED_BOX_BUDGET,
  DASH_SEGMENT_BUDGET,
  MASK_SUBPATH_BUDGET,
  type GatedBox,
} from "./tracks";

/** The one drawbox grammar all three dsl-canvas idioms share (curtain :260,
 *  cursor ring :373, split dashes :478) — key order and escaping are the
 *  parity contract for the Phase 3 refactor. */
describe("gatedBoxTrackSource", () => {
  test("curtain-shape golden (revealCurtainSource term grammar)", () => {
    const src = gatedBoxTrackSource([{ x: 0, y: 0, w: 500, h: 500, toSec: 1.4 }], {
      color: "#111726",
    });
    expect(src.type).toBe("lavfi");
    expect(src.lavfi).toBe(
      "color=black@0,drawbox=x=0:y=0:w=500:h=500:color=#111726:t=fill:replace=1:enable=lt(t\\,1.400)",
    );
  });

  test("ring-shape golden (cursorTrackSource term grammar)", () => {
    const src = gatedBoxTrackSource(
      [{ x: 10, y: 20, w: 300, h: 200, fromSec: 0.95, toSec: 1.85, thicknessPx: 5 }],
      { color: "#FF8A3D" },
    );
    expect(src.lavfi).toBe(
      "color=black@0,drawbox=x=10:y=20:w=300:h=200:color=#FF8A3D:t=5:replace=1:enable=between(t\\,0.950\\,1.850)",
    );
  });

  test("window semantics: only fromSec → gte; neither → always on; fromSec 0 → start", () => {
    const boxes: GatedBox[] = [
      { x: 0, y: 0, w: 10, h: 10, fromSec: 1.2 },
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 10, h: 10, fromSec: 0, toSec: 2 },
    ];
    const ops = gatedBoxTrackSource(boxes, { color: "c" }).lavfi!.split(",drawbox=").slice(1);
    expect(ops[0]).toContain(":enable=gte(t\\,1.200)");
    expect(ops[1]).not.toContain(":enable=");
    expect(ops[2]).toContain(":enable=lt(t\\,2.000)"); // fromSec 0 = from the start
  });

  test("replace=1 is present on EVERY drawbox (R7 — alpha writes on the transparent base)", () => {
    const boxes: GatedBox[] = Array.from({ length: 20 }, (_v, i) => ({
      x: i,
      y: 0,
      w: 5,
      h: 5,
      toSec: i + 1,
    }));
    const ops = gatedBoxTrackSource(boxes, { color: "c" }).lavfi!.split(",drawbox=").slice(1);
    expect(ops).toHaveLength(20);
    for (const op of ops) expect(op).toContain(":replace=1");
  });

  test("per-box color override (alpha-suffixed colors ride through verbatim)", () => {
    const src = gatedBoxTrackSource(
      [
        { x: 0, y: 0, w: 10, h: 10, color: "#7C5CFF@0.9" },
        { x: 1, y: 0, w: 10, h: 10 },
      ],
      { color: "#FFFFFF" },
    );
    expect(src.lavfi).toContain("color=#7C5CFF@0.9:t=fill");
    expect(src.lavfi).toContain("color=#FFFFFF:t=fill");
  });

  test("transparent base is always the first graph node", () => {
    expect(gatedBoxTrackSource([], { color: "c" }).lavfi).toBe("color=black@0");
    expect(
      gatedBoxTrackSource([{ x: 0, y: 0, w: 1, h: 1 }], { color: "c" }).lavfi!.startsWith(
        "color=black@0,",
      ),
    ).toBe(true);
  });

  test("throws fail-fast past the budget (default and explicit)", () => {
    const boxes: GatedBox[] = Array.from({ length: 3 }, (_v, i) => ({ x: i, y: 0, w: 1, h: 1 }));
    expect(() => gatedBoxTrackSource(boxes, { color: "c", budget: 2 })).toThrow(/argv budget/);
    const big: GatedBox[] = Array.from({ length: GATED_BOX_BUDGET + 1 }, (_v, i) => ({
      x: i,
      y: 0,
      w: 1,
      h: 1,
    }));
    expect(() => gatedBoxTrackSource(big, { color: "c" })).toThrow(/argv budget/);
  });
});

describe("gatedEnableExpr", () => {
  test("the four window shapes, comma-escaped for raw lavfi argv", () => {
    expect(gatedEnableExpr(0.95, 1.85)).toBe("between(t\\,0.950\\,1.850)");
    expect(gatedEnableExpr(undefined, 1.4)).toBe("lt(t\\,1.400)");
    expect(gatedEnableExpr(1.2, undefined)).toBe("gte(t\\,1.200)");
    expect(gatedEnableExpr(undefined, undefined)).toBeNull();
    expect(gatedEnableExpr(0, 2)).toBe("lt(t\\,2.000)"); // 0 = from the start
  });
});

describe("curtainSource", () => {
  test("byte-parity with revealCurtainSource's emitted lavfi", () => {
    const src = curtainSource(
      [
        { x: 0, y: 0, w: 500, h: 500, revealAtSec: 0 }, // visible from t=0 → skipped
        { x: 500, y: 0, w: 500, h: 500, revealAtSec: 1.4 },
        { x: 0, y: 500, w: 500, h: 500, revealAtSec: 2.3 },
      ],
      "#111726",
    );
    expect(src!.lavfi).toBe(
      "color=black@0," +
        "drawbox=x=500:y=0:w=500:h=500:color=#111726:t=fill:replace=1:enable=lt(t\\,1.400)," +
        "drawbox=x=0:y=500:w=500:h=500:color=#111726:t=fill:replace=1:enable=lt(t\\,2.300)",
    );
  });

  test("null when nothing is ever curtained (parity: all reveal at t=0 / empty)", () => {
    expect(curtainSource([], "#111726")).toBeNull();
    expect(curtainSource([{ x: 0, y: 0, w: 10, h: 10, revealAtSec: 0 }], "#111726")).toBeNull();
    expect(curtainSource([{ x: 0, y: 0, w: 10, h: 10, revealAtSec: -1 }], "#111726")).toBeNull();
  });

  test("budget forwards to the underlying track", () => {
    const boxes = Array.from({ length: 3 }, (_v, i) => ({
      x: i,
      y: 0,
      w: 1,
      h: 1,
      revealAtSec: i + 1,
    }));
    expect(() => curtainSource(boxes, "c", { budget: 2 })).toThrow(/argv budget/);
  });
});

describe("dashedGuideBoxes — splitTrackSource math parity", () => {
  // W=H=1000 → lineW = max(2, round(3)) = 3; dash0 = max(6, 16) = 16;
  // gap0 = max(4, round(11.2)) = 11; period = 27; half = 1.5.
  const opts = { canvasW: 1000, canvasH: 1000 };

  test("horizontal line: fixed dash+gap period, rounded cross-axis position", () => {
    const boxes = dashedGuideBoxes(
      [{ vertical: false, fixed: 100, from: 0, to: 400, fromSec: 0.5, toSec: 2 }],
      opts,
    );
    // p = 0, 27, …, 378 → 15 dashes, all full 16px (400-378=22 ≥ 16).
    expect(boxes).toHaveLength(15);
    expect(boxes[0]).toEqual({ x: 0, y: 99, w: 16, h: 3, fromSec: 0.5, toSec: 2 });
    expect(boxes[14]).toEqual({ x: 378, y: 99, w: 16, h: 3, fromSec: 0.5, toSec: 2 });
  });

  test("vertical line swaps the axes", () => {
    const boxes = dashedGuideBoxes(
      [{ vertical: true, fixed: 200, from: 100, to: 150, fromSec: 1, toSec: 3 }],
      opts,
    );
    expect(boxes).toEqual([
      { x: 199, y: 100, w: 3, h: 16, fromSec: 1, toSec: 3 },
      { x: 199, y: 127, w: 3, h: 16, fromSec: 1, toSec: 3 },
    ]);
  });

  test("tail dash shorter than 1px breaks; zero/negative spans are skipped", () => {
    // to=27.5: p=0 → 16px dash; p=27 → len 0.5 < 1 → break.
    expect(
      dashedGuideBoxes([{ vertical: false, fixed: 10, from: 0, to: 27.5 }], opts),
    ).toHaveLength(1);
    expect(dashedGuideBoxes([{ vertical: false, fixed: 10, from: 50, to: 50 }], opts)).toEqual([]);
    expect(dashedGuideBoxes([{ vertical: false, fixed: 10, from: 60, to: 50 }], opts)).toEqual([]);
  });

  test("over-budget layouts coarsen the period UNIFORMLY instead of overflowing", () => {
    // One 2700px line at period 27 wants 100 dashes; budget 10 → scale 10:
    // period 270, dash 160 — crisp sparse guides, exactly at budget.
    const boxes = dashedGuideBoxes([{ vertical: false, fixed: 10, from: 0, to: 2700 }], {
      ...opts,
      budget: 10,
    });
    expect(boxes).toHaveLength(10);
    expect(boxes[0].w).toBe(160); // dash scaled with the period (not thinned out)
    expect(DASH_SEGMENT_BUDGET).toBe(700); // the default stays the dsl-canvas value
  });

  test("explicit lineWidthPx / dashPx / gapPx override the canvas-derived defaults", () => {
    const boxes = dashedGuideBoxes([{ vertical: false, fixed: 10, from: 0, to: 30 }], {
      ...opts,
      lineWidthPx: 2,
      dashPx: 10,
      gapPx: 5,
    });
    // period 15: p=0 (len 10), p=15 (len 10) → 2 dashes of width 10, height 2.
    expect(boxes).toEqual([
      { x: 0, y: 9, w: 10, h: 2, fromSec: undefined, toSec: undefined },
      { x: 15, y: 9, w: 10, h: 2, fromSec: undefined, toSec: undefined },
    ]);
  });

  test("composes through gatedBoxTrackSource into the split-track grammar", () => {
    const boxes = dashedGuideBoxes(
      [{ vertical: false, fixed: 100, from: 0, to: 20, fromSec: 0.5, toSec: 2 }],
      opts,
    );
    const src = gatedBoxTrackSource(boxes, { color: "#7C5CFF@0.9" });
    expect(src.lavfi).toBe(
      "color=black@0,drawbox=x=0:y=99:w=16:h=3:color=#7C5CFF@0.9:t=fill:replace=1:enable=between(t\\,0.500\\,2.000)",
    );
  });
});

describe("roundedRectPathD — golden vs dsl-canvas roundedRectAt", () => {
  test("rounded", () => {
    expect(roundedRectPathD(10, 20, 100, 60, 8)).toBe(
      "M18 20 H102 A8 8 0 0 1 110 28 V72 A8 8 0 0 1 102 80 H18 A8 8 0 0 1 10 72 V28 A8 8 0 0 1 18 20 Z",
    );
  });

  test("r ≤ 0 → plain rect", () => {
    expect(roundedRectPathD(10, 20, 100, 60, 0)).toBe("M10 20 H110 V80 H10 Z");
    expect(roundedRectPathD(10, 20, 100, 60, -5)).toBe("M10 20 H110 V80 H10 Z");
  });

  test("radius clamps to the half-extents", () => {
    expect(roundedRectPathD(0, 0, 30, 60, 100)).toBe(
      "M15 0 H15 A15 15 0 0 1 30 15 V45 A15 15 0 0 1 15 60 H15 A15 15 0 0 1 0 45 V15 A15 15 0 0 1 15 0 Z",
    );
  });
});

describe("maskAtlasSource", () => {
  const bounds = { width: 1280, height: 760 };

  test("joins subpaths into ONE silhouette on canvas-space bounds", () => {
    const p1 = roundedRectPathD(0, 0, 100, 100, 4);
    const p2 = roundedRectPathD(200, 0, 100, 100, 4);
    const src = maskAtlasSource([p1, p2], "#232B3D", bounds) as {
      type?: string;
      mask?: { kind: string; localPath: string; bounds: { x: number; y: number; width: number; height: number } };
    };
    expect(src.mask?.kind).toBe("inline-mask");
    expect(src.mask?.localPath).toBe(`${p1} ${p2}`);
    expect(src.mask?.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 760 });
  });

  test("empty subpaths are dropped (degenerate rects filter to nothing upstream)", () => {
    const p = roundedRectPathD(0, 0, 50, 50, 0);
    const src = maskAtlasSource(["", p, ""], "#232B3D", bounds) as {
      mask?: { localPath: string };
    };
    expect(src.mask?.localPath).toBe(p);
  });

  test("throws past MASK_SUBPATH_BUDGET (the one-resolver-arg argv wall)", () => {
    const paths = Array.from({ length: MASK_SUBPATH_BUDGET + 1 }, (_v, i) =>
      roundedRectPathD(i, 0, 5, 5, 0),
    );
    expect(() => maskAtlasSource(paths, "#232B3D", bounds)).toThrow(/MASK_SUBPATH_BUDGET/);
  });

  test("deterministic", () => {
    const paths = [roundedRectPathD(0, 0, 10, 10, 2), roundedRectPathD(20, 0, 10, 10, 2)];
    expect(JSON.stringify(maskAtlasSource(paths, "#232B3D", bounds))).toBe(
      JSON.stringify(maskAtlasSource(paths, "#232B3D", bounds)),
    );
  });
});

describe("track-level union window (enable-gating sprint)", () => {
  test("gatedBoxTrackSource: both bounds → [min(from), max(to)]", () => {
    const s = gatedBoxTrackSource(
      [
        { x: 0, y: 0, w: 10, h: 10, fromSec: 1.25, toSec: 2 },
        { x: 20, y: 0, w: 10, h: 10, fromSec: 0.5, toSec: 3.5 },
      ],
      { color: "#fff" },
    ) as { overlay?: { window?: { startSec?: number; endSec?: number } } };
    expect(s.overlay?.window).toEqual({ startSec: 0.5, endSec: 3.5 });
  });

  test("a box open on a side opens that bound", () => {
    const noFrom = gatedBoxTrackSource(
      [
        { x: 0, y: 0, w: 10, h: 10, toSec: 2 }, // paints from t=0
        { x: 20, y: 0, w: 10, h: 10, fromSec: 1, toSec: 3 },
      ],
      { color: "#fff" },
    ) as { overlay?: { window?: object } };
    expect(noFrom.overlay?.window).toEqual({ endSec: 3 });

    const noTo = gatedBoxTrackSource(
      [
        { x: 0, y: 0, w: 10, h: 10, fromSec: 1 }, // paints to stream end
        { x: 20, y: 0, w: 10, h: 10, fromSec: 2, toSec: 3 },
      ],
      { color: "#fff" },
    ) as { overlay?: { window?: object } };
    expect(noTo.overlay?.window).toEqual({ startSec: 1 });
  });

  test("fromSec ≤ 0 counts as open-from-0 (gatedEnableExpr parity)", () => {
    const s = gatedBoxTrackSource(
      [{ x: 0, y: 0, w: 10, h: 10, fromSec: 0, toSec: 2 }],
      { color: "#fff" },
    ) as { overlay?: { window?: object } };
    expect(s.overlay?.window).toEqual({ endSec: 2 });
  });

  test("no gated box → no overlay/window attached", () => {
    const s = gatedBoxTrackSource([{ x: 0, y: 0, w: 10, h: 10 }], { color: "#fff" }) as {
      overlay?: unknown;
    };
    expect(s.overlay).toBeUndefined();
  });

  test("curtainSource inherits the union end (max reveal moment)", () => {
    const s = curtainSource(
      [
        { x: 0, y: 0, w: 10, h: 10, revealAtSec: 1.5 },
        { x: 20, y: 0, w: 10, h: 10, revealAtSec: 4 },
        { x: 40, y: 0, w: 10, h: 10, revealAtSec: 0 }, // never curtained
      ],
      "#232B3D",
    ) as { overlay?: { window?: object } } | null;
    expect(s?.overlay?.window).toEqual({ endSec: 4 });
  });
});
