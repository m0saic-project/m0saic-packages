import {
  parseM0StringToRenderFrames,
  validateM0String,
} from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicOverlayExpr,
  MosaicTextSource,
} from "@m0saic/types";
import { codeTheme } from "../../../_shared/code-theme";
import { measureCodeGrid } from "../../../_shared/code-metrics";
import { computeSnippetFrameGeometry } from "./chrome";
import { buildSnippetMorphPlan } from "./plan";
import {
  buildSnippetDocument,
  buildSnippetPipeline,
  rawLineSpans,
  rawOffsetForColumn,
  type SnippetStepVisualOptions,
} from "./steps";

const WIDTH = 1280;
const HEIGHT = 720;
const THEME = codeTheme("dark");
const VISUAL: SnippetStepVisualOptions = {
  fontSize: 16,
  lineHeight: 1.5,
  fontFamily: "JetBrains Mono",
  fontWeight: "normal",
  fontStyle: "normal",
  title: "snippet.ts",
  showChrome: true,
  trafficLights: true,
  lineNumbers: true,
  codeAlign: "left",
};
const GEOMETRY = computeSnippetFrameGeometry({
  width: WIDTH,
  height: HEIGHT,
  fontSize: VISUAL.fontSize,
  showChrome: VISUAL.showChrome,
  lineNumbers: VISUAL.lineNumbers,
});
const MOTION = { reduceMotion: false, addEntrance: "rise" as const };

type Bound = { propKey: string; index?: number; range?: { start: number; end: number } };
const codeLines = (doc: MosaicDocument) =>
  doc.sources.filter(
    (s): s is MosaicTextSource => s.type === "text" && (s.editor as { binding?: Bound } | undefined)?.binding?.propKey === "states",
  );
const bindingOf = (s: MosaicTextSource) => (s.editor as { binding?: Bound }).binding!;

