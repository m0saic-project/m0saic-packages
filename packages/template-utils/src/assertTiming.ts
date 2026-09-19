import type {
    MosaicEngineContext,
    MosaicRenderableFile,
    MosaicDocument,
    MosaicDocumentPipeline,
  } from "@m0saic/types";
  import { computePipelineTimeline } from "@m0saic/types";

  export function assertTiming(
    file: MosaicRenderableFile,
    ctx: MosaicEngineContext,
    templateId: string
  ): void {
    const targetFps = ctx.target.fps;
    const targetDur = ctx.target.durationMs;

    if (file.kind === "mosaic_document") {
      const doc = file as MosaicDocument;
      const fps = doc.fps;
      const dur = doc.durationMs;

      if (fps !== targetFps) {
        throw new Error(
          `${templateId} must return MosaicDocument with fps matching ctx.target ` +
            `(got fps=${fps} expected fps=${targetFps})`
        );
      }
      // A document's durationMs may legitimately DIFFER from
      // ctx.target.durationMs: an authored duration is deliberate
      // (source-follow — subtitle-burn stamps the input's real length so a
      // feature film doesn't truncate to the 10s hint), the stamp preserves
      // it (stampDocOutput), and templates yield to explicit user intent
      // via ctx.userIntent before authoring. Assert only validity — the
      // same relaxation the pipeline fps branch below documents.
      if (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0) {
        throw new Error(
          `${templateId} must return MosaicDocument with a valid durationMs ` +
            `(got dur=${dur}; target was ${targetDur})`
        );
      }
      return;
    }

    // mosaic_pipeline
    const pipe = file as MosaicDocumentPipeline;
    const pipeFps = pipe.fps;

    // A pipeline's fps may legitimately DIFFER from ctx.target.fps: a
    // template that authors it did so deliberately (source-follow — e.g.
    // highlights sets it from the probed input so 60fps footage isn't
    // resampled to the default 30), and the stamp preserves that intent
    // (resolveStampedPipelineFps). Assert only validity; an explicit user
    // fps overrides downstream in the planner with a diagnostic.
    if (pipeFps !== undefined && !(Number.isFinite(pipeFps) && pipeFps > 0)) {
      throw new Error(
        `${templateId} returned mosaic_pipeline with invalid fps=${pipeFps} ` +
          `(expected a positive finite number or undefined)`
      );
    }

    // emit:multi pipelines are fan-outs — each step is its own output file,
    // so the "sum of step durations equals target" invariant doesn't apply.
    // Each step.durationMs is the per-file render length (typically equal
    // to ctx.target.durationMs across all steps). The invariant is only
    // load-bearing for emit:single (the concat path).
    if (pipe.emit === "multi") return;

    // The invariant is about what the pipeline STITCHES TO, not what its
    // steps add up to. A transition of d ms overlaps the two steps it
    // joins, so the concatenated output is
    // `Σ output-step durationMs − Σ overlap`. Asserting the plain sum
    // lets a cross-faded pipeline pass while rendering short of target
    // — which is exactly how the ffmpeg-pulse hero came to declare
    // 38000ms and render 35550ms. Intermediate steps are excluded here
    // too: they render but never reach the concat.
    const timeline = computePipelineTimeline(pipe, {
      targetSize: { width: ctx.target.width, height: ctx.target.height },
    });
    const stitchedMs = timeline?.naturalDurationMs ?? 0;

    // WHAT must it stitch to? The same authored-intent precedence the
    // document branch above and the output stamp already honour (gate 26 /
    // the gate-28 Q1 ruling: only an EXPLICIT ask pins duration):
    //   1. an explicit user pin (`ctx.userIntent.durationMs`) — the template
    //      had to honour it (resolvePinnedDurationMs), so the stitch must too;
    //   2. else the pipeline's own authored `durationMs` — a plan that
    //      computed its natural length (snippet-morph: states × timing) is
    //      deliberate, and the planner follows it (`pipeline.durationMs`);
    //      comparing against the HOST HINT here refused every render whose
    //      knobs didn't happen to sum to the outputHints default (gate 32);
    //   3. else the host-seeded target — the only expectation left.
    // In every case the check still catches the hero-class bug (declared
    // 38000ms, stitched 35550ms): declared and stitched must agree.
    const pinnedMs = ctx.userIntent?.durationMs;
    const pinned =
      typeof pinnedMs === "number" && Number.isFinite(pinnedMs) && pinnedMs > 0 ? pinnedMs : undefined;
    const authored =
      typeof pipe.durationMs === "number" && Number.isFinite(pipe.durationMs) && pipe.durationMs > 0
        ? pipe.durationMs
        : undefined;
    const expectedMs = pinned ?? authored ?? targetDur;
    const expectedLabel =
      pinned != null
        ? "the pinned ctx.userIntent.durationMs"
        : authored != null
          ? "its own declared durationMs"
          : "ctx.target.durationMs";

    if (stitchedMs !== expectedMs) {
      throw new Error(
        `${templateId} mosaic_pipeline must stitch to ${expectedLabel} ` +
          `(got ${stitchedMs} expected ${expectedMs}). The stitched length is ` +
          `Σ output-step durationMs − Σ transition overlap — a step that ` +
          `transitions out has to carry that overlap on top of its visible time.`
      );
    }
  }
