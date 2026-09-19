import { forbidXY, substituteLocalTime, substituteTileMacros } from "@m0saic/template-utils";
import { computeScrollWallGeometry, type ScrollWallGeometry } from "./geometry";
import {
  buildScrollXExpr,
  evalScrollXExpr,
  floorMod,
  parseScrollXExpr,
  resolveSpeedPxPerSec,
  rowDirectionSign,
  rowPhasePx,
  scrollAbsX,
  type ScrollMotionParams,
} from "./motion";

const FPS = 30;

function geomAt(canvasW: number, canvasH: number, visibleCount: number, rows: number): ScrollWallGeometry {
  const r = computeScrollWallGeometry({ canvasW, canvasH, visibleCount, rows, gapPx: 24, marginPx: 0 });
  if (!r.ok) throw new Error(r.error);
  return r.geometry;
}

/** The worked example: 1920×1080, rows=1, vc=3, 5 clips, gap 24, 6 s @ 30 fps. */
function workedExampleParams(): { p: ScrollMotionParams; slotCount: number } {
  const g = geomAt(1920, 1080, 3, 1);
  const slotCount = 5;
  const period = slotCount * g.pitch; // 3120
  const pxPerSec = resolveSpeedPxPerSec({
    speedMode: "cycles",
    cycles: 1,
    pxPerSec: 240,
    period,
    fps: FPS,
    durationMs: 6000,
    snapVelocityToFrameGrid: false,
  });
  return {
    p: { slots: g.slots, pitch: g.pitch, period, phasePx: 0, sign: -1, pxPerSec, durationSec: 6 },
    slotCount,
  };
}

describe("resolveSpeedPxPerSec", () => {
  it("cycles mode derives v from the FRAME COUNT (v = cycles·P·fps/N)", () => {
    expect(
      resolveSpeedPxPerSec({
        speedMode: "cycles",
        cycles: 1,
        pxPerSec: 240,
        period: 3120,
        fps: 30,
        durationMs: 6000,
        snapVelocityToFrameGrid: false,
      }),
    ).toBe(520);
    // Non-whole durationMs·fps/1000: N = round(6.05·30) = 182, not 181.5.
    expect(
      resolveSpeedPxPerSec({
        speedMode: "cycles",
        cycles: 1,
        pxPerSec: 240,
        period: 3120,
        fps: 30,
        durationMs: 6050,
        snapVelocityToFrameGrid: false,
      }),
    ).toBe((3120 * 30) / 182);
  });

  it("pxPerSec mode passes the speed through", () => {
    expect(
      resolveSpeedPxPerSec({
        speedMode: "pxPerSec",
        cycles: 1,
        pxPerSec: 333,
        period: 3120,
        fps: 30,
        durationMs: 6000,
        snapVelocityToFrameGrid: false,
      }),
    ).toBe(333);
  });

  it("snapVelocityToFrameGrid rounds to integer px/frame", () => {
    expect(
      resolveSpeedPxPerSec({
        speedMode: "cycles",
        cycles: 1,
        pxPerSec: 240,
        period: 3120,
        fps: 30,
        durationMs: 6000,
        snapVelocityToFrameGrid: true,
      }),
    ).toBe(510); // 520/30 = 17.33 px/frame → 17 px/frame → 510 px/s
  });
});

describe("buildScrollXExpr — the worked example's five exact strings", () => {
  it("emits the plan's table verbatim", () => {
    const { p, slotCount } = workedExampleParams();
    const exprs = Array.from({ length: slotCount }, (_, i) => buildScrollXExpr(p, i));
    expect(exprs).toEqual([
      "mod(6240-520*t,3120)-624",
      "mod(6864-520*t,3120)-1248",
      "mod(7488-520*t,3120)-1872",
      "mod(8112-520*t,3120)-624",
      "mod(8736-520*t,3120)-1248",
    ]);
  });

  it("absX at t=0 matches the plan's table", () => {
    const { p, slotCount } = workedExampleParams();
    const abs0 = Array.from({ length: slotCount }, (_, i) => scrollAbsX(p, i, 0));
    expect(abs0).toEqual([-624, 0, 624, 1248, 1872]);
  });
});

