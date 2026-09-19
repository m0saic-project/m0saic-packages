/**
 * Props + story.json contract for @m0saic/story/narrated-chapters/v1.
 *
 * The template renders from a `story` manifest (the boundary artifact of the
 * agentic-video pipeline — see the internal agenticvideo notes
 * narrated-chapters.md`). The example orchestrator `examples/story-studio`
 * owns authoring-time validation (typo suggestions, path absolutization);
 * this file owns the RENDER-time contract: the CLI make path calls
 * `render()` directly, so the schema below is documentation and the
 * template must re-validate defensively.
 *
 * `provenance` is deliberately absent from everything below: it records how
 * the assets were generated and the renderer must never read it (the
 * determinism firewall).
 */

import { definePropsSchema } from "@m0saic/template-utils";

export const STORY_SCHEMA_VERSION = 1;

/**
 * The story renders as 2 + 2N pipeline steps and the engine drops every
 * xfade past 80 concat inputs; 30 sections (62 steps) leaves headroom.
 */
export const MAX_SECTIONS = 30;

export const STORY_OUTPUT_NAMES = ["landscape", "portrait"] as const;
export type StoryOutputName = (typeof STORY_OUTPUT_NAMES)[number];

export type StoryBrand = {
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
};

export type StoryTimingDefaults = {
  titleCardMs?: number;
  sectionCardMs?: number;
  outroMs?: number;
  xfadeMs?: number;
  narrationTailPadMs?: number;
  minSectionMs?: number;
  minImageDwellMs?: number;
  imageFadeMs?: number;
};

export const DEFAULT_STORY_DEFAULTS: Required<StoryTimingDefaults> = {
  titleCardMs: 3500,
  sectionCardMs: 2000,
  outroMs: 3000,
  xfadeMs: 600,
  narrationTailPadMs: 700,
  minSectionMs: 1500,
  minImageDwellMs: 2200,
  imageFadeMs: 500,
};

export type StorySectionOverrides = StoryTimingDefaults & {
  /** Explicit narration length — outranks the probed audio duration. */
  durationMs?: number;
  imageWeights?: number[];
  imageFocus?: Array<{ x: number; y: number }>;
  caption?: string;
};

/**
 * One caption cue, times relative to the SECTION'S NARRATION START (which
 * is step-local t=0 — cards cut INTO narration by design).
 */
export type StoryCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export type StorySection = {
  id?: string;
  title?: string;
  narrationText?: string;
  narrationAudio?: string;
  /**
   * SubRip path — AUTHORING-time input. Templates are pure (no fs):
   * `story-studio build` parses it and inlines `cues`; a template seeing
   * `srt` without `cues` emits a diagnostic, never reads the file.
   */
  srt?: string;
  /** Caption cues (narration-relative). Win over synthesized sentence cues. */
  cues?: StoryCue[];
  images?: string[];
  overrides?: StorySectionOverrides;
};

export type StoryAudio = {
  narrationVolume?: number;
  /** Music-bed volume (default 0.10 — amix sums with no limiter). */
  musicVolume?: number;
  /** Music-bed file, project-relative at authoring time (absolute in props.json). */
  music?: string;
  /** Offset into the music file where the story starts (default 0). */
  musicStartMs?: number;
};

export type StoryDocument = {
  schemaVersion?: number;
  title?: string;
  subtitle?: string;
  brand?: StoryBrand;
  defaults?: StoryTimingDefaults;
  motion?: { seed?: number; ease?: string; intensity?: number };
  captions?: { enabled?: boolean; minCueMs?: number; cueGapMs?: number; plate?: string };
  audio?: StoryAudio;
  outputs?: StoryOutputName[];
  sections?: StorySection[];
  [key: string]: unknown;
};

export type NarratedChaptersProps = {
  /**
   * The story manifest. `type:"json"` is validator-permissive by design —
   * the value may arrive as an object or a JSON string; render() parses and
   * shape-checks it. Omit for the built-in demo story.
   */
  story?: StoryDocument | string;
  /**
   * Flat probe mirror of every asset path inside `story` — the engine only
   * probes TOP-LEVEL string/string[] props, so nested paths need this
   * machine-generated twin (emitted by `story-studio build`, byte-identical
   * to the in-story strings; never hand-authored).
   */
  mediaPaths?: string[];
  /** Informational; shortens paths in error frames. */
  projectDir?: string;
};

export const narratedChaptersPropsSchema = definePropsSchema<NarratedChaptersProps>({
  story: {
    type: "json",
    required: false,
    description:
      "story.json manifest — { title, sections: [{ narrationText, narrationAudio?, images?, overrides? }], defaults?, brand?, outputs? }. Omit for the built-in demo story.",
    meta: { ui: { label: "Story manifest", order: 1 } },
  },
  mediaPaths: {
    type: "media[]",
    required: false,
    description:
      "Machine-generated flat mirror of every asset path in the story (run `story-studio build`); needed so narration durations are probed before render.",
    meta: { ui: { label: "Media paths", order: 2 } },
  },
  projectDir: {
    type: "string",
    required: false,
    description: "Story project folder (informational; used to shorten paths in diagnostics).",
    meta: { control: { placeholder: "none (full paths in diagnostics)" }, ui: { label: "Project folder", order: 3 } },
  },
});

/**
 * Parse the `story` prop into a StoryDocument. `type:"json"` props can
 * legally arrive as objects or JSON strings; anything else is an error.
 * `undefined`/`null` means "no story given" (demo mode) and is NOT an error.
 */
