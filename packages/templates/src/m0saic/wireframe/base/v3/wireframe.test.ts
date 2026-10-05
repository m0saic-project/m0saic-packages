import type { MosaicDocument, MosaicDocumentPipeline } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { WireframeV2 } from "../v2/wireframe";
import { WireframeV3 } from "./wireframe";

const D = WireframeV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>) =>
  (await WireframeV3.render({ ...D, ...props } as never, ctxFor(WireframeV3))) as MosaicDocument;

const OVERLAY = "2(1,1{2[-,1]})";
const UNBOUND = { backgroundImageOpacity: "trace image (needs a background image)" };

vnextSuite({
  next: WireframeV3,
  prev: WireframeV2,
  cases: [
    { name: "labels on some cells, aspect content", props: { M0String: "3(1,2[1,1],1)", labels: ["Hero", "", "Side"], labelContent: "aspect" } },
    { name: "labels, the rest left empty, transparent, rect fill", props: { labels: ["A"], unlabeledCells: "empty", background: "transparent", fill: 0.3 } },
    { name: "heat colours (with and without labels)", props: { cellColors: ["#ff0000", "", "#00ff00", "#0000ff"], labels: ["hot", "", "", ""] } },
    { name: "trace image under the lines", props: { backgroundImage: "/shots/page.png", backgroundImageOpacity: 0.5, backgroundImageFit: "contain", background: "transparent" } },
    { name: "an overlay with a hole", props: { M0String: OVERLAY } },
    { name: "layer explode (null frames shown)", props: { M0String: OVERLAY, nullFrames: "show", nullLabel: "-", labels: ["base"] } },
    { name: "thumb mode", props: { mode: "thumb" } },
    { name: "grid-paper preset", props: { preset: "grid-paper" } },
    { name: "heatmap preset, portrait", props: { preset: "heatmap-depth", M0String: "4[1,1,1,1]" }, w: 1080, h: 1920 },
  ],
  bound: ["backgroundImage", "cellColors", "fill", "labels"],
  unbound: UNBOUND,
});

describe("@m0saic/wireframe/base/v3 — handles", () => {
  type Entry = { propKey: string; index?: number };
  const entriesOf = (doc: MosaicDocument): Entry[][] =>
    (doc.sources as Array<{ editor?: { bindings?: Entry[]; binding?: Entry } }>).map((s) => s.editor?.bindings ?? (s.editor?.binding ? [s.editor.binding] : []));

  it("defaults: cell n carries its label (v2's), its body colour, the rect fill and the trace image", async () => {
    const cells = entriesOf(await render({}));
    expect(cells).toHaveLength(4);
    cells.forEach((entries, n) => {
      expect(entries).toEqual([{ propKey: "labels", index: n }, { propKey: "cellColors", index: n }, { propKey: "fill" }, { propKey: "backgroundImage" }]);
    });
  });

  it("the image's opacity rides the cells once there is an image to fade", async () => {
    const cells = entriesOf(await render({ backgroundImage: "/shots/page.png" }));
    for (const entries of cells) expect(entries.map((e) => e.propKey)).toEqual(["labels", "cellColors", "fill", "backgroundImage", "backgroundImageOpacity"]);
  });

  it("heat cells — flat (no label) and nested (label over colour) — are the same handles", async () => {
    const doc = await render({ cellColors: ["#ff0000", "#00ff00"], labels: ["hot"] });
    const cells = entriesOf(doc);
    expect((doc.sources[0] as { type?: string }).type).toBe("mosaic"); // body + ink child
    expect((doc.sources[1] as { type?: string }).type).toBe("lavfi"); // flat heat tile
    expect(cells[0].slice(0, 2)).toEqual([{ propKey: "labels", index: 0 }, { propKey: "cellColors", index: 0 }]);
    expect(cells[1].slice(0, 2)).toEqual([{ propKey: "labels", index: 1 }, { propKey: "cellColors", index: 1 }]);
  });

  it("thumb tiles carry no label and stay unbound (as v2); the paper grid is never a handle", async () => {
    expect(entriesOf(await render({ mode: "thumb" })).flat()).toEqual([]);
    const paper = entriesOf(await render({ preset: "grid-paper" }));
    expect(paper[paper.length - 1]).toEqual([]);
  });

  it("layer explode: a painted cell keeps its composite number on every still; ghosts and holes are not handles (v2 bound nothing here)", async () => {
    const ctx = ctxFor(WireframeV3);
    const film = (await WireframeV3.render({ ...D, M0String: OVERLAY, nullFrames: "show" } as never, ctx)) as MosaicDocumentPipeline;
    expect(film.kind).toBe("mosaic_pipeline");
    const perStill = film.steps.map((st) => entriesOf(st.file as MosaicDocument).filter((e) => e.length > 0));
    // Three painted cells over two depths: cells 1 + 2 on the base still, cell 3 on the overlay still.
    expect(perStill.map((cells) => cells.map((e) => e[0]))).toEqual([
      [{ propKey: "labels", index: 0 }, { propKey: "labels", index: 1 }],
      [{ propKey: "labels", index: 2 }],
    ]);
    for (const cells of perStill) for (const e of cells) expect(e.map((x) => x.propKey)).toEqual(["labels", "fill", "backgroundImage"]);
    expect(handlesOf(film, WireframeV3, ctx).rejected).toEqual([]);
  });

  it("nothing is rejected with every handle in play", async () => {
    const ctx = ctxFor(WireframeV3);
    const doc = await WireframeV3.render({ ...D, labels: ["a"], cellColors: ["#ff0000", "", "#00ff00"], fill: 0.2, backgroundImage: "/shots/page.png" } as never, ctx);
    expect(handlesOf(doc, WireframeV3, ctx).rejected).toEqual([]);
  });
});
