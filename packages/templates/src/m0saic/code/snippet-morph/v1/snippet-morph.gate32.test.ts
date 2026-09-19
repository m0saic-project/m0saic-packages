/**
 * Gate-32 (v1 prod cut) locks for `@m0saic/code/snippet-morph/v1`: the
 * 2-state default (a morph template's default face shows a morph), the
 * format/audio stamps, and the duration law — the plan authors its natural
 * length from states × timing, an explicit pin wins, the hint never does.
 */
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { SnippetMorphV1, type SnippetMorphV1Props } from "./snippet-morph";

function ctxFor(width = 1280, height = 720, pinMs?: number): MosaicEngineContext {
  return {
    mode: "design",
    target: { width, height, fps: 30, durationMs: 7500 },
    output: { width, height, fps: 30, durationMs: 7500 },
    media: {},
    ...(pinMs != null ? { userIntent: { durationMs: pinMs } } : {}),
  } as unknown as MosaicEngineContext;
}
const D = SnippetMorphV1.defaultProps as SnippetMorphV1Props;
type LitePipe = { kind: string; durationMs: number; format?: unknown; steps: Array<{ name: string; durationMs: number; file: MosaicDocument }> };
const lite = async (props: SnippetMorphV1Props, ctx = ctxFor()) => (await SnippetMorphV1.render(props, ctx)) as unknown as LitePipe;
const finalOf = (p: LitePipe) => p.steps[p.steps.length - 1]!.file;
const overlaysOf = (doc: MosaicDocument) =>
  doc.sources.map((s) => (s as { overlay?: Record<string, unknown> }).overlay).filter((o): o is Record<string, unknown> => !!o);

