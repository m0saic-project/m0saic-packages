import { parseM0cFile } from "@m0saic/dsl-file-formats";

import { comparisonGenerator } from "./comparisonGenerator";

describe("comparisonGenerator", () => {
  it("emits plain m0 (no .m0c) at silent tier", () => {
    const result = comparisonGenerator({ pairs: 2, direction: "horizontal" });
    expect(result.m0).toBeTruthy();
    expect(result.sourceCount).toBe(4);
    expect(result.m0c).toBeUndefined();
  });

  it("labels each cell with side+pair number (a1/b1/a2/b2/...) at signposts", () => {
    const result = comparisonGenerator({ pairs: 3, direction: "horizontal", labels: "signposts" });
    expect(result.m0c).toBeDefined();
    const parsed = parseM0cFile(result.m0c!);
    const texts = Object.values(parsed.labels!).map((l) => l.text).sort();
    expect(texts).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"]);
  });

  it("uses 1-based pair numbering even when there's only one pair", () => {
    const result = comparisonGenerator({ pairs: 1, labels: "signposts" });
    const parsed = parseM0cFile(result.m0c!);
    const texts = Object.values(parsed.labels!).map((l) => l.text).sort();
    expect(texts).toEqual(["a1", "b1"]);
  });

  it("atlas tier matches signposts (comparison has no per-cell axis beyond A/B sides)", () => {
    const a = comparisonGenerator({ pairs: 2, labels: "signposts" });
    const b = comparisonGenerator({ pairs: 2, labels: "atlas" });
    expect(a.m0c).toBeDefined();
    expect(b.m0c).toBeDefined();
    const labelsA = Object.values(parseM0cFile(a.m0c!).labels!).map((l) => l.text).sort();
    const labelsB = Object.values(parseM0cFile(b.m0c!).labels!).map((l) => l.text).sort();
    expect(labelsA).toEqual(labelsB);
  });
});
