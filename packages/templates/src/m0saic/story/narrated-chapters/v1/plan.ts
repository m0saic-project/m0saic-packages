/**
 * resolveTiming — story → StoryPlan, the template's single source of time.
 *
 * The timing model (verbatim from the brief):
 *
 *   X    = min(xfadeMs, tailPadMs, floor(min(all visible durations) / 2))
 *
 *   title            visible = titleCardMs      xfadeOut = X
 *   for each i:
 *     s{i}-card      visible = sectionCardMs    xfadeOut = 0   ← CUT into narration
 *     s{i}-body      visible = max(minSectionMs, narrationMs_i + tailPadMs)
 *                                               xfadeOut = X
 *   outro            visible = outroMs          xfadeOut = 0
 *
 *   step.durationMs = visible + xfadeOut   (the step CARRIES its own overlap)
 *   storyMs         = Σ visible            (exact, INTEGER ms — a fractional
 *                                           declared durationMs is silently
 *                                           dropped by the output stamp)
 *   scene.startMs   = Σ_{j<k} visible_j
 *
 * The transition rule: a body step is never the B side of an xfade (its head
 * carries narration from t=0); it may be the A side because its last
 * X ≤ tailPadMs are padding. Cards cut into narration by design.
 *
 * narrationMs_i = overrides.durationMs (explicit wins) → probed audio
 * durationMs → FAIL FAST. A section with no narration at ALL is not an
 * error: it falls back to minSectionMs with a STORY_SECTION_NO_NARRATION
 * diagnostic.
 *
 * Pure and provenance-blind: reads nothing but the fields it names.
 */

import { DEFAULT_CAPTIONS, hamilton, resolveSectionCues } from "./captions";
import type { CaptionsConfig } from "./captions";
import { DEFAULT_STORY_DEFAULTS, MAX_SECTIONS } from "./props";
import type {
  StoryCue,
  StoryDocument,
  StoryOutputName,
  StorySection,
  StoryTimingDefaults,
} from "./props";

export { hamilton };

export type SceneKind = "title" | "section-card" | "body" | "outro";

/** One image's slot in a body scene, on the SCENE-LOCAL clock. */
export type SceneImageSlot = {
  /** Index into the section's `images` array. */
  imageIndex: number;
  startMs: number;
  /** Hamilton-distributed so Σ durations === the step's full length exactly. */
  durationMs: number;
};

export type StoryScene = {
  kind: SceneKind;
  /** Stable step slug: "title", "s0-card", "s0-body", …, "outro". */
  name: string;
  /** Present on section-card/body scenes. */
  sectionIndex?: number;
  sectionId?: string;
  /** Text the scene leads with (title text / section heading / outro line). */
  heading: string;
  /** Secondary line on title/outro cards (the story subtitle). */
  subheading?: string;
  /** Integer ms this scene owns on the timeline. */
  visibleMs: number;
  /** Integer ms of crossfade INTO the next scene (0 = hard cut). */
  xfadeOutMs: number;
  /** Σ of all previous scenes' visibleMs. */
  startMs: number;
  /** True when a body length came from the minSectionMs fallback. */
  noNarration?: boolean;
  /** Body scenes: dwell schedule over the step's FULL duration (visible + xfadeOut). */
  images?: SceneImageSlot[];
  /** Body scenes: cross-dissolve length for images after the first. */
  imageFadeMs?: number;
  /** Body scenes: resolved narration length (explicit or probed), ms. */
  narrationMs?: number;
  /** Body scenes: final caption cues, narration-relative (== step-local). */
  cues?: StoryCue[];
};

export const MOTION_EASES = ["linear", "smoothstep", "easeOut", "easeInOut"] as const;
export type MotionEase = (typeof MOTION_EASES)[number];

export type StoryMotionPlan = {
  seed: number;
  intensity: number;
  /** Drift ease — "linear" is the genre default (constant velocity). */
  ease: MotionEase;
};

export type StoryVariant = {
  name: StoryOutputName;
  width: number;
  height: number;
};

export type StoryAudioPlan = {
  narrationVolume: number;
  musicVolume: number;
  /** Raw music path string (the ctx.media key) — undefined = no music bed. */
  musicPath?: string;
  musicStartMs: number;
};