describe("string ≡ model", () => {
  it("the emitted string evaluates (floor-mod) to the model at every sampled t", () => {
    const g = geomAt(1920, 1080, 4, 2);
    for (const sign of [-1, 1] as const) {
      for (let row = 0; row < 4; row++) {
        const slotCount = g.minSlotCount;
        const p: ScrollMotionParams = {
          slots: g.slots,
          pitch: g.pitch,
          period: slotCount * g.pitch,
          phasePx: rowPhasePx(0.5, row, g.pitch),
          sign,
          pxPerSec: 520,
          durationSec: 6,
        };
        for (let i = 0; i < slotCount; i++) {
          const expr = buildScrollXExpr(p, i);
          const baseX = (i % p.slots) * p.pitch;
          for (let t = 0; t <= 6; t += 0.05) {
            expect(evalScrollXExpr(expr, t) + baseX).toBe(scrollAbsX(p, i, t));
          }
        }
      }
    }
  });
});

describe("the comb invariant", () => {
  const T = 4;
  const SAMPLE_DT = 1 / 60;

  it("positions form a uniform comb of spacing pitch at every t; edge bands never exceed gapX", () => {
    for (const rows of [1, 2, 4]) {
      for (const visibleCount of [1, 3, 4, 6]) {
        const g = geomAt(1920, 1080, visibleCount, rows);
        for (const extraSlots of [0, 3]) {
          const slotCount = g.minSlotCount + extraSlots;
          const period = slotCount * g.pitch;
          const pxPerSec = resolveSpeedPxPerSec({
            speedMode: "cycles",
            cycles: 1,
            pxPerSec: 240,
            period,
            fps: FPS,
            durationMs: T * 1000,
            snapVelocityToFrameGrid: false,
          });
          for (const direction of ["left", "right"] as const) {
            for (let row = 0; row < rows; row++) {
              const p: ScrollMotionParams = {
                slots: g.slots,
                pitch: g.pitch,
                period,
                phasePx: rowPhasePx(0.5, row, g.pitch),
                sign: rowDirectionSign(direction, row, true),
                pxPerSec,
                durationSec: T,
              };
              for (let t = 0; t <= T + 1 / FPS; t += SAMPLE_DT) {
                const xs = Array.from({ length: slotCount }, (_, i) => scrollAbsX(p, i, t)).sort(
                  (a, b) => a - b,
                );
                for (let j = 1; j < xs.length; j++) {
                  expect(xs[j] - xs[j - 1]).toBeCloseTo(g.pitch, 6);
                }
                // Coverage. NOTE this deliberately corrects the plan's literal
                // `max(absX)+cellW >= canvasW`: at the exact wrap instant (which
                // t=0 CAN be) the rightmost visible band is the traveling GAP, so
                // the tight invariant — the one the prototype verified in pixels —
                // is "no uncovered edge band ever exceeds gapX".
                expect(xs[0]).toBeLessThanOrEqual(0);
                const uncoveredRight = 1920 - (xs[xs.length - 1] + g.cellW);
                expect(uncoveredRight).toBeLessThanOrEqual(g.gapX + 1e-6);
              }
            }
          }
        }
      }
    }
  });
});

