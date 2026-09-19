import { classifyGlyphs, buildDslStringProjection } from "./dslString";
import { buildSteps } from "./buildSteps";
import { computeTiming } from "./timing";

describe("classifyGlyphs", () => {
  test("classifies a split into count / bracket / comma / frame", () => {
    const g = classifyGlyphs("2(F,F)");
    expect(g.map((x) => x.ch).join("")).toBe("2(F,F)");
    expect(g.map((x) => x.type)).toEqual(["count", "bracket", "frame", "comma", "frame", "bracket"]);
  });

  test("a digit run that opens a split is a count; multi-digit handled", () => {
    const g = classifyGlyphs("10[F,F]");
    expect(g[0].type).toBe("count"); // '1'
    expect(g[1].type).toBe("count"); // '0' — part of the count run before '['
    expect(g[2].type).toBe("bracket"); // '['
  });

  test("a lone 0 is a passthrough; - and > are passthrough; {} are brackets", () => {
    expect(classifyGlyphs("2(0,>)")[2].type).toBe("passthrough"); // '0'
    expect(classifyGlyphs("2(0,>)")[4].type).toBe("passthrough"); // '>'
    expect(classifyGlyphs("F{F}").map((x) => x.type)).toEqual(["frame", "bracket", "frame", "bracket"]);
    expect(classifyGlyphs("2(F,-)")[4].type).toBe("passthrough"); // '-'
  });

  test("deterministic", () => {
    expect(JSON.stringify(classifyGlyphs("2(2[1,1],2[1,1])"))).toBe(
      JSON.stringify(classifyGlyphs("2(2[1,1],2[1,1])")),
    );
  });
});

describe("buildDslStringProjection", () => {
  function proj(m0: string) {
    const { steps, m0: str } = buildSteps(m0 as any, 1000, 600);
    return buildDslStringProjection(steps, computeTiming(steps.length, 1), str);
  }

  test("one glyph per character; one caret-enable per glyph", () => {
    const p = proj("2(F,F)");
    expect(p.glyphs.length).toBe("2(F,F)".length);
    expect(p.caretEnable.length).toBe(p.glyphs.length);
  });

  test("at least one glyph gets a non-empty caret window; exprs are filter-context (raw commas)", () => {
    const p = proj("2(F,F)");
    expect(p.caretEnable.some((e) => e.length > 0)).toBe(true);
    for (const e of p.caretEnable) expect(e).not.toContain("\\,");
    for (const v of p.narration) expect(v.enableExpr).not.toContain("\\,");
  });

  test("narration has lines and they're enable-gated", () => {
    const p = proj("2(F,F)");
    expect(p.narration.length).toBeGreaterThan(0);
    for (const v of p.narration) {
      expect(typeof v.label).toBe("string");
      expect(v.enableExpr).toContain("gte(t,");
    }
  });

  test("deterministic", () => {
    expect(JSON.stringify(proj("2(1,1)"))).toBe(JSON.stringify(proj("2(1,1)")));
  });
});