describe("SnippetMorphV1 — gate 32", () => {
  it("defaults carry TWO states so the default face morphs (adds + moves), hint = their natural 7.5s", () => {
    expect(D.states).toHaveLength(2);
    expect(D.states[1]).toContain("export function announce");
    expect(D.states[1].split("\n").length).toBeGreaterThan(D.states[0].split("\n").length);
    expect(SnippetMorphV1.outputHints).toMatchObject({ durationMs: 7500, format: { kind: "video", container: "mp4" } });
  });

  it("the plan authors its natural length from states × timing — the hint never pins", async () => {
    const two = await lite(D);
    expect(two.durationMs).toBe(7500);
    const fast = await lite({ ...D, timing: { morphMs: 400, holdMs: 600 } });
    expect(fast.durationMs).toBe(2000); // NOT the 7500 hint — this is the case the stitch check used to refuse
    const one = await lite({ ...D, states: [D.states[0]] });
    expect(one.durationMs).toBe(3750);
  });

  it("an explicit pin (ctx.userIntent.durationMs) wins over the natural length", async () => {
    const pinned = await lite(D, ctxFor(1280, 720, 10000));
    expect(pinned.durationMs).toBe(10000);
  });

  it("the lite stand-in is a per-state PIPELINE that plays the morph (take 3)", async () => {
    const pipe = await lite(D);
    expect(pipe.kind).toBe("mosaic_pipeline");
    expect(pipe.steps.map((s) => s.name)).toEqual(["state-1", "state-2"]);
    expect(pipe.steps.map((s) => s.durationMs)).toEqual([3750, 3750]);
    // state 1: at rest (no morph into it)
    expect(overlaysOf(pipe.steps[0].file)).toHaveLength(0);
    // state 2: persisting lines that shifted rows slide from their old row;
    // added lines fade (+ rise) in from the morph start — the render's own expressions
    const ov = overlaysOf(pipe.steps[1].file);
    const moves = ov.filter((o) => typeof o.yExpr === "string" && o.alpha == null);
    const adds = ov.filter((o) => typeof o.alpha === "string" && (o.window as { startSec?: number } | undefined)?.startSec != null);
    expect(moves.length).toBeGreaterThan(0);
    expect(adds.length).toBeGreaterThan(0);
    expect(moves[0].yExpr as string).toMatch(/^\(1-\(.*\)\)\*-?\d+$/);
    expect(moves[0].startAtSec).toBe(0);
    // reduced motion: hard cuts, nothing animated
    const still = await lite({ ...D, animation: { reduceMotion: true } });
    expect(overlaysOf(still.steps[1].file)).toHaveLength(0);
  });

  it("every code run is bound to its state for Make double-click editing; removed lines bind to the previous state", async () => {
    const pipe = await lite({ ...D, states: [D.states[1], D.states[0]] }); // state 2 REMOVES lines
    const bindings = (doc: MosaicDocument) =>
      doc.sources
        .map((s) => (s as { editor?: { binding?: { propKey: string; index?: number } } }).editor?.binding)
        .filter((b): b is { propKey: string; index?: number } => !!b && b.propKey === "states");
    const idx = new Set(bindings(pipe.steps[1].file).map((b) => b.index));
    expect(idx).toEqual(new Set([0, 1])); // current state's runs → 1, fading removed lines → 0
    expect(bindings(pipe.steps[0].file).every((b) => b.index === 0)).toBe(true);
  });

  it("every code LINE source binds ITS line of its state (range = the raw line) — tabs + CRLF map to raw offsets", async () => {
    const raw0 = "function f() {\r\n\tif (x) {\r\n\t\treturn 1;\r\n\t}\r\n}";
    const raw1 = raw0 + "\r\n\r\nf();";
    type B = { propKey: string; index?: number; range?: { start: number; end: number }; focus?: { start: number; end: number } };
    const bindings = (doc: MosaicDocument) =>
      doc.sources
        .map((s) => ({
          b: (s as { editor?: { binding?: B } }).editor?.binding,
          // one source per LINE: its layers are the line's token runs
          tokens: ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""),
        }))
        .filter((x): x is { b: B; tokens: string[] } => !!x.b && x.b.propKey === "states");
    const pipe = await lite({ ...D, states: [raw0, raw1], language: "js", typography: { tabWidth: 4 } });
    for (const [stateIdx, raw] of [[0, raw0], [1, raw1]] as Array<[number, string]>) {
      const bs = bindings(pipe.steps[stateIdx].file).filter((x) => x.b.index === stateIdx);
      expect(bs.length).toBeGreaterThan(3); // one per non-blank line
      for (const { b, tokens } of bs) {
        expect(b.range).toBeDefined();
        const line = raw.slice(b.range!.start, b.range!.end);
        expect(line).not.toMatch(/[\r\n]/); // exactly one raw line
        expect(tokens.length).toBeGreaterThan(0);
        for (const tok of tokens) expect(line).toContain(tok); // the runs this source draws ARE that line's tokens
      }
    }
    // the added `f();` line binds to state 2's LAST raw line
    const added = bindings(pipe.steps[1].file).find((x) => raw1.slice(x.b.range!.start, x.b.range!.end) === "f();");
    expect(added?.b.index).toBe(1);
    // reversed: the fading removed line binds to the PREVIOUS state's raw line
    const rev = await lite({ ...D, states: [raw1, raw0], language: "js", typography: { tabWidth: 4 } });
    const del = bindings(rev.steps[1].file).find((x) => x.b.index === 0);
    expect(del).toBeDefined();
    expect(raw1.slice(del!.b.range!.start, del!.b.range!.end)).toBe("f();");
  });

  it("full bleed by default: the card IS the canvas; chrome.fullBleed:false restores the framed margin", async () => {
    const full = finalOf(await lite(D));
    const framed = finalOf(await lite({ ...D, chrome: { ...D.chrome, fullBleed: false } }));
    const card = (doc: MosaicDocument) => doc.sources.find((s) => (s as { editor?: { label?: string } }).editor?.label === "card");
    // The card tile carries no rounding/stroke at full bleed, and does when framed.
    expect((card(full) as { effects?: unknown } | undefined)?.effects).toBeUndefined();
    expect((card(framed) as { effects?: { rounding?: unknown } } | undefined)?.effects?.rounding).toBeDefined();
    expect(D.chrome?.fullBleed).toBe(true);
  });

  it("the document is CODE TEXT in JetBrains Mono with gutter numbers, stamped video — and it IS the render (no renderLite)", async () => {
    expect(SnippetMorphV1.renderLite).toBeUndefined();
    const pipe = await lite(D);
    expect(pipe.format).toEqual({ kind: "video", container: "mp4" });
    const doc = finalOf(pipe);
    type T = { style?: { fontFamily?: string }; layers: Array<{ content: { text?: string }; style?: { fontFamily?: string; fontColor?: string } }> };
    const texts = doc.sources.filter((s) => s.type === "text") as unknown as T[];
    // one source per code LINE (a layer per run) + one per gutter number + the title
    const literals = texts.flatMap((s) => s.layers.map((l) => l.content?.text ?? ""));
    for (const tok of ["type", "Launch", "product:", "announce(l:", "console.log(l.product"]) {
      expect(literals.some((l) => l.includes(tok) || tok.includes(l))).toBe(true);
    }
    // every text source declares the code face (source style for code lines, layer style for labels)
    expect(texts.every((s) => (s.style?.fontFamily ?? s.layers[0]?.style?.fontFamily) === "JetBrains Mono")).toBe(true);
    const rawLines = D.states[1].split("\n");
    for (let n = 1; n <= rawLines.length; n++) expect(literals).toContain(String(n));
    // no colour-bar stand-ins for code: the only flat tiles left are chrome (card, bars, dots)
    const lavfi = doc.sources.filter((s) => s.type === "lavfi");
    expect(lavfi.length).toBeLessThan(12);
    const nonBlank = rawLines.filter((l) => l.trim().length > 0).length;
    expect(texts.length).toBe(nonBlank + rawLines.length + 2); // code lines + gutter numbers + title + traffic lights
  });

  it("declares no cover and no tutorial (open questions for the gate)", () => {
    expect(SnippetMorphV1.renderCover).toBeUndefined();
    expect(SnippetMorphV1.renderTutorial).toBeUndefined();
  });
});
