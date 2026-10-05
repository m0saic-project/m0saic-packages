import type { MosaicDocument, MosaicDocumentPipeline } from "@m0saic/types";
import { ctxFor, entriesOn, handlesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { SnippetMorphV1 } from "../v1/snippet-morph";
import { SnippetMorphV2 } from "./snippet-morph";

const D = SnippetMorphV2.defaultProps as Record<string, unknown>;
const TIMING = { "timing.morphMs": "timing", "timing.holdMs": "timing", "timing.leadMs": "timing", "timing.trailMs": "timing" };
const THREE = ["const a = 1;", "const a = 1;\n// then\nconst b = a + 2;", "const a = 1;\nconst b = a + 2;\nexport default sum(a, b);"];

vnextSuite({
  next: SnippetMorphV2,
  prev: SnippetMorphV1,
  cases: [
    { name: "three states", props: { states: THREE } },
    { name: "framed card, no line numbers, centred", props: { chrome: { show: true, title: "sum.ts", trafficLights: false, lineNumbers: false, codeAlign: "center", fullBleed: false } } },
    { name: "no chrome, portrait", props: { chrome: { show: false, lineNumbers: true, fullBleed: true } }, w: 1080, h: 1920 },
    { name: "light preset with overrides, big type", props: { theme: { preset: "light", keyword: "#FF0000", plain: "#00FF00" }, typography: { fontSize: 22, lineHeight: 1.7, tabWidth: 4 } } },
    { name: "one state, reduced motion, fade", props: { states: ["let x = 1;\n\treturn x;"], animation: { reduceMotion: true, addEntrance: "fade" } } },
  ],
  bound: [
    "chrome.title", "states",
    "theme.comment", "theme.fnCall", "theme.ident", "theme.keyword", "theme.number", "theme.operator", "theme.plain", "theme.punct", "theme.string",
    "typography.fontSize", "typography.lineHeight", "typography.tabWidth",
  ],
  unbound: TIMING,
});

describe("@m0saic/code/snippet-morph/v2 — handles", () => {
  type Entry = { propKey: string; index?: number; range?: { start: number; end: number } };
  const stepsOf = async (props: Record<string, unknown>) => {
    const ctx = ctxFor(SnippetMorphV2);
    const film = (await SnippetMorphV2.render({ ...D, ...props } as never, ctx)) as MosaicDocumentPipeline;
    return { film, ctx, docs: film.steps.map((st) => st.file as MosaicDocument) };
  };
  const linesOf = (doc: MosaicDocument): Entry[][] =>
    (doc.sources as Array<{ editor?: { binding?: Entry; bindings?: Entry[] } }>)
      .map((s) => s.editor?.bindings ?? (s.editor?.binding ? [s.editor.binding] : []))
      .filter((b) => b[0]?.propKey === "states");

  it("a code line carries its text first, then the colours of exactly the token kinds it paints", async () => {
    const { docs } = await stepsOf({ states: ["const a = 1;\n// note\n\nsum(a);"] });
    const lines = linesOf(docs[0]).map((b) => b.map((e) => e.propKey));
    expect(lines).toEqual([
      ["states", "theme.keyword", "theme.number", "theme.ident", "theme.operator", "theme.punct"],
      ["states", "theme.comment"],
      ["states", "theme.fnCall", "theme.ident", "theme.punct"],
    ]);
    // v1's ranged text binding is still the line's own, first.
    expect(linesOf(docs[0])[1][0]).toEqual({ propKey: "states", index: 0, range: { start: 13, end: 20 } });
  });

  it("the code area carries the type, and every token colour with nothing painted in this state", async () => {
    const { docs } = await stepsOf({ states: ["const a = 1;"] });
    expect(entriesOn(docs[0], "code-area").map((e) => (e as Entry).propKey)).toEqual([
      "typography.fontSize", "typography.lineHeight", "typography.tabWidth",
      "theme.string", "theme.comment", "theme.fnCall", "theme.plain",
    ]);
  });

  it("a morph step's removed lines keep the previous state's index and that line's kinds", async () => {
    const { docs } = await stepsOf({ states: ["const a = 1;\n// gone", "const a = 1;"] });
    const prior = linesOf(docs[1]).filter((b) => b[0].index === 0);
    expect(prior.map((b) => b.map((e) => e.propKey))).toEqual([["states", "theme.comment"]]);
  });

  it("every step resolves its handles; none is rejected — with chrome off too", async () => {
    for (const props of [{}, { states: THREE }, { chrome: { show: false, lineNumbers: false, fullBleed: false } }]) {
      const { film, ctx, docs } = await stepsOf(props);
      expect(handlesOf(film, SnippetMorphV2, ctx).rejected).toEqual([]);
      for (const doc of docs) expect(entriesOn(doc, "code-area").length).toBeGreaterThanOrEqual(3);
    }
  });

  it("declares the base rect with a reason, and only timing as unbound", () => {
    expect((SnippetMorphV2 as { canvas?: { baseRect?: string } }).canvas?.baseRect).toMatch(/editor card is the subject/);
    expect(SnippetMorphV2.bindings?.unbound).toEqual(TIMING);
  });
});
