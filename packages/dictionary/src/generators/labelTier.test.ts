import { parseM0cFile } from "@m0saic/dsl-file-formats";

import {
  emitLabeledM0c,
  isLabelTier,
  labelTierParam,
  LABEL_TIER_VALUES,
  resolveLabelTier,
  type LabelTier,
} from "./labelTier";

describe("labelTier", () => {
  it("accepts canonical tier values", () => {
    expect(isLabelTier("silent")).toBe(true);
    expect(isLabelTier("signposts")).toBe(true);
    expect(isLabelTier("atlas")).toBe(true);
  });

  it("rejects non-tier values", () => {
    expect(isLabelTier("off")).toBe(false);
    expect(isLabelTier("verbose")).toBe(false);
    expect(isLabelTier(null)).toBe(false);
    expect(isLabelTier(0)).toBe(false);
    expect(isLabelTier(undefined)).toBe(false);
  });

  it("exposes the three tiers in stable order", () => {
    expect(LABEL_TIER_VALUES).toEqual(["silent", "signposts", "atlas"]);
  });

  it("builds a descriptor honoring the requested default tier", () => {
    const tiers: LabelTier[] = ["silent", "signposts", "atlas"];
    for (const t of tiers) {
      const p = labelTierParam({ defaultTier: t });
      expect(p.key).toBe("labels");
      expect(p.type).toBe("enum");
      expect(p.default).toBe(t);
      expect(p.options).toBeDefined();
      const optionValues = p.options?.map((o) => o.value).sort() ?? [];
      expect(optionValues).toEqual(["atlas", "signposts", "silent"]);
    }
  });

  it("appends generator-specific description text", () => {
    const p = labelTierParam({ defaultTier: "silent", description: "extra note." });
    expect(p.description).toMatch(/extra note\./);
  });

  describe("resolveLabelTier", () => {
    it("passes through canonical tiers", () => {
      expect(resolveLabelTier("silent")).toBe("silent");
      expect(resolveLabelTier("signposts")).toBe("signposts");
      expect(resolveLabelTier("atlas")).toBe("atlas");
    });
    it("falls back to silent for anything else", () => {
      expect(resolveLabelTier(undefined)).toBe("silent");
      expect(resolveLabelTier(null)).toBe("silent");
      expect(resolveLabelTier("verbose")).toBe("silent");
      expect(resolveLabelTier(42)).toBe("silent");
    });
  });

  describe("emitLabeledM0c", () => {
    const M0_2COL = "2(1,1)";
    const SIZE = { width: 100, height: 100 };

    it("returns undefined for silent tier", () => {
      const result = emitLabeledM0c({
        m0: M0_2COL,
        size: SIZE,
        app: "test",
        tier: "silent",
        labelsBySourceIndex: { 0: "left", 1: "right" },
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined when no labels would land", () => {
      const result = emitLabeledM0c({
        m0: M0_2COL,
        size: SIZE,
        app: "test",
        tier: "signposts",
        labelsBySourceIndex: {},
      });
      expect(result).toBeUndefined();
    });

    it("maps source-index labels to stableKeys at signposts tier", () => {
      const m0c = emitLabeledM0c({
        m0: M0_2COL,
        size: SIZE,
        app: "test",
        tier: "signposts",
        labelsBySourceIndex: { 0: "left", 1: "right" },
      });
      expect(m0c).toBeDefined();
      const parsed = parseM0cFile(m0c!);
      expect(parsed.labels).toBeTruthy();
      const labelTexts = Object.values(parsed.labels!).map((l) => l.text).sort();
      expect(labelTexts).toEqual(["left", "right"]);
    });

    it("merges keyed labels on top of positional labels", () => {
      const m0c = emitLabeledM0c({
        m0: M0_2COL,
        size: SIZE,
        app: "test",
        tier: "atlas",
        labelsBySourceIndex: { 0: "a", 1: "b" },
        keyedLabels: { "r/gcolc50/fc0": "first" },
      });
      expect(m0c).toBeDefined();
      const parsed = parseM0cFile(m0c!);
      expect(parsed.labels).toBeTruthy();
      const texts = Object.values(parsed.labels!).map((l) => l.text).sort();
      expect(texts).toContain("b");
      // The keyed override replaces the positional "a" at the same key.
      expect(texts).toContain("first");
    });

    it("skips empty / falsy label texts silently", () => {
      const m0c = emitLabeledM0c({
        m0: M0_2COL,
        size: SIZE,
        app: "test",
        tier: "signposts",
        labelsBySourceIndex: { 0: "", 1: "right" },
      });
      const parsed = parseM0cFile(m0c!);
      expect(Object.values(parsed.labels!).map((l) => l.text)).toEqual(["right"]);
    });

  });
});
