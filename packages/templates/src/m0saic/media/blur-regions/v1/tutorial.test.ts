import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { renderBlurRegionsTutorial } from "./tutorial";
import { BlurRegions } from "./blur-regions";

function ctx(w = 1280, h = 720): MosaicEngineContext {
  const target = { width: w, height: h, fps: 30, durationMs: 4000 };
  return { mode: "design", target, output: target, media: {} } as unknown as MosaicEngineContext;
}

describe("blur-regions tutorial", () => {
  it("is wired on the template (the host gates the ? pill on method presence)", () => {
    expect(typeof BlurRegions.renderTutorial).toBe("function");
  });

  it("returns a six-beat pipeline whose durations sum to the total", () => {
    const tut = renderBlurRegionsTutorial(ctx());
    expect(tut.kind).toBe("mosaic_pipeline");
    expect(tut.steps).toHaveLength(8);
    expect(tut.steps.map((s) => s.name)).toEqual(["hero", "flow", "draw", "brush", "inbox", "chat", "usecases", "finish"]);
    const sum = tut.steps.reduce((a, s) => a + s.durationMs, 0);
    expect(tut.durationMs).toBe(sum);
    // Clip beats run their recording's length (~49s of captures + statics).
    expect(sum).toBeGreaterThan(55000);
    expect(sum).toBeLessThan(80000);
  });

  it("every beat is a sized mosaic document at the target canvas", () => {
    const tut = renderBlurRegionsTutorial(ctx(1920, 1080));
    for (const step of tut.steps) {
      const doc = step.file as MosaicDocument;
      expect(doc.kind).toBe("mosaic_document");
      expect(doc.size).toEqual({ width: 1920, height: 1080 });
      expect((doc.sources ?? []).length).toBeGreaterThan(0);
    }
  });

  it("clip beats carry the founder recordings and run the clip length", () => {
    const tut = renderBlurRegionsTutorial(ctx());
    for (const [name, ms] of [["draw", 10483], ["brush", 7967], ["inbox", 17533], ["chat", 13133]] as const) {
      const step = tut.steps.find((s) => s.name === name)!;
      expect(step.durationMs).toBe(ms);
      const doc = step.file as MosaicDocument;
      const assets = Object.values(doc.assets ?? {}) as Array<{ path?: string }>;
      expect(assets.some((a) => (a.path ?? "").includes("screen_recordings"))).toBe(true);
      const labels = (doc.sources ?? []).map((s) => (s as { editor?: { label?: string } }).editor?.label).filter(Boolean);
      expect(labels).toContain(`recording ${name}`);
    }
  });

  it("determinism: two renders are byte-identical", () => {
    const a = renderBlurRegionsTutorial(ctx());
    const b = renderBlurRegionsTutorial(ctx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
