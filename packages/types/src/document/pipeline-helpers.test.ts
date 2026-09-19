import type { M0String } from "@m0saic/dsl";
import type { MosaicDocument } from "./document";
import type { MosaicDocumentPipeline } from "./document-pipeline";
import {
  computePipelineTimeline,
  getEmit,
  getOutputStepCount,
  getOutputSteps,
  isDocumentFile,
  isMultiOutputCapable,
  isValidPipelineDurationMs,
  resolvePipelineFit,
  resolveStepName,
  stepIndexAtTime,
  sumPipelineDurations,
} from "./pipeline-helpers";

const m0 = (s: string): M0String => s as unknown as M0String;

const minimalDoc: MosaicDocument = {
  kind: "mosaic_document",
  version: 1,
  m0: m0("1"),
  assets: {},
  sources: [{ type: "lavfi", color: "#000000" }],
};

describe("isDocumentFile", () => {
  it("returns true for a document", () => {
    expect(isDocumentFile(minimalDoc)).toBe(true);
  });

  it("returns false for a pipeline", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: minimalDoc }],
    };
    expect(isDocumentFile(p)).toBe(false);
  });

  it("returns false for null / undefined / scalars", () => {
    expect(isDocumentFile(null)).toBe(false);
    expect(isDocumentFile(undefined)).toBe(false);
    expect(isDocumentFile("mosaic_document")).toBe(false);
    expect(isDocumentFile(42)).toBe(false);
  });
});

describe("getOutputSteps / getOutputStepCount", () => {
  it("returns all steps when none are intermediate", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [
        { durationMs: 1000, file: minimalDoc },
        { durationMs: 1000, file: minimalDoc },
        { durationMs: 1000, file: minimalDoc },
      ],
    };
    expect(getOutputSteps(p)).toHaveLength(3);
    expect(getOutputStepCount(p)).toBe(3);
  });

  it("filters out intermediate steps", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [
        { intermediate: true, durationMs: 1000, file: minimalDoc },
        { durationMs: 1000, file: minimalDoc },
        { intermediate: true, durationMs: 1000, file: minimalDoc },
        { durationMs: 1000, file: minimalDoc },
      ],
    };
    expect(getOutputStepCount(p)).toBe(2);
    expect(getOutputSteps(p)).toHaveLength(2);
  });

  it("returns 0 when every step is intermediate (engine emits PIPELINE_NO_OUTPUT_STEPS)", () => {
    const p: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ intermediate: true, durationMs: 1000, file: minimalDoc }],
    };
    expect(getOutputStepCount(p)).toBe(0);
  });
});

describe("getEmit", () => {
  const single: MosaicDocumentPipeline = {
    kind: "mosaic_pipeline",
    version: 1,
    steps: [{ durationMs: 1000, file: minimalDoc }],
  };
  const multi: MosaicDocumentPipeline = {
    ...single,
    emit: "multi",
  };

  it("defaults to 'single' when omitted", () => {
    expect(getEmit(single, { nested: false })).toBe("single");
  });

  it("returns the declared emit when top-level", () => {
    expect(getEmit(multi, { nested: false })).toBe("multi");
  });

  it("downgrades multi to single when nested", () => {
    expect(getEmit(multi, { nested: true })).toBe("single");
  });
});

describe("isMultiOutputCapable", () => {
  const pipeline = (
    stepCount: number,
    intermediateCount = 0,
    emit?: "single" | "multi",
  ): MosaicDocumentPipeline => ({
    kind: "mosaic_pipeline",
    version: 1,
    steps: [
      ...Array.from({ length: intermediateCount }, () => ({
        intermediate: true as const,
        durationMs: 100,
        file: minimalDoc,
      })),
      ...Array.from({ length: stepCount }, () => ({
        durationMs: 1000,
        file: minimalDoc,
      })),
    ],
    ...(emit ? { emit } : {}),
  });

  it("returns false for documents", () => {
    expect(isMultiOutputCapable(minimalDoc, { nested: false })).toBe(false);
  });

  it("returns false when emit is single (default)", () => {
    expect(isMultiOutputCapable(pipeline(2), { nested: false })).toBe(false);
  });

  it("returns false when nested even if emit is multi", () => {
    expect(isMultiOutputCapable(pipeline(2, 0, "multi"), { nested: true })).toBe(false);
  });

  it("returns false when only one output step", () => {
    expect(isMultiOutputCapable(pipeline(1, 0, "multi"), { nested: false })).toBe(false);
  });

  it("returns true for top-level pipeline + emit multi + >1 output step", () => {
    expect(isMultiOutputCapable(pipeline(2, 0, "multi"), { nested: false })).toBe(true);
  });

  it("ignores intermediate steps when counting output steps", () => {
    // 3 intermediate + 1 real → only 1 output step → not multi-capable
    expect(isMultiOutputCapable(pipeline(1, 3, "multi"), { nested: false })).toBe(false);
  });
});

