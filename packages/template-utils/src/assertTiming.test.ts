import { assertTiming } from "./assertTiming";
import { toM0String } from "@m0saic/dsl-stdlib";
import type {
  MosaicEngineContext,
  MosaicDocument,
  MosaicDocumentPipeline,
} from "@m0saic/types";

function makeCtx(durationMs: number, fps = 30): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps,
      durationMs,
    },
    output: {
      width: 1920,
      height: 1080,
      fps,
      durationMs,
      workspaceDir: "/tmp",
    },
    media: {},
    cache: ({
      get: () => undefined,
      set: () => {},
      getOrCompute: async (_k: string, fn: () => any) => fn(),
    } as any),
  };
}

describe("assertTiming", () => {
  const ctx = makeCtx(3000, 30);
  const templateId = "TestTemplate";

  test("passes for valid mosaic_document", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: toM0String("F", "test"),
      sources: [] as any, fps: 30 as any, durationMs: 3000 as any ,
    };

    expect(() => assertTiming(doc, ctx, templateId)).not.toThrow();
  });

  test("throws for mosaic_document with wrong fps (duration may differ — authored)", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: toM0String("F", "test"),
      sources: [] as any, fps: 24 as any, durationMs: 2000 as any ,
    };

    expect(() => assertTiming(doc, ctx, templateId)).toThrow(
      /MosaicDocument with fps matching/
    );
  });

  test("gate-26: authored durationMs differing from target is VALID; invalid duration throws", () => {
    const base = {
      kind: "mosaic_document" as const,
      version: 1 as const,
      assets: {} as any,
      m0: toM0String("F", "test"),
      sources: [] as any,
      fps: ctx.target.fps as any,
    };
    // Source-follow: a doc that authored 596s against a 5s target passes.
    expect(() =>
      assertTiming({ ...base, durationMs: 596000 as any }, ctx, templateId),
    ).not.toThrow();
    // But a missing/invalid duration still fails loud.
    expect(() =>
      assertTiming({ ...base, durationMs: 0 as any }, ctx, templateId),
    ).toThrow(/valid durationMs/);
  });

  test("passes for valid mosaic_pipeline", () => {
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      fps: 30 ,
      steps: [
        { durationMs: 1000, ref: "a" },
        { durationMs: 2000, ref: "b" },
      ],
    };

    expect(() => assertTiming(pipe, ctx, templateId)).not.toThrow();
  });

  test("allows mosaic_pipeline fps differing from target (authored source-follow)", () => {
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      fps: 60,
      steps: [{ durationMs: 3000, ref: "a" }],
    };

    expect(() => assertTiming(pipe, ctx, templateId)).not.toThrow();
  });

  test("throws if mosaic_pipeline fps is invalid", () => {
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      fps: 0 as never,
      steps: [{ durationMs: 3000, ref: "a" }],
    };

    expect(() => assertTiming(pipe, ctx, templateId)).toThrow(/invalid fps/);
  });

  test("throws if mosaic_pipeline step durations do not sum", () => {
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      fps: 30 ,
      steps: [
        { durationMs: 1000, ref: "a" },
        { durationMs: 1000, ref: "b" },
      ],
    };

    expect(() => assertTiming(pipe, ctx, templateId)).toThrow(/must stitch to/);
  });

  test("counts transition OVERLAP against the target, not the plain sum", () => {
    // 1500 + 1500 joined by a 500ms crossfade stitches to 2500, not
    // 3000 — the overlap is consumed once. The plain-sum check passed
    // this shape while the render came out 500ms short.
    const overlapping: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      fps: 30,
      steps: [
        {
          durationMs: 1500,
          ref: "a",
          transitionToNext: { type: "fade", durationMs: 500 },
        },
        { durationMs: 1500, ref: "b" },
      ],
    };
    expect(() => assertTiming(overlapping, ctx, templateId)).toThrow(
      /must stitch to .*got 2500 expected 3000/s,
    );

    // Carrying the overlap on the outgoing step lands it exactly.
    const corrected: MosaicDocumentPipeline = {
      ...overlapping,
      steps: [
        {
          durationMs: 2000,
          ref: "a",
          transitionToNext: { type: "fade", durationMs: 500 },
        },
        { durationMs: 1500, ref: "b" },
      ],
    };
    expect(() => assertTiming(corrected, ctx, templateId)).not.toThrow();
  });

  test("excludes intermediate steps from the stitched length", () => {
    // An intermediate step renders (it publishes variables) but never
    // reaches the concat, so it must not count toward the target.
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      fps: 30,
      steps: [
        { durationMs: 9000, ref: "fetcher", intermediate: true },
        { durationMs: 3000, ref: "a" },
      ],
    };
    expect(() => assertTiming(pipe, ctx, templateId)).not.toThrow();
  });

  test("SKIPS the sum-of-steps check under emit:multi (fan-out fixtures)", () => {
    // emit:multi templates produce N independent output files; each
    // step.durationMs is the per-file length, not a slice of a concat
    // target. Three 3000ms steps with ctx.target.durationMs=3000 is a
    // legitimate fan-out (3 files × 3s each), and would have failed the
    // sum check (9000 != 3000) before this gate.
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      fps: 30,
      steps: [
        { durationMs: 3000, ref: "a" },
        { durationMs: 3000, ref: "b" },
        { durationMs: 3000, ref: "c" },
      ],
    };

    expect(() => assertTiming(pipe, ctx, templateId)).not.toThrow();
  });

  test("emit:multi allows an authored fps differing from target (source-follow)", () => {
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      fps: 24,
      steps: [{ durationMs: 3000, ref: "a" }],
    };

    expect(() => assertTiming(pipe, ctx, templateId)).not.toThrow();
  });
});