export function coerceStoryProp(raw: unknown): { story: StoryDocument | null; errors: string[] } {
  if (raw === undefined || raw === null) return { story: null, errors: [] };
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim().length === 0) return { story: null, errors: [] };
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return {
        story: null,
        errors: [`props.story is a string but not valid JSON — ${(e as Error).message}`],
      };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { story: null, errors: [`props.story must be a story object, got ${describe(value)}`] };
  }
  return { story: value as StoryDocument, errors: [] };
}

/**
 * Render-time structural gate (fail fast → error frame). Deliberately
 * narrower than story-studio's authoring validator: only what the renderer
 * needs to proceed safely. Collects every problem, not just the first.
 */
export function validateStoryShape(story: StoryDocument): string[] {
  const errors: string[] = [];
  if (story.schemaVersion !== undefined && story.schemaVersion !== STORY_SCHEMA_VERSION) {
    errors.push(
      `story.schemaVersion ${String(story.schemaVersion)} is unsupported (this template understands ${STORY_SCHEMA_VERSION}).`,
    );
  }
  const sections = story.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    errors.push(`story.sections must be a non-empty array of section objects.`);
  } else {
    if (sections.length > MAX_SECTIONS) {
      errors.push(
        `story.sections has ${sections.length} entries; the maximum is ${MAX_SECTIONS} (the pipeline concat wall sits at 80 steps).`,
      );
    }
    sections.forEach((section, i) => {
      if (typeof section !== "object" || section === null || Array.isArray(section)) {
        errors.push(`story.sections[${i}] must be an object, got ${describe(section)}.`);
        return;
      }
      // Blank/non-string image entries would silently shift imageFocus and
      // imageWeights indices after filtering — reject them instead.
      if (section.images !== undefined) {
        if (!Array.isArray(section.images)) {
          errors.push(`story.sections[${i}].images must be an array of path strings.`);
        } else {
          section.images.forEach((img, k) => {
            if (typeof img !== "string" || img.trim().length === 0) {
              errors.push(`story.sections[${i}].images[${k}] must be a non-empty path string, got ${describe(img)}.`);
            }
          });
        }
      }
      validateCueShape(section.cues, i, errors);
    });
  }
  if (story.audio !== undefined && story.audio !== null && typeof story.audio === "object") {
    if (story.audio.music !== undefined && (typeof story.audio.music !== "string" || story.audio.music.trim().length === 0)) {
      errors.push(`story.audio.music must be a non-empty path string.`);
    }
    if (
      story.audio.musicStartMs !== undefined &&
      !(typeof story.audio.musicStartMs === "number" && Number.isFinite(story.audio.musicStartMs) && story.audio.musicStartMs >= 0)
    ) {
      errors.push(`story.audio.musicStartMs must be a number of milliseconds ≥ 0.`);
    }
  }
  if (story.outputs !== undefined) {
    if (!Array.isArray(story.outputs)) {
      errors.push(`story.outputs must be an array; valid values: ${STORY_OUTPUT_NAMES.join(", ")}.`);
    } else {
      story.outputs.forEach((o, i) => {
        if (!(STORY_OUTPUT_NAMES as readonly string[]).includes(o as string)) {
          errors.push(
            `story.outputs[${i}] is ${JSON.stringify(o)}; valid values: ${STORY_OUTPUT_NAMES.map((n) => `"${n}"`).join(", ")}.`,
          );
        }
      });
    }
  }
  return errors;
}

/**
 * Recognize a bare story document passed AS the props bag. `--props
 * @story.json` hands the CLI the manifest itself, so `props.story` is
 * undefined — without this sniff the render silently fell back to the demo
 * (the worst outcome: a wrong video with zero diagnostics). A bag with a
 * `sections` array and no `story` key IS the story; validateStoryShape
 * still gates it fully afterwards.
 */
export function sniffBareStory(props: unknown): StoryDocument | null {
  if (typeof props !== "object" || props === null || Array.isArray(props)) return null;
  const bag = props as Record<string, unknown>;
  if (bag.story !== undefined) return null;
  if (!Array.isArray(bag.sections)) return null;
  return bag as StoryDocument;
}

/** Same monotonic non-overlap rule the orchestrator enforces — defensive twin. */
function validateCueShape(cues: unknown, sectionIndex: number, errors: string[]): void {
  if (cues === undefined) return;
  if (!Array.isArray(cues)) {
    errors.push(`story.sections[${sectionIndex}].cues must be an array of { startMs, endMs, text }.`);
    return;
  }
  let prevEnd = -1;
  cues.forEach((cue, k) => {
    const c = cue as { startMs?: unknown; endMs?: unknown; text?: unknown };
    const ok =
      typeof cue === "object" &&
      cue !== null &&
      typeof c.startMs === "number" &&
      Number.isFinite(c.startMs) &&
      c.startMs >= 0 &&
      typeof c.endMs === "number" &&
      Number.isFinite(c.endMs) &&
      (c.endMs as number) > (c.startMs as number) &&
      typeof c.text === "string" &&
      c.text.trim().length > 0;
    if (!ok) {
      errors.push(
        `story.sections[${sectionIndex}].cues[${k}] must be { startMs ≥ 0, endMs > startMs, text } (narration-relative ms).`,
      );
      return;
    }
    if ((c.startMs as number) < prevEnd) {
      errors.push(
        `story.sections[${sectionIndex}].cues[${k}] starts before the previous cue ends — cues must be ordered and non-overlapping.`,
      );
    }
    prevEnd = c.endMs as number;
  });
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}