describe("resolveStepName", () => {
  it("returns step.name when set", () => {
    expect(resolveStepName({ name: "desktop", durationMs: 1000, file: minimalDoc }, 0)).toBe("desktop");
  });

  it("falls back to step-{index} when name is absent", () => {
    expect(resolveStepName({ durationMs: 1000, file: minimalDoc }, 0)).toBe("step-0");
    expect(resolveStepName({ durationMs: 1000, file: minimalDoc }, 5)).toBe("step-5");
  });
});

// ───────────────────────── duration / timeline ─────────────────────────

const sized = (width: number, height: number): MosaicDocument => ({
  ...minimalDoc,
  size: { width, height },
});

/** Steps of the given durations, optionally fade-joined. */
const steps = (
  durationsMs: number[],
  opts: { fadeMs?: number; file?: MosaicDocument } = {},
) =>
  durationsMs.map((durationMs, i) => ({
    durationMs,
    file: opts.file ?? minimalDoc,
    ...(opts.fadeMs && i < durationsMs.length - 1
      ? { transitionToNext: { type: "fade" as const, durationMs: opts.fadeMs } }
      : {}),
  }));

const pipe = (
  p: Partial<MosaicDocumentPipeline> & Pick<MosaicDocumentPipeline, "steps">,
): MosaicDocumentPipeline => ({ kind: "mosaic_pipeline", version: 1, ...p });

describe("isValidPipelineDurationMs", () => {
  it("accepts positive integers", () => {
    expect(isValidPipelineDurationMs(1)).toBe(true);
    expect(isValidPipelineDurationMs(38000)).toBe(true);
  });

  it("rejects Infinity, NaN, zero, negatives and fractions", () => {
    expect(isValidPipelineDurationMs(Infinity)).toBe(false);
    expect(isValidPipelineDurationMs(-Infinity)).toBe(false);
    expect(isValidPipelineDurationMs(NaN)).toBe(false);
    expect(isValidPipelineDurationMs(0)).toBe(false);
    expect(isValidPipelineDurationMs(-1)).toBe(false);
    expect(isValidPipelineDurationMs(100.5)).toBe(false);
  });

  it("rejects non-numbers", () => {
    expect(isValidPipelineDurationMs("2000")).toBe(false);
    expect(isValidPipelineDurationMs(undefined)).toBe(false);
    expect(isValidPipelineDurationMs(null)).toBe(false);
  });
});

describe("sumPipelineDurations", () => {
  it("is a plain sum when no boundary overlaps", () => {
    expect(sumPipelineDurations([1000, 1000, 1000], [0, 0, 0])).toBe(3000);
  });

  it("subtracts each overlap once (out = A + B - d)", () => {
    expect(sumPipelineDurations([1000, 1000, 1000], [0, 400, 400])).toBe(2200);
  });

  it("treats a missing overlap entry as zero", () => {
    expect(sumPipelineDurations([1000, 1000], [])).toBe(2000);
  });
});

