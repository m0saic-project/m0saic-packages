import type { MosaicDictionaryEntryResolved } from "@m0saic/types";
import { asDictionaryEntryId } from "@m0saic/types";

import {
  _testClearSourceOrderCache,
  getSourceOrderStableKeys,
  getSourceOrderStableKeysForM0,
} from "./sourceOrder";

function makeEntry(
  overrides: Partial<MosaicDictionaryEntryResolved> = {},
): MosaicDictionaryEntryResolved {
  return {
    id: asDictionaryEntryId("test/entry"),
    m0: "2(1,1)",
    sourceCount: 2,
    title: "Test",
    description: "Test",
    category: "split",
    tags: [],
    feasibility: { minWidthPx: 16, minHeightPx: 16 },
    sourceResolution: { width: 100, height: 100 },
    complexity: {
      frameCount: 2,
      passthroughCount: 0,
      nullCount: 0,
      groupCount: 0,
      nodeCount: 2,
      precisionCost: 2,
      precision: { maxSplitX: 2, maxSplitY: 1, maxSplitAny: 2 },
    },
    ...overrides,
  };
}

describe("getSourceOrderStableKeys", () => {
  beforeEach(() => {
    _testClearSourceOrderCache();
  });

  it("returns sourceCount keys in stable order for a simple split", () => {
    const entry = makeEntry({ m0: "2(1,1)" });
    const keys = getSourceOrderStableKeys(entry);
    expect(keys).toHaveLength(2);
    expect(typeof keys[0]).toBe("string");
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it("returns keys in stable order across runs (memoization)", () => {
    const entry = makeEntry({ m0: "3(1,1,1)", sourceCount: 3 });
    const a = getSourceOrderStableKeys(entry);
    const b = getSourceOrderStableKeys(entry);
    expect(a).toBe(b); // same reference — memoized
  });

  it("returns distinct keys for each source in a flat split", () => {
    const flat = makeEntry({ m0: "3(1,1,1)", sourceCount: 3 });
    const flatKeys = getSourceOrderStableKeys(flat);
    expect(flatKeys).toHaveLength(3);
    expect(new Set(flatKeys).size).toBe(3);
  });

  it("throws when entry has no inline m0", () => {
    const entry = makeEntry({ m0: "" });
    expect(() => getSourceOrderStableKeys(entry)).toThrow(/no inline m0/);
  });

  it("getSourceOrderStableKeysForM0 throws on invalid m0", () => {
    expect(() => getSourceOrderStableKeysForM0("test", "garbage(", 100, 100)).toThrow();
  });
});