export type StoryPlan = {
  fps: number;
  /** Σ visible — integer, the length of every emitted deliverable. */
  storyMs: number;
  scenes: StoryScene[];
  variants: StoryVariant[];
  motion: StoryMotionPlan;
  captions: CaptionsConfig;
  audio: StoryAudioPlan;
  /** Non-fatal notes, e.g. STORY_SECTION_NO_NARRATION. */
  diagnostics: string[];
};

export type ResolveTimingOptions = {
  fps: number;
  target: { width: number; height: number };
  /**
   * Probed audio duration for a raw (trimmed) asset-path string, or
   * undefined when the path was never probed / has no duration.
   */
  narrationDurationMs: (rawPath: string) => number | undefined;
};

export type ResolveTimingResult = { plan: StoryPlan } | { error: string };

export function resolveTiming(
  story: StoryDocument,
  options: ResolveTimingOptions,
): ResolveTimingResult {
  const sections: StorySection[] = Array.isArray(story.sections) ? story.sections : [];
  if (sections.length === 0 || sections.length > MAX_SECTIONS) {
    return { error: `story.sections must contain 1–${MAX_SECTIONS} sections, got ${sections.length}.` };
  }

  const defaults: Required<StoryTimingDefaults> = {
    ...DEFAULT_STORY_DEFAULTS,
    ...pickTimingDefaults(story.defaults),
  };
  const diagnostics: string[] = [];

  // -- narration length per section (the load-bearing derivation) -----------
  const bodyVisible: number[] = [];
  const cardVisible: number[] = [];
  const noNarration: boolean[] = [];
  const narrationLen: Array<number | undefined> = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i] ?? {};
    const eff = { ...defaults, ...pickTimingDefaults(section.overrides) };
    cardVisible.push(Math.round(eff.sectionCardMs));
    noteDocumentLevelOverrides(section, i, diagnostics);
    const explicit = section.overrides?.durationMs;
    let narrationMs: number | undefined;
    if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
      narrationMs = explicit;
      // The override wins, but a large disagreement with the probed audio is
      // usually a stale manifest — say so instead of drifting silently.
      if (typeof section.narrationAudio === "string" && section.narrationAudio.trim().length > 0) {
        const probed = options.narrationDurationMs(section.narrationAudio.trim());
        if (probed !== undefined && Math.abs(probed - explicit) > 250) {
          diagnostics.push(
            `STORY_DURATION_OVERRIDE_DISAGREES: ${sectionLabel(section, i)} overrides.durationMs (${explicit} ms) disagrees with the probed narration (${Math.round(probed)} ms) by more than 250 ms — the override wins.`,
          );
        }
      }
    } else if (typeof section.narrationAudio === "string" && section.narrationAudio.trim().length > 0) {
      narrationMs = options.narrationDurationMs(section.narrationAudio.trim());
      if (narrationMs === undefined) {
        return { error: missingNarrationError(section, i) };
      }
    }
    narrationLen.push(narrationMs === undefined ? undefined : Math.round(narrationMs));
    if (narrationMs === undefined) {
      // No narration at all — legal; the section holds for minSectionMs.
      diagnostics.push(
        `STORY_SECTION_NO_NARRATION: ${sectionLabel(section, i)} has neither narrationAudio nor overrides.durationMs — holding for minSectionMs (${eff.minSectionMs} ms).`,
      );
      bodyVisible.push(Math.round(eff.minSectionMs));
      noNarration.push(true);
    } else {
      bodyVisible.push(Math.max(Math.round(eff.minSectionMs), Math.round(narrationMs + eff.narrationTailPadMs)));
      noNarration.push(false);
    }
  }

  const titleVisible = Math.round(defaults.titleCardMs);
  const outroVisible = Math.round(defaults.outroMs);

  // Fail fast on zero-length scenes: the engine hard-rejects a 0ms pipeline
  // step (PIPELINE_BAD_DURATION) and a 0 in the visible set would collapse X
  // to 0, silently deleting every crossfade — better to name the field here.
  if (titleVisible < 1) return { error: badDurationError("defaults.titleCardMs", titleVisible) };
  if (outroVisible < 1) return { error: badDurationError("defaults.outroMs", outroVisible) };
  for (let i = 0; i < sections.length; i++) {
    if (cardVisible[i] < 1) {
      return { error: badDurationError(`sections[${i}]'s effective sectionCardMs`, cardVisible[i]) };
    }
    if (bodyVisible[i] < 1) {
      return {
        error: `${sectionLabel(sections[i] ?? {}, i)}: resolves to a ${bodyVisible[i]} ms scene (no narration and minSectionMs too small). Every scene needs at least 1 ms.`,
      };
    }
  }

  const allVisible = [titleVisible, outroVisible, ...cardVisible, ...bodyVisible];
  const xfadeMs = Math.max(
    0,
    Math.min(
      Math.floor(defaults.xfadeMs),
      Math.floor(defaults.narrationTailPadMs),
      Math.floor(Math.min(...allVisible) / 2),
    ),
  );

  // -- scene list ------------------------------------------------------------
  const scenes: StoryScene[] = [];
  let startMs = 0;
  const push = (scene: Omit<StoryScene, "startMs">): void => {
    scenes.push({ ...scene, startMs });
    startMs += scene.visibleMs;
  };

  const captions = resolveCaptions(story);
  noteUnknownPlate(story, diagnostics);
  const audio = resolveAudio(story);
  // Interim advisory while the founder decides the mix-headroom rule: only
  // fires when a music bed actually exists (nothing can sum otherwise).
  if (audio.musicPath !== undefined && audio.narrationVolume + audio.musicVolume > 1) {
    diagnostics.push(
      `STORY_AUDIO_SUM: narrationVolume (${audio.narrationVolume}) + musicVolume (${audio.musicVolume}) exceeds 1.0 — the mixer sums with no limiter; simultaneous peaks may clip.`,
    );
  }
  const title = typeof story.title === "string" ? story.title : "Untitled story";
  const subtitle = typeof story.subtitle === "string" && story.subtitle.trim().length > 0 ? story.subtitle : undefined;

  push({
    kind: "title",
    name: "title",
    heading: title,
    ...(subtitle !== undefined ? { subheading: subtitle } : {}),
    visibleMs: titleVisible,
    xfadeOutMs: xfadeMs,
  });
  sections.forEach((section, i) => {
    const id = typeof section.id === "string" && section.id.trim().length > 0 ? section.id : `section-${i + 1}`;
    const heading =
      typeof section.title === "string" && section.title.trim().length > 0
        ? section.title
        : firstWords(section.narrationText, 6) ?? id;
    const eff = { ...defaults, ...pickTimingDefaults(section.overrides) };
    push({
      kind: "section-card",
      name: `s${i}-card`,
      sectionIndex: i,
      sectionId: id,
      heading,
      visibleMs: cardVisible[i],
      xfadeOutMs: 0, // hard cut — the narration's first word stays intact
    });
    if (typeof section.srt === "string" && section.srt.trim().length > 0 && !Array.isArray(section.cues)) {
      diagnostics.push(
        `STORY_SRT_NOT_INLINED: ${sectionLabel(section, i)} declares "srt" but no inlined "cues" — templates never read files; run \`story-studio build\` to inline the cues.`,
      );
    }
    push({
      kind: "body",
      name: `s${i}-body`,
      sectionIndex: i,
      sectionId: id,
      heading,
      visibleMs: bodyVisible[i],
      xfadeOutMs: xfadeMs,
      ...(noNarration[i] ? { noNarration: true } : {}),
      images: scheduleImages(section, i, bodyVisible[i] + xfadeMs, eff, diagnostics),
      imageFadeMs: Math.round(eff.imageFadeMs),
      ...(narrationLen[i] !== undefined ? { narrationMs: narrationLen[i] } : {}),
      cues: resolveSectionCues(section, narrationLen[i], captions),
    });
  });
  push({
    kind: "outro",
    name: "outro",
    heading: title,
    ...(subtitle !== undefined ? { subheading: subtitle } : {}),
    visibleMs: outroVisible,
    xfadeOutMs: 0, // final step — nothing to fade into
  });

  const storyMs = scenes.reduce((sum, s) => sum + s.visibleMs, 0);

  return {
    plan: {
      fps: options.fps,
      storyMs,
      scenes,
      variants: resolveVariants(story.outputs, options.target),
      motion: resolveMotion(story, diagnostics),
      captions,
      audio,
      diagnostics,
    },
  };
}

