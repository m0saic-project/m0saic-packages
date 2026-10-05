/**
 * @m0saic/story/narrated-chapters/v2 — the agentic-video flagship.
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

import { definePropsSchema, makeErrorMosaic, registerTemplate, type PropBindingEntry } from "@m0saic/template-utils";
import { asAssetId, asTemplateId } from "@m0saic/types";
import type { MosaicDocument, MosaicEngineContext, MosaicRenderableFile, MosaicSource, MosaicTemplate } from "@m0saic/types";

import { labelOf, withAddHandles } from "../../../_shared/canvas-handles";

import { serializeSrt } from "../v1/captions";
import type { AbsoluteCue } from "../v1/captions";
import { DEMO_STORY } from "../v1/demo-fixture";
import { resolveTiming } from "../v1/plan";
import type { StoryPlan } from "../v1/plan";
import { coerceStoryProp, sniffBareStory, validateStoryShape } from "../v1/props";
import type { NarratedChaptersProps, StoryDocument, StorySection } from "../v1/props";
import { buildOuterPipeline } from "../v1/pipeline";
import { focusFromOverrides } from "../v1/scenes/body";
import type { MusicBed, SectionMedia } from "../v1/scenes/body";
import { themeFromStory } from "../v1/theme";

const TEMPLATE_ID = "@m0saic/story/narrated-chapters/v2";
const TEMPLATE_TITLE = "Narrated Chapters";

/** Demo storyMs: 3500 + 4×2000 + (3340+4820+4060+5780) + 3000 = 32500. */
const DEMO_DURATION_MS = 32500;

export type { NarratedChaptersProps };

// What each value IS. Its label and hint live in narrated-chapters.catalog.json
// beside this file (0.3.1).
const propsSchema = definePropsSchema<NarratedChaptersProps>({
  story: { type: "json", required: false },
  mediaPaths: { type: "media[]", required: false },
  projectDir: { type: "string", required: false },
});

/** Is this the seeded demo manifest (hosts clone default props, so compare by value)? */
const DEMO_STORY_JSON = JSON.stringify(DEMO_STORY);
function isSeededDemo(story: unknown): boolean {
  if (story === DEMO_STORY) return true;
  if (typeof story !== "object" || story === null) return false;
  try {
    return JSON.stringify(story) === DEMO_STORY_JSON;
  } catch {
    return false;
  }
}

/**
 * v2: the story's own words and colours, on the rects that show them. Every
 * handle is a LEAF of the `story` manifest (path + kind — a structured prop):
 *
 *  - the title and outro cards: `title` on the heading, `subtitle` on the line
 *    under it;
 *  - a section card: that section's `title` on the heading; the PART kicker
 *    (derived text) carries the accent colour it is drawn in;
 *  - a chapter's captions: that section's `narrationText` — unless the section
 *    brings its own `cues`, which are timed lines, not one string;
 *  - headings and captions also carry the ink (`brand.textColor`).
 *
 * Images are NOT handles: a dropped file would write a path the host never
 * probed (the engine probes top-level props only — `mediaPaths` is that
 * mirror), and the render refuses an unprobed image.
 *
 * Edits in place, after the pipeline is built; never touches paint.
 */
function bindStoryHandles(pipeline: MosaicRenderableFile, plan: StoryPlan, story: StoryDocument): void {
  const leaf = (path: Array<string | number>, kind: "string" | "color"): PropBindingEntry => ({ propKey: "story", path, kind });
  const ink = leaf(["brand", "textColor"], "color");
  const accent = leaf(["brand", "accentColor"], "color");
  const sections: StorySection[] = Array.isArray(story.sections) ? story.sections : [];
  const byLabel = new Map<string, PropBindingEntry[]>();
  for (const scene of plan.scenes) {
    const i = scene.sectionIndex;
    if (scene.kind === "title" || scene.kind === "outro") {
      byLabel.set(`${scene.name}/heading`, [leaf(["title"], "string"), ink]);
      byLabel.set(`${scene.name}/sub`, [leaf(["subtitle"], "string")]);
    } else if (scene.kind === "section-card" && i !== undefined) {
      byLabel.set(`${scene.name}/heading`, [leaf(["sections", i, "title"], "string"), ink]);
      byLabel.set(`${scene.name}/kicker`, [accent]);
    } else if (scene.kind === "body" && i !== undefined && sections[i]?.cues === undefined) {
      byLabel.set(`${scene.name}/captions`, [leaf(["sections", i, "narrationText"], "string"), ink]);
    }
  }
  const variants = (pipeline as { steps?: Array<{ file?: { steps?: Array<{ file?: MosaicDocument }> } }> }).steps ?? [];
  for (const variant of variants) {
    for (const step of variant.file?.steps ?? []) {
      for (const source of (step.file?.sources ?? []) as MosaicSource[]) {
        const entries = byLabel.get(labelOf(source) ?? "");
        if (entries) withAddHandles(source, entries);
      }
    }
  }
}

export const NarratedChaptersV2: MosaicTemplate<NarratedChaptersProps> = {
  id: asTemplateId(TEMPLATE_ID),
  version: 2,
  capabilities: { tier: "core" },
  outputHints: {
    format: { kind: "video", container: "mp4" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: DEMO_DURATION_MS,
    note: "Duration derives from the story manifest (narration lengths), not from -t/--duration.",
    // Mid title card (3.5 s): the story's title, settled.
    posterTimeMs: 1750,
  },
  propsSchema,
  bindings: {
    unbound: {
      mediaPaths: "probe mirror (machine-generated by `story-studio build`)",
      projectDir: "informational (shortens paths in diagnostics)",
    },
  },
  // v2 SEEDS the form with the demo manifest instead of leaving it empty: the
  // render is the same (v1 fell back to this very story), but a card's text is
  // now a leaf of a real value — so editing it on the canvas edits the story,
  // instead of creating a one-field manifest that fails validation.
  defaultProps: { story: DEMO_STORY },
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
    // rather than silently rendering the demo over the user's story. In v2
    // that bag arrives beside the SEEDED demo (hosts merge the defaults in),
    // so a bag with its own `sections` outranks a `story` that is only the seed.
    const bag = (props ?? {}) as Record<string, unknown>;
    const bare =
      props?.story === undefined || isSeededDemo(props.story)
        ? sniffBareStory({ ...bag, story: undefined })
        : null;
    const story: StoryDocument = bare ?? coerced.story ?? DEMO_STORY;
    // Handles are leaves of `props.story` — only when the story IS that prop,
    // as an object (a JSON string or a bare bag has no leaf a host can write).
    const storyIsTheProp = bare === null && typeof props?.story === "object" && props.story !== null;
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
    if (storyIsTheProp) bindStoryHandles(pipeline, timing.plan, story);
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

registerTemplate(NarratedChaptersV2);
