/**
 * @m0saic/story/narrated-chapters/v1 — the agentic-video flagship.
 *
 * A chaptered, narration-timed story pipeline: an upstream orchestrator
 * (see `examples/story-studio`) turns a topic into `story.json` + assets;
 * this template turns that manifest into one emit:"multi" pipeline with one
 * output step per aspect variant. Phase-2 state: structural skeleton with
 * placeholder colour scenes; card/body visuals, narration audio and
 * captions land in later phases.
 *
 * Time authority: the CLI make path passes no durationMs/fps to the
 * planner, `emit:"multi"` escapes assertTiming's stitched-length invariant,
 * and the output stamp preserves a template-declared pipeline durationMs —
 * so the story's length derives entirely from the manifest + probed
 * narration durations. `ctx.target` stays the sole authority for canvas
 * geometry and fps (its durationMs is only a default-5000ms hint and is
 * deliberately ignored).
 */

import { makeErrorMosaic, registerTemplate } from "@m0saic/template-utils";
import { asAssetId, asTemplateId } from "@m0saic/types";
import type { MosaicEngineContext, MosaicRenderableFile, MosaicTemplate } from "@m0saic/types";

import { serializeSrt } from "./captions";
import type { AbsoluteCue } from "./captions";
import { DEMO_STORY } from "./demo-fixture";
import { resolveTiming } from "./plan";
import type { StoryPlan } from "./plan";
import { coerceStoryProp, narratedChaptersPropsSchema, sniffBareStory, validateStoryShape } from "./props";
import type { NarratedChaptersProps, StoryDocument, StorySection } from "./props";
import { buildOuterPipeline } from "./pipeline";
import { focusFromOverrides } from "./scenes/body";
import type { MusicBed, SectionMedia } from "./scenes/body";
import { themeFromStory } from "./theme";

const TEMPLATE_ID = "@m0saic/story/narrated-chapters/v1";
const TEMPLATE_TITLE = "Narrated Chapters";

/** Demo storyMs: 3500 + 4×2000 + (3340+4820+4060+5780) + 3000 = 32500. */
const DEMO_DURATION_MS = 32500;

export type { NarratedChaptersProps };

export const NarratedChapters: MosaicTemplate<NarratedChaptersProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: TEMPLATE_TITLE,
  version: 1,
  description:
    "Chaptered, narration-timed story video from a story.json manifest — title/section cards, per-chapter scenes, and one deliverable per aspect (landscape/portrait) from a single invocation. Omit props for the built-in demo story.",
  capabilities: { tier: "core" },
  tags: ["media", "story", "chapters", "narrated", "pipeline", "agentic", "animated", "creators", "educators", "social", "voice-over", "explainer"],
  outputHints: {
    format: { kind: "video", container: "mp4" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: DEMO_DURATION_MS,
    note: "Duration derives from the story manifest (narration lengths), not from -t/--duration.",
  },
  propsSchema: narratedChaptersPropsSchema,
  defaultProps: {},
  async render(
    props: NarratedChaptersProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    const width = Math.max(1, Math.round(ctx.target.width));
    const height = Math.max(1, Math.round(ctx.target.height));
    const fail = (message: string): MosaicRenderableFile =>
      makeErrorMosaic(message, { width, height, title: TEMPLATE_TITLE });

    // The CLI calls render() directly — validateTemplateProps never runs on
    // that path, so the props schema is documentation and this is the gate.
    const coerced = coerceStoryProp(props?.story);
    if (coerced.errors.length > 0) return fail(coerced.errors.join("\n"));

    // `--props @story.json` passes the manifest AS the props bag — accept it
    // rather than silently rendering the demo over the user's story.
    const story: StoryDocument = coerced.story ?? sniffBareStory(props) ?? DEMO_STORY;
    const shapeErrors = validateStoryShape(story);
    if (shapeErrors.length > 0) return fail(shapeErrors.join("\n"));

    const timing = resolveTiming(story, {
      fps: ctx.target.fps,
      target: { width, height },
      // Registry keys are the RAW trimmed prop strings; never normalize.
      narrationDurationMs: (rawPath) => ctx.media[asAssetId(rawPath)]?.durationMs,
    });
    if ("error" in timing) return fail(timing.error);

    const media = resolveSectionMedia(story, ctx);
    if (typeof media === "string") return fail(media);

    const music: MusicBed | undefined =
      timing.plan.audio.musicPath !== undefined
        ? { path: timing.plan.audio.musicPath, assetKey: "music_bed" }
        : undefined;

    const pipeline = buildOuterPipeline(
      timing.plan,
      { width, height, fps: ctx.target.fps },
      themeFromStory(story),
      media,
      music,
    );
    attachCaptionsSidecar(pipeline, timing.plan);
    return pipeline;
  },
  sidecarsSchema: {
    captions: {
      type: "object",
      required: false,
      description:
        "Combined SubRip captions on the story timeline, written as {output-basename}.captions.srt next to the deliverable (cues are aspect-invariant, so one file serves every variant).",
    },
  },
};