function resolveCaptions(story: StoryDocument): CaptionsConfig {
  const c = story.captions;
  return {
    enabled: typeof c?.enabled === "boolean" ? c.enabled : DEFAULT_CAPTIONS.enabled,
    minCueMs:
      typeof c?.minCueMs === "number" && Number.isFinite(c.minCueMs) && c.minCueMs >= 0
        ? Math.round(c.minCueMs)
        : DEFAULT_CAPTIONS.minCueMs,
    cueGapMs:
      typeof c?.cueGapMs === "number" && Number.isFinite(c.cueGapMs) && c.cueGapMs >= 0
        ? Math.round(c.cueGapMs)
        : DEFAULT_CAPTIONS.cueGapMs,
    plate: c?.plate === "never" ? "never" : "always",
  };
}

function noteUnknownPlate(story: StoryDocument, diagnostics: string[]): void {
  const plate = story.captions?.plate;
  if (plate !== undefined && plate !== "always" && plate !== "never") {
    diagnostics.push(
      `STORY_CAPTIONS_PLATE_UNKNOWN: captions.plate ${JSON.stringify(plate)} is not "always" or "never" — using "always".`,
    );
  }
}

function resolveAudio(story: StoryDocument): StoryAudioPlan {
  const a = story.audio;
  const vol = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  return {
    narrationVolume: vol(a?.narrationVolume, 1),
    musicVolume: vol(a?.musicVolume, 0.1),
    ...(typeof a?.music === "string" && a.music.trim().length > 0 ? { musicPath: a.music.trim() } : {}),
    musicStartMs:
      typeof a?.musicStartMs === "number" && Number.isFinite(a.musicStartMs) && a.musicStartMs >= 0
        ? Math.round(a.musicStartMs)
        : 0,
  };
}

