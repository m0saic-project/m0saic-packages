/**
 * These tests encode the stamp analysis from the brief — non-negotiable.
 *
 * `stampStepInlineDoc` writes `size: doc.size ?? outerTarget`, `fps: doc.fps
 * ?? src.fps` and `durationMs: step.durationMs` unconditionally, without
 * recursing into nested steps, and `resolvePipelineFit`'s default is "loop".
 * Every assertion below exists because dropping the corresponding field
 * would silently render the portrait cut in landscape, loop the entire
 * video, or drop the declared duration.
 */

import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import type { MosaicDocument, MosaicDocumentPipeline } from "@m0saic/types";

import { resolveTiming } from "./plan";
import type { StoryPlan, StoryVariant } from "./plan";
import { buildOuterPipeline, buildSceneDoc, buildStoryPipeline } from "./pipeline";
import type { StoryDocument } from "./props";
import { storyTheme } from "./theme";

const THEME = storyTheme();
/** Media-free (the demo shape): body scenes take the panel path. */
const NO_MEDIA: never[] = [];

const TARGET = { width: 1920, height: 1080, fps: 30 };

function makePlan(partial?: Partial<StoryDocument>): StoryPlan {
  const s: StoryDocument = {
    schemaVersion: 1,
    title: "T",
    outputs: ["landscape", "portrait"],
    sections: [
      { id: "a", title: "A", overrides: { durationMs: 2640 } },
      { id: "b", title: "B", overrides: { durationMs: 4120 } },
    ],
    ...partial,
  };
  const r = resolveTiming(s, {
    fps: TARGET.fps,
    target: { width: TARGET.width, height: TARGET.height },
    narrationDurationMs: () => undefined,
  });
  if ("error" in r) throw new Error(r.error);
  return r.plan;
}

/** Stitched natural length: Σ step durations − Σ transition overlaps. */
function naturalOf(pipe: MosaicDocumentPipeline): number {
  let sum = 0;
  let overlap = 0;
  for (const step of pipe.steps) {
    sum += step.durationMs;
    const t = step.transitionToNext;
    if (t && t.type !== "cut") overlap += t.durationMs;
  }
  return sum - overlap;
}

describe("buildStoryPipeline (inner, per-variant)", () => {
  const plan = makePlan();
  const variant: StoryVariant = plan.variants[1]; // portrait — the one the stamp would corrupt
  const inner = buildStoryPipeline(plan, variant, THEME, NO_MEDIA);

  it("declares its own size — an undeclared size silently renders portrait at the outer canvas", () => {
    expect(inner.size).toEqual({ width: 1080, height: 1920 });
  });

  it("declares fps", () => {
    expect(inner.fps).toBe(30);
  });

  it("declares durationMs === its stitched natural === storyMs", () => {
    expect(inner.durationMs).toBe(plan.storyMs);
    expect(naturalOf(inner)).toBe(plan.storyMs);
  });

  it("declares durationFit 'cut' — drift underruns visibly instead of looping", () => {
    expect(inner.durationFit).toBe("cut");
  });

  it("declares emit 'single' explicitly (never relies on the nested downgrade)", () => {
    expect(inner.emit).toBe("single");
  });

  it("each step carries its own overlap: durationMs = visible + xfadeOut", () => {
    inner.steps.forEach((step, i) => {
      const scene = plan.scenes[i];
      expect(step.name).toBe(scene.name);
      expect(step.durationMs).toBe(scene.visibleMs + scene.xfadeOutMs);
      if (scene.xfadeOutMs > 0) {
        expect(step.transitionToNext).toEqual({ type: "fade", durationMs: scene.xfadeOutMs });
      } else {
        expect(step.transitionToNext).toBeUndefined();
      }
    });
  });

  it("a body step is never the B side of an xfade (its head carries narration)", () => {
    inner.steps.forEach((step, i) => {
      const next = plan.scenes[i + 1];
      if (next?.kind === "body") {
        expect(step.transitionToNext ?? { type: "cut" }).toEqual({ type: "cut" });
      }
    });
  });

  it("the last step never dangles a transition", () => {
    expect(inner.steps[inner.steps.length - 1].transitionToNext).toBeUndefined();
  });

  it("every scene doc self-declares size/fps/durationMs (the stamp does not recurse)", () => {
    inner.steps.forEach((step) => {
      const doc = step.file as MosaicDocument;
      expect(doc.kind).toBe("mosaic_document");
      expect(doc.size).toEqual({ width: variant.width, height: variant.height });
      expect(doc.fps).toBe(30);
      expect(doc.durationMs).toBe(step.durationMs);
    });
  });

  it("every emitted m0 validates and its frame count equals the source count", () => {
    // validateSourceCounts skips nested-pipeline subtrees — this unit test
    // is the only guard on the cell-count invariant for scene docs.
    inner.steps.forEach((step) => {
      const doc = step.file as MosaicDocument;
      expect(isValidM0String(String(doc.m0))).toBe(true);
      const frames = parseM0StringToRenderFrames(String(doc.m0), variant.width, variant.height);
      expect(doc.sources).toHaveLength(frames.length);
    });
  });

  it("stays far below the 80-input concat wall at the section cap", () => {
    const maxPlan = makePlan({
      outputs: ["landscape"],
      sections: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, overrides: { durationMs: 1000 } })),
    });
    const pipe = buildStoryPipeline(maxPlan, maxPlan.variants[0], THEME, NO_MEDIA);
    expect(pipe.steps.length).toBe(2 + 2 * 30);
    expect(pipe.steps.length).toBeLessThanOrEqual(80);
  });
});