describe("resolvePipelineFit", () => {
  it("is a no-op when no duration is declared", () => {
    expect(resolvePipelineFit(3000, undefined)).toMatchObject({
      durationMs: 3000,
      action: "none",
    });
  });

  it("is a no-op when the declared duration is structurally invalid", () => {
    for (const bad of [Infinity, NaN, 0, -1, 100.5]) {
      expect(resolvePipelineFit(3000, bad)).toMatchObject({
        durationMs: 3000,
        action: "none",
      });
    }
  });

  it("is a no-op when declared equals natural (the stamped default)", () => {
    expect(resolvePipelineFit(3000, 3000)).toMatchObject({
      durationMs: 3000,
      declaredDurationMs: 3000,
      action: "none",
    });
  });

  it("trims the tail when declared is shorter — in every fit mode", () => {
    for (const fit of ["loop", "freeze", "cut"] as const) {
      expect(resolvePipelineFit(3000, 2200, fit)).toMatchObject({
        durationMs: 2200,
        action: "trim",
      });
    }
  });

  it("defaults a longer declared duration to loop (matching the nested default)", () => {
    expect(resolvePipelineFit(35550, 38000)).toMatchObject({
      durationMs: 38000,
      fit: "loop",
      action: "loop",
    });
  });

  it("pads when longer under freeze", () => {
    expect(resolvePipelineFit(35550, 38000, "freeze")).toMatchObject({
      durationMs: 38000,
      action: "pad",
    });
  });

  it("underruns when longer under cut — natural wins, nothing to fill with", () => {
    expect(resolvePipelineFit(35550, 38000, "cut")).toMatchObject({
      durationMs: 35550,
      declaredDurationMs: 38000,
      action: "underrun",
    });
  });

  it("never loops a zero-length pipeline", () => {
    expect(resolvePipelineFit(0, 5000, "loop")).toMatchObject({
      durationMs: 0,
      action: "none",
    });
  });
});

describe("computePipelineTimeline — natural duration", () => {
  it("returns null for documents and for output-step-less pipelines", () => {
    expect(computePipelineTimeline(minimalDoc)).toBeNull();
    expect(
      computePipelineTimeline(
        pipe({ steps: [{ intermediate: true, durationMs: 1000, file: minimalDoc }] }),
      ),
    ).toBeNull();
  });

  it("sums plain cut steps", () => {
    const t = computePipelineTimeline(pipe({ steps: steps([1000, 1000, 1000]) }))!;
    expect(t.naturalDurationMs).toBe(3000);
    expect(t.bands.map((b) => [b.startMs, b.endMs])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 3000],
    ]);
  });

  it("subtracts transition overlap — bands overlap on the track", () => {
    const t = computePipelineTimeline(
      pipe({ steps: steps([1000, 1000, 1000], { fadeMs: 400 }) }),
    )!;
    expect(t.naturalDurationMs).toBe(2200);
    expect(t.bands.map((b) => [b.startMs, b.endMs])).toEqual([
      [0, 1000],
      [600, 1600],
      [1200, 2200],
    ]);
    expect(t.bands.map((b) => b.overlapInMs)).toEqual([0, 400, 400]);
  });

  it("excludes intermediate steps from the total and the bands", () => {
    const t = computePipelineTimeline(
      pipe({
        steps: [
          { intermediate: true, durationMs: 5000, file: minimalDoc },
          { durationMs: 1000, file: minimalDoc },
          { durationMs: 1000, file: minimalDoc },
        ],
      }),
    )!;
    expect(t.naturalDurationMs).toBe(2000);
    // Band names keep their FULL-array index for engine parity.
    expect(t.bands.map((b) => b.name)).toEqual(["step-1", "step-2"]);
  });

  it("honours defaultTransition and lets transitionToNext override it", () => {
    const t = computePipelineTimeline(
      pipe({
        defaultTransition: { type: "fade", durationMs: 200 },
        steps: [
          { durationMs: 1000, file: minimalDoc, transitionToNext: { type: "cut" } },
          { durationMs: 1000, file: minimalDoc },
          { durationMs: 1000, file: minimalDoc },
        ],
      }),
    )!;
    // boundary 0 forced to cut, boundary 1 takes the 200ms default
    expect(t.bands.map((b) => b.overlapInMs)).toEqual([0, 0, 200]);
    expect(t.naturalDurationMs).toBe(2800);
  });
});