function resolveMotion(story: StoryDocument, diagnostics: string[]): StoryMotionPlan {
  const motion = story.motion;
  const seed = typeof motion?.seed === "number" && Number.isFinite(motion.seed) ? Math.trunc(motion.seed) : 7;
  const intensity =
    typeof motion?.intensity === "number" && Number.isFinite(motion.intensity) && motion.intensity >= 0
      ? Math.min(motion.intensity, 2)
      : 1;
  let ease: MotionEase = "linear";
  if (motion?.ease !== undefined) {
    if ((MOTION_EASES as readonly string[]).includes(motion.ease as string)) {
      ease = motion.ease as MotionEase;
    } else {
      diagnostics.push(
        `STORY_MOTION_EASE_UNKNOWN: motion.ease ${JSON.stringify(motion.ease)} is not one of ${MOTION_EASES.join(", ")} — using "linear".`,
      );
    }
  }
  return { seed, intensity, ease };
}

/**
 * Images share the step's FULL duration D (including the crossfading tail,
 * so the dissolve never freezes) via Hamilton largest-remainder, so
 * Σ dwell === D exactly. Meff = min(M, max(1, floor(D / minImageDwellMs)));
 * dropped images and mismatched weight lists get named diagnostics, never
 * silence.
 */
export function scheduleImages(
  section: StorySection,
  sectionIndex: number,
  stepMs: number,
  eff: Required<StoryTimingDefaults>,
  diagnostics: string[],
): SceneImageSlot[] {
  const images = Array.isArray(section.images)
    ? section.images.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];
  const total = images.length;
  if (total === 0) return [];

  const minDwell = Math.max(1, Math.round(eff.minImageDwellMs));
  const effective = Math.min(total, Math.max(1, Math.floor(stepMs / minDwell)));
  if (effective < total) {
    diagnostics.push(
      `STORY_IMAGES_DROPPED: sections[${sectionIndex}] declares ${total} images but the scene (${stepMs} ms) fits only ${effective} at minImageDwellMs ${minDwell} — the last ${total - effective} are not shown.`,
    );
  }

  const rawWeights = section.overrides?.imageWeights;
  let weights: number[];
  if (Array.isArray(rawWeights) && rawWeights.length > 0) {
    if (rawWeights.length !== effective || !rawWeights.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0)) {
      diagnostics.push(
        `STORY_IMAGE_WEIGHTS_IGNORED: sections[${sectionIndex}].overrides.imageWeights must be ${effective} positive numbers (one per shown image); using equal weights.`,
      );
      weights = new Array(effective).fill(1);
    } else {
      weights = rawWeights;
    }
  } else {
    weights = new Array(effective).fill(1);
  }

  let durations = hamilton(stepMs, weights);
  // Extreme weight ratios can starve a slot to 0 ms (the engine rejects
  // zero-length anything). Degrade to equal weights, never silently.
  if (durations.some((d) => d < 1)) {
    diagnostics.push(
      `STORY_IMAGE_WEIGHTS_IGNORED: sections[${sectionIndex}].overrides.imageWeights are so extreme an image gets 0 ms; using equal weights.`,
    );
    durations = hamilton(stepMs, new Array(effective).fill(1));
  }
  const slots: SceneImageSlot[] = [];
  let startMs = 0;
  for (let k = 0; k < effective; k++) {
    slots.push({ imageIndex: k, startMs, durationMs: durations[k] });
    startMs += durations[k];
  }
  return slots;
}


