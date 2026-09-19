import type {
  LoopMode,
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLanguageCode,
  MosaicSource,
  MosaicSubtitleCue,
  MosaicSubtitleTrack,
  MosaicTemplate,
  MosaicTextLayer,
} from "@m0saic/types";
import { asAliasId, asAssetId, asTemplateId, emitTemplateLog } from "@m0saic/types";
import { matchesLanguageCode } from "@m0saic/platform";
import { toM0String } from "@m0saic/dsl-stdlib";
// Editor-only first-open cover (gate-25/26 founder ruling: "needs a cover" —
// the missing-source first face was an error card). Sibling module keeps this
// file about the burn itself.
import { renderSubtitleBurnCover } from "./subtitle-burn-cover";
import {
  buildOverlayStack,
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
  slugifyAssetKeyFromPath,
  textEmUnits,
} from "@m0saic/template-utils";

// ---- PROPS ----

export type SubtitleBurnProps = {
  /**
   * Source id in `ctx.media` (e.g. an MKV/MP4 with embedded subtitle streams).
   * When omitted, the first media entry with a populated subtitle track is used;
   * if none has subtitles, the first video source is used as pass-through.
   */
  sourceId?: string;

  /**
   * Preferred subtitle language as an ISO 639-2/B 3-letter code (e.g. `"eng"`,
   * `"spa"`) or any form `normalizeLanguageCode` can canonicalize (`"en"`,
   * `"en-US"`, `"Eng"`). When set and a matching track exists, it wins over
   * the default-flagged track. Use {@link MosaicLanguageCode} constants from
   * `@m0saic/types` for readability.
   */
  languageCode?: MosaicLanguageCode;

  /**
   * When `languageCode` is set but no track matches, this controls whether
   * the template falls back to the default-flagged track (then first track)
   * or skips subtitles entirely (pass-through).
   *
   * Defaults to `true` — sensible because callers usually want subtitles
   * when they exist, even if their preferred language isn't available.
   * Set to `false` to enforce strict matching.
   */
  fallbackToDefault?: boolean;

  /**
   * Explicit subtitle track index (0-based). When set, this is the highest-
   * priority selection signal and overrides `languageCode` / `fallbackToDefault`.
   * Use this for fully deterministic selection regardless of language tags.
   */
  trackIndex?: number;

  /**
   * When `true`, the template publishes the extracted (window-clamped) cues
   * via TWO additional channels alongside the rendered video:
   *
   * - **`MosaicDataSource`** with `alias: "subtitleCues"` — pipeline-readable
   *   via `ctx.upstreamData.subtitleCues` in a downstream step.
   * - **`doc.sidecars.cues`** — written to disk by the engine as
   *   `{output-basename}.cues.json` next to the rendered video.
   *
   * Off by default. Free-of-cost when disabled (no extra sources, no disk write).
   */
  emitCues?: boolean;

  /**
   * Source-relative milliseconds at which the rendered segment begins.
   * When set, the template trims the input video to `[clipStartMs, clipEndMs]`
   * and offsets subtitle cue times to be output-relative (cue at source-time
   * `clipStartMs + Δ` fires at output-time `Δ`).
   *
   * Omit (or set to `0`) to render from the start of the source.
   */
  clipStartMs?: number;

  /**
   * Source-relative milliseconds at which the rendered segment ends.
   * Must be greater than `clipStartMs` when both are set; otherwise the
   * template falls back to the error mosaic.
   *
   * Omit to render to the end of the source (subject to `ctx.target.durationMs`
   * and `clipLoopMode`).
   */
  clipEndMs?: number;

  /**
   * How the clipped media source behaves when its length doesn't match
   * `ctx.target.durationMs`. Defaults to `"cut"` (clip plays its real
   * length, remainder transparent — best for subtitle work). Other options:
   *
   * - `"loop"` — repeat the clip seamlessly to fill the target duration
   * - `"freeze"` — hold the final frame of the clip
   *
   * Surface of {@link MosaicPlaybackProps.loopMode}.
   */
  clipLoopMode?: LoopMode;

  /** Where the burned subtitle text sits on the frame. Defaults to "bottom". */
  placement?: "bottom" | "top";

  /** Subtitle font size in pixels. Default scales from `ctx.target.height`. */
  fontSize?: number;
  /** Subtitle font color. Default `"#ffffff"`. */
  fontColor?: string;
  /** Outline / border color for legibility. Default `"#000000"`. */
  borderColor?: string;
  /** Outline width as a fraction of min(w,h). Default `0.003`. */
  borderWidth?: number;
};