describe("computePipelineTimeline — degrade-to-cut paths", () => {
  it("drops an unknown xfade kernel", () => {
    const t = computePipelineTimeline(
      pipe({
        steps: [
          {
            durationMs: 1000,
            file: minimalDoc,
            transitionToNext: { type: "xfade", kind: "nope" as never, durationMs: 400 },
          },
          { durationMs: 1000, file: minimalDoc },
        ],
      }),
    )!;
    expect(t.naturalDurationMs).toBe(2000);
  });

  it("drops a non-finite or non-positive transition duration", () => {
    for (const bad of [0, -100, NaN, Infinity]) {
      const t = computePipelineTimeline(
        pipe({ steps: steps([1000, 1000], { fadeMs: bad }) }),
      )!;
      expect(t.naturalDurationMs).toBe(2000);
    }
  });

  it("drops a size-mismatched boundary (xfade needs equal dimensions)", () => {
    const t = computePipelineTimeline(
      pipe({
        steps: [
          {
            durationMs: 1000,
            file: sized(1920, 1080),
            transitionToNext: { type: "fade", durationMs: 400 },
          },
          { durationMs: 1000, file: sized(1080, 1920) },
        ],
      }),
    )!;
    expect(t.naturalDurationMs).toBe(2000);
  });

  it("uses targetSize for steps that declare no size of their own", () => {
    const mismatched = computePipelineTimeline(
      pipe({
        steps: [
          {
            durationMs: 1000,
            file: sized(1080, 1920),
            transitionToNext: { type: "fade", durationMs: 400 },
          },
          { durationMs: 1000, file: minimalDoc },
        ],
      }),
      { targetSize: { width: 1920, height: 1080 } },
    )!;
    expect(mismatched.naturalDurationMs).toBe(2000);
  });

  it("clamps the overlap to the shorter adjacent segment", () => {
    const t = computePipelineTimeline(
      pipe({ steps: steps([300, 1000], { fadeMs: 900 }) }),
    )!;
    // clamped to min(300, 1000) → 1300 - 300
    expect(t.bands[1].overlapInMs).toBe(300);
    expect(t.naturalDurationMs).toBe(1000);
  });

  it("drops EVERY transition past the concat-input ceiling", () => {
    const many = computePipelineTimeline(
      pipe({ steps: steps(Array(81).fill(100), { fadeMs: 50 }) }),
    )!;
    expect(many.naturalDurationMs).toBe(8100);
    expect(many.bands.every((b) => b.overlapInMs === 0)).toBe(true);

    const under = computePipelineTimeline(
      pipe({ steps: steps(Array(80).fill(100), { fadeMs: 50 }) }),
    )!;
    expect(under.naturalDurationMs).toBe(8000 - 79 * 50);
  });
});

describe("computePipelineTimeline — emit and nesting", () => {
  it("treats emit:multi as a plain sum with no overlaps", () => {
    const t = computePipelineTimeline(
      pipe({ emit: "multi", steps: steps([1000, 1000, 1000], { fadeMs: 400 }) }),
    )!;
    expect(t.emit).toBe("multi");
    expect(t.naturalDurationMs).toBe(3000);
    expect(t.bands.every((b) => b.overlapInMs === 0)).toBe(true);
  });

  it("ignores a declared durationMs under emit:multi (inert — no flattened result)", () => {
    const t = computePipelineTimeline(
      pipe({ emit: "multi", durationMs: 1000, steps: steps([500, 1000, 1000]) }),
    )!;
    expect(t.durationMs).toBe(2500);
    expect(t.action).toBe("none");
    expect(t.declaredDurationMs).toBeUndefined();
  });

  it("collapses emit:multi to single when nested", () => {
    const t = computePipelineTimeline(
      pipe({ emit: "multi", steps: steps([1000, 1000], { fadeMs: 400 }) }),
      { nested: true },
    )!;
    expect(t.emit).toBe("single");
    expect(t.naturalDurationMs).toBe(1600);
  });

  it("treats a single image-format step as multi (the Frame Stripper shape)", () => {
    const t = computePipelineTimeline(
      pipe({
        emit: "multi",
        steps: [
          {
            durationMs: 1000,
            file: { ...minimalDoc, format: { kind: "image" } } as MosaicDocument,
          },
        ],
      }),
    )!;
    expect(t.emit).toBe("multi");
  });

  it("derives a nested-pipeline step's length from the inner stitch, not its authored value", () => {
    const inner = pipe({ steps: steps([1000, 1000], { fadeMs: 400 }) });
    const t = computePipelineTimeline(
      pipe({
        steps: [
          // authored 9999 disagrees; the derived 1600 wins
          { durationMs: 9999, file: inner as never },
          { durationMs: 1000, file: minimalDoc },
        ],
      }),
    )!;
    expect(t.naturalDurationMs).toBe(2600);
  });

  it("uses a nested pipeline's FITTED duration when it declares one", () => {
    const inner = pipe({ durationMs: 5000, steps: steps([1000, 1000]) });
    const t = computePipelineTimeline(
      pipe({ steps: [{ durationMs: 2000, file: inner as never }] }),
    )!;
    expect(t.naturalDurationMs).toBe(5000);
  });
});

