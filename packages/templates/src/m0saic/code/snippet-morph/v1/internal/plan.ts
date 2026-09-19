/** Pure state → diff/motion → pipeline-step planning for snippet-morph v1. */

import {
  coalesceFadeUnits,
  groupMotionUnits,
  lcsDiffLines,
  type CoalescedMotionPlan,
  type LineOp,
  type MotionUnit,
} from "../../../_shared/code-diff";
import {
  lexTsJs,
  type CodeLanguage,
  type LexedCodeState,
} from "../../../_shared/code-lexer";

export interface MorphTimingKnobs {
  morphMs: number;
  holdMs: number;
  leadMs: number;
  trailMs: number;
}

export const DEFAULT_MORPH_TIMING: MorphTimingKnobs = {
  morphMs: 750,
  holdMs: 3000,
  leadMs: 0,
  trailMs: 0,
};

/** Maximum independently animated code rasters in one transition document. */
export const MAX_ANIMATED_UNITS = 16;

export interface TimeWindowMs {
  /** Step-local start, inclusive. */
  startMs: number;
  /** Step-local end, exclusive. */
  endMs: number;
  durationMs: number;
  /** Whole-pipeline start, inclusive. */
  globalStartMs: number;
  /** Whole-pipeline end, exclusive. */
  globalEndMs: number;
}

export interface MorphStepTiming {
  index: number;
  naturalDurationMs: number;
  durationMs: number;
  globalStartMs: number;
  globalEndMs: number;
  lead: TimeWindowMs;
  morph: TimeWindowMs;
  hold: TimeWindowMs;
  trail: TimeWindowMs;
}

export interface MorphTimeline {
  stateCount: number;
  knobs: MorphTimingKnobs;
  naturalDurationMs: number;
  durationMs: number;
  /** Uniform authored-duration scale before integer step quantization. */
  scale: number;
  pinned: boolean;
  steps: MorphStepTiming[];
}

export interface TransitionPlan {
  index: number;
  /** Null identifies the first reveal transition from the empty state. */
  fromStateIndex: number | null;
  toStateIndex: number;
  ops: LineOp[];
  units: MotionUnit[];
  /** Number of animated units before the overlay-budget fallback is applied. */
  requestedAnimatedUnitCount: number;
  renderMode: "morph" | "crossfade";
  coalesced: CoalescedMotionPlan;
}

export interface SnippetMorphStepPlan {
  index: number;
  stateIndex: number;
  durationMs: number;
  timing: MorphStepTiming;
  transition: TransitionPlan;
}

export interface SnippetMorphPlan {
  language: CodeLanguage;
  tabWidth: number;
  states: LexedCodeState[];
  transitions: TransitionPlan[];
  timeline: MorphTimeline;
  steps: SnippetMorphStepPlan[];
}

export interface BuildSnippetMorphPlanSpec {
  states: string[];
  language?: CodeLanguage;
  tabWidth?: number;
  timing?: Partial<MorphTimingKnobs>;
  /** Authored output duration. Omit/non-positive for the natural recommendation. */
  targetDurationMs?: number;
}

function normalizeDuration(
  value: number | undefined,
  fallback: number,
  name: string,
  allowZero: boolean,
): number {
  const selected = value ?? fallback;
  if (
    !Number.isFinite(selected) ||
    (allowZero ? selected < 0 : selected <= 0)
  ) {
    throw new Error(
      `${name} must be a finite number ${allowZero ? ">= 0" : "> 0"}, got ${selected}`,
    );
  }
  const rounded = Math.round(selected);
  if (!allowZero && rounded <= 0) {
    throw new Error(`${name} rounds below 1ms, got ${selected}`);
  }
  return rounded;
}