/**
 * One deliverable per outputs entry. The requested canvas gives the base
 * geometry: the landscape cut uses (long × short), the portrait cut
 * (short × long) — so `-w 1920 -h 1080` yields 1920×1080 / 1080×1920.
 *
 * When `outputs` is omitted, the default variant ADOPTS the requested
 * canvas orientation (a bare `-w 1080 -h 1920` renders portrait) — the
 * absolute landscape/portrait names only re-orient when the manifest asks
 * for an aspect explicitly.
 */
export function resolveVariants(
  outputs: StoryOutputName[] | undefined,
  target: { width: number; height: number },
): StoryVariant[] {
  const long = Math.max(target.width, target.height);
  const short = Math.min(target.width, target.height);
  const dims: Record<StoryOutputName, { width: number; height: number }> = {
    landscape: { width: long, height: short },
    portrait: { width: short, height: long },
  };
  const requestedOrientation: StoryOutputName = target.height > target.width ? "portrait" : "landscape";
  const names: StoryOutputName[] = [];
  for (const o of Array.isArray(outputs) && outputs.length > 0 ? outputs : [requestedOrientation]) {
    if (!names.includes(o)) names.push(o);
  }
  return names.map((name) => ({ name, ...dims[name] }));
}

function pickTimingDefaults(bag: StoryTimingDefaults | undefined): StoryTimingDefaults {
  if (bag === undefined || bag === null || typeof bag !== "object") return {};
  const out: StoryTimingDefaults = {};
  for (const key of Object.keys(DEFAULT_STORY_DEFAULTS) as Array<keyof StoryTimingDefaults>) {
    const v = bag[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

/**
 * Per-section overrides accept any defaults key, but three of them are
 * structurally document-level in the v1 timing model (one title card, one
 * outro, one global X). Accepting-and-ignoring a typed knob is forbidden —
 * name the inert key instead. (minImageDwellMs / imageFadeMs are consumed
 * per-section by the Phase-4 image machinery, so they get no note here.)
 */
const DOCUMENT_LEVEL_OVERRIDE_KEYS = ["titleCardMs", "outroMs", "xfadeMs"] as const;

function noteDocumentLevelOverrides(
  section: StorySection,
  i: number,
  diagnostics: string[],
): void {
  const overrides = section.overrides;
  if (overrides === null || typeof overrides !== "object") return;
  for (const key of DOCUMENT_LEVEL_OVERRIDE_KEYS) {
    if (overrides[key] !== undefined) {
      diagnostics.push(
        `STORY_OVERRIDE_DOCUMENT_LEVEL: sections[${i}].overrides.${key} is ignored — "${key}" is document-level in v1; set story.defaults.${key} instead.`,
      );
    }
  }
}

function badDurationError(field: string, value: number): string {
  return `${field} resolves to ${value} ms — every scene needs at least 1 ms (zero-length scenes are not supported in v1).`;
}

function missingNarrationError(section: StorySection, i: number): string {
  return [
    `${sectionLabel(section, i)}: can't determine its length.`,
    `  narrationAudio = ${JSON.stringify(section.narrationAudio)}`,
    `  · not in ctx.media — this engine probes only TOP-LEVEL string/string[] props,`,
    `    so a path nested inside sections[] is never probed`,
    `  · and sections[${i}].overrides.durationMs is not set`,
    `Fix any one of:`,
    `  (a) run \`story-studio build <project>\` to regenerate props.json (emits mediaPaths)`,
    `  (b) set sections[${i}].overrides.durationMs to the clip length in ms`,
    `  (c) add the path to the top-level \`mediaPaths\` array`,
  ].join("\n");
}

function sectionLabel(section: StorySection, i: number): string {
  const name = typeof section.title === "string" && section.title.trim().length > 0 ? section.title : section.id;
  return typeof name === "string" && name.length > 0 ? `Section ${i} ("${name}")` : `Section ${i}`;
}

function firstWords(text: unknown, count: number): string | undefined {
  if (typeof text !== "string" || text.trim().length === 0) return undefined;
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}
