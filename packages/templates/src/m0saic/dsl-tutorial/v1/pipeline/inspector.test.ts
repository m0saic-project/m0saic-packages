import { buildInspectorProjection } from "./inspector";
import { buildSteps } from "./buildSteps";
import { computeTiming } from "./timing";

function project(m0: string, w = 1000, h = 600) {
  const { steps } = buildSteps(m0 as any, w, h);
  const timing = computeTiming(steps.length, 1);
  return buildInspectorProjection(steps, timing);
}

describe("buildInspectorProjection — fields", () => {
  test("emits output rect fields then internal engine state, in X/Y/W/H/Z/N/R/C order", () => {
    const p = project("2(1,1)");
    expect(p.fields.map((f) => f.name)).toEqual(["X", "Y", "W", "H", "Z", "N", "R", "C"]);
  });

  test("N reads the split count and pulses on the count step (even when the count repeats)", () => {
    // 2(1,1): N goes 0 → 2 on the count read, so the count step is not a no-op.
    const p = project("2(1,1)");
    const N = p.fields.find((f) => f.name === "N")!;
    expect(N.valueVariants.some((v) => v.label === "2")).toBe(true); // the count
    expect(N.changeEnable).toContain("gte(t,"); // pulses on the count step
    // an all-8s grid still pulses on each count read despite the repeated value.
    const grid = project("8(F,F,F,F,F,F,F,F)");
    const N8 = grid.fields.find((f) => f.name === "N")!;
    expect(N8.changeEnable).not.toBe("0");
  });

  test("R surfaces the split quantization remainder (1000÷3 → 1; 1000÷8 → 0)", () => {
    const uneven = project("3(F,F,F)").fields.find((f) => f.name === "R")!;
    expect(uneven.valueVariants.some((v) => v.label === "1")).toBe(true); // 1000 % 3 = 1 leftover px
    expect(uneven.changeEnable).toContain("gte(t,"); // pulses on the count read
    const even = project("8(F,F,F,F,F,F,F,F)").fields.find((f) => f.name === "R")!;
    // 1000 / 8 = 125 exactly → remainder 0 everywhere; the only value is 0.
    expect(even.valueVariants.map((v) => v.label)).toEqual(["0"]);
  });

  test("C surfaces the passthrough carry (donate → claim) and pulses on it", () => {
    const C = project("2(0,F)").fields.find((f) => f.name === "C")!;
    expect(C.valueVariants.some((v) => v.label === "500")).toBe(true); // the donated 500px in flight
    expect(C.changeEnable).toContain("gte(t,"); // pulses on passthrough + claim
    // no passthrough → carry is always 0.
    const none = project("2(F,F)").fields.find((f) => f.name === "C")!;
    expect(none.valueVariants.map((v) => v.label)).toEqual(["0"]);
  });

  test("value variants are enable-gated literals — one per DISTINCT value (no giant eif)", () => {
    const p = project("2(1,1)");
    for (const f of p.fields) {
      expect(Array.isArray(f.valueVariants)).toBe(true);
      expect(f.valueVariants.length).toBeGreaterThan(0);
      for (const v of f.valueVariants) {
        expect(typeof v.label).toBe("string");
        expect(v.enableExpr).toContain("gte(t,"); // gated over the value's window(s)
      }
      // distinct labels — a value appears as ONE variant, not one per change.
      const labels = f.valueVariants.map((v) => v.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  test("the change-pulse expr is CAPPED on dense grids (bounds the per-pixel geq alpha)", () => {
    // A field that changes ~once per tile would otherwise build a ~100-term geq
    // alpha; ×8 fields overflowed the inspector filtergraph at init.
    const big = "10[" + Array.from({ length: 10 }, () => "10(F,F,F,F,F,F,F,F,F,F)").join(",") + "]";
    const X = project(big).fields.find((f) => f.name === "X")!;
    const termCount = (X.changeEnable.match(/gte\(t,/g) || []).length;
    expect(termCount).toBeGreaterThan(0);
    expect(termCount).toBeLessThanOrEqual(32);
  });

  test("a dense grid stays a handful of value variants (X repeats across rows)", () => {
    // 10×10 = 100 tiles: X cycles through only 10 column positions, so X has ~10
    // distinct-value variants (NOT ~100 changes) — the whole point of the collapse.
    const big = "10[" + Array.from({ length: 10 }, () => "10(F,F,F,F,F,F,F,F,F,F)").join(",") + "]";
    const X = project(big).fields.find((f) => f.name === "X")!;
    expect(X.valueVariants.length).toBeLessThanOrEqual(16);
  });

  test("W reads the root width at step 0, then the halved child width after the 2-split", () => {
    // 2(1,1) at 1000 wide: step 0 (lead) = 1000, then 500 once the split fires.
    const p = project("2(1,1)", 1000, 600);
    const W = p.fields.find((f) => f.name === "W")!;
    expect(W.valueVariants.some((v) => v.label === "1000")).toBe(true); // root (step 0) hold
    expect(W.valueVariants.some((v) => v.label === "500")).toBe(true); // child column after the split
    // the change pulse fires (root→child is a real mutation).
    expect(W.changeEnable).not.toBe("0");
  });

  test("a field that mutates gets a non-zero change pulse; a constant one gets '0'", () => {
    // 2(1,1): X jumps 0 → 500 between the two leaves (changes); Y stays 0.
    const p = project("2(1,1)");
    const X = p.fields.find((f) => f.name === "X")!;
    const Y = p.fields.find((f) => f.name === "Y")!;
    expect(X.changeEnable).not.toBe("0");
    expect(X.changeEnable).toContain("gte(t,");
    expect(Y.changeEnable).toBe("0");
  });
});

describe("buildInspectorProjection — chips", () => {
  test("Kind variants cover the distinct node kinds; Status covers the char ops", () => {
    // 2(1,1) chars: 2 ( 1 , 1 ) → Count, Split, Leaf, Next, Leaf, Close.
    const p = project("2(1,1)");
    const kinds = p.kindVariants.map((v) => v.label).sort();
    expect(kinds).toContain("Frame");
    const status = p.statusVariants.map((v) => v.label).sort();
    expect(status).toEqual(["Close", "Count", "Leaf", "Next", "Split"]);
  });

  test("chip enable exprs are filter-context (nonzero = shown), raw commas", () => {
    const p = project("2(1,1)");
    for (const v of [...p.kindVariants, ...p.statusVariants]) {
      expect(v.enableExpr).toContain("gte(t,");
      expect(v.enableExpr).toContain("lt(t,");
    }
  });
});

describe("buildInspectorProjection — determinism", () => {
  test("same m0 → byte-identical projection", () => {
    expect(JSON.stringify(project("4(1,1,1,1)"))).toBe(
      JSON.stringify(project("4(1,1,1,1)")),
    );
  });
});
