import {
  rebalanceAdditiveChains,
  DEFAULT_MAX_FLAT_ADDITIVE_TERMS,
} from "../balance";
import { quoteEnableArg } from "../ffmpeg";

/** Max paren nesting depth — proxy for ffmpeg's expression parse depth. */
function parenDepth(s: string): number {
  let d = 0;
  let max = 0;
  for (const ch of s) {
    if (ch === "(") {
      d++;
      if (d > max) max = d;
    } else if (ch === ")") d--;
  }
  return max;
}

/** Longest flat `+` chain at any paren level. */
function maxFlatChain(s: string): number {
  let max = 0;
  const scan = (seg: string) => {
    let depth = 0;
    let terms = 1;
    let start = -1;
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      if (ch === "(") {
        if (depth === 0) start = i + 1;
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0 && start >= 0) scan(seg.slice(start, i));
      } else if (ch === "+" && depth === 0) terms++;
    }
    if (terms > max) max = terms;
  };
  scan(s);
  return max;
}

const windows = (n: number): string =>
  Array.from(
    { length: n },
    (_v, i) =>
      `(gte(t,${(i * 0.1).toFixed(3)})*lt(t,${(i * 0.1 + 0.049).toFixed(3)}))`,
  ).join("+");

describe("rebalanceAdditiveChains", () => {
  test("returns short chains byte-identical", () => {
    const exprs = [
      "between(t,0,2)",
      "0",
      "(gte(t,0.1)*lt(t,0.2))+(gte(t,0.3)*lt(t,0.4))",
      windows(DEFAULT_MAX_FLAT_ADDITIVE_TERMS),
      "lum(X,Y)*((" + windows(8) + "))",
      "a+b-c+d",
    ];
    for (const e of exprs) expect(rebalanceAdditiveChains(e)).toBe(e);
  });

  test("rebalances a long flat chain into a bounded-depth tree", () => {
    const flat = windows(604);
    const out = rebalanceAdditiveChains(flat);
    expect(out).not.toBe(flat);
    // every term survives, in order
    expect(out.replace(/[()]/g, "")).toBe(flat.replace(/[()]/g, ""));
    // depth is logarithmic: ceil(log2(604)) = 10 levels + term-internal parens
    expect(parenDepth(out)).toBeLessThanOrEqual(14);
    expect(maxFlatChain(out)).toBeLessThanOrEqual(2);
  });

  test("rebalances chains nested inside wrappers (geq alpha shape)", () => {
    const wrapped = `lum(X,Y)*((${windows(100)}))`;
    const out = rebalanceAdditiveChains(wrapped);
    expect(out).not.toBe(wrapped);
    expect(out.startsWith("lum(X,Y)*((")).toBe(true);
    expect(maxFlatChain(out)).toBeLessThanOrEqual(2);
  });

  test("is idempotent", () => {
    const once = rebalanceAdditiveChains(windows(200));
    expect(rebalanceAdditiveChains(once)).toBe(once);
  });

  test("honors a custom threshold", () => {
    expect(rebalanceAdditiveChains("a+b+c+d", 2)).toBe("((a+b)+(c+d))");
    expect(rebalanceAdditiveChains("a+b+c+d+e", 2)).toBe("(((a+b)+(c+d))+e)");
    expect(rebalanceAdditiveChains("a+b", 2)).toBe("a+b");
  });

  test("does not split scientific-notation plus", () => {
    const terms = Array.from({ length: 5 }, (_v, i) => `gte(t,1e+${i + 1})`);
    const e = terms.join("+");
    expect(rebalanceAdditiveChains(e, 2)).toBe(
      `(((${terms[0]}+${terms[1]})+(${terms[2]}+${terms[3]}))+${terms[4]})`,
    );
  });

  test("leaves malformed input untouched", () => {
    expect(rebalanceAdditiveChains("a+b+(c+d", 2)).toBe("a+b+(c+d");
    expect(rebalanceAdditiveChains("+a+b+c", 2)).toBe("+a+b+c");
  });
});

describe("quoteEnableArg rebalancing", () => {
  test("short enable exprs are unchanged (goldens stay stable)", () => {
    expect(quoteEnableArg("between(t,0,2)")).toBe(":enable='between(t\\,0\\,2)'");
  });

  test("dense enable windows are regrouped before escaping", () => {
    const out = quoteEnableArg(windows(150));
    expect(out.match(/gte\(/g)?.length).toBe(150);
    expect(maxFlatChain(out)).toBeLessThanOrEqual(
      DEFAULT_MAX_FLAT_ADDITIVE_TERMS,
    );
  });
});