describe("assertTiming — pipeline duration follows authored intent (gate 32)", () => {
  const templateId = "@test/pipe";
  const pipe = (durationMs: number | undefined, stepMs: number[]): MosaicDocumentPipeline =>
    ({
      kind: "mosaic_pipeline",
      version: 1,
      fps: 30,
      ...(durationMs != null ? { durationMs } : {}),
      steps: stepMs.map((ms, i) => ({ durationMs: ms, ref: `s${i}` })),
    }) as MosaicDocumentPipeline;

  test("an AUTHORED pipeline duration that differs from the host hint is valid when it matches the stitch", () => {
    // snippet-morph: 2 states × (400 + 600) = 2000ms authored; the hint said 7500.
    expect(() => assertTiming(pipe(2000, [1000, 1000]), makeCtx(7500), templateId)).not.toThrow();
  });

  test("declared ≠ stitched still throws (the hero-class bug), unpinned", () => {
    expect(() => assertTiming(pipe(38000, [20000, 15550]), makeCtx(38000), templateId)).toThrow(
      /must stitch to its own declared durationMs \(got 35550 expected 38000\)/,
    );
  });

  test("an explicit user pin wins: the stitch must match the pin, not the authored length", () => {
    const ctx = { ...makeCtx(7500), userIntent: { durationMs: 10000 } } as MosaicEngineContext;
    expect(() => assertTiming(pipe(2000, [1000, 1000]), ctx, templateId)).toThrow(
      /must stitch to the pinned ctx.userIntent.durationMs \(got 2000 expected 10000\)/,
    );
    expect(() => assertTiming(pipe(10000, [5000, 5000]), ctx, templateId)).not.toThrow();
  });

  test("no authored duration and no pin → the host target is the expectation (unchanged)", () => {
    expect(() => assertTiming(pipe(undefined, [1000, 2000]), makeCtx(3000), templateId)).not.toThrow();
    expect(() => assertTiming(pipe(undefined, [1000, 1000]), makeCtx(3000), templateId)).toThrow(/must stitch to ctx.target.durationMs/);
  });
});