const propsSchema = definePropsSchema<SubtitleBurnProps>({
  sourceId: {
    type: "media",
    required: false,
    description: "Source id in ctx.media. Defaults to first video with subtitles.",
    meta: { ui: { label: "Source" } },
  },
  languageCode: {
    type: "string",
    required: false,
    description:
      'Preferred subtitle language (e.g. "eng", "spa"). 2-letter and locale-suffix forms accepted.',
    meta: { control: { placeholder: "first subtitle track" }, ui: { label: "Language" } },
  },
  fallbackToDefault: {
    type: "boolean",
    required: false,
    description:
      "When languageCode misses, fall back to default-flagged or first track. Default true.",
    meta: { ui: { label: "Fallback to default" } },
  },
  trackIndex: {
    type: "number",
    required: false,
    description: "Explicit subtitle track index (overrides languageCode when set).",
    meta: { control: { placeholder: "auto" }, constraints: { min: 0, max: 32 }, ui: { label: "Track" } },
  },
  emitCues: {
    type: "boolean",
    required: false,
    description:
      "Publish extracted cues as a MosaicDataSource (pipeline-readable) AND doc.sidecars.cues (written to {basename}.cues.json).",
    meta: { ui: { label: "Emit cues" } },
  },
  clipStartMs: {
    type: "number",
    required: false,
    description: "Source-relative ms where the rendered segment starts. Paired with clipEndMs.",
    meta: {
      constraints: { min: 0 },
      control: {
        placeholder: "full video",
        picker: "time-range",
        videoFromProp: "sourceId",
        unit: "ms",
        markersProvider: {
          kind: "subtitles",
          videoFromProp: "sourceId",
          languageFromProp: "languageCode",
          trackIndexFromProp: "trackIndex",
        },
      },
      ui: { label: "Clip start" },
    },
  },
  clipEndMs: {
    type: "number",
    required: false,
    description: "Source-relative ms where the rendered segment ends. Must be > clipStartMs.",
    meta: {
      constraints: { min: 0 },
      control: {
        placeholder: "full video",
        picker: "time-range",
        videoFromProp: "sourceId",
        unit: "ms",
        markersProvider: {
          kind: "subtitles",
          videoFromProp: "sourceId",
          languageFromProp: "languageCode",
          trackIndexFromProp: "trackIndex",
        },
      },
      ui: { label: "Clip end" },
    },
  },
  clipLoopMode: {
    type: "string",
    required: false,
    description: "How the clipped source fills ctx.target.durationMs when shorter.",
    meta: {
      constraints: { oneOf: ["cut", "loop", "freeze"] },
      control: {
        options: [
          { value: "cut", label: "Cut (default)" },
          { value: "loop", label: "Loop" },
          { value: "freeze", label: "Freeze last frame" },
        ],
      },
      ui: { label: "Clip loop mode" },
    },
  },
  placement: {
    type: "string",
    required: false,
    description: "Vertical placement of burned subtitles.",
    meta: { ui: { label: "Placement" } },
  },
  fontSize: {
    type: "number",
    required: false,
    description: "Subtitle font size in pixels.",
    meta: { control: { placeholder: "auto (by height)" }, constraints: { min: 8, max: 200 }, ui: { label: "Font Size" } },
  },
  fontColor: {
    type: "string",
    required: false,
    description: "Subtitle font color (hex or named).",
    meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Font Color" } },
  },
  borderColor: {
    type: "string",
    required: false,
    description: "Subtitle outline color (hex or named).",
    meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Border Color" } },
  },
  borderWidth: {
    type: "number",
    required: false,
    description: "Outline width as a fraction of min(w,h).",
    meta: { constraints: { min: 0, max: 0.05 }, ui: { label: "Border Width" } },
  },
});

// ---- HELPERS ----

const DEFAULT_FONT_COLOR = "#ffffff";
const DEFAULT_BORDER_COLOR = "#000000";
const DEFAULT_BORDER_WIDTH = 0.003;
const DEFAULT_PLACEMENT: "bottom" | "top" = "bottom";

