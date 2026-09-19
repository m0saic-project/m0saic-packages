/**
 * The tutorial's density CEILING (founder direction, 2026-09-05): a layout past
 * the canvas panel's feasibility floor is refused in the template's own words,
 * never by a raw parser line. The 52k-char dictionary pick at precision 1080
 * parsed at 1920×1080 (1px a row) and died re-parsing in the 756px-tall canvas
 * panel with "Split produced a 0-size frame" — which reads as a syntax error.
 * The tutorial teaches layouts that fit its canvas; it does not chase a denser
 * layout with a bigger canvas (Layout is the tool for those).
 */
import type { M0String } from "@m0saic/dsl";
import { parseM0StringComplete } from "@m0saic/dsl";
import type { MosaicDocument, MosaicEngineContext, MosaicRenderableFile } from "@m0saic/types";
import { DslTutorial, dslTutorialCeiling } from "./dsl-tutorial";
import { MAX_CHARS, MAX_FRAMES, SUMMARIZE_MAX_CHARS } from "./pipeline/timing";
import { CURTAIN_BOX_BUDGET } from "./panels/canvas/v1/dsl-canvas";
// Registers the panel subtemplates the parent renders (same as the gate-33 suite).
import "./index";

function makeCtx(W = 1920, H = 1080): MosaicEngineContext {
  const target = { width: W, height: H, fps: 30, durationMs: 12000 };
  return {
    mode: "render" as const,
    target,
    output: { ...target, workspaceDir: "/tmp" },
    media: {},
    cache: { get: () => undefined, set: () => {}, getOrCompute: async (_k: string, fn: () => unknown) => fn() },
  } as unknown as MosaicEngineContext;
}

/** A passthrough-heavy layout of ~2n chars with ONE frame (feasible at any size). */
const passthroughs = (n: number): M0String => `${n + 1}(${Array(n).fill(">").join(",")},F)` as M0String;
/** An n×n grid of frames: n² frames in ~2n² chars. */
const grid = (n: number): M0String => `${n}(${Array(n).fill(`${n}[${Array(n).fill("F").join(",")}]`).join(",")})` as M0String;
/** The dictionary shape: a root frame overlaid by an n-row split of frames. */
const rows = (n: number): M0String => `1{${n}[${Array(n).fill("F").join(",")}]}` as M0String;
const render = (props: Partial<Parameters<typeof DslTutorial.render>[0]>, ctx = makeCtx()) =>
  DslTutorial.render({ ...DslTutorial.defaultProps!, ...props } as never, ctx);
const asDoc = (f: MosaicRenderableFile): MosaicDocument => {
  expect(f.kind).toBe("mosaic_document");
  return f as MosaicDocument;
};
const rejection = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected the render to refuse");
};

const OUT = { width: 1920, height: 1080 };
const PARSE = { width: 1920, height: 1080 };
/** The canvas panel at a 1920×1080 output, all panels on: 70% of the height, the
 *  80% body column letterboxed to the 16:9 parse aspect — 1344×756 ideal, 1330×750
 *  once the letterbox bars are real m0 cells (quantized). */
const PANEL = { width: 1330, height: 750 };

