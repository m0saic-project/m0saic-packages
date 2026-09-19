import { keyframeExpr, type Keyframe } from "./keyframes";

/**
 * Golden strings captured from dsl-tutorial's `focusExpr`
 * (packages/templates/src/m0saic/dsl-tutorial/v1/pipeline/camera.ts) BEFORE
 * the F2 extraction (Seam A). `keyframeExpr` at its defaults must reproduce
 * them byte-for-byte — this is the tripwire for the Phase 3 refactor being
 * render-identical. Do not "clean up" these strings.
 */
const FOCUS_2KEY =
  "lt(t,0.95000)*(0.25000)+(gte(t,0.95000)*lt(t,1.85000))*(0.25000+(0.60000-0.25000)*(min(1,max(0,(t-0.95000)/0.90000)))*(min(1,max(0,(t-0.95000)/0.90000)))*(3-2*(min(1,max(0,(t-0.95000)/0.90000)))))+gte(t,1.85000)*(0.60000)";
const FOCUS_3KEY =
  "lt(t,0.95000)*(0.25000)+(gte(t,0.95000)*lt(t,1.85000))*(0.25000+(0.60000-0.25000)*(min(1,max(0,(t-0.95000)/0.90000)))*(min(1,max(0,(t-0.95000)/0.90000)))*(3-2*(min(1,max(0,(t-0.95000)/0.90000)))))+(gte(t,1.85000)*lt(t,2.75000))*(0.60000+(1.00000-0.60000)*(min(1,max(0,(t-1.85000)/0.90000)))*(min(1,max(0,(t-1.85000)/0.90000)))*(3-2*(min(1,max(0,(t-1.85000)/0.90000)))))+gte(t,2.75000)*(1.00000)";
const FOCUS_ZERO_DUR =
  "lt(t,2.00000)*(0.00000)+(gte(t,2.00000)*lt(t,2.00000))*(0.00000+(1.00000-0.00000)*(min(1,max(0,(t-2.00000)/0.00010)))*(min(1,max(0,(t-2.00000)/0.00010)))*(3-2*(min(1,max(0,(t-2.00000)/0.00010)))))+gte(t,2.00000)*(1.00000)";

const KEYS_2: Keyframe[] = [
  { t: 0.95, v: 0.25 },
  { t: 1.85, v: 0.6 },
];
const KEYS_3: Keyframe[] = [
  { t: 0.95, v: 0.25 },
  { t: 1.85, v: 0.6 },
  { t: 2.75, v: 1 },
];

describe("keyframeExpr — golden parity vs dsl-tutorial focusExpr", () => {
  test("empty keys with emptyValue '0.5' → focusExpr's centered default, verbatim", () => {
    expect(keyframeExpr([], { emptyValue: "0.5" })).toBe("0.5");
  });

  test("single key → constant value (no time dependence)", () => {
    expect(keyframeExpr([{ t: 1.4, v: 0.3 }])).toBe("0.30000");
  });

  test("two keys → byte-identical to focusExpr", () => {
    expect(keyframeExpr(KEYS_2)).toBe(FOCUS_2KEY);
  });

  test("three keys → byte-identical to focusExpr", () => {
    expect(keyframeExpr(KEYS_3)).toBe(FOCUS_3KEY);
  });

  test("coincident keys hit the 1e-4 duration floor, byte-identical", () => {
    expect(
      keyframeExpr([
        { t: 2, v: 0 },
        { t: 2, v: 1 },
      ]),
    ).toBe(FOCUS_ZERO_DUR);
  });
});

