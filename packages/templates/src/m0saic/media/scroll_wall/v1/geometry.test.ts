import {
  computeScrollWallGeometry,
  crossAxisBands,
  largestDivisorAtMost,
  scrollAxisLattice,
  type ScrollWallGeometry,
} from "./geometry";

function geom(args: Partial<Parameters<typeof computeScrollWallGeometry>[0]> = {}): ScrollWallGeometry {
  const r = computeScrollWallGeometry({
    canvasW: 1920,
    canvasH: 1080,
    visibleCount: 4,
    rows: 2,
    gapPx: 24,
    marginPx: 0,
    ...args,
  });
  if (!r.ok) throw new Error(`expected ok geometry, got: ${r.error}`);
  return r.geometry;
}

describe("largestDivisorAtMost", () => {
  it("finds the largest divisor under the cap", () => {
    expect(largestDivisorAtMost(1920, 24)).toBe(24);
    expect(largestDivisorAtMost(1080, 24)).toBe(24);
    expect(largestDivisorAtMost(1920, 25)).toBe(24);
    expect(largestDivisorAtMost(1080, 47)).toBe(45);
  });

  it("collapses to 1 on a prime axis (warning-only territory)", () => {
    expect(largestDivisorAtMost(997, 24)).toBe(1);
  });

  it("never exceeds the axis and never returns < 1", () => {
    expect(largestDivisorAtMost(8, 24)).toBe(8);
    expect(largestDivisorAtMost(7, 0)).toBe(1);
  });
});

describe("computeScrollWallGeometry — exact expected geometry", () => {
  it("1920×1080 / vc4 / rows2 / gap24 (the default canvas)", () => {
    const g = geom();
    expect(g).toMatchObject({
      q: 24,
      qy: 24,
      gapX: 24,
      gapY: 24,
      pitch: 480,
      cellW: 456,
      slots: 4,
      coverCount: 4,
      minSlotCount: 5,
      rowH: 528,
      rowYs: [0, 552],
      topPad: 0,
      bottomPad: 0,
    });
  });

  it("1920×1080 / vc3 / rows1 (the worked example)", () => {
    const g = geom({ visibleCount: 3, rows: 1 });
    expect(g).toMatchObject({
      q: 24,
      gapX: 24,
      pitch: 624,
      cellW: 600,
      slots: 3,
      coverCount: 4,
      minSlotCount: 5,
      rowH: 1080,
      rowYs: [0],
    });
  });

  it("3840×2160 / vc5 / rows3 (the plan's 4K row)", () => {
    const g = geom({ canvasW: 3840, canvasH: 2160, visibleCount: 5, rows: 3 });
    expect(g.pitch).toBe(768);
    expect(g.cellW).toBe(744);
    expect(g.coverCount).toBe(5);
    expect(g.rowH).toBe(696);
  });

  it("1080×1920 / vc2 / rows4 (the plan's portrait row)", () => {
    const g = geom({ canvasW: 1080, canvasH: 1920, visibleCount: 2, rows: 4 });
    expect(g.pitch).toBe(528);
    expect(g.cellW).toBe(504);
    expect(g.coverCount).toBe(3);
    expect(g.rowH).toBe(456);
  });
});

