import * as fs from "fs";
import * as path from "path";
import { validateM0String } from "@m0saic/dsl";
import {
  BENCHMARK_BATTERY,
  BENCHMARK_SET_VERSIONS,
  BENCHMARK_STANDARD_SETS,
  BENCHMARK_HEAVY_SETS,
  BENCHMARK_SLOTH_SETS,
  BATTERY_SCENARIOS_SUBDIR,
} from "./manifest";

const SCENARIOS_DIR = path.join(__dirname, BATTERY_SCENARIOS_SUBDIR);

function loadScenarioDoc(file: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(SCENARIOS_DIR, file), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("benchmark battery manifest", () => {
  it("has unique scenario ids", () => {
    const ids = BENCHMARK_BATTERY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses sets that declare a content version", () => {
    for (const s of BENCHMARK_BATTERY) {
      expect(BENCHMARK_SET_VERSIONS[s.set]).toBeGreaterThanOrEqual(1);
    }
  });

  it("encoder scenarios carry a codec; others do not", () => {
    for (const s of BENCHMARK_BATTERY) {
      if (s.set === "encoders") expect(typeof s.codec).toBe("string");
      else expect(s.codec).toBeUndefined();
    }
  });

  it("every scenario points to a renderable frozen .mosaic", () => {
    for (const s of BENCHMARK_BATTERY) {
      const doc = loadScenarioDoc(s.file);
      if (doc.kind === "mosaic_pipeline") {
        // Captured multi-output templates (e.g. screencap-grid) are pipelines.
        expect(Array.isArray(doc.steps)).toBe(true);
        expect((doc.steps as unknown[]).length).toBeGreaterThanOrEqual(1);
      } else {
        expect(doc.kind).toBe("mosaic_document");
        expect(doc.version).toBe(1);
        expect(validateM0String(doc.m0 as string).ok).toBe(true);
        expect(Array.isArray(doc.sources)).toBe(true);
        expect((doc.sources as unknown[]).length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("the three tiers are mutually disjoint and cover every versioned set", () => {
    const tiers = [BENCHMARK_STANDARD_SETS, BENCHMARK_HEAVY_SETS, BENCHMARK_SLOTH_SETS];
    // No set appears in more than one tier.
    const all = tiers.flat();
    expect(new Set(all).size).toBe(all.length);
    // Every versioned set is placed in exactly one tier.
    const tiered = new Set(all);
    for (const set of Object.keys(BENCHMARK_SET_VERSIONS)) {
      expect(tiered.has(set as (typeof BENCHMARK_STANDARD_SETS)[number])).toBe(true);
    }
  });

  it("real + sloth scenarios carry a duration override + template provenance", () => {
    const measured = BENCHMARK_BATTERY.filter((s) => s.set === "real" || s.set === "sloth");
    expect(measured.length).toBeGreaterThanOrEqual(3);
    for (const s of measured) {
      expect(typeof s.durationMs).toBe("number");
      expect((s.durationMs as number)).toBeGreaterThan(0);
      expect(Array.isArray(s.templateIds)).toBe(true);
      expect((s.templateIds as string[]).length).toBeGreaterThanOrEqual(1);
    }
    // Each workload is measured at multiple lengths (the cost curve).
    const lengths = new Set(measured.map((s) => s.durationMs));
    expect(lengths.size).toBeGreaterThanOrEqual(2);
  });

  it("the donut blowup lives in the sloth tier, not real", () => {
    const donutId = "@m0saic/charts/donut/v1";
    const inReal = BENCHMARK_BATTERY.filter((s) => s.set === "real" && s.templateIds?.includes(donutId));
    const inSloth = BENCHMARK_BATTERY.filter((s) => s.set === "sloth" && s.templateIds?.includes(donutId));
    expect(inReal).toEqual([]); // carved out of the heavy tier
    expect(inSloth.length).toBeGreaterThanOrEqual(1); // measured in sloth
  });
});