describe("keyframeExpr — flat gated shape (the ~100-recursion wall)", () => {
  test("gated segments, not nested ifs — parse depth stays flat per keyframe", () => {
    // ffmpeg's expression parser has a ~100 recursion budget; a nested if-else
    // chain consumes one level per keyframe and fails a dense (10×10 = 100+
    // leaf) walk at crop config. The gated-sum shape keeps per-segment depth
    // constant regardless of keyframe count.
    const keys = Array.from({ length: 300 }, (_v, i) => ({
      t: i * 0.04,
      v: (i % 10) / 10,
    }));
    const e = keyframeExpr(keys);
    expect(e).not.toContain("if(");
    let d = 0;
    let maxDepth = 0;
    for (const ch of e) {
      if (ch === "(") {
        d++;
        if (d > maxDepth) maxDepth = d;
      } else if (ch === ")") d--;
    }
    expect(maxDepth).toBeLessThanOrEqual(8);
  });

  test("terms partition the timeline: lt head, gte·lt segments, gte tail", () => {
    const e = keyframeExpr(KEYS_3);
    expect(e.startsWith("lt(t,0.95000)*(0.25000)")).toBe(true); // hold before first
    expect(e).toContain("(gte(t,0.95000)*lt(t,1.85000))*"); // half-open segment
    expect(e.endsWith("gte(t,2.75000)*(1.00000)")).toBe(true); // hold after last
    // n-1 eased segments for n keys (head + segments + tail = n+1 terms).
    expect(e.split("(gte(t,").length - 1).toBe(2);
  });
});

describe("keyframeExpr — options", () => {
  test("empty keys default → '0'; numeric emptyValue formats at precision", () => {
    expect(keyframeExpr([])).toBe("0");
    expect(keyframeExpr([], { emptyValue: 0.25 })).toBe("0.25000");
    expect(keyframeExpr([], { emptyValue: 0.25, precision: 2 })).toBe("0.25");
  });

  test("track-level ease default applies to every segment", () => {
    const e = keyframeExpr(KEYS_3, { ease: "linear" });
    expect(e).not.toContain("3-2*"); // no smoothstep anywhere
    expect(e).toContain("*(min(1,max(0,(t-0.95000)/0.90000))))+"); // bare linear ramp
  });

  test("per-key ease shapes the segment LEAVING that key", () => {
    const e = keyframeExpr([
      { t: 0.95, v: 0.25, ease: "linear" },
      { t: 1.85, v: 0.6 }, // → smoothstep (default) toward the next key
      { t: 2.75, v: 1 },
    ]);
    const seg1 = e.slice(0, e.indexOf("+(gte(t,1.85000)"));
    const seg2 = e.slice(e.indexOf("+(gte(t,1.85000)"));
    expect(seg1).not.toContain("3-2*"); // linear leaves key 1
    expect(seg2).toContain("3-2*"); // smoothstep leaves key 2
  });

  test("easeOut emits the quadratic ease-out shape", () => {
    const e = keyframeExpr(KEYS_2, { ease: "easeOut" });
    expect(e).toContain("(1-(1-(min(1,max(0,(t-0.95000)/0.90000))))*(1-(min(1,max(0,(t-0.95000)/0.90000)))))");
  });

  test("timeVar 'lt' rewrites every time reference (gates and ramps)", () => {
    const e = keyframeExpr(KEYS_2, { timeVar: "lt" });
    expect(e).toContain("lt(lt,0.95000)");
    expect(e).toContain("gte(lt,0.95000)");
    expect(e).toContain("(lt-0.95000)");
    expect(e).not.toContain("(t-");
    expect(e).not.toContain("(t,");
  });

  test("precision controls toFixed digits everywhere", () => {
    const e = keyframeExpr(KEYS_2, { precision: 3 });
    expect(e).toContain("lt(t,0.950)*(0.250)");
    expect(e).toContain("/0.900");
    expect(e).not.toContain("0.95000");
  });
});

describe("keyframeExpr — determinism", () => {
  test("same keys, same options → identical string", () => {
    expect(keyframeExpr(KEYS_3)).toBe(keyframeExpr(KEYS_3));
    expect(keyframeExpr(KEYS_3, { ease: "easeOut", precision: 4 })).toBe(
      keyframeExpr(KEYS_3, { ease: "easeOut", precision: 4 }),
    );
  });
});