describe("dslTutorialCeiling — the pure gate", () => {
  it("passes a layout whose floor fits both the parse dims and the panel", () => {
    expect(dslTutorialCeiling({ chars: 61, frames: 4, feas: { minWidthPx: 4, minHeightPx: 4 }, parse: PARSE, panel: PANEL, output: OUT })).toBeNull();
    expect(dslTutorialCeiling({ chars: 61, frames: 4, feas: { minWidthPx: PANEL.width, minHeightPx: PANEL.height }, parse: PARSE, panel: PANEL, output: OUT })).toBeNull();
  });

  it("refuses at the parse dims first, naming the floor and the caller's own knobs", () => {
    const msg = dslTutorialCeiling({ chars: 61, frames: 4, feas: { minWidthPx: 1, minHeightPx: 1200 }, parse: PARSE, panel: PANEL, output: OUT });
    expect(msg).toContain("needs at least 1 x 1200 px to parse");
    expect(msg).toContain("parsed at 1920 x 1080 (canvasWidth x canvasHeight)");
    expect(msg).not.toContain("canvas panel");
  });

  it("refuses a layout that fits the parse dims but not the canvas panel, naming both walls", () => {
    const msg = dslTutorialCeiling({ chars: 61, frames: 4, feas: { minWidthPx: 1, minHeightPx: 1080 }, parse: PARSE, panel: PANEL, output: OUT });
    expect(msg).toContain("too fine for the tutorial canvas");
    expect(msg).toContain("needs at least 1 x 1080 px to draw");
    expect(msg).toContain(`canvas panel is ${PANEL.width} x ${PANEL.height} px at a 1920 x 1080 output`);
    expect(msg).toContain("open a layout this dense in Layout instead");
    // Either axis past the panel is a refusal.
    expect(dslTutorialCeiling({ chars: 61, frames: 4, feas: { minWidthPx: PANEL.width + 1, minHeightPx: 1 }, parse: PARSE, panel: PANEL, output: OUT })).toContain(`${PANEL.width + 1} x 1 px`);
  });

  it("with no panel (the canvas hidden) only the parse dims gate", () => {
    expect(dslTutorialCeiling({ chars: 61, frames: 4, feas: { minWidthPx: 1, minHeightPx: 1080 }, parse: PARSE, output: OUT })).toBeNull();
  });

  it("the ABSOLUTE wall (founder, 09-06): past MAX_CHARS the layout is refused at any output, before the floor is even considered", () => {
    expect(MAX_CHARS).toBe(16_000);
    expect(MAX_CHARS).toBeGreaterThan(SUMMARIZE_MAX_CHARS); // sloth keeps a real band
    const fits = { minWidthPx: 4, minHeightPx: 4 };
    expect(dslTutorialCeiling({ chars: MAX_CHARS, frames: 4, feas: fits, parse: PARSE, panel: PANEL, output: OUT })).toBeNull();
    const msg = dslTutorialCeiling({ chars: 52_454, frames: 80, feas: fits, parse: PARSE, panel: PANEL, output: OUT });
    expect(msg).toContain("this layout is 52,454 characters");
    expect(msg).toContain("up to 16,000");
    expect(msg).toContain("Open it in Layout instead");
    // Chars first: a huge layout that is ALSO infeasible gets the size answer, not the floor.
    const both = dslTutorialCeiling({ chars: MAX_CHARS + 1, frames: 1080, feas: { minWidthPx: 1, minHeightPx: 1080 }, parse: PARSE, panel: PANEL, output: OUT });
    expect(both).toContain("characters");
    expect(both).not.toContain("canvas panel");
  });

  it("the FRAME wall (founder, 09-06): past MAX_FRAMES the reveal itself would be dropped, so the walk is refused — after size, before the floor", () => {
    expect(MAX_FRAMES).toBe(6_000);
    expect(MAX_FRAMES).toBe(CURTAIN_BOX_BUDGET); // the canvas's reveal-curtain budget IS the line
    const fits = { minWidthPx: 4, minHeightPx: 4 };
    expect(dslTutorialCeiling({ chars: 15_000, frames: MAX_FRAMES, feas: fits, parse: PARSE, panel: PANEL, output: OUT })).toBeNull();
    const msg = dslTutorialCeiling({ chars: 15_000, frames: 6_400, feas: fits, parse: PARSE, panel: PANEL, output: OUT });
    expect(msg).toContain("this layout has 6,400 frames");
    expect(msg).toContain("up to 6,000");
    expect(msg).toContain("Open it in Layout instead");
    expect(msg).toMatch(/^[\x20-\x7E]+$/);
    // Order: size answers first; frames answer before any floor.
    expect(dslTutorialCeiling({ chars: 149_332, frames: 36_770, feas: fits, parse: PARSE, panel: PANEL, output: OUT })).toContain("characters");
    expect(dslTutorialCeiling({ chars: 15_000, frames: 6_400, feas: { minWidthPx: 1, minHeightPx: 1080 }, parse: PARSE, panel: PANEL, output: OUT })).not.toContain("canvas panel");
  });

  it("speaks ASCII — makeErrorMosaic draws the refusal with drawtext, which turns × and — into ?", () => {
    for (const [chars, feas] of [[61, { minWidthPx: 1, minHeightPx: 1200 }], [61, { minWidthPx: 1, minHeightPx: 1080 }], [52_454, { minWidthPx: 4, minHeightPx: 4 }]] as [number, { minWidthPx: number; minHeightPx: number }][]) {
      const msg = dslTutorialCeiling({ chars, frames: 4, feas, parse: PARSE, panel: PANEL, output: OUT })!;
      expect(msg).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});

describe("DslTutorial — density ceiling (founder, 2026-09-05)", () => {
  it("a 1080-row layout parses at 1920×1080 but is refused for the canvas panel, in the template's words", async () => {
    expect(parseM0StringComplete(String(rows(1080)), 1920, 1080).ok).toBe(true);
    const msg = await rejection(render({ M0String: rows(1080) }));
    expect(msg).toContain("dsl-tutorial: this layout is too fine for the tutorial canvas");
    expect(msg).toContain("needs at least 1 x 1080 px");
    expect(msg).toContain(`canvas panel is ${PANEL.width} x ${PANEL.height} px at a 1920 x 1080 output`);
    expect(msg).not.toContain("0-size frame");
  });

  it("the ceiling is the panel's exact floor: a layout on the floor renders, one row past it is refused", async () => {
    const onFloor = asDoc(await render({ M0String: rows(PANEL.height) }));
    expect(onFloor.children?.canvas).toBeDefined();
    const msg = await rejection(render({ M0String: rows(PANEL.height + 1) }));
    expect(msg).toContain(`needs at least 1 x ${PANEL.height + 1} px`);
  });

  it("a layout infeasible at its own parse dims is refused by the parse-dims wall (canvasWidth/canvasHeight)", async () => {
    const msg = await rejection(render({ M0String: rows(600), canvasHeight: 500 }));
    expect(msg).toContain("needs at least 1 x 600 px to parse");
    expect(msg).toContain("parsed at 1920 x 500 (canvasWidth x canvasHeight)");
    expect(msg).not.toContain("0-size frame");
  });

  it("hiding the canvas lifts the panel wall — the string + inspector still teach the walk", async () => {
    const doc = asDoc(await render({ M0String: rows(1080), showCanvas: false }));
    expect(doc.children?.canvas).toBeUndefined();
    expect(doc.children?.["dsl-string"]).toBeDefined();
  });

  it("a layout past MAX_CHARS is refused by size, whatever its floor — the 4K chase is closed", async () => {
    const huge = passthroughs(8_100); // 16,205 chars, floor 1×1 px: every panel wall would pass
    expect(String(huge).length).toBeGreaterThan(MAX_CHARS);
    const msg = await rejection(render({ M0String: huge }, makeCtx(3840, 2160)));
    expect(msg).toContain(`this layout is ${String(huge).length.toLocaleString("en-US")} characters`);
    expect(msg).not.toContain("0-size frame");
  });

  it("a grid past MAX_FRAMES but under MAX_CHARS is refused by frames (an 80×80 grid: 6,400 frames in 13,123 chars)", async () => {
    const g = grid(80);
    expect(String(g).length).toBeLessThanOrEqual(MAX_CHARS);
    const msg = await rejection(render({ M0String: g }));
    expect(msg).toContain("this layout has 6,400 frames");
  });

  it("a grid at the frame line renders with its reveal intact (a 70×70 grid: 4,900 frames)", async () => {
    const doc = asDoc(await render({ M0String: grid(70) }));
    const canvas = doc.children?.canvas as MosaicDocument | undefined;
    expect(canvas).toBeDefined();
    // The curtain is the reveal: one lavfi with an lt(t,…) box per tile.
    const curtain = canvas!.sources.find((src) => typeof (src as { lavfi?: string }).lavfi === "string" && (src as { lavfi: string }).lavfi.includes("enable=lt(t"));
    expect(curtain).toBeDefined();
    expect(((curtain as { lavfi: string }).lavfi.match(/drawbox=/g) ?? []).length).toBe(4_900);
  });

  it("a sloth layout under the ceiling still renders (the band above summarize is real)", async () => {
    const sloth = passthroughs(7_000); // 14,005 chars
    expect(String(sloth).length).toBeGreaterThan(SUMMARIZE_MAX_CHARS);
    expect(String(sloth).length).toBeLessThanOrEqual(MAX_CHARS);
    const doc = asDoc(await render({ M0String: sloth }));
    expect(doc.children?.canvas).toBeDefined();
  });

  it("an invalid string still fails as a parse failure, not a ceiling refusal", async () => {
    const msg = await rejection(render({ M0String: "2(F,>)" as M0String }));
    expect(msg).toMatch(/^dsl-tutorial: m0 parse failed/);
    expect(msg).toContain("PASSTHROUGH_TO_NOTHING");
  });
});