describe("snippet document — every code line is ONE svg text source", () => {
  const states = ["const answer = 42;\n\nconsole.log(answer);"];
  const plan = buildSnippetMorphPlan({ states });
  const doc = buildSnippetDocument({
    state: plan.states[0]!,
    geometry: GEOMETRY,
    theme: THEME,
    visual: VISUAL,
    width: WIDTH,
    height: HEIGHT,
    fps: 30,
    durationMs: 3750,
    bindStateIndex: 0,
    bindSpans: { tabWidth: 2, current: rawLineSpans(states[0]) },
  });

  it("emits valid m0 with exactly one source per frame, no media, no assets, video/no-audio stamps", () => {
    expect(validateM0String(doc.m0).ok).toBe(true);
    expect(parseM0StringToRenderFrames(doc.m0, WIDTH, HEIGHT)).toHaveLength(doc.sources.length);
    expect(Object.keys(doc.assets)).toEqual([]);
    expect(doc.sources.some((s) => s.type === "media")).toBe(false);
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(doc.audio).toEqual({ mode: "off" });
    expect(doc.durationMs).toBe(3750);
  });

  it("draws one source per NON-BLANK line with a layer per token run, in the token's colour, on the grid", () => {
    const lines = codeLines(doc);
    expect(lines).toHaveLength(2); // the blank middle line draws nothing
    const metrics = measureCodeGrid(plan.states[0]!.lines, { fontSize: 16, lineHeight: 1.5 });
    const first = lines[0]!;
    expect(first.rasterizer).toBe("svg");
    expect(first.style).toMatchObject({ fontFamily: "JetBrains Mono", fontSize: 16 });
    expect(first.layers.map((l) => (l.content as { text: string }).text)).toEqual(["const", "answer", "=", "42", ";"]);
    // keyword colour on `const`, a different colour on the number
    const kw = first.layers[0]!.style!.fontColor;
    const num = first.layers[3]!.style!.fontColor;
    expect(kw).toBe(THEME.syntax.keyword);
    expect(num).toBe(THEME.syntax.number);
    expect(kw).not.toBe(num);
    // absolute px per run: xExpr = col × charW (independent of the frame the layout hands back);
    // every run top-aligned (baseline = ascent, like the gutter)
    const frames = parseM0StringToRenderFrames(doc.m0, WIDTH, HEIGHT);
    const frame = frames[doc.sources.indexOf(first)]!;
    const xs = first.layers.map((l) => Number((l.placement as { xExpr: string }).xExpr));
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBeCloseTo(6 * metrics.charW, 3); // "answer" starts at column 6
    expect(xs[3]).toBeCloseTo(15 * metrics.charW, 3); // "42"
    expect(first.layers.every((l) => l.placement?.hAlign === "left" && l.placement?.vAlign === "top")).toBe(true);
    // the PAINT box (cell after the layout's recovery inset) is one lineStep tall at the row's top
    type Inset = { top?: number; right?: number; bottom?: number; left?: number; x?: number; y?: number } | number | undefined;
    const paintBox = (src: MosaicTextSource, f: { x: number; y: number; width: number; height: number }) => {
      const raw = (src.placement as { inset?: Inset } | undefined)?.inset;
      const i = typeof raw === "number" ? { top: raw, right: raw, bottom: raw, left: raw } : raw ?? {};
      const top = i.top ?? i.y ?? 0, bottom = i.bottom ?? i.y ?? 0, left = i.left ?? i.x ?? 0, right = i.right ?? i.x ?? 0;
      return { x: f.x + left * f.width, y: f.y + top * f.height, w: f.width * (1 - left - right), h: f.height * (1 - top - bottom) };
    };
    // (the layout's recovery inset shaves ≤ 0.5px per side off the requested rect)
    const box1 = paintBox(first, frame);
    expect(Math.abs(box1.h - metrics.lineStep)).toBeLessThanOrEqual(1);
    expect(Math.abs(box1.x - GEOMETRY.codeArea.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box1.y - GEOMETRY.codeArea.y)).toBeLessThanOrEqual(1);
    const box2 = paintBox(lines[1]!, frames[doc.sources.indexOf(lines[1]!)]!);
    expect(Math.abs(box2.y - box1.y - 2 * metrics.lineStep)).toBeLessThanOrEqual(1); // row 2 (row 1 is blank)
    expect(Math.abs(box2.x - box1.x)).toBeLessThanOrEqual(0.01); // every line shares one grid origin
    // the box HUGS the text: "const answer = 42;" is 18 columns, not the whole code area
    expect(Math.abs(box1.w - (Math.ceil(18 * metrics.charW) + 6))).toBeLessThanOrEqual(1);
    expect(box1.w).toBeLessThan(GEOMETRY.codeArea.w / 2);
    expect(Math.abs(box2.w - (Math.ceil(20 * metrics.charW) + 6))).toBeLessThanOrEqual(1); // "console.log(answer);"
  });

  it("binds each line to ITS span of the raw state", () => {
    const [a, b] = codeLines(doc).map(bindingOf);
    expect(a).toEqual({ propKey: "states", index: 0, range: { start: 0, end: 18 } });
    expect(b).toEqual({ propKey: "states", index: 0, range: { start: 20, end: 40 } });
    expect(states[0].slice(20, 40)).toBe("console.log(answer);");
  });

  it("is byte-deterministic", () => {
    const again = buildSnippetDocument({
      state: plan.states[0]!,
      geometry: GEOMETRY,
      theme: THEME,
      visual: VISUAL,
      width: WIDTH,
      height: HEIGHT,
      fps: 30,
      durationMs: 3750,
      bindStateIndex: 0,
      bindSpans: { tabWidth: 2, current: rawLineSpans(states[0]) },
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(doc));
  });
});

describe("snippet pipeline — one document per state carrying the morph into it", () => {
  const S1 = "type T = {\n  id: string;\n};";
  const S2 = "import x from \"y\";\n\ntype T = {\n  id: string;\n};\n\nexport const t: T = { id: \"1\" };";
  const pipe = buildSnippetPipeline({
    plan: buildSnippetMorphPlan({ states: [S1, S2], timing: { morphMs: 500, holdMs: 1000 } }),
    rawStates: [S1, S2],
    tabWidth: 2,
    geometry: GEOMETRY,
    theme: THEME,
    visual: VISUAL,
    width: WIDTH,
    height: HEIGHT,
    fps: 30,
    motion: MOTION,
  });
  const overlays = (doc: MosaicDocument) =>
    codeLines(doc).map((s) => ({ overlay: s.overlay as MosaicOverlayExpr | undefined, b: bindingOf(s) }));

  it("names and times the steps from the plan and stamps the root", () => {
    expect(pipe.kind).toBe("mosaic_pipeline");
    expect(pipe.steps.map((s) => s.name)).toEqual(["state-1", "state-2"]);
    expect(pipe.steps.map((s) => s.durationMs)).toEqual([1500, 1500]);
    expect(pipe.durationMs).toBe(3000);
    expect(pipe.format).toEqual({ kind: "video", container: "mp4" });
    expect(pipe.audio).toEqual({ mode: "off" });
  });

  it("state 1 sits at rest; state 2 slides the persisting lines from their old rows and fades the added ones in", () => {
    expect(overlays(pipe.steps[0]!.file as MosaicDocument).every((o) => o.overlay == null)).toBe(true);
    const ov = overlays(pipe.steps[1]!.file as MosaicDocument);
    const moved = ov.filter((o) => o.overlay?.yExpr && o.overlay.alpha == null);
    const added = ov.filter((o) => o.overlay?.alpha && o.overlay.window?.startSec != null);
    expect(moved).toHaveLength(3); // the type block moved down two rows
    expect(moved[0]!.overlay!.yExpr).toMatch(/^\(1-\(.*\)\)\*-\d+$/);
    expect(moved[0]!.overlay!.startAtSec).toBe(0);
    expect(added).toHaveLength(2); // import + export lines
    expect(added.every((o) => typeof o.overlay!.yExpr === "string")).toBe(true); // rise entrance
    expect(added.every((o) => o.b.index === 1)).toBe(true);
    expect(ov.every((o) => o.b.range != null)).toBe(true);
  });

  it("removed lines fade out at their old row, drawn and bound from the PREVIOUS state", () => {
    const back = buildSnippetPipeline({
      plan: buildSnippetMorphPlan({ states: [S2, S1], timing: { morphMs: 500, holdMs: 1000 } }),
      rawStates: [S2, S1],
      geometry: GEOMETRY,
      theme: THEME,
      visual: VISUAL,
      width: WIDTH,
      height: HEIGHT,
      fps: 30,
      motion: MOTION,
    });
    const ov = overlays(back.steps[1]!.file as MosaicDocument);
    const removed = ov.filter((o) => o.overlay?.window?.endSec != null);
    expect(removed).toHaveLength(2);
    expect(removed.every((o) => o.b.index === 0)).toBe(true);
    expect(removed.map((o) => S2.slice(o.b.range!.start, o.b.range!.end))).toEqual(["import x from \"y\";", "export const t: T = { id: \"1\" };"]);
    expect(removed[0]!.overlay!.alpha).toMatch(/^\(1-\(/);
  });

  it("reduced motion is hard cuts: no overlay on any line", () => {
    const still = buildSnippetPipeline({
      plan: buildSnippetMorphPlan({ states: [S1, S2] }),
      geometry: GEOMETRY,
      theme: THEME,
      visual: VISUAL,
      width: WIDTH,
      height: HEIGHT,
      fps: 30,
      motion: { reduceMotion: true, addEntrance: "fade" },
    });
    expect(overlays(still.steps[1]!.file as MosaicDocument).every((o) => o.overlay == null)).toBe(true);
    // and without raw states the lines bind the whole state
    expect(bindingOf(codeLines(still.steps[1]!.file as MosaicDocument)[0]!)).toEqual({ propKey: "states", index: 1 });
  });
});

describe("raw line spans + column → offset (Make ranged edits index the RAW prop)", () => {
  it("splits like the lexer (CRLF, CR, LF; trailing newline → empty last line)", () => {
    expect(rawLineSpans("a\r\nbb\rc\n")).toEqual([
      { start: 0, end: 1, raw: "a" },
      { start: 3, end: 5, raw: "bb" },
      { start: 6, end: 7, raw: "c" },
      { start: 8, end: 8, raw: "" },
    ]);
  });

  it("maps grid columns back through tabs, wide glyphs and astral glyphs", () => {
    expect(rawOffsetForColumn("\tif (x)", 4, 4)).toBe(1); // tab = 4 columns, 1 code unit
    expect(rawOffsetForColumn("\tif (x)", 6, 4)).toBe(3);
    expect(rawOffsetForColumn("日本 x", 3, 2)).toBe(3); // codeColumnCount counts code points (2 for 日本 + space)
    expect(rawOffsetForColumn("🚀 x", 2, 2)).toBe(3); // the emoji is one column over two code units
    expect(rawOffsetForColumn("abc", 99, 2)).toBe(3); // clamps to the line
  });
});