function defaultFontSize(targetH: number): number {
  // Scale subtitle font from output height; matches conventions in info_pane.ts.
  return Math.max(14, Math.min(72, Math.round(targetH * 0.045)));
}

/** Pick `props.sourceId` if set, else the first video source in ctx.media that has subtitles, else the first video. */
function resolveSourceId(
  props: SubtitleBurnProps,
  ctx: MosaicEngineContext,
): string | undefined {
  if (props.sourceId) return props.sourceId;
  const entries = Object.entries(ctx.media);
  const withSubs = entries.find(
    ([, m]) => m.kind === "video" && (m.subtitles?.length ?? 0) > 0,
  );
  if (withSubs) return withSubs[0];
  const firstVideo = entries.find(([, m]) => m.kind === "video");
  return firstVideo?.[0];
}

/**
 * Names the algorithm path taken by {@link selectSubtitleTrack}. Surfaced
 * via telemetry so consumers can attribute a render to its selection logic
 * without reverse-engineering the props.
 */
export type SubtitleSelectionRule =
  | "no-tracks"            // input list empty / undefined
  | "explicit-index"       // props.trackIndex resolved to a valid track
  | "language-match"       // props.languageCode matched a track
  | "language-miss-strict" // languageCode missed AND fallbackToDefault: false
  | "default-flagged"      // a default-flagged track was used
  | "first-track";         // no default flagged; first track used

export type SelectSubtitleTrackResult = {
  track: MosaicSubtitleTrack | undefined;
  rule: SubtitleSelectionRule;
};

/**
 * Selection algorithm (in priority order):
 *
 *   1. `trackIndex` set → use that exact track (rule: `"explicit-index"`).
 *   2. `languageCode` set → first track whose `stream.language` matches.
 *      - match → rule: `"language-match"`
 *      - miss + `fallbackToDefault: false` → rule: `"language-miss-strict"`, track: undefined
 *      - miss + fallback → fall through to (3)
 *   3. No preference (or fallthrough from 2) → default-flagged track if any
 *      (rule: `"default-flagged"`), else first track (rule: `"first-track"`).
 *
 * Empty / undefined input → rule: `"no-tracks"`, track: undefined.
 *
 * Caller pass-through behavior: `track === undefined` means render the base
 * video with no overlays. The `rule` lets the caller (and telemetry) explain
 * *why* there's no track.
 */
export function selectSubtitleTrack(
  tracks: readonly MosaicSubtitleTrack[] | undefined,
  props: Pick<SubtitleBurnProps, "trackIndex" | "languageCode" | "fallbackToDefault">,
): SelectSubtitleTrackResult {
  if (!tracks || tracks.length === 0) {
    return { track: undefined, rule: "no-tracks" };
  }

  if (typeof props.trackIndex === "number") {
    const track = tracks[props.trackIndex];
    return { track, rule: "explicit-index" };
  }

  if (props.languageCode) {
    const matched = tracks.find((t) =>
      matchesLanguageCode(t.stream.language, props.languageCode),
    );
    if (matched) return { track: matched, rule: "language-match" };
    if (props.fallbackToDefault === false) {
      return { track: undefined, rule: "language-miss-strict" };
    }
    // fall through to default/first below
  }

  const defaultFlagged = tracks.find((t) => t.stream.default === true);
  if (defaultFlagged) return { track: defaultFlagged, rule: "default-flagged" };
  return { track: tracks[0], rule: "first-track" };
}

function filterCuesToWindow(
  cues: MosaicSubtitleCue[],
  durationMs: number,
): MosaicSubtitleCue[] {
  const end = Math.max(0, durationMs);
  return cues
    .filter((c) => c.startMs < end && c.endMs > 0)
    .map((c) => ({
      startMs: Math.max(0, c.startMs),
      endMs: Math.min(end, c.endMs),
      text: c.text,
    }))
    .filter((c) => c.endMs > c.startMs && c.text.length > 0);
}

