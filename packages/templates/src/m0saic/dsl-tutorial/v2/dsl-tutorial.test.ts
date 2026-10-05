import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../__tests__/vnextSuite";
import { DslTutorial } from "../v1"; // registers the four panels too
import { DslTutorialV2 } from "./dsl-tutorial";

const D = DslTutorialV2.defaultProps as Record<string, unknown>;
// The panels memoise through ctx.cache (the engine supplies one).
const withCache = (ctx: MosaicEngineContext): MosaicEngineContext =>
  ({ ...ctx, cache: { get: () => undefined, set: () => {}, getOrCompute: async (_k: string, fn: () => unknown) => fn() } }) as unknown as MosaicEngineContext;
const mkCtx = (w?: number, h?: number) => withCache(ctxFor(DslTutorialV2, { w, h }));

vnextSuite({
  next: DslTutorialV2,
  prev: DslTutorial,
  ctx: (t, c) => withCache(ctxFor(t, c)),
  cases: [
    { name: "dark, a small lesson, all events, 2× speed", props: { M0String: "2(F,2[F,F])", preset: "dark", stepEvents: "all", speedMultiplier: 2, title: "Two columns" } },
    { name: "a portrait layout parsed at 1080×1920, zoomed", props: { M0String: "3[F,F,F]", canvasWidth: 1080, canvasHeight: 1920, cameraZoom: 2 } },
    { name: "canvas only", props: { showInspector: false, showDslString: false, showChrome: false } },
    { name: "no canvas", props: { showCanvas: false } },
    { name: "portrait output", props: {}, w: 1080, h: 1920 },
  ],
  bound: ["cameraZoom", "canvasHeight", "canvasWidth", "speedMultiplier", "title"],
  unbound: {},
});

describe("@m0saic/dsl-tutorial/v2 — handles", () => {
  type Panel = { type?: string; ref?: string; editor?: { bindings?: Array<{ propKey: string }> } };
  const panelsOf = (doc: MosaicDocument) =>
    Object.fromEntries((doc.sources as Panel[]).filter((s) => s.type === "mosaic").map((s) => [s.ref, (s.editor?.bindings ?? []).map((b) => b.propKey)]));

  it("the header carries the speed; the canvas panel its camera and the size the layout is parsed at; the rest nothing (v1 bound none of these)", async () => {
    const doc = (await DslTutorialV2.render({ ...D } as never, mkCtx())) as MosaicDocument;
    expect(panelsOf(doc)).toEqual({
      "chrome-header": ["speedMultiplier"],
      "dsl-string": [],
      "dsl-narration": [],
      canvas: ["cameraZoom", "canvasWidth", "canvasHeight"],
      inspector: [],
      "chrome-status": [],
    });
  });

  it("inside the header, the Speed pill edits the tutorial's speed (v1 bound it to the chrome panel's own `speedLabel`, which every host refused)", async () => {
    const keysIn = (doc: MosaicDocument) =>
      ((doc.children as Record<string, MosaicDocument>)["chrome-header"].sources as Array<{ editor?: { binding?: { propKey: string } } }>)
        .map((s) => s.editor?.binding?.propKey)
        .filter(Boolean);
    const next = (await DslTutorialV2.render({ ...D } as never, mkCtx())) as MosaicDocument;
    const prev = (await DslTutorial.render({ ...D } as never, mkCtx())) as MosaicDocument;
    expect(keysIn(prev)).toEqual(expect.arrayContaining(["title", "speedLabel"]));
    expect(keysIn(next)).toEqual(keysIn(prev).map((k) => (k === "speedLabel" ? "speedMultiplier" : k)));
    expect(handlesOf(prev, DslTutorial, mkCtx()).rejected).not.toEqual([]);
  });

  it("a hidden panel offers nothing, and nothing is rejected in any panel set", async () => {
    for (const props of [{}, { showChrome: false }, { showCanvas: false }, { showInspector: false, showDslString: false }]) {
      const ctx = mkCtx();
      const doc = (await DslTutorialV2.render({ ...D, ...props } as never, ctx)) as MosaicDocument;
      const panels = panelsOf(doc);
      if ((props as { showChrome?: boolean }).showChrome === false) expect(panels["chrome-header"]).toBeUndefined();
      if ((props as { showCanvas?: boolean }).showCanvas === false) expect(panels.canvas).toBeUndefined();
      expect(handlesOf(doc, DslTutorialV2, ctx).rejected).toEqual([]);
    }
  });
});
