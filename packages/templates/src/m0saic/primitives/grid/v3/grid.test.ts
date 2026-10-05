import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, vnextSuite } from "../../../../__tests__/vnextSuite";
import { PrimitiveGridV2 } from "../v2/grid";
import { PrimitiveGridV3 } from "./grid";

const D = PrimitiveGridV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await PrimitiveGridV3.render({ ...D, ...props } as never, ctxFor(PrimitiveGridV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: PrimitiveGridV3,
  prev: PrimitiveGridV2,
  catalog: { primitive: true },
  // v3 dropped v2's full-canvas transparent base slot (canvasFill), so the
  // documents differ by that one source — the parity lock below compares the LINES.
  parity: false,
  // direction / origin gained their closed sets (v2 typed them as free text).
  schemaChanged: ["direction", "origin"],
  bound: ["color", "count", "opacity", "thicknessFrac"],
  unbound: {},
});

describe("@m0saic/primitives/grid/v3 — the lines are v2's, the base slot is gone", () => {
  const CASES: Array<Record<string, unknown>> = [
    {},
    { direction: "vertical", count: 8, origin: "right" },
    { direction: "both", count: 4, excludeEdges: false, color: "#22cc88", opacity: 0.5, thicknessFrac: 0.01 },
    { origin: "top", count: 3 },
  ];

  it.each(CASES.map((c, i) => [i, c] as const))("case %i: every line paints exactly what v2's paints", async (_i, props) => {
    const ctx = ctxFor(PrimitiveGridV3, { w: 1280, h: 720 });
    const v2 = (await PrimitiveGridV2.render({ ...PrimitiveGridV2.defaultProps, ...props }, ctx)) as MosaicDocument;
    const v3 = await render(props, 1280, 720);
    const paint = (doc: MosaicDocument, from: number) => JSON.parse(JSON.stringify(doc.sources.slice(from), (k, v) => (k === "editor" ? undefined : v)));
    expect(paint(v3, 0)).toEqual(paint(v2, 1)); // v2's sources[0] is the transparent base
    expect(v3.sources.length).toBe(v2.sources.length - 1);
  });

  it("no source covers the canvas as a plain fill", async () => {
    const doc = await render({});
    expect((doc.sources as Array<{ fitMode?: string; size?: unknown }>).every((s) => s.fitMode === "content" || !!s.size)).toBe(true);
  });

  it("every line carries the four things it shows, colour first", async () => {
    const doc = await render({ direction: "both" });
    for (const s of doc.sources as Array<{ editor?: { bindings?: Array<{ propKey: string }> } }>) {
      expect(s.editor?.bindings?.map((b) => b.propKey)).toEqual(["color", "opacity", "thicknessFrac", "count"]);
    }
  });

  it("hidden or a single interval still renders the empty (transparent) grid", async () => {
    expect((await render({ show: false })).sources).toHaveLength(1);
    expect((await render({ count: 1 })).sources).toHaveLength(1);
  });
});
