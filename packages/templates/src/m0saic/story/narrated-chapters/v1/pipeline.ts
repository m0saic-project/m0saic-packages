/**
 * Pipeline assembly — the structural core of the template.
 *
 * OUTER: emit:"multi", one step per output VARIANT (aspect). Authored
 * emit:"multi" escapes assertTiming's stitched-length invariant, which is
 * what makes narration-derived duration legal. One variant collapses to the
 * bare `-o` path (no concat is planned for a single video output step); two
 * variants fan out to `<out>-landscape.mp4` / `<out>-portrait.mp4`.
 *
 * INNER: one emit:"single" story pipeline per variant, at that variant's
 * own canvas. Scenes are plain builders (scenes/card.ts, scenes/body.ts) —
 * pure functions, not registered subtemplates; each pipeline STEP is its
 * own ffmpeg command, so every scene gets a fresh overlay-depth budget.
 *
 * ⚠ Stamp hazard (the reason for every seemingly redundant field below):
 * `stampStepInlineDoc` treats a step's `file` like a document — it writes
 * `size: doc.size ?? outerTarget`, `fps: doc.fps ?? src.fps`, and
 * `durationMs: step.durationMs` UNCONDITIONALLY, and it does NOT recurse
 * into inner steps. So the nested pipeline MUST self-declare `size`/`fps`/
 * `durationMs` (an undeclared size silently renders the portrait cut at the
 * landscape canvas), every outer `step.durationMs` MUST equal the nested
 * natural length (the default durationFit is "loop" — a mismatch loops or
 * trims the entire video), and every scene doc self-declares all three too.
 * `durationFit:"cut"` at both levels makes any drift underrun VISIBLY
 * rather than loop silently. `plan.storyMs` is a positive integer by
 * construction — `isValidPipelineDurationMs` rejects fractional values and
 * the declaration would be silently dropped.
 */

import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicPipelineStep,
} from "@m0saic/types";

import type { StoryPlan, StoryScene, StoryVariant } from "./plan";
import { buildBodyDoc } from "./scenes/body";
import type { MusicBed, SectionMedia } from "./scenes/body";
import { buildCardDoc } from "./scenes/card";
import type { StoryTheme } from "./theme";

export type StoryRenderTarget = {
  width: number;
  height: number;
  fps: number;
};

/** Dispatch one scene to its builder. */
export function buildSceneDoc(
  scene: StoryScene,
  variant: StoryVariant,
  plan: StoryPlan,
  theme: StoryTheme,
  media: SectionMedia[],
  music?: MusicBed,
): MosaicDocument {
  if (scene.kind === "body") {
    const sectionMedia = scene.sectionIndex !== undefined ? media[scene.sectionIndex] : undefined;
    return buildBodyDoc(scene, sectionMedia, variant, plan, theme, music);
  }
  return buildCardDoc(scene, variant, plan, theme, music);
}

/** The INNER pipeline — the whole story at one variant's canvas. */
export function buildStoryPipeline(
  plan: StoryPlan,
  variant: StoryVariant,
  theme: StoryTheme,
  media: SectionMedia[],
  music?: MusicBed,
): MosaicDocumentPipeline {
  const steps: MosaicPipelineStep[] = plan.scenes.map((scene) => ({
    name: scene.name,
    label: scene.name,
    // The step CARRIES its own overlap: durationMs = visible + xfadeOut, so
    // the stitched natural length is Σ visible === storyMs exactly.
    durationMs: scene.visibleMs + scene.xfadeOutMs,
    file: buildSceneDoc(scene, variant, plan, theme, media, music),
    ...(scene.xfadeOutMs > 0
      ? { transitionToNext: { type: "fade" as const, durationMs: scene.xfadeOutMs } }
      : {}),
  }));
  return {
    kind: "mosaic_pipeline",
    version: 1,
    emit: "single", // explicit — never rely on the nested-emit downgrade
    size: { width: variant.width, height: variant.height }, // MANDATORY (stamp hazard)
    fps: plan.fps, // MANDATORY
    durationMs: plan.storyMs, // MANDATORY — equals the stitched natural
    durationFit: "cut", // drift underruns VISIBLY, never silently loops
    defaultTransition: { type: "cut" },
    backgroundColor: theme.canvas,
    steps,
  };
}

/** The OUTER pipeline — one output step per variant. */
export function buildOuterPipeline(
  plan: StoryPlan,
  target: StoryRenderTarget,
  theme: StoryTheme,
  media: SectionMedia[],
  music?: MusicBed,
): MosaicDocumentPipeline {
  return {
    kind: "mosaic_pipeline",
    version: 1,
    emit: "multi", // escapes the stitched-length invariant (assertTiming)
    fps: target.fps, // must equal ctx.target.fps
    size: { width: target.width, height: target.height },
    durationMs: plan.storyMs, // preserved by the stamp as authoring intent
    durationFit: "cut",
    // Templates have no first-class warning channel; parking the STORY_*
    // diagnostics on meta.note makes them inspectable via --save-mosaic
    // instead of vanishing (a proper surface is an open engine question).
    ...(plan.diagnostics.length > 0 ? { meta: { note: plan.diagnostics.join("\n") } } : {}),
    steps: plan.variants.map((variant) => ({
      name: variant.name, // → <out>-landscape.mp4 / <out>-portrait.mp4
      label: variant.name,
      durationMs: plan.storyMs, // MUST equal the nested natural
      // The step type says MosaicDocument; the planner dispatches on
      // file.kind === "mosaic_pipeline" at runtime — same cast the engine
      // itself uses for nested pipelines.
      file: buildStoryPipeline(plan, variant, theme, media, music) as unknown as MosaicDocument,
    })),
  };
}