describe("computePipelineTimeline — the declared-duration fit", () => {
  it("leaves the stitch alone when declared equals natural", () => {
    const t = computePipelineTimeline(
      pipe({ durationMs: 2200, steps: steps([1000, 1000, 1000], { fadeMs: 400 }) }),
    )!;
    expect(t.naturalDurationMs).toBe(2200);
    expect(t.durationMs).toBe(2200);
    expect(t.action).toBe("none");
  });

  it("a trim drops bands past the cut and clips the straddling one", () => {
    const t = computePipelineTimeline(
      pipe({ durationMs: 2500, steps: steps([1000, 1000, 1000]) }),
    )!;
    expect(t.naturalDurationMs).toBe(3000);
    expect(t.durationMs).toBe(2500);
    expect(t.action).toBe("trim");
    expect(t.bands.map((b) => [b.startMs, b.endMs])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 2500], // clipped
    ]);
  });

  it("a trim that lands on a boundary drops the dead band entirely", () => {
    const t = computePipelineTimeline(
      pipe({ durationMs: 2000, steps: steps([1000, 1000, 1000]) }),
    )!;
    expect(t.bands).toHaveLength(2);
  });

  it("a freeze fill extends the final band and marks where the hold starts", () => {
    const t = computePipelineTimeline(
      pipe({ durationMs: 5000, durationFit: "freeze", steps: steps([1000, 1000]) }),
    )!;
    expect(t.action).toBe("pad");
    expect(t.bands).toHaveLength(2);
    expect(t.bands[1].endMs).toBe(5000);
    expect(t.bands[1].heldFromMs).toBe(2000);
  });

  it("a loop fill REPEATS the cycle so the bands tile the whole track", () => {
    // Natural 2000 looped to 5000 → laps at 0, 2000, 4000; the last is
    // clipped mid-cycle. Without this the 2000–5000 region has no band
    // and the scrubber reports the wrong step for most of the track.
    const t = computePipelineTimeline(
      pipe({ durationMs: 5000, steps: steps([1000, 1000]) }),
    )!;
    expect(t.action).toBe("loop");
    expect(t.bands.map((b) => [b.startMs, b.endMs, b.lap ?? 0])).toEqual([
      [0, 1000, 0],
      [1000, 2000, 0],
      [2000, 3000, 1],
      [3000, 4000, 1],
      [4000, 5000, 2],
    ]);
    // Bands tile [0, durationMs] with no gap.
    expect(t.bands[t.bands.length - 1].endMs).toBe(t.durationMs);
  });

  it("a looped band keeps its step identity, so the scrubber stays honest", () => {
    // The 6s/10s case from the desktop check: at 7.7s the render is back
    // on step 0, not still on step 2.
    const t = computePipelineTimeline(
      pipe({ durationMs: 10_000, steps: steps([2000, 2000, 2000]) }),
    )!;
    expect(stepIndexAtTime(t, 7700)).toBe(0);
    expect(stepIndexAtTime(t, 9000)).toBe(1);
    expect(stepIndexAtTime(t, 5000)).toBe(2);
  });

  it("honours durationFit", () => {
    const base = { durationMs: 5000, steps: steps([1000, 1000]) };
    expect(computePipelineTimeline(pipe({ ...base, durationFit: "freeze" }))!.action).toBe("pad");
    expect(computePipelineTimeline(pipe({ ...base, durationFit: "cut" }))!.action).toBe("underrun");
    expect(computePipelineTimeline(pipe({ ...base, durationFit: "cut" }))!.durationMs).toBe(2000);
  });

  it("ignores a structurally invalid declared duration", () => {
    const t = computePipelineTimeline(
      pipe({ durationMs: Infinity, steps: steps([1000, 1000]) }),
    )!;
    expect(t.durationMs).toBe(2000);
    expect(t.action).toBe("none");
  });
});