/**
 * Remap source-relative cues to output-relative cues for a clipped segment.
 *
 * Source cues come from ffprobe in source-time. When the template renders
 * `[clipStartMs, clipEndMs]` of the source, a cue with source-time
 * `[cs, ce]` should appear at output-time `[cs - clipStartMs, ce - clipStartMs]`,
 * intersected with the output's render window `[0, durationMs]`.
 *
 * Returns cues with:
 *   - times offset by `-clipStartMs`
 *   - intersected with the clip window AND `[0, durationMs]`
 *   - empty / zero-length cues dropped
 */
export function offsetCuesToOutput(
  cues: readonly MosaicSubtitleCue[],
  clipStartMs: number,
  clipEndMs: number,
  durationMs: number,
): MosaicSubtitleCue[] {
  const clipStart = Math.max(0, clipStartMs);
  const clipEnd = Math.max(clipStart, clipEndMs);
  const renderEnd = Math.max(0, durationMs);
  // Effective output window: intersection of [0, clipEnd-clipStart] and [0, renderEnd].
  const outputEnd = Math.min(clipEnd - clipStart, renderEnd);

  const out: MosaicSubtitleCue[] = [];
  for (const c of cues) {
    // Drop cues that fall entirely outside the clip window in source-time.
    if (c.endMs <= clipStart) continue;
    if (c.startMs >= clipEnd) continue;
    // Intersect with the clip window in source-time, then offset to output-time.
    const localStart = Math.max(0, c.startMs - clipStart);
    const localEnd = Math.min(outputEnd, c.endMs - clipStart);
    if (localEnd <= localStart) continue;
    if (c.text.length === 0) continue;
    out.push({ startMs: localStart, endMs: localEnd, text: c.text });
  }
  return out;
}

// ── Cue text fit (gate 26) ────────────────────────────────────
//
// Cue layers draw LITERAL text at a fixed font, centered — a long single
// line overflowed BOTH edges silently (the gate-16 CLI text-clip class,
// pixel-confirmed on a 155-char cue). Subtitles must never lose words, so
// the fit is WRAP-FIRST: greedy word-wrap each authored line to the em
// budget; only when the wrapped cue still exceeds CUE_MAX_LINES does the
// font step down (one bounded 0.75× step, floor 14px) and re-wrap.

const CUE_EM_RATIO = 0.62;
const CUE_PAD_X = 0.05;
const CUE_MAX_LINES = 3;

function cueLineBudget(canvasW: number, fontSize: number): number {
  return (canvasW * (1 - 2 * CUE_PAD_X)) / (fontSize * CUE_EM_RATIO);
}