describe("non-negativity + monotonicity", () => {
  it("the mod argument stays ≥ 0 for every rendered t (both directions)", () => {
    const { p, slotCount } = workedExampleParams();
    for (const sign of [-1, 1] as const) {
      const q = { ...p, sign };
      for (let i = 0; i < slotCount; i++) {
        const { c, pxPerSec } = parseScrollXExpr(buildScrollXExpr(q, i));
        const tEnd = q.durationSec + 1 / FPS;
        expect(c + sign * pxPerSec * tEnd).toBeGreaterThanOrEqual(0);
        expect(c).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("between wraps the motion is uniform in the row's direction; wraps jump by the period", () => {
    const { p } = workedExampleParams();
    for (const sign of [-1, 1] as const) {
      const q = { ...p, sign };
      const dt = 1 / 60;
      for (let t = 0; t < q.durationSec; t += dt) {
        const step = scrollAbsX(q, 0, t + dt) - scrollAbsX(q, 0, t);
        const uniform = sign * q.pxPerSec * dt;
        const wrapped = uniform - sign * q.period;
        expect(
          Math.abs(step - uniform) < 1e-6 || Math.abs(step - wrapped) < 1e-6,
        ).toBe(true);
      }
    }
  });
});

describe("seamlessness (position-continuous, not frame-identical)", () => {
  it("absX(0) == absX(N/fps) at whole cycles", () => {
    const g = geomAt(1920, 1080, 3, 1);
    for (const cycles of [1, 2]) {
      for (const durationMs of [6000, 6050]) {
        const slotCount = g.minSlotCount;
        const period = slotCount * g.pitch;
        const totalFrames = Math.round((durationMs / 1000) * FPS);
        const pxPerSec = resolveSpeedPxPerSec({
          speedMode: "cycles",
          cycles,
          pxPerSec: 240,
          period,
          fps: FPS,
          durationMs,
          snapVelocityToFrameGrid: false,
        });
        const p: ScrollMotionParams = {
          slots: g.slots,
          pitch: g.pitch,
          period,
          phasePx: 0,
          sign: -1,
          pxPerSec,
          durationSec: durationMs / 1000,
        };
        // The loop closes at t = N/fps (one frame past the last RENDERED frame),
        // not at durationSec — the two differ when durationMs·fps/1000 isn't whole.
        expect(scrollAbsX(p, 0, totalFrames / FPS)).toBeCloseTo(scrollAbsX(p, 0, 0), 6);
      }
    }
  });
});

describe("row helpers", () => {
  it("rowDirectionSign alternates: left → [-1,1,-1,1]", () => {
    expect([0, 1, 2, 3].map((r) => rowDirectionSign("left", r, true))).toEqual([-1, 1, -1, 1]);
    expect([0, 1, 2, 3].map((r) => rowDirectionSign("right", r, true))).toEqual([1, -1, 1, -1]);
    expect([0, 1, 2, 3].map((r) => rowDirectionSign("left", r, false))).toEqual([-1, -1, -1, -1]);
  });

  it("rowPhasePx is exactly rowOffsetFrac·pitch per row, folded into [0, pitch)", () => {
    expect(rowPhasePx(0.5, 0, 480)).toBe(0);
    expect(rowPhasePx(0.5, 1, 480)).toBe(240);
    expect(rowPhasePx(0.5, 2, 480)).toBe(0); // 480 ≡ 0 — a k·pitch phase relabels, not offsets
    expect(rowPhasePx(0.25, 1, 480)).toBe(120);
  });
});

describe("expression hygiene", () => {
  it("trips neither forbidXY nor the macro/local-time substituters", () => {
    const { p } = workedExampleParams();
    const expr = buildScrollXExpr(p, 2);
    expect(() => forbidXY(expr)).not.toThrow();
    expect(substituteTileMacros(expr, { W: 1920, H: 1080 })).toBe(expr);
    expect(substituteLocalTime(expr)).toBe(expr);
  });

  it("stays far under the additive-term parse cliff", () => {
    const { p } = workedExampleParams();
    const expr = buildScrollXExpr(p, 4);
    // ~5 additive terms including the engine's `(baseX)+(...)` wrap — no
    // rebalanceAdditiveChains needed (the cliff is ~99 flat terms).
    expect(expr.split(/[+-]/).length).toBeLessThanOrEqual(8);
  });

  it("parseScrollXExpr round-trips and rejects foreign shapes", () => {
    const { p } = workedExampleParams();
    expect(parseScrollXExpr(buildScrollXExpr(p, 1))).toEqual({
      c: 6864,
      sign: -1,
      pxPerSec: 520,
      period: 3120,
      sub: 1248,
    });
    expect(() => parseScrollXExpr("(w-100)/2")).toThrow(/not a scroll xExpr/);
  });

  it("floorMod matches ffmpeg's mod convention", () => {
    expect(floorMod(-30, 100)).toBe(70);
    expect(floorMod(-5, 3)).toBe(1);
    expect(floorMod(-1e9, 1920)).toBe(1280);
  });
});
