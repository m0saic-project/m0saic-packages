import type { M0String } from "@m0saic/dsl";
import { buildSteps, countTokens } from "./pipeline/buildSteps";
import { computeTiming, stepNumberExpr } from "./pipeline/timing";

const M0 = "2(2[1,1],2[1,1])" as M0String;
const W = 1920;
const H = 1080;

describe("buildSteps — deterministic Step[] pipeline", () => {
  it("is a pure function: identical inputs → byte-identical output", () => {
    const a = buildSteps(M0, W, H, { stepEvents: "enter+leaf" });
    const b = buildSteps(M0, W, H, { stepEvents: "enter+leaf" });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("numbers steps 1..total and stamps a consistent total", () => {
    const { steps } = buildSteps(M0, W, H);
    expect(steps.length).toBeGreaterThan(0);
    steps.forEach((s, i) => {
      expect(s.index).toBe(i + 1);
      expect(s.total).toBe(steps.length);
    });
  });

  it("every character is a step (one step per significant char)", () => {
    const m0 = "2(1,1)";
    const { steps } = buildSteps(m0 as M0String, W, H);
    expect(steps.length).toBe(m0.length); // 2 ( 1 , 1 )
    expect(steps.map((s) => s.eventType)).toEqual([
      "count", "enter", "emitLeaf", "sibling", "emitLeaf", "exit",
    ]);
  });

  it("W halves ON the open paren (the split char), not the count or a later step", () => {
    // 2( … : the `2` (count) leaves W untouched; the `(` performs the split.
    const { steps } = buildSteps("2(1,1)" as M0String, W, H);
    const count = steps[0];
    expect(count.eventType).toBe("count");
    expect(count.fields.W.before).toBe(count.fields.W.after); // count: no geometry change
    const open = steps[1];
    expect(open.eventType).toBe("enter");
    expect(open.fields.W.before).toBe(W);
    expect(open.fields.W.after).toBe(Math.round(W / 2)); // split halves W here
  });

  it("a comma moves the cursor to the next sibling (X advances); a close restores the parent", () => {
    const { steps } = buildSteps("2(1,1)" as M0String, W, H);
    const comma = steps.find((s) => s.eventType === "sibling")!;
    expect(comma.fields.X.before).toBe(0);
    expect(comma.fields.X.after).toBe(Math.round(W / 2)); // second column
    const close = steps.find((s) => s.eventType === "exit")!;
    expect(close.fields.W.after).toBe(W); // restored to the full parent
    expect(close.fields.X.after).toBe(0);
  });

  it("Z tracks overlay depth (0 for a flat layout), not a logical index", () => {
    const { steps } = buildSteps(M0, W, H);
    for (const s of steps) expect(s.fields.Z.after).toBe(0);
  });

  it("derives real accumulator values from split metadata (no synthetic gap/pad)", () => {
    const { steps } = buildSteps(M0, W, H);
    const keysSeen = new Set<string>();
    for (const s of steps) for (const k of Object.keys(s.accumulator)) keysSeen.add(k);
    // Real, trace-derived keys only.
    expect([...keysSeen].some((k) => k === "grid.cols" || k === "grid.rows")).toBe(true);
    expect(keysSeen.has("tile.w")).toBe(true);
    expect(keysSeen.has("grid.gap")).toBe(false);
    expect(keysSeen.has("grid.pad")).toBe(false);
  });

  it('"all" mode yields at least as many steps as "enter+leaf"', () => {
    const few = buildSteps(M0, W, H, { stepEvents: "enter+leaf" }).steps.length;
    const many = buildSteps(M0, W, H, { stepEvents: "all" }).steps.length;
    expect(many).toBeGreaterThanOrEqual(few);
  });

  it("reports positive token + node counts", () => {
    const { tokenCount, nodeCount } = buildSteps(M0, W, H);
    expect(tokenCount).toBeGreaterThan(0);
    expect(nodeCount).toBeGreaterThan(0);
  });
});

describe("buildSteps — split geometry (for the canvas subdivision overlay)", () => {
  it("a col split's enter step carries axis 'col' + the interior divider", () => {
    const { steps } = buildSteps("2(1,1)" as M0String, 1000, 600);
    const enter = steps.find((s) => s.eventType === "enter")!;
    expect(enter.split).toBeDefined();
    expect(enter.split!.axis).toBe("col");
    expect(enter.split!.dividers.length).toBe(1);
    expect(enter.split!.dividers[0]).toBeCloseTo(0.5, 3);
  });

  it("a row split reports axis 'row'", () => {
    const { steps } = buildSteps("2[1,1]" as M0String, 1000, 600);
    const enter = steps.find((s) => s.eventType === "enter")!;
    expect(enter.split!.axis).toBe("row");
  });

  it("a 3-way split reports both interior dividers; leaves carry no split", () => {
    const { steps } = buildSteps("3(1,1,1)" as M0String, 1200, 600);
    const enter = steps.find((s) => s.eventType === "enter")!;
    expect(enter.split!.dividers.length).toBe(2);
    expect(enter.split!.dividers[0]).toBeCloseTo(1 / 3, 2);
    expect(enter.split!.dividers[1]).toBeCloseTo(2 / 3, 2);
    const leaf = steps.find((s) => s.eventType === "emitLeaf")!;
    expect(leaf.split).toBeUndefined();
  });
});

describe("buildSteps — engine state (R remainder consumption + C carry)", () => {
  it("R counts DOWN as fat tiles claim remainder px, reaching 0 by the split close", () => {
    // 1000 / 3 = 333 r1 → exactly one tile is fattened by the leftover px.
    const { steps } = buildSteps("3(1,1,1)" as M0String, 1000, 600);
    const count = steps.find((s) => s.eventType === "count")!;
    expect(count.fields.R.after).toBe(1); // the read surfaces the full remainder
    const claim = steps.find((s) => (s.remainderClaim ?? 0) > 0)!;
    expect(claim.eventType).toBe("emitLeaf"); // a FRAME takes the px
    expect(claim.remainderClaim).toBe(1);
    expect(claim.fields.R.before).toBe(1);
    expect(claim.fields.R.after).toBe(0); // R decrements on the claim, not at close
    const close = steps.find((s) => s.eventType === "exit")!;
    expect(close.fields.R.after).toBe(0);
  });

  it("an even split never accrues a remainder (R stays 0, no claims)", () => {
    const { steps } = buildSteps("8(1,1,1,1,1,1,1,1)" as M0String, 1000, 600);
    expect(steps.every((s) => s.fields.R.after === 0)).toBe(true);
    expect(steps.some((s) => (s.remainderClaim ?? 0) > 0)).toBe(false);
  });

  it("a passthrough donates its slot forward (C rises) and the next tile absorbs it (C → 0)", () => {
    const { steps } = buildSteps("2(0,1)" as M0String, 1000, 600);
    const pass = steps.find((s) => s.eventType === "passthrough")!;
    expect(pass.fields.C.after).toBe(500); // donated half the width
    const leaf = steps.find((s) => s.eventType === "emitLeaf")!;
    expect(leaf.carryAbsorbed).toBe(500); // the tile claims the donation
    expect(leaf.fields.C.after).toBe(0);
  });

  it("a RUN of passthroughs carries once — the parse tree's passthrough rect is already cumulative (brand-M regression, 09-05)", () => {
    // 10 columns of 192px: eight `>` in a row donate 192 each; the carry climbs 192 → 1536, never re-counting.
    const { steps } = buildSteps("10(F,>,>,>,>,>,>,>,>,F)" as M0String, 1920, 1080);
    const passes = steps.filter((s) => s.eventType === "passthrough");
    expect(passes.length).toBe(8);
    expect(passes.map((s) => s.fields.C.after)).toEqual([192, 384, 576, 768, 960, 1152, 1344, 1536]);
    expect(passes.every((s) => /donate 192px forward/.test(s.narration))).toBe(true);
    expect(passes.every((s) => (s.remainderClaim ?? 0) === 0)).toBe(true); // an even split: nothing fat to claim
    const last = steps.filter((s) => s.eventType === "emitLeaf")[1];
    expect(last.carryAbsorbed).toBe(1536); // the receiving tile absorbs the whole run once
    expect(last.rect.width).toBe(192 + 1536);
    expect(last.fields.C.after).toBe(0);
    // The carry can never exceed the axis it lives on.
    expect(Math.max(...steps.map((s) => s.fields.C.after))).toBeLessThanOrEqual(1920);
  });

  it("a passthrough donation is not double-counted as remainder", () => {
    // 1920 / 7 = 274 r2, with a passthrough at slot 2 — the donation must net out
    // so only the genuinely-fat tiles register a remainder claim.
    const { steps } = buildSteps("7(1,0,1,1,1,1,1)" as M0String, 1920, 600);
    const totalClaimed = steps.reduce((n, s) => n + (s.remainderClaim ?? 0), 0);
    expect(totalClaimed).toBe(2); // exactly the 2 leftover px, not inflated by the 274px donation
  });
});

describe("buildSteps — axis in focus (arity row/col tag)", () => {
  it("tags steps inside a col split 'col' and a row split 'row'", () => {
    const col = buildSteps("2(1,1)" as M0String, W, H).steps.find((s) => s.eventType === "emitLeaf")!;
    expect(col.axisInFocus).toBe("col");
    const row = buildSteps("2[1,1]" as M0String, W, H).steps.find((s) => s.eventType === "emitLeaf")!;
    expect(row.axisInFocus).toBe("row");
  });

  it("nested split tags the INNER axis while inside it, the outer once it closes", () => {
    // 2[2(1,1),1]: outer is a row split; inner 2(1,1) is a col split.
    const { steps } = buildSteps("2[2(1,1),1]" as M0String, W, H);
    const innerLeaf = steps.find((s) => s.eventType === "emitLeaf")!;
    expect(innerLeaf.axisInFocus).toBe("col"); // first leaf lives in the inner col split
    const afterInnerClose = steps.find((s) => s.eventType === "exit");
    expect(afterInnerClose?.axisInFocus).toBe("row"); // inner closed → back in the outer row
  });
});

describe("countTokens", () => {
  it("counts a digit-run split as one token", () => {
    // "10(1,1)" → 10, (, 1, ,, 1, ) = 6 tokens.
    expect(countTokens("10(1,1)")).toBe(6);
  });
});

describe("computeTiming — the shared timeline", () => {
  it("slower speed → longer duration", () => {
    const fast = computeTiming(10, 2);
    const slow = computeTiming(10, 0.5);
    expect(slow.durationMs).toBeGreaterThan(fast.durationMs);
  });

  it("step starts are monotonically increasing", () => {
    const t = computeTiming(8, 1);
    for (let i = 2; i <= t.stepCount; i++) {
      expect(t.stepStartSec(i)).toBeGreaterThan(t.stepStartSec(i - 1));
    }
  });

  it("stepNumberExpr embeds the total and is a drawtext eif expr", () => {
    const t = computeTiming(28, 1.25);
    const expr = stepNumberExpr(t, "Step ", ` / ${t.stepCount}`);
    expect(expr).toContain("eif");
    expect(expr).toContain("28");
  });
});