/**
 * The combined .srt rides as a text sidecar on the FIRST variant's first
 * scene doc: the sidecar walker recurses nested pipelines and resolves an
 * inner step's base to the primary `-o` path, and cue timing is identical
 * across variants, so one attachment yields exactly one
 * `{basename}.captions.srt`.
 */
function attachCaptionsSidecar(pipeline: MosaicRenderableFile, plan: StoryPlan): void {
  const absolute: AbsoluteCue[] = [];
  for (const scene of plan.scenes) {
    for (const cue of scene.cues ?? []) {
      absolute.push({ startMs: scene.startMs + cue.startMs, endMs: scene.startMs + cue.endMs, text: cue.text });
    }
  }
  if (absolute.length === 0) return;
  const outer = pipeline as { steps?: Array<{ file?: { steps?: Array<{ file?: { sidecars?: unknown } }> } }> };
  const firstSceneDoc = outer.steps?.[0]?.file?.steps?.[0]?.file;
  if (firstSceneDoc === undefined) return;
  firstSceneDoc.sidecars = {
    captions: { kind: "text", ext: "srt", content: serializeSrt(absolute) },
  };
}

/**
 * Probe-verify every declared image against ctx.media and hand the scene
 * builders resolved keys. Fail fast (one message naming every problem +
 * the mediaPaths remedy) — a missing asset must never render as a black
 * tile. Asset keys are positional (`img_<section>_<index>`), so key
 * collisions are impossible by construction.
 */
function resolveSectionMedia(story: StoryDocument, ctx: MosaicEngineContext): SectionMedia[] | string {
  const sections: StorySection[] = Array.isArray(story.sections) ? story.sections : [];
  const problems: string[] = [];
  const resolved: SectionMedia[] = sections.map((section, i) => {
    const paths = Array.isArray(section.images)
      ? section.images.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    const images = paths.map((rawPath, k) => {
      const meta = ctx.media[asAssetId(rawPath.trim())];
      if (meta === undefined) {
        problems.push(
          `sections[${i}].images[${k}] ("${rawPath}") is not in ctx.media — this engine probes only top-level string/string[] props; run \`story-studio build\` so mediaPaths mirrors it.`,
        );
      } else if (meta.kind !== "image") {
        problems.push(
          `sections[${i}].images[${k}] ("${rawPath}") probed as ${meta.kind ?? "unknown"} — images must be stills in v1.`,
        );
      }
      return { path: rawPath.trim(), assetKey: `img_${i}_${k}` };
    });
    // Narration becomes a real audio source — the doc manifest is what the
    // engine probes for audio correctness (it recurses nested pipelines),
    // so this works even on routes where mediaPaths is absent.
    const narrationPath =
      typeof section.narrationAudio === "string" && section.narrationAudio.trim().length > 0
        ? section.narrationAudio.trim()
        : undefined;
    return {
      images,
      focus: focusFromOverrides(section.overrides, paths.length),
      ...(narrationPath !== undefined ? { narration: { path: narrationPath, assetKey: `nar_${i}` } } : {}),
    };
  });
  if (problems.length > 0) return problems.join("\n");
  return resolved;
}

registerTemplate(NarratedChapters);