describe("buildOuterPipeline (emit:multi wrapper)", () => {
  const plan = makePlan();
  const outer = buildOuterPipeline(plan, TARGET, THEME, NO_MEDIA);

  it("authors emit:'multi' — the escape hatch from the stitched-length invariant", () => {
    expect(outer.emit).toBe("multi");
  });

  it("authors fps === ctx.target.fps and the target canvas", () => {
    expect(outer.fps).toBe(TARGET.fps);
    expect(outer.size).toEqual({ width: TARGET.width, height: TARGET.height });
  });

  it("declares durationMs = storyMs (a positive integer, or the stamp drops it) and durationFit 'cut'", () => {
    expect(outer.durationMs).toBe(plan.storyMs);
    expect(Number.isInteger(outer.durationMs)).toBe(true);
    expect((outer.durationMs ?? 0) > 0).toBe(true);
    expect(outer.durationFit).toBe("cut");
  });

  it("one step per variant, named for the deliverable suffix", () => {
    expect(outer.steps.map((s) => s.name)).toEqual(["landscape", "portrait"]);
  });

  it("every outer step.durationMs equals its nested pipeline's natural length", () => {
    outer.steps.forEach((step) => {
      const nested = step.file as unknown as MosaicDocumentPipeline;
      expect(nested.kind).toBe("mosaic_pipeline");
      expect(step.durationMs).toBe(naturalOf(nested));
      expect(step.durationMs).toBe(nested.durationMs);
    });
  });

  it("nested variants carry their own true canvases (portrait is not a stretch)", () => {
    const nested = outer.steps.map((s) => s.file as unknown as MosaicDocumentPipeline);
    expect(nested[0].size).toEqual({ width: 1920, height: 1080 });
    expect(nested[1].size).toEqual({ width: 1080, height: 1920 });
  });

  it("a single-output story produces exactly one step (the collapse case)", () => {
    const solo = makePlan({ outputs: ["landscape"] });
    const pipe = buildOuterPipeline(solo, TARGET, THEME, NO_MEDIA);
    expect(pipe.steps).toHaveLength(1);
    expect(pipe.emit).toBe("multi"); // authored emit is what assertTiming reads
  });

  it("is deterministic", () => {
    expect(buildOuterPipeline(plan, TARGET, THEME, NO_MEDIA)).toEqual(outer);
  });

  it("plan diagnostics ride the outer pipeline's meta.note instead of vanishing", () => {
    const noisy = makePlan({
      sections: [{ id: "a", overrides: { durationMs: 2000, xfadeMs: 100 } }],
    });
    expect(noisy.diagnostics.length).toBeGreaterThan(0);
    const pipe = buildOuterPipeline(noisy, TARGET, THEME, NO_MEDIA);
    expect(pipe.meta?.note).toContain("STORY_OVERRIDE_DOCUMENT_LEVEL");
    // A clean plan attaches no meta at all.
    expect(outer.meta).toBeUndefined();
  });
});

describe("buildSceneDoc dispatch", () => {
  const plan = makePlan();
  const variant = plan.variants[0];

  it("card scenes carry an svg heading; media-free bodies take the panel path", () => {
    const title = buildSceneDoc(plan.scenes[0], variant, plan, THEME, NO_MEDIA);
    expect(JSON.stringify(title)).toContain('"rasterizer":"svg"');
    expect(JSON.stringify(title)).toContain(plan.scenes[0].heading);

    const body = plan.scenes.find((s) => s.kind === "body")!;
    const bodyDoc = buildSceneDoc(body, variant, plan, THEME, NO_MEDIA);
    expect(String(bodyDoc.m0)).toBe("F{F}");
    expect(bodyDoc.sources).toHaveLength(2);
  });

  it("bodies with resolved images build the nested image stack with cover fit", () => {
    // Fabricate a plan whose section declares two images so the schedule exists.
    const withImages = makePlan({
      sections: [
        { id: "a", title: "A", overrides: { durationMs: 5000 }, images: ["/abs/1.jpg", "/abs/2.jpg"] },
        { id: "b", title: "B", overrides: { durationMs: 4120 } },
      ],
    });
    const media = [
      { images: [{ path: "/abs/1.jpg", assetKey: "img_0_0" }, { path: "/abs/2.jpg", assetKey: "img_0_1" }], focus: [undefined, undefined] },
      { images: [], focus: [] },
    ];
    const doc = buildSceneDoc(withImages.scenes.find((s) => s.kind === "body")!, variant, withImages, THEME, media);
    expect(String(doc.m0)).toBe("F{F}");
    expect(doc.sources).toHaveLength(2);
    const flat = JSON.stringify(doc);
    expect(flat).toContain('"fit":"cover"');
    expect(flat).toContain("img_0_0");
    expect(flat).toContain("img_0_1");
  });
});