/** Greedy word-wrap one authored line into chunks that fit the budget. */
function wrapLineToBudget(line: string, budgetUnits: number): string[] {
  if (textEmUnits(line) <= budgetUnits + 0.5) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && textEmUnits(cand) > budgetUnits) {
      out.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Fit one cue's text to the frame width. Returns the (possibly re-wrapped)
 * text and the (possibly stepped-down) font size. Cues that already fit
 * pass through byte-identical.
 */
export function fitCueText(
  text: string,
  canvasW: number,
  fontSize: number,
): { text: string; fontSize: number } {
  const wrapAt = (font: number): string[] =>
    text
      .split("\n")
      .flatMap((line) => wrapLineToBudget(line, cueLineBudget(canvasW, font)));

  const lines = wrapAt(fontSize);
  if (lines.length <= CUE_MAX_LINES) {
    const joined = lines.join("\n");
    return { text: joined === text ? text : joined, fontSize };
  }
  const stepped = Math.max(14, Math.round(fontSize * 0.75));
  return { text: wrapAt(stepped).join("\n"), fontSize: stepped };
}

function fmtSec(ms: number): string {
  // 3-decimal seconds is plenty for ffmpeg between() and stays deterministic.
  return (ms / 1000).toFixed(3);
}

function buildCueLayer(
  cue: MosaicSubtitleCue,
  placement: "bottom" | "top",
  fontSize: number,
  fontColor: MosaicColor,
  borderColor: MosaicColor,
  borderWidth: number,
): MosaicTextLayer {
  return {
    content: { kind: "literal", text: cue.text },
    style: { fontSize, fontColor, borderColor, borderWidth },
    placement: {
      hAlign: "center",
      vAlign: placement === "top" ? "top" : "bottom",
      padding: { x: 0.05, y: 0.05 },
    },
    overlay: { enable: `between(t,${fmtSec(cue.startMs)},${fmtSec(cue.endMs)})` },
  };
}

// ---- RENDER ----

export const SUBTITLE_BURN_TEMPLATE_ID = asTemplateId(
  "@m0saic/media/subtitle-burn/v1",
);

export const SubtitleBurn: MosaicTemplate<SubtitleBurnProps> = {
  id: SUBTITLE_BURN_TEMPLATE_ID,
  label: "Subtitle Burn",
  version: 1,
  // Forward-looking role assignment per the Phase 3j closed-union role
  // formalization. Subtitle-burn produces pixels (base video + drawtext
  // overlays); the optional MosaicDataSource it can emit on emitCues:true
  // doesn't change its role — sources arrays can carry mixed kinds.
  role: "renderable",
  description:
    "Reads subtitle cues from an MKV/MP4's embedded subtitle stream (text-based codecs) and burns them onto the video as m0saic text overlays. Opt-in cue emission via MosaicDataSource + doc.sidecars.cues.",
  capabilities: { tier: "core" },
  tags: ["media", "subtitles", "captions", "creators", "educators", "animated", "accessibility", "video"],
  propsSchema,

  // Free-form schemas; the engine doesn't enforce shape yet, but declaring
  // them documents the published contract for downstream consumers.
  outputsSchema: {
    subtitleCues: {
      type: "object",
      required: false,
      description:
        "Selected subtitle track + window-clamped cues. Available to downstream pipeline steps via ctx.upstreamData.subtitleCues when emitCues:true.",
    },
  },
  sidecarsSchema: {
    cues: {
      type: "object",
      required: false,
      description:
        "Written as {output-basename}.cues.json next to the rendered video when emitCues:true.",
    },
  },

  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 10000,
    format: { kind: "video", container: "mp4" },
  },

  defaultProps: {
    placement: DEFAULT_PLACEMENT,
    fallbackToDefault: true,
    emitCues: false,
    clipLoopMode: "cut",
    fontColor: DEFAULT_FONT_COLOR,
    borderColor: DEFAULT_BORDER_COLOR,
    borderWidth: DEFAULT_BORDER_WIDTH,
  },

  renderCover(_props: SubtitleBurnProps, ctx: MosaicEngineContext): MosaicDocument {
    return renderSubtitleBurnCover(ctx);
  },

  render(
    props: SubtitleBurnProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const sourceId = resolveSourceId(props, ctx);
    if (!sourceId) {
      emitTemplateLog(ctx, {
        templateId: SUBTITLE_BURN_TEMPLATE_ID,
        level: "warn",
        message: "Pass-through: no video source in ctx.media",
        data: { event: "passthrough", reason: "no-video-source" },
      });
      return Promise.resolve(
        makeErrorMosaic('No video source found in ctx.media.', {
          title: "Subtitle Burn",
          width: ctx.target.width,
          height: ctx.target.height,
        }),
      );
    }

    const meta = ctx.media[asAssetId(sourceId)];
    const placement = props.placement ?? DEFAULT_PLACEMENT;
    const fontSize = props.fontSize ?? defaultFontSize(ctx.target.height);
    // User-supplied color strings are validated downstream by the engine;
    // the union-typed MosaicColor doesn't accept arbitrary `string`, so cast
    // at the prop boundary.
    const fontColor = (props.fontColor ?? DEFAULT_FONT_COLOR) as MosaicColor;
    const borderColor = (props.borderColor ?? DEFAULT_BORDER_COLOR) as MosaicColor;
    const borderWidth = props.borderWidth ?? DEFAULT_BORDER_WIDTH;

    // Clip window: source-relative [clipStart, clipEnd]. When either prop is
    // omitted we degrade gracefully — no clip is applied and the existing
    // [0, ctx.target.durationMs] filter handles the render window.
    const hasClipStart = typeof props.clipStartMs === "number";
    const hasClipEnd = typeof props.clipEndMs === "number";
    const clipActive = hasClipStart || hasClipEnd;
    const clipStartMs = Math.max(0, props.clipStartMs ?? 0);
    const clipEndMs = hasClipEnd
      ? Math.max(0, props.clipEndMs!)
      : (meta?.durationMs ?? clipStartMs + ctx.target.durationMs);
    if (clipActive && clipEndMs <= clipStartMs) {
      emitTemplateLog(ctx, {
        templateId: SUBTITLE_BURN_TEMPLATE_ID,
        level: "warn",
        message: "Invalid clip range: clipEndMs must be greater than clipStartMs",
        data: { event: "passthrough", reason: "invalid-clip-range", clipStartMs, clipEndMs },
      });
      return Promise.resolve(
        makeErrorMosaic("clipEndMs must be greater than clipStartMs.", {
          title: "Subtitle Burn",
          width: ctx.target.width,
          height: ctx.target.height,
        }),
      );
    }
    const clipDurationMs = clipEndMs - clipStartMs;
    const clipLoopMode: LoopMode = props.clipLoopMode ?? "cut";

    // Telemetry event #1: tracks_discovered (count + language list).
    const allTracks = meta?.subtitles ?? [];
    emitTemplateLog(ctx, {
      templateId: SUBTITLE_BURN_TEMPLATE_ID,
      message: "Subtitle tracks discovered in source",
      data: {
        event: "tracks_discovered",
        sourceId,
        count: allTracks.length,
        languages: allTracks.map((t) => t.stream.language ?? null),
      },
    });

    const { track, rule } = selectSubtitleTrack(allTracks, {
      trackIndex: props.trackIndex,
      languageCode: props.languageCode,
      fallbackToDefault: props.fallbackToDefault ?? true,
    });

    // Telemetry event #2: track_selected — names which algorithm path won.
    emitTemplateLog(ctx, {
      templateId: SUBTITLE_BURN_TEMPLATE_ID,
      message: `Subtitle track selection: ${rule}`,
      data: {
        event: "track_selected",
        rule,
        requestedLanguageCode: props.languageCode ?? null,
        requestedTrackIndex: props.trackIndex ?? null,
        trackIndex: track?.stream.streamIndex ?? null,
        language: track?.stream.language ?? null,
        codec: track?.stream.codecName ?? null,
        default: track?.stream.default ?? null,
        forced: track?.stream.forced ?? null,
      },
    });

    // ── Duration follow (gate 26 founder catch: "when i dropped big buck
    // bunny, it defaulted to 10 seconds instead of the duration of the
    // file"). The natural length of a subtitle burn is the SOURCE's (or
    // the clip window's) — the 10s outputHints default is just a hint.
    // The doc AUTHORS its duration below (authored declarations already
    // out-rank hint-derived targets; Make's Duration override starts
    // empty by design so the declaration reaches the planner untouched),
    // and an EXPLICIT user duration (ctx.userIntent.durationMs — Make
    // override / CLI --durationMs) still wins over the follow.
    const userAskedDuration =
      typeof ctx.userIntent?.durationMs === "number" && ctx.userIntent.durationMs > 0;
    const followDurationMs = clipActive
      ? clipDurationMs
      : typeof meta?.durationMs === "number" && meta.durationMs > 0
        ? meta.durationMs
        : undefined;
    const effectiveDurationMs =
      !userAskedDuration && followDurationMs != null
        ? followDurationMs
        : ctx.target.durationMs;

    const rawCues = track?.cues ?? [];
    // When a clip window is set, offset cues to output-relative time AND
    // intersect with both the clip window and the render duration. Otherwise
    // the simple no-clip filter (assumes clip starts at 0) is sufficient.
    // Both filter against the EFFECTIVE duration, so source-follow renders
    // keep every cue instead of dropping everything past the 10s hint.
    const cues = clipActive
      ? offsetCuesToOutput(rawCues, clipStartMs, clipEndMs, effectiveDurationMs)
      : filterCuesToWindow(rawCues, effectiveDurationMs);

    // Telemetry event #3: cues_filtered — raw → window-clamped counts.
    emitTemplateLog(ctx, {
      templateId: SUBTITLE_BURN_TEMPLATE_ID,
      message: "Cues filtered to ctx.target window",
      data: {
        event: "cues_filtered",
        rawCount: rawCues.length,
        windowedCount: cues.length,
        durationMs: effectiveDurationMs,
        clipActive,
      },
    });

    // Telemetry event #5: clip_applied — emitted only when a clip window is active.
    if (clipActive) {
      emitTemplateLog(ctx, {
        templateId: SUBTITLE_BURN_TEMPLATE_ID,
        message: "Clip window applied to source",
        data: {
          event: "clip_applied",
          clipStartMs,
          clipEndMs,
          clipDurationMs,
          clipLoopMode,
          sourceDurationMs: meta?.durationMs ?? null,
          targetDurationMs: ctx.target.durationMs,
        },
      });
    }

    // Telemetry event #4: passthrough — when no track was selected.
    if (!track) {
      emitTemplateLog(ctx, {
        templateId: SUBTITLE_BURN_TEMPLATE_ID,
        level: "warn",
        message: `Pass-through: ${rule}`,
        data: { event: "passthrough", reason: rule, sourceId },
      });
    }

    const sourceAssetId = asAssetId(slugifyAssetKeyFromPath(sourceId));
    const assets: MosaicAssetManifest = {
      [sourceAssetId]: {
        kind: "file",
        path: sourceId,
        mediaType: "video",
      },
    };

    const sources: MosaicSource[] = [
      {
        type: "media",
        mediaType: "video",
        assetId: sourceAssetId,
        placement: { fit: "cover" },
        ...(clipActive
          ? {
              playback: {
                clipStartMs,
                clipDurationMs,
                loopMode: clipLoopMode,
              },
            }
          : {}),
        editor: { owner: "template" },
      },
    ];

    if (cues.length > 0) {
      const layers = cues.map((c) => {
        const fit = fitCueText(c.text, ctx.target.width, fontSize);
        return buildCueLayer(
          { ...c, text: fit.text },
          placement,
          fit.fontSize,
          fontColor,
          borderColor,
          borderWidth,
        );
      });
      sources.push({
        type: "text",
        renderMode: { kind: "video" },
        layers,
        visual: { backgroundColor: "none" as MosaicColor },
        editor: { owner: "template" },
      });
    }

    // Cue emission: opt-in via emitCues, and only fires when we actually
    // selected a track. The published shape is symmetric across the two
    // channels (MosaicDataSource for pipelines, doc.sidecars for disk).
    let sidecars: Record<string, unknown> | undefined;
    if (props.emitCues === true && track) {
      const cuesPayload = {
        language: track.stream.language ?? null,
        codec: track.stream.codecName ?? null,
        streamIndex: track.stream.streamIndex,
        default: track.stream.default ?? false,
        forced: track.stream.forced ?? false,
        selectionRule: rule,
        // Clip context lets downstream consumers see whether cues are
        // source-relative (no clip) or output-relative (clip active).
        clip: clipActive
          ? { startMs: clipStartMs, endMs: clipEndMs, durationMs: clipDurationMs, loopMode: clipLoopMode }
          : null,
        cues,
      };

      // Pipeline-readable channel: downstream step reads via
      // ctx.upstreamData.subtitleCues.
      sources.push({
        type: "data",
        alias: asAliasId("subtitleCues"),
        variables: cuesPayload,
        editor: { owner: "template" },
      });

      // Disk-side channel: engine's writeSidecars writes
      // {output-basename}.cues.json next to the rendered video.
      sidecars = { cues: cuesPayload };
    }

    // Pass-through when no cues: single full-frame tile. Otherwise stack a
    // transparent overlay slot atop the base media so the text composites on top.
    const m0 = cues.length > 0 ? buildOverlayStack(2) : "F";

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets,
      m0: toM0String(m0, "SubtitleBurn"),
      sources,
      // Declared format (family convention — watermark/trickplay/screencap:
      // each rendered doc declares its own). Without it, Make's Output Type
      // has no ground truth for this doc and cannot preset/self-heal to
      // Video — the gate-26 founder catch ("why is it trying to make my
      // output an image").
      format: { kind: "video", container: "mp4" },
      // Authored duration: the source's (or clip window's) real length —
      // see the duration-follow block above. Omitted only when nothing
      // usable was probed (the target then rules as before).
      ...(followDurationMs != null && !userAskedDuration
        ? { durationMs: effectiveDurationMs }
        : {}),
      ...(sidecars ? { sidecars } : {}),
    };

    return Promise.resolve(doc);
  },
};

registerTemplate(SubtitleBurn);
