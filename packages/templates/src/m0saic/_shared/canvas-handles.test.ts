import type { MosaicSource } from "@m0saic/types";
import { bindProp, bindPropRange, tag } from "@m0saic/template-utils";
import { addHandlesByLabel, firstLabelPresent, labelOf, withAddHandles } from "./canvas-handles";

type Bound = MosaicSource & { editor?: { label?: string; binding?: unknown; bindings?: unknown[] } };
const tile = (): Bound => ({ type: "lavfi", color: "#112233" }) as unknown as Bound;

describe("canvas-handles", () => {
  it("withAddHandles appends to a source's own binding, which stays first", () => {
    const src = bindProp(tile(), "title");
    withAddHandles(src, [{ propKey: "color" }, { propKey: "title" }]);
    expect(src.editor?.bindings).toEqual([{ propKey: "title" }, { propKey: "color" }]);
    expect(src.editor?.binding).toBeUndefined();
  });

  it("withAddHandles with nothing new leaves the source exactly as it was", () => {
    const src = bindProp(tile(), "title");
    const before = JSON.stringify(src);
    withAddHandles(src, [{ propKey: "title" }]);
    withAddHandles(src, []);
    expect(JSON.stringify(src)).toBe(before);
  });

  it("withAddHandles keeps a ranged binding's span (one line of a string stays one line)", () => {
    const src = bindPropRange(tile(), "states", 1, { start: 13, end: 20 }, { start: 14, end: 16 });
    withAddHandles(src, [{ propKey: "theme.comment" }]);
    expect(src.editor?.bindings).toEqual([
      { propKey: "states", index: 1, range: { start: 13, end: 20 }, focus: { start: 14, end: 16 } },
      { propKey: "theme.comment" },
    ]);
  });

  it("addHandlesByLabel hangs entries on every source tagged with the label, fixed or per source", () => {
    const sources = [tag(tile(), "bar"), tile(), tag(tile(), "bar"), tag(tile(), "axis")] as MosaicSource[];
    addHandlesByLabel(sources, { bar: (_src, nth) => [{ propKey: "values", index: nth }], axis: [{ propKey: "axisColor" }] });
    expect(sources.map((s) => (s as Bound).editor?.bindings ?? null)).toEqual([
      [{ propKey: "values", index: 0 }],
      null,
      [{ propKey: "values", index: 1 }],
      [{ propKey: "axisColor" }],
    ]);
    expect(labelOf(sources[3])).toBe("axis");
    expect(firstLabelPresent(sources, ["title", "axis", "bar"])).toBe("axis");
  });
});