describe("computeScrollWallGeometry — swept lattice invariant", () => {
  const CANVASES: Array<[number, number]> = [
    [1920, 1080],
    [1080, 1920],
    [3840, 2160],
    [1280, 720],
    [997, 720], // prime-ish x — q falls to 1, still correct
  ];

  it("every edge lands on the lattice; gaps and coverage bound hold", () => {
    for (const [canvasW, canvasH] of CANVASES) {
      for (let rows = 1; rows <= 4; rows++) {
        for (let visibleCount = 1; visibleCount <= 6; visibleCount++) {
          for (const gapPx of [1, 8, 24, 48]) {
            const r = computeScrollWallGeometry({ canvasW, canvasH, visibleCount, rows, gapPx, marginPx: 0 });
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            const g = r.geometry;
            // Lattice: quanta divide the canvas; every geometry number is a multiple.
            expect(canvasW % g.q).toBe(0);
            expect(canvasH % g.qy).toBe(0);
            expect(g.pitch % g.q).toBe(0);
            expect(g.cellW % g.q).toBe(0);
            expect(g.gapX % g.q).toBe(0);
            expect(g.rowH % g.qy).toBe(0);
            for (const y of g.rowYs) expect(y % g.qy).toBe(0);
            // Gap bounds: snapped DOWN, floored at 1.
            expect(g.gapX).toBeGreaterThanOrEqual(1);
            expect(g.gapX).toBeLessThanOrEqual(Math.max(1, gapPx));
            // Coverage bound is tight at the slot-count floor.
            expect((g.minSlotCount - 1) * g.pitch).toBeGreaterThanOrEqual(canvasW);
            // Rects fit the canvas (placeOptimizedRects would throw otherwise).
            expect((g.slots - 1) * g.pitch + g.cellW).toBeLessThanOrEqual(canvasW);
            const lastY = g.rowYs[g.rowYs.length - 1];
            expect(lastY + g.rowH).toBeLessThanOrEqual(canvasH);
            expect(g.topPad).toBeGreaterThanOrEqual(0);
            expect(g.bottomPad).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe("computeScrollWallGeometry — margins", () => {
  it("vertical margin reserves lattice-aligned top/bottom slack", () => {
    const g = geom({ marginPx: 48, rows: 2 });
    expect(g.rowH).toBe(480);
    expect(g.rowYs).toEqual([48, 552]);
    expect(g.topPad).toBe(48);
    expect(g.bottomPad).toBe(48);
    expect(g.topPad % g.qy).toBe(0);
  });

  it("margin snaps to the nearest lattice point", () => {
    // q = 24 → a 20px request snaps to 24, not to 0.
    const g = geom({ marginPx: 20, rows: 2 });
    expect(g.topPad).toBeGreaterThanOrEqual(24);
    expect(g.topPad % g.qy).toBe(0);
  });
});

describe("computeScrollWallGeometry — coprime canvas stays valid", () => {
  it("997×720 (prime width) returns valid geometry without throwing", () => {
    const r = computeScrollWallGeometry({
      canvasW: 997,
      canvasH: 720,
      visibleCount: 3,
      rows: 2,
      gapPx: 24,
      marginPx: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.geometry.q).toBe(1); // the lattice cannot rescue a prime axis
    expect(r.geometry.cellW).toBeGreaterThanOrEqual(1);
  });
});

describe("computeScrollWallGeometry — fail-fast", () => {
  it("errors when the scroll axis cannot fit visibleCount", () => {
    const r = computeScrollWallGeometry({
      canvasW: 100,
      canvasH: 1080,
      visibleCount: 12,
      rows: 1,
      gapPx: 24,
      marginPx: 0,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("visibleCount");
  });

  it("errors when the cross axis cannot fit the rows", () => {
    const r = computeScrollWallGeometry({
      canvasW: 1920,
      canvasH: 8,
      visibleCount: 4,
      rows: 4,
      gapPx: 24,
      marginPx: 0,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("rows");
  });

  it("axis helpers surface the same errors", () => {
    expect("error" in (scrollAxisLattice(100, 12, 24) as object)).toBe(true);
    expect("error" in (crossAxisBands(8, 4, 24, 0) as object)).toBe(true);
  });
});

describe("look knobs thin to fit instead of refusing the wall", () => {
  it("thins a margin the axis cannot hold, leaving the bands at least half of it", () => {
    // 200px of margin top AND bottom of a 360px axis: the slider at its stop.
    const r = crossAxisBands(360, 2, 24, 200);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(2 * r.bandPx).toBeGreaterThanOrEqual(180);
    expect(r.leadPx).toBeLessThan(200);
    expect(2 * r.bandPx + r.gapPx + r.leadPx + r.trailPx).toBe(360);
  });

  it("leaves a margin the axis CAN hold exactly where it asked", () => {
    const asked = crossAxisBands(1080, 4, 24, 96);
    const none = crossAxisBands(1080, 4, 24, 0);
    expect("error" in asked).toBe(false);
    if ("error" in asked || "error" in none) return;
    expect(asked.leadPx).toBeGreaterThanOrEqual(96);
    expect(asked.bandPx).toBeLessThan(none.bandPx);
  });

  it("thins a gap wider than half the pitch, leaving the tile the larger half", () => {
    // A 997px (prime) axis collapses the quantum to 1, so 12 tiles have an 83px
    // pitch — a 96px gap would leave no tile at all.
    const r = scrollAxisLattice(997, 12, 96);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.gapPx).toBeLessThan(96);
    expect(r.cellPx).toBeGreaterThanOrEqual(r.gapPx);
    expect(r.cellPx + r.gapPx).toBe(r.pitch);
  });

  it("leaves a gap the pitch CAN hold untouched", () => {
    const r = scrollAxisLattice(1920, 4, 24);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.gapPx).toBe(24);
  });

  it("the wall renders on every rows x margin slider stop at 1080p", () => {
    for (let rows = 1; rows <= 4; rows++) {
      for (const marginPx of [0, 50, 100, 150, 200]) {
        for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
          const r = computeScrollWallGeometry({ canvasW: w, canvasH: h, visibleCount: 4, rows, gapPx: 24, marginPx });
          expect({ rows, marginPx, canvas: `${w}x${h}`, ok: r.ok }).toEqual({ rows, marginPx, canvas: `${w}x${h}`, ok: true });
        }
      }
    }
  });
});

describe("computeScrollWallGeometry — determinism", () => {
  it("identical inputs → deep-equal geometry", () => {
    const a = computeScrollWallGeometry({ canvasW: 1920, canvasH: 1080, visibleCount: 4, rows: 3, gapPx: 17, marginPx: 33 });
    const b = computeScrollWallGeometry({ canvasW: 1920, canvasH: 1080, visibleCount: 4, rows: 3, gapPx: 17, marginPx: 33 });
    expect(a).toEqual(b);
  });
});