function normalizeTiming(
  input: Partial<MorphTimingKnobs>,
): MorphTimingKnobs {
  return {
    morphMs: normalizeDuration(
      input.morphMs,
      DEFAULT_MORPH_TIMING.morphMs,
      "computeMorphTimeline: morphMs",
      false,
    ),
    holdMs: normalizeDuration(
      input.holdMs,
      DEFAULT_MORPH_TIMING.holdMs,
      "computeMorphTimeline: holdMs",
      true,
    ),
    leadMs: normalizeDuration(
      input.leadMs,
      DEFAULT_MORPH_TIMING.leadMs,
      "computeMorphTimeline: leadMs",
      true,
    ),
    trailMs: normalizeDuration(
      input.trailMs,
      DEFAULT_MORPH_TIMING.trailMs,
      "computeMorphTimeline: trailMs",
      true,
    ),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function timeWindow(
  startMs: number,
  endMs: number,
  globalOffsetMs: number,
): TimeWindowMs {
  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    globalStartMs: globalOffsetMs + startMs,
    globalEndMs: globalOffsetMs + endMs,
  };
}

/**
 * Build integer pipeline-step timings from the uniform duration-fit model.
 *
 * Natural duration = lead + S·(morph + hold) + trail. Under a pin every
 * component first scales by one `k`; step durations round independently and
 * the final step owns the exact remainder. A ≥1ms reservation keeps every
 * state present when a very short (but viable) duration is authored.
 */
export function computeMorphTimeline(
  stateCount: number,
  knobs: Partial<MorphTimingKnobs> = {},
  targetDurationMs?: number,
): MorphTimeline {
  if (!Number.isInteger(stateCount) || stateCount < 1) {
    throw new Error(
      `computeMorphTimeline: stateCount must be a positive integer, got ${stateCount}`,
    );
  }
  const normalized = normalizeTiming(knobs);
  const naturalDurationMs =
    normalized.leadMs +
    stateCount * (normalized.morphMs + normalized.holdMs) +
    normalized.trailMs;

  if (targetDurationMs != null && !Number.isFinite(targetDurationMs)) {
    throw new Error(
      `computeMorphTimeline: targetDurationMs must be finite, got ${targetDurationMs}`,
    );
  }
  const pinned = targetDurationMs != null && targetDurationMs > 0;
  const durationMs = pinned
    ? Math.round(targetDurationMs)
    : naturalDurationMs;
  if (pinned && durationMs < stateCount) {
    throw new Error(
      `computeMorphTimeline: targetDurationMs must provide at least 1ms per state (${stateCount} states, got ${durationMs}ms)`,
    );
  }
  const scale = durationMs / naturalDurationMs;

  const naturalStepDurations = Array.from({ length: stateCount }, (_, index) =>
    normalized.morphMs +
    normalized.holdMs +
    (index === 0 ? normalized.leadMs : 0) +
    (index === stateCount - 1 ? normalized.trailMs : 0),
  );
  const stepDurations: number[] = [];
  let remaining = durationMs;
  for (let index = 0; index < stateCount; index += 1) {
    const remainingSteps = stateCount - index - 1;
    const stepDuration =
      index === stateCount - 1
        ? remaining
        : clamp(
            Math.round(naturalStepDurations[index]! * scale),
            1,
            remaining - remainingSteps,
          );
    stepDurations.push(stepDuration);
    remaining -= stepDuration;
  }

  const steps: MorphStepTiming[] = [];
  let globalStartMs = 0;
  for (let index = 0; index < stateCount; index += 1) {
    const duration = stepDurations[index]!;
    const isFirst = index === 0;
    const isLast = index === stateCount - 1;
    const leadEnd = isFirst
      ? clamp(Math.round(normalized.leadMs * scale), 0, duration)
      : 0;
    const naturalMorphEnd =
      (isFirst ? normalized.leadMs : 0) + normalized.morphMs;
    const morphEnd = clamp(
      Math.round(naturalMorphEnd * scale),
      leadEnd,
      duration,
    );
    const scaledTrail = isLast
      ? clamp(Math.round(normalized.trailMs * scale), 0, duration)
      : 0;
    const trailStart = isLast
      ? clamp(duration - scaledTrail, morphEnd, duration)
      : duration;
    const globalEndMs = globalStartMs + duration;

    steps.push({
      index,
      naturalDurationMs: naturalStepDurations[index]!,
      durationMs: duration,
      globalStartMs,
      globalEndMs,
      lead: timeWindow(0, leadEnd, globalStartMs),
      morph: timeWindow(leadEnd, morphEnd, globalStartMs),
      hold: timeWindow(morphEnd, trailStart, globalStartMs),
      trail: timeWindow(trailStart, duration, globalStartMs),
    });
    globalStartMs = globalEndMs;
  }

  return {
    stateCount,
    knobs: normalized,
    naturalDurationMs,
    durationMs,
    scale,
    pinned,
    steps,
  };
}

function validateStates(states: string[]): void {
  if (!Array.isArray(states) || states.length === 0) {
    throw new Error("buildSnippetMorphPlan: states must contain at least one code state");
  }
  states.forEach((state, index) => {
    if (typeof state !== "string") {
      throw new Error(`buildSnippetMorphPlan: states[${index}] must be a string`);
    }
  });
}

function animatedUnitCount(plan: CoalescedMotionPlan): number {
  return (
    plan.moves.length +
    (plan.removalRaster ? 1 : 0) +
    (plan.additionRaster ? 1 : 0)
  );
}

function wholeSnippetCrossfade(
  beforeLines: ReadonlyArray<string>,
  afterLines: ReadonlyArray<string>,
): CoalescedMotionPlan {
  return {
    ...(beforeLines.length > 0
      ? {
          removalRaster: {
            kind: "remove" as const,
            lines: beforeLines.map((text, fromLine) => ({
              text,
              fromLine,
              toLine: null,
            })),
          },
        }
      : {}),
    ...(afterLines.length > 0
      ? {
          additionRaster: {
            kind: "add" as const,
            lines: afterLines.map((text, toLine) => ({
              text,
              fromLine: null,
              toLine,
            })),
          },
        }
      : {}),
    moves: [],
  };
}

/** Build the complete pure plan consumed by the raster/document seams. */
export function buildSnippetMorphPlan(
  spec: BuildSnippetMorphPlanSpec,
): SnippetMorphPlan {
  if (spec == null || typeof spec !== "object") {
    throw new Error("buildSnippetMorphPlan: spec must be an object");
  }
  validateStates(spec.states);
  const language = spec.language ?? "ts";
  const tabWidth = spec.tabWidth ?? 2;
  const states = spec.states.map((state) =>
    lexTsJs(state, language, { tabWidth }),
  );
  const timeline = computeMorphTimeline(
    states.length,
    spec.timing,
    spec.targetDurationMs,
  );

  const transitions = states.map((state, index): TransitionPlan => {
    const beforeLines =
      index === 0
        ? []
        : states[index - 1]!.lines.map((line) => line.text);
    const afterLines = state.lines.map((line) => line.text);
    const ops = lcsDiffLines(beforeLines, afterLines);
    const units = groupMotionUnits(ops);
    const morphPlan = coalesceFadeUnits(units, "block");
    const requestedAnimatedUnitCount = animatedUnitCount(morphPlan);
    const renderMode =
      index > 0 && requestedAnimatedUnitCount > MAX_ANIMATED_UNITS
        ? "crossfade"
        : "morph";
    return {
      index,
      fromStateIndex: index === 0 ? null : index - 1,
      toStateIndex: index,
      ops,
      units,
      requestedAnimatedUnitCount,
      renderMode,
      coalesced:
        renderMode === "crossfade"
          ? wholeSnippetCrossfade(beforeLines, afterLines)
          : morphPlan,
    };
  });

  const steps = transitions.map((transition, index): SnippetMorphStepPlan => ({
    index,
    stateIndex: index,
    durationMs: timeline.steps[index]!.durationMs,
    timing: timeline.steps[index]!,
    transition,
  }));

  return {
    language,
    tabWidth,
    states,
    transitions,
    timeline,
    steps,
  };
}
