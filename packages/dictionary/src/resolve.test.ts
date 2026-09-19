import type { MosaicDictionaryEntryResolved } from "@m0saic/types";
import { asDictionaryEntryId } from "@m0saic/types";
import {
  resolveM0saic,
  setDictionaryAssetsBase,
  _testGetCache,
  _testClearCache,
} from "./resolve";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<MosaicDictionaryEntryResolved> = {}): MosaicDictionaryEntryResolved {
  return {
    id: asDictionaryEntryId("test/entry"),
    m0: "",
    sourceCount: 1,
    title: "Test",
    description: "Test entry",
    category: "split",
    tags: [],
    feasibility: { minWidthPx: 1, minHeightPx: 1 },
    complexity: {
      frameCount: 1,
      passthroughCount: 0,
      nullCount: 0,
      groupCount: 0,
      nodeCount: 1,
      precisionCost: 1,
      precision: { maxSplitX: 1, maxSplitY: 1, maxSplitAny: 1 },
    },
    ...overrides,
  };
}

const VALID_M0_FILE = [
  "# m0saic",
  "# format: m0",
  "# version: 1",
  "# created: 2026-01-01T00:00:00.000Z",
  "",
  "2(1,1)",
].join("\n");

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

beforeEach(() => {
  _testClearCache();
  jest.restoreAllMocks();
});

describe("resolveM0saic", () => {
  // ── Inline entries (fast path) ──

  test("returns inline m0saic immediately", async () => {
    const entry = makeEntry({ m0: "2(1,1)" });
    const result = await resolveM0saic(entry);
    expect(result).toBe("2(1,1)");
  });

  test("does not cache inline entries", async () => {
    const entry = makeEntry({ m0: "2(1,1)" });
    await resolveM0saic(entry);
    expect(_testGetCache().size).toBe(0);
  });

  // ── Error cases ──

  test("throws if no m0saic and no m0File", async () => {
    const entry = makeEntry({ m0: "", m0File: undefined });
    await expect(resolveM0saic(entry)).rejects.toThrow("no m0saic or m0File");
  });

  test("throws on fetch failure", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const entry = makeEntry({ m0: "", m0File: "entries/test/m0saic.m0" });
    await expect(resolveM0saic(entry)).rejects.toThrow("404");
  });

  // ── Fetch + parse + cache ──

  test("fetches m0File, parses, and returns m0saic", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => VALID_M0_FILE,
    } as Response);

    const entry = makeEntry({ m0: "", m0File: "entries/test/m0saic.m0" });
    const result = await resolveM0saic(entry);
    expect(result).toBe("2(1,1)");
  });

  test("caches after first fetch", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => VALID_M0_FILE,
    } as Response);

    const entry = makeEntry({ id: asDictionaryEntryId("test/cached"), m0: "", m0File: "entries/test/m0saic.m0" });

    const r1 = await resolveM0saic(entry);
    const r2 = await resolveM0saic(entry);

    expect(r1).toBe("2(1,1)");
    expect(r2).toBe("2(1,1)");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only fetched once
    expect(_testGetCache().has("test/cached")).toBe(true);
  });

  // ── URL construction ──

  test("constructs URL from base + m0File", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => VALID_M0_FILE,
    } as Response);

    setDictionaryAssetsBase("/custom/path");
    const entry = makeEntry({ m0: "", m0File: "entries/test/m0saic.m0" });
    await resolveM0saic(entry);

    expect(fetchSpy).toHaveBeenCalledWith("/custom/path/entries/test/m0saic.m0");

    // Restore default
    setDictionaryAssetsBase("/dictionary");
  });

  // ── Cache eviction ──

  test("cache evicts oldest when full", async () => {
    // Fill cache manually via sequential resolves
    for (let i = 0; i < 65; i++) {
      jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        text: async () => VALID_M0_FILE,
      } as Response);

      await resolveM0saic(makeEntry({
        id: asDictionaryEntryId(`test/entry-${i}`),
        m0: "",
        m0File: `entries/test/entry-${i}.m0`,
      }));
    }

    // Cache should be at max (64), not 65
    expect(_testGetCache().size).toBeLessThanOrEqual(64);
    // First entry should have been evicted
    expect(_testGetCache().has("test/entry-0")).toBe(false);
    // Last entry should be present
    expect(_testGetCache().has("test/entry-64")).toBe(true);
  });
});
