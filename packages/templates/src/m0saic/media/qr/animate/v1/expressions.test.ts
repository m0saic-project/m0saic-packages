import {
  buildDiagonalRanks,
  buildModuleGleamFactor,
  buildTileAlphaExpr,
  buildTileOffsetExpr,
  type RankInputTile,
} from "./expressions";

// Evaluate an ffmpeg-style expr (only the ops these builders emit) at a given
// `t`, for asserting numeric behaviour rather than just string shape.
function evalExpr(expr: string, t: number): number {
  const PI = Math.PI;
  const min = Math.min;
  const max = Math.max;
  const abs = Math.abs;
  const mod = (a: number, b: number) => a - b * Math.floor(a / b);
  const cos = Math.cos;
  // eslint-disable-next-line no-new-func
  return Function("t", "PI", "min", "max", "abs", "mod", "cos", `return (${expr});`)(
    t, PI, min, max, abs, mod, cos,
  );
}

describe("buildModuleGleamFactor", () => {
  it("stays within [minAlpha, 1] across a full sweep", () => {
    const expr = buildModuleGleamFactor(0.4, { sweepSec: 2, minAlpha: 0.82, width: 0.22 });
    for (let t = 0; t <= 4; t += 0.05) {
      const v = evalExpr(expr, t);
      expect(v).toBeGreaterThanOrEqual(0.82 - 1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("peaks at ~1 when the band centre crosses the cell's rank", () => {
    const rank = 0.5;
    const expr = buildModuleGleamFactor(rank, { sweepSec: 2, minAlpha: 0.82, width: 0.22 });
    // p = mod(t,2)/2 = rank when t = rank*2 = 1.0
    expect(evalExpr(expr, 1.0)).toBeGreaterThan(0.99);
    // Far from the band → floor.
    expect(evalExpr(expr, 0.0)).toBeCloseTo(0.82, 2);
  });

  it("a higher minAlpha keeps the floor higher (gentler, more scannable)", () => {
    const lo = buildModuleGleamFactor(0.5, { sweepSec: 2, minAlpha: 0.7, width: 0.2 });
    const hi = buildModuleGleamFactor(0.5, { sweepSec: 2, minAlpha: 0.95, width: 0.2 });
    // At t=0 the band is at p=0, far from rank 0.5 → floor for both.
    expect(evalExpr(lo, 0)).toBeCloseTo(0.7, 2);
    expect(evalExpr(hi, 0)).toBeCloseTo(0.95, 2);
  });
});

describe("buildDiagonalRanks", () => {
  it("empty input returns []", () => {
    expect(buildDiagonalRanks([])).toEqual([]);
  });

  it("single tile gets rank 0", () => {
    expect(buildDiagonalRanks([{ x: 0, y: 0, logicalIndex: 0 }])).toEqual([0]);
  });

  it("3 tiles along the row get evenly spread ranks", () => {
    const tiles: RankInputTile[] = [
      { x: 0, y: 0, logicalIndex: 0 },
      { x: 10, y: 0, logicalIndex: 1 },
      { x: 20, y: 0, logicalIndex: 2 },
    ];
    expect(buildDiagonalRanks(tiles)).toEqual([0, 0.5, 1]);
  });

  it("ranks tiles by (x + y) ascending — TL gets 0, BR gets 1", () => {
    // 2×2 grid:
    //   (0,0)  (10,0)
    //   (0,10) (10,10)
    // Diagonal scores: 0, 10, 10, 20. Tiles 1 and 2 tie; tiebreak by x asc.
    const tiles: RankInputTile[] = [
      { x: 0, y: 0, logicalIndex: 0 },   // score 0  → rank 0
      { x: 10, y: 0, logicalIndex: 1 },  // score 10 → rank 1/3 or 2/3 (tied)
      { x: 0, y: 10, logicalIndex: 2 },  // score 10 → rank 1/3 or 2/3 (tied)
      { x: 10, y: 10, logicalIndex: 3 }, // score 20 → rank 1
    ];
    const ranks = buildDiagonalRanks(tiles);
    expect(ranks[0]).toBe(0);
    expect(ranks[3]).toBe(1);
    // Tied pair: x=0 sorts before x=10 → tile 2 (x:0,y:10) before tile 1 (x:10,y:0).
    // So ranks: tile2 = 1/3, tile1 = 2/3.
    expect(ranks[2]).toBeCloseTo(1 / 3);
    expect(ranks[1]).toBeCloseTo(2 / 3);
  });

  it("logicalIndex breaks ties when x and (x+y) are identical", () => {
    // Two tiles at the exact same (x, y) — tiebreak by logicalIndex asc.
    const tiles: RankInputTile[] = [
      { x: 5, y: 5, logicalIndex: 7 },
      { x: 5, y: 5, logicalIndex: 3 },
    ];
    const ranks = buildDiagonalRanks(tiles);
    // logicalIndex 3 sorts first → rank 0. logicalIndex 7 → rank 1.
    expect(ranks[1]).toBe(0); // tiles[1] has logicalIndex 3
    expect(ranks[0]).toBe(1); // tiles[0] has logicalIndex 7
  });

  it("is deterministic — repeated calls produce identical arrays", () => {
    const tiles: RankInputTile[] = Array.from({ length: 8 }, (_, i) => ({
      x: (i * 13) % 50,
      y: (i * 7) % 50,
      logicalIndex: i,
    }));
    const a = buildDiagonalRanks(tiles);
    const b = buildDiagonalRanks(tiles);
    expect(a).toEqual(b);
  });
});

describe("buildTileAlphaExpr", () => {
  it("rank-0 tile starts ramping at t=0", () => {
    const expr = buildTileAlphaExpr(0, { spawnDurSec: 1.0, tileFadeSec: 0.2 });
    // startSec = 0 * 1.0 = 0
    expect(expr).toContain("(t-0.000)");
    expect(expr).toContain("/0.200");
  });

  it("rank-1 tile starts ramping at t=spawnDurSec", () => {
    const expr = buildTileAlphaExpr(1, { spawnDurSec: 1.0, tileFadeSec: 0.2 });
    // startSec = 1 * 1.0 = 1.0
    expect(expr).toContain("(t-1.000)");
  });

  it("returns smoothstep form u² * (3 - 2u)", () => {
    const expr = buildTileAlphaExpr(0.5, { spawnDurSec: 1.0, tileFadeSec: 0.2 });
    // Smoothstep shape: (u*u*(3-2*u))
    expect(expr).toMatch(/\*.*\*\(3-2\*/);
  });

  it("clamps progress to [0, 1] via min(1, max(0, ...))", () => {
    const expr = buildTileAlphaExpr(0, { spawnDurSec: 1.0, tileFadeSec: 0.2 });
    expect(expr).toContain("min(1,max(0,");
  });

  it("guards tileFadeSec=0 against divide-by-zero", () => {
    const expr = buildTileAlphaExpr(0.5, { spawnDurSec: 1.0, tileFadeSec: 0 });
    // Floor at 0.001 to avoid /0
    expect(expr).toContain("/0.001");
  });

  it("is deterministic — identical inputs produce identical strings", () => {
    const a = buildTileAlphaExpr(0.42, { spawnDurSec: 0.7, tileFadeSec: 0.15 });
    const b = buildTileAlphaExpr(0.42, { spawnDurSec: 0.7, tileFadeSec: 0.15 });
    expect(a).toBe(b);
  });
});

describe("buildTileOffsetExpr", () => {
  it("offsetPx === 0 short-circuits to literal \"0\"", () => {
    expect(
      buildTileOffsetExpr(0.5, { spawnDurSec: 1.0, tileFadeSec: 0.2, offsetPx: 0 }),
    ).toBe("0");
  });

  it("non-zero offset produces an expression with the offsetPx coefficient", () => {
    const expr = buildTileOffsetExpr(0.5, {
      spawnDurSec: 1.0,
      tileFadeSec: 0.2,
      offsetPx: 2,
    });
    expect(expr).toContain("2.000*(1-");
  });

  it("uses the same start time as buildTileAlphaExpr at the same rank", () => {
    const alpha = buildTileAlphaExpr(0.5, { spawnDurSec: 1.0, tileFadeSec: 0.2 });
    const offset = buildTileOffsetExpr(0.5, {
      spawnDurSec: 1.0,
      tileFadeSec: 0.2,
      offsetPx: 1,
    });
    // Both gates start at t = rank * spawnDurSec = 0.500.
    expect(alpha).toContain("(t-0.500)");
    expect(offset).toContain("(t-0.500)");
  });

  it("decays from offsetPx → 0 as progress goes 0 → 1", () => {
    const expr = buildTileOffsetExpr(0, {
      spawnDurSec: 1.0,
      tileFadeSec: 0.2,
      offsetPx: 1,
    });
    // Shape: 1.000*(1 - smoothstep(progress))
    expect(expr).toContain("1.000*(1-(");
  });

  it("is deterministic — identical inputs produce identical strings", () => {
    const a = buildTileOffsetExpr(0.3, {
      spawnDurSec: 0.7,
      tileFadeSec: 0.15,
      offsetPx: 1.5,
    });
    const b = buildTileOffsetExpr(0.3, {
      spawnDurSec: 0.7,
      tileFadeSec: 0.15,
      offsetPx: 1.5,
    });
    expect(a).toBe(b);
  });
});
