/**
 * Official dictionary generator: Aspect Fit
 *
 * Fits a target aspect ratio inside a root canvas, producing a single
 * rendered frame with letterbox/pillarbox bars as null tiles.
 *
 * Wraps the stdlib aspectFit builder with a UI-friendly parameter surface
 * including presets, input modes, alignment, and padding controls.
 */

import { aspectFit as stdlibAspectFit } from "@m0saic/dsl-stdlib";
import type { AspectRatio } from "@m0saic/dsl-stdlib";
import { parseM0StringComplete, toCanonicalM0String } from "@m0saic/dsl";
import { serializeM0cFile, type M0Label } from "@m0saic/dsl-file-formats";
import { labelTierParam, resolveLabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Presets ───────────────────────────────────────────────

const PRESET_RATIOS: Record<string, AspectRatio> = {
  "16:9": { w: 16, h: 9 },
  "21:9": { w: 21, h: 9 },
  "4:3": { w: 4, h: 3 },
  "1:1": { w: 1, h: 1 },
  "9:16": { w: 9, h: 16 },
  // Golden ratio presets — Fibonacci pair 21:13 ≈ φ (error 0.16%, well
  // below perceptual threshold). Integer pairs work natively with the
  // aspect-fit math; using floats here would force lossy snapping.
  "phi:1": { w: 21, h: 13 },
  "1:phi": { w: 13, h: 21 },
};

// ── Descriptor ────────────────────────────────────────────

export const aspectFitDescriptor: GeneratorDescriptor = {
  id: "aspect-fit",
  title: "Aspect Fit",
  description:
    "Fit a target aspect ratio inside a canvas. Produces deterministic letterbox/pillarbox bars from ratio math.",
  category: "layout",
  group: "Core",
  params: [
    // Root dimensions
    {
      key: "rootW",
      title: "Root Width",
      type: "int",
      default: 1920,
      min: 1,
      max: 7680,
    },
    {
      key: "rootH",
      title: "Root Height",
      type: "int",
      default: 1080,
      min: 1,
      max: 4320,
    },
    // Preset selector
    {
      key: "preset",
      title: "Preset",
      type: "enum",
      default: "21:9",
      description:
        "Target aspect ratio for the inner content rect. Common video and display ratios are listed; pick Custom to enter your own.",
      options: [
        { value: "custom", label: "Custom", description: "Specify your own aspect ratio (as either a ratio or pixel dimensions)." },
        { value: "16:9", label: "16:9", description: "Standard widescreen — most TV, computer monitors, and online video." },
        { value: "21:9", label: "21:9", description: "Ultrawide / cinematic — film and ultrawide monitors." },
        { value: "4:3", label: "4:3", description: "Classic standard-definition TV / older monitors." },
        { value: "1:1", label: "1:1", description: "Square — Instagram feed posts, profile photos." },
        { value: "9:16", label: "9:16", description: "Vertical — phone video, Reels, TikTok, Stories." },
        { value: "phi:1", label: "φ:1 (golden landscape)", description: "Golden ratio rectangle, wider than tall (≈1.618:1). Classic editorial / blog hero proportion." },
        { value: "1:phi", label: "1:φ (golden portrait)",  description: "Golden ratio rectangle, taller than wide (≈1:1.618). Editorial column / book-page proportion." },
      ],
    },
    // Input mode (only when custom)
    {
      key: "inputMode",
      title: "Input Mode",
      type: "enum",
      default: "ratio",
      description:
        "How you want to specify a custom target. Ratio: enter W:H numbers (e.g. 16:9). Dimensions: enter pixel sizes; the ratio is derived.",
      options: [
        { value: "ratio", label: "Ratio", description: "Enter the aspect ratio as two integers (e.g. 16 × 9)." },
        { value: "dimensions", label: "Dimensions", description: "Enter target pixel dimensions; the aspect ratio is derived from them." },
      ],
      visibleWhen: { preset: "custom" },
    },
    // Target ratio (custom + ratio mode)
    {
      key: "targetW",
      title: "Ratio W",
      type: "int",
      default: 16,
      min: 1,
      max: 100,
      visibleWhen: { preset: "custom", inputMode: "ratio" },
    },
    {
      key: "targetH",
      title: "Ratio H",
      type: "int",
      default: 9,
      min: 1,
      max: 100,
      visibleWhen: { preset: "custom", inputMode: "ratio" },
    },
    // Target dimensions (custom + dimensions mode) → derive ratio only
    {
      key: "targetDimW",
      title: "Target Width",
      type: "int",
      default: 3840,
      min: 1,
      max: 15360,
      visibleWhen: { preset: "custom", inputMode: "dimensions" },
    },
    {
      key: "targetDimH",
      title: "Target Height",
      type: "int",
      default: 2160,
      min: 1,
      max: 8640,
      visibleWhen: { preset: "custom", inputMode: "dimensions" },
    },
    // Alignment
    {
      key: "hAlign",
      title: "H Align",
      type: "enum",
      default: "center",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
    },
    {
      key: "vAlign",
      title: "V Align",
      type: "enum",
      default: "center",
      options: [
        { value: "top", label: "Top" },
        { value: "center", label: "Center" },
        { value: "bottom", label: "Bottom" },
      ],
    },
    // Padding
    {
      key: "padding",
      title: "Padding",
      type: "float",
      default: 0,
      min: 0,
      max: 0.49,
      step: 0.01,
      description:
        "Inset on all four sides, as a fraction of canvas size (0.05 = 5% padding). For per-edge control turn on Custom Padding.",
    },
    {
      key: "customPadding",
      title: "Custom Padding",
      type: "bool",
      default: false,
      description:
        "Switch to per-edge padding controls (Pad Left / Right / Top / Bottom) instead of a single uniform value.",
    },
    {
      key: "paddingLeft",
      title: "Pad Left",
      type: "float",
      default: 0,
      min: 0,
      max: 0.49,
      step: 0.01,
      visibleWhen: { customPadding: true },
    },
    {
      key: "paddingRight",
      title: "Pad Right",
      type: "float",
      default: 0,
      min: 0,
      max: 0.49,
      step: 0.01,
      visibleWhen: { customPadding: true },
    },
    {
      key: "paddingTop",
      title: "Pad Top",
      type: "float",
      default: 0,
      min: 0,
      max: 0.49,
      step: 0.01,
      visibleWhen: { customPadding: true },
    },
    {
      key: "paddingBottom",
      title: "Pad Bottom",
      type: "float",
      default: 0,
      min: 0,
      max: 0.49,
      step: 0.01,
      visibleWhen: { customPadding: true },
    },
    labelTierParam({
      defaultTier: "silent",
      description: "atlas labels the content frame plus letterbox/pillarbox borders so template callers can target padding regions by name. Signposts is a no-op (single landmark is the content itself — use atlas instead).",
    }),
  ],
};

// ── Params ────────────────────────────────────────────────

export type AspectFitGeneratorParams = {
  rootW: number;
  rootH: number;
  preset?: string;
  inputMode?: string;
  targetW?: number;
  targetH?: number;
  targetDimW?: number;
  targetDimH?: number;
  hAlign?: string;
  vAlign?: string;
  padding?: number;
  customPadding?: boolean;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  labels?: string;
};

// ── Helpers ───────────────────────────────────────────────

type HAlign = "left" | "center" | "right";
type VAlign = "top" | "center" | "bottom";

const VALID_HALIGN = new Set<string>(["left", "center", "right"]);
const VALID_VALIGN = new Set<string>(["top", "center", "bottom"]);

function resolveHAlign(v: string | undefined): HAlign {
  return VALID_HALIGN.has(v ?? "") ? (v as HAlign) : "center";
}

function resolveVAlign(v: string | undefined): VAlign {
  return VALID_VALIGN.has(v ?? "") ? (v as VAlign) : "center";
}

function resolveTargetRatio(params: AspectFitGeneratorParams): AspectRatio {
  const preset = params.preset ?? "21:9";

  if (preset !== "custom") {
    const ratio = PRESET_RATIOS[preset];
    if (!ratio) throw new Error(`aspectFit: unknown preset "${preset}"`);
    return ratio;
  }

  const mode = params.inputMode ?? "ratio";

  if (mode === "dimensions") {
    const w = params.targetDimW ?? 3840;
    const h = params.targetDimH ?? 2160;
    if (!Number.isInteger(w) || w < 1)
      throw new Error(`aspectFit: targetDimW must be a positive integer, got ${w}`);
    if (!Number.isInteger(h) || h < 1)
      throw new Error(`aspectFit: targetDimH must be a positive integer, got ${h}`);
    return { w, h };
  }

  // ratio mode
  const w = params.targetW ?? 16;
  const h = params.targetH ?? 9;
  if (!Number.isInteger(w) || w < 1 || w > 100)
    throw new Error(`aspectFit: targetW must be an integer 1–100, got ${w}`);
  if (!Number.isInteger(h) || h < 1 || h > 100)
    throw new Error(`aspectFit: targetH must be an integer 1–100, got ${h}`);
  return { w, h };
}

// ── Build ─────────────────────────────────────────────────

export function aspectFit(params: AspectFitGeneratorParams): GeneratorResult {
  const { rootW, rootH } = params;

  if (!Number.isInteger(rootW) || rootW < 1 || rootW > 7680)
    throw new Error(`aspectFit: rootW must be an integer 1–7680, got ${rootW}`);
  if (!Number.isInteger(rootH) || rootH < 1 || rootH > 4320)
    throw new Error(`aspectFit: rootH must be an integer 1–4320, got ${rootH}`);

  const target = resolveTargetRatio(params);
  const hAlign = resolveHAlign(params.hAlign);
  const vAlign = resolveVAlign(params.vAlign);

  // Resolve padding
  const basePad = params.padding ?? 0;
  const useCustom = params.customPadding === true;

  const result = stdlibAspectFit({
    rootW,
    rootH,
    target,
    hAlign,
    vAlign,
    padding: useCustom ? undefined : basePad,
    paddingLeft: useCustom ? (params.paddingLeft ?? 0) : undefined,
    paddingRight: useCustom ? (params.paddingRight ?? 0) : undefined,
    paddingTop: useCustom ? (params.paddingTop ?? 0) : undefined,
    paddingBottom: useCustom ? (params.paddingBottom ?? 0) : undefined,
  });

  const m0 = toCanonicalM0String(result.m0);
  const tier = resolveLabelTier(params.labels);
  // signposts: aspectFit's only single-cell landmark IS the content
  // itself — labeling it doesn't add information beyond what the lone
  // render frame already carries. Atlas is where the value lives: the
  // borders (which are `-` null frames at the DSL level, NOT rendered)
  // get position-based names so template callers can target padding
  // regions explicitly. silent and signposts → no m0c.
  let m0c: string | undefined;
  if (tier === "atlas") {
    m0c = buildAspectFitAtlasM0c(m0, rootW, rootH);
  }

  return {
    m0,
    sourceCount: 1,
    ...(m0c ? { m0c } : {}),
  };
}

/**
 * Walk the parsed aspectFit layout and label:
 *   - the single rendered frame as `content`
 *   - each null leaf as `letterbox-top` / `letterbox-bottom` /
 *     `pillarbox-left` / `pillarbox-right` based on its position
 *     relative to the content's bbox
 *
 * Nulls share their stableKeys with the labels (m0c labels target any
 * structural node, rendered or not). When multiple null leaves sit on
 * the same side (e.g. an outer letterbox + inner padding), each one
 * still picks up the side-name — duplicates are fine, callers can scan
 * for `text === "letterbox-top"` to find all top-side padding regions.
 */
function buildAspectFitAtlasM0c(
  m0: string,
  rootW: number,
  rootH: number,
): string | undefined {
  const parsed = parseM0StringComplete(m0, rootW, rootH);
  if (!parsed.ok) return undefined;
  const content = parsed.ir.renderFrames[0];
  if (!content) return undefined;

  const labels: Record<string, M0Label> = {};
  labels[String(content.meta.stableKey)] = { text: "content" };

  const cx0 = content.x;
  const cy0 = content.y;
  const cx1 = content.x + content.width;
  const cy1 = content.y + content.height;

  for (const f of parsed.ir.editorFrames) {
    // Only `kind: "null"` leaves are the real border rectangles —
    // `passthrough` frames carry cumulative layout positions during the
    // parse walk, not real geometry, so they'd produce phantom labels.
    if (f.kind !== "null") continue;
    if (f.width <= 0 || f.height <= 0) continue;
    const fcx = f.x + f.width / 2;
    const fcy = f.y + f.height / 2;
    // Snap a side classification: the centroid that's furthest outside
    // the content bbox wins. A border can only be on one side of the
    // content; ambiguity is resolved by picking the dominant offset.
    const dTop = Math.max(0, cy0 - fcy);
    const dBottom = Math.max(0, fcy - cy1);
    const dLeft = Math.max(0, cx0 - fcx);
    const dRight = Math.max(0, fcx - cx1);
    const max = Math.max(dTop, dBottom, dLeft, dRight);
    if (max === 0) continue; // inside content bbox — not a border
    let text: string;
    if (max === dTop) text = "letterbox-top";
    else if (max === dBottom) text = "letterbox-bottom";
    else if (max === dLeft) text = "pillarbox-left";
    else text = "pillarbox-right";
    labels[String(f.meta.stableKey)] = { text };
  }

  if (Object.keys(labels).length === 0) return undefined;
  return serializeM0cFile({
    m0,
    size: { width: rootW, height: rootH },
    app: "aspect-fit-generator",
    labels,
  });
}
