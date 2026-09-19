import { DslString } from "./dsl-string";
import { buildDslStringProjection } from "../../../pipeline/dslString";
import { buildSteps } from "../../../pipeline/buildSteps";
import { computeTiming } from "../../../pipeline/timing";

function ctx(w: number, h: number): any {
  return {
    mode: "render",
    output: { width: w, height: h, fps: 30, durationMs: 12000, workspaceDir: "/tmp" },
    target: { width: w, height: h, fps: 30, durationMs: 12000 },
    media: {},
  };
}

function projFor(m0: string) {
  const { steps, m0: str } = buildSteps(m0 as any, 1000, 600);
  return buildDslStringProjection(steps, computeTiming(steps.length, 1), str);
}

describe("DslString — source validity", () => {
  test("no text source has empty layers[] (engine rejects those)", async () => {
    const p = projFor("2(2[1,1],2[1,1])");
    for (const part of ["strip", "narration"] as const) {
      const doc: any = await DslString.render(
        { part, preset: "dark", glyphs: p.glyphs, caretEnable: p.caretEnable, narration: p.narration },
        ctx(1280, 150),
      );
      for (const s of doc.sources as any[]) {
        if (s?.type === "text") {
          expect(Array.isArray(s.layers)).toBe(true);
          expect(s.layers.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("DslString — strip part", () => {
  test("collapses each row to ONE positioned text source (a layer per glyph) + a gated caret track", async () => {
    const p = projFor("2(F,F)");
    const doc: any = await DslString.render(
      { part: "strip", preset: "dark", glyphs: p.glyphs, caretEnable: p.caretEnable },
      ctx(1000, 150),
    );
    // COLLAPSE: the glyph strip is ONE text source whose LAYERS are the glyphs
    // (positioned via xExpr), not N sibling cells — the root:1 perf fix.
    const textSources = (doc.sources as any[]).filter((s) => s?.type === "text");
    const glyphStrip = textSources.find(
      (s) => Array.isArray(s.layers) && s.layers.length >= p.glyphs.length,
    );
    expect(glyphStrip).toBeDefined();
    expect(glyphStrip.layers[0].content.kind).toBe("literal");
    // Every glyph layer is positioned (absolute xExpr), not a hAlign cell.
    expect(glyphStrip.layers.every((l: any) => typeof l.placement?.xExpr === "string")).toBe(true);
    // The caret wash/underline is a single gated lavfi drawbox track, not per-char cells.
    const lavfi = (doc.sources as any[]).filter((s) => s?.type === "lavfi");
    expect(lavfi.length).toBeGreaterThan(0);
    expect(
      lavfi.some(
        (s) => typeof s.lavfi === "string" && s.lavfi.includes("drawbox") && s.lavfi.includes("enable="),
      ),
    ).toBe(true);
  });

  test("commas are nudged toward the baseline (a lower yExpr than other glyphs)", async () => {
    const p = projFor("2(F,F)"); // contains a comma between the two F leaves
    const doc: any = await DslString.render(
      { part: "strip", preset: "dark", glyphs: p.glyphs, caretEnable: p.caretEnable },
      ctx(1000, 150),
    );
    // The GLYPH strip (not the ruler) is the one carrying an actual "," layer.
    const strip = (doc.sources as any[]).find(
      (s) => s?.type === "text" && Array.isArray(s.layers) && s.layers.some((l: any) => l.content.text === ","),
    );
    expect(strip).toBeDefined();
    const comma = strip.layers.find((l: any) => l.content.text === ",");
    const nonComma = strip.layers.find((l: any) => l.content.text !== "," && l.content.text.trim() !== "");
    expect(comma).toBeDefined();
    // Comma yExpr carries a downward offset the plain centre expr doesn't.
    expect(comma.placement.yExpr).not.toBe(nonComma.placement.yExpr);
    expect(comma.placement.yExpr).toContain("+");
  });
});

describe("DslString — long string pages", () => {
  test("a string past the char cap PAGES: one positioned glyph source per page, gated by disjoint windows (no SVG masks)", async () => {
    // 8×8 = 154 chars, far over the cap at this width → must page.
    const big = "8[" + Array.from({ length: 8 }, () => "8(F,F,F,F,F,F,F,F)").join(",") + "]";
    const p = projFor(big);
    const doc: any = await DslString.render(
      { part: "strip", preset: "dark", glyphs: p.glyphs, caretEnable: p.caretEnable, caretSteps: p.caretSteps },
      ctx(975, 120),
    );
    // Drawtext-only strip: no SVG rasterizer anywhere (SVG glyph masks overflow the
    // mask resolver on a long string — the collapse renders one drawtext chain).
    const svgGlyphs = (doc.sources as any[]).filter((s) => s?.type === "text" && s?.rasterizer === "svg");
    expect(svgGlyphs.length).toBe(0);
    // Each page's glyph row is ONE text source with many positioned layers.
    const multiLayer = (doc.sources as any[]).filter(
      (s) => s?.type === "text" && Array.isArray(s.layers) && s.layers.length > 5,
    );
    expect(multiLayer.length).toBeGreaterThan(0);
    // Pages are gated by disjoint time windows → more than one distinct page enable.
    const enables = new Set(
      (doc.sources as any[])
        .map((s) => s?.overlay?.enable)
        .filter((e) => typeof e === "string" && e.includes("gte(t,")),
    );
    expect(enables.size).toBeGreaterThan(1); // at least two page windows
  });
});

describe("DslString — narration part", () => {
  test("collapses narration into ONE video text source with a per-LAYER enable per variant", async () => {
    const p = projFor("2(F,F)");
    const doc: any = await DslString.render(
      { part: "narration", preset: "dark", narration: p.narration },
      ctx(1000, 90),
    );
    // COLLAPSE: not N stacked sources — one text source whose LAYERS are the
    // narration variants, gated per-layer (rendered as video so enable=… is
    // evaluated per frame). This is the ~24s root:2 perf fix.
    const textSources = (doc.sources as any[]).filter((s) => s?.type === "text");
    const narrationSrc = textSources.find(
      (s) => Array.isArray(s.layers) && s.layers.length === p.narration.length,
    );
    expect(narrationSrc).toBeDefined();
    expect(narrationSrc.renderMode?.kind).toBe("video");
    // Every layer carries a narration label + its own enable expr; none rely on
    // a source-level enable (which would gate the whole banner as one unit).
    const labels = new Set(p.narration.map((v) => v.label));
    expect(narrationSrc.overlay?.enable).toBeUndefined();
    for (const layer of narrationSrc.layers) {
      expect(typeof layer.overlay?.enable).toBe("string");
      expect(labels.has(layer.content.text)).toBe(true);
    }
  });
});