describe("computePipelineTimeline — the host duration override", () => {
  // Mirrors the planner's `options.durationMs` (CLI --durationMs / the
  // Make Duration field).
  const three = steps([1000, 1000, 1000]);

  it("re-times the step when there is exactly ONE output step", () => {
    const t = computePipelineTimeline(pipe({ steps: steps([1000]) }), {
      overrideDurationMs: 4000,
    })!;
    expect(t.naturalDurationMs).toBe(4000);
    expect(t.action).toBe("none");
    expect(t.bands[0].endMs).toBe(4000);
  });

  it("becomes the declared slot duration with MORE than one output step", () => {
    const t = computePipelineTimeline(pipe({ steps: three }), {
      overrideDurationMs: 2000,
    })!;
    expect(t.naturalDurationMs).toBe(3000); // steps untouched
    expect(t.durationMs).toBe(2000);
    expect(t.action).toBe("trim");
  });

  it("wins over an authored pipeline.durationMs", () => {
    const t = computePipelineTimeline(
      pipe({ durationMs: 9000, steps: three }),
      { overrideDurationMs: 2000 },
    )!;
    expect(t.durationMs).toBe(2000);
  });

  it("supersedes a stale authored durationMs when re-timing ONE output step", () => {
    // Regression: the render wrapper stamps the pipeline's NATURAL total
    // onto `pipeline.durationMs`. A later host override re-times the
    // single step, and the stale declared slot must not survive to fit —
    // with the default "loop" fit a 596.5s stamp + a 10s Duration field
    // looped the re-timed 10s window for ~60 laps (the metadata-stamp
    // batch templates declare emit:"multi" even for one input).
    const t = computePipelineTimeline(
      pipe({ emit: "multi", durationMs: 596500, steps: steps([596500]) }),
      { overrideDurationMs: 10000 },
    )!;
    expect(t.emit).toBe("single"); // one video output resolves single
    expect(t.naturalDurationMs).toBe(10000);
    expect(t.durationMs).toBe(10000);
    expect(t.action).toBe("none");
    expect(t.bands).toHaveLength(1);
    expect(t.bands[0].endMs).toBe(10000);
  });

  it("is ignored for nested pipelines — it addresses the outer deliverable", () => {
    const t = computePipelineTimeline(pipe({ steps: three }), {
      overrideDurationMs: 9000,
      nested: true,
    })!;
    expect(t.durationMs).toBe(3000);
  });

  it("ignores a structurally invalid override", () => {
    for (const bad of [Infinity, NaN, 0, -1]) {
      const t = computePipelineTimeline(pipe({ steps: three }), {
        overrideDurationMs: bad,
      })!;
      expect(t.durationMs).toBe(3000);
    }
  });
});

describe("stepIndexAtTime", () => {
  const timeline = computePipelineTimeline(
    pipe({ steps: steps([1000, 1000, 1000], { fadeMs: 400 }) }),
  )!;

  it("resolves a time inside a single band", () => {
    expect(stepIndexAtTime(timeline, 100)).toBe(0);
  });

  it("gives an overlap zone to the INCOMING step", () => {
    // bands 0 [0,1000] and 1 [600,1600] overlap on [600,1000]
    expect(stepIndexAtTime(timeline, 700)).toBe(1);
  });

  it("is end-inclusive on the final band", () => {
    expect(stepIndexAtTime(timeline, 2200)).toBe(2);
  });

  it("returns null outside the track", () => {
    expect(stepIndexAtTime(timeline, -1)).toBeNull();
    expect(stepIndexAtTime(timeline, 99999)).toBeNull();
  });
});
