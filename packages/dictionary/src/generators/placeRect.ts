/**
 * Official dictionary generator: Place Rect
 *
 * Places an exact pixel-sized rectangle inside a root canvas.
 * Unlike Aspect Fit (which works from ratios), Place Rect takes
 * exact pixel dimensions — useful when you need a precise inner
 * canvas, e.g. for grid-safe regions.
 */

import { placeRect as stdlibPlaceRect } from "@m0saic/dsl-stdlib";
import { parseM0StringComplete, toCanonicalM0String } from "@m0saic/dsl";
import { serializeM0cFile, type M0Label } from "@m0saic/dsl-file-formats";
import { labelTierParam, resolveLabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const placeRectDescriptor: GeneratorDescriptor = {
  id: "place-rect",
  title: "Place Rect",
  description:
    "Position an exact rectangle inside a canvas. Converts pixel dimensions to deterministic ratio weights.",
  category: "layout",
  group: "Precision",
  params: [
    {
      key: "rootW",
      title: "Root Width",
      type: "int",
      default: 1920,
      min: 1,
      max: 7680,
      description: "Outer canvas width. The rect is placed inside this.",
    },
    {
      key: "rootH",
      title: "Root Height",
      type: "int",
      default: 1080,
      min: 1,
      max: 4320,
      description: "Outer canvas height. The rect is placed inside this.",
    },
    {
      key: "rectW",
      title: "Rect Width",
      type: "int",
      default: 1740,
      min: 1,
      max: 7680,
      description: "Width of the inner rectangle to place. Must be ≤ Root Width; the difference becomes left/right padding.",
    },
    {
      key: "rectH",
      title: "Rect Height",
      type: "int",
      default: 975,
      min: 1,
      max: 4320,
      description: "Height of the inner rectangle. Must be ≤ Root Height; the difference becomes top/bottom padding.",
    },
    {
      key: "hAlign",
      title: "H Align",
      type: "enum",
      default: "center",
      description: "Where the rect sits horizontally inside the root canvas when it's narrower than the root.",
      options: [
        { value: "left", label: "Left", description: "Rect against the left edge; padding on the right." },
        { value: "center", label: "Center", description: "Rect centered horizontally; padding split evenly left and right." },
        { value: "right", label: "Right", description: "Rect against the right edge; padding on the left." },
      ],
    },
    {
      key: "vAlign",
      title: "V Align",
      type: "enum",
      default: "center",
      description: "Where the rect sits vertically inside the root canvas when it's shorter than the root.",
      options: [
        { value: "top", label: "Top", description: "Rect against the top edge; padding on the bottom." },
        { value: "center", label: "Center", description: "Rect centered vertically; padding split evenly top and bottom." },
        { value: "bottom", label: "Bottom", description: "Rect against the bottom edge; padding on the top." },
      ],
    },
    labelTierParam({
      defaultTier: "silent",
      description: "atlas labels the placed frame plus each padding border so template callers can target them by name. Signposts is a no-op (single landmark is the placed rect — use atlas instead).",
    }),
  ],
};

// ── Params ────────────────────────────────────────────────

export type PlaceRectGeneratorParams = {
  rootW: number;
  rootH: number;
  rectW: number;
  rectH: number;
  hAlign?: string;
  vAlign?: string;
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

// ── Build ─────────────────────────────────────────────────

export function placeRect(params: PlaceRectGeneratorParams): GeneratorResult {
  const { rootW, rootH, rectW, rectH } = params;

  if (!Number.isInteger(rootW) || rootW < 1 || rootW > 7680)
    throw new Error(`placeRect: rootW must be an integer 1–7680, got ${rootW}`);
  if (!Number.isInteger(rootH) || rootH < 1 || rootH > 4320)
    throw new Error(`placeRect: rootH must be an integer 1–4320, got ${rootH}`);
  if (!Number.isInteger(rectW) || rectW < 1 || rectW > rootW)
    throw new Error(`placeRect: rectW must be an integer 1–${rootW}, got ${rectW}`);
  if (!Number.isInteger(rectH) || rectH < 1 || rectH > rootH)
    throw new Error(`placeRect: rectH must be an integer 1–${rootH}, got ${rectH}`);

  const result = stdlibPlaceRect({
    rootW,
    rootH,
    rectW,
    rectH,
    hAlign: resolveHAlign(params.hAlign),
    vAlign: resolveVAlign(params.vAlign),
  });

  const m0 = toCanonicalM0String(result.m0);
  const tier = resolveLabelTier(params.labels);
  // Mirrors aspectFit: silent + signposts are no-ops (a single placed
  // cell adds nothing beyond what the lone render frame already is —
  // labeling it "placed" alone is trivial). atlas labels the placed
  // frame as "placed" plus each border null as padding-top / right /
  // bottom / left based on its position relative to the placed rect's
  // bbox. Padding borders are `kind: "null"` leaves in the parse;
  // passthroughs (cumulative-position bookkeeping nodes) are skipped.
  let m0c: string | undefined;
  if (tier === "atlas") {
    m0c = buildPlaceRectAtlasM0c(m0, rootW, rootH);
  }

  return {
    m0,
    sourceCount: 1,
    idealCanvas: { width: rootW, height: rootH },
    ...(m0c ? { m0c } : {}),
  };
}

/**
 * Walk the parsed placeRect layout and label:
 *   - the single rendered frame as `placed`
 *   - each null leaf as `padding-{top|right|bottom|left}` based on its
 *     centroid offset outside the placed rect's bbox.
 *
 * Mirrors aspectFit's atlas helper. When a null rect is dominantly
 * outside one side (e.g. fully above the placed rect), it gets that
 * side's label. Corners are vanishingly rare in placeRect (the stdlib
 * produces axis-aligned nulls), but if one occurs the side with the
 * largest offset wins — same tie-breaking as aspectFit.
 */
function buildPlaceRectAtlasM0c(
  m0: string,
  rootW: number,
  rootH: number,
): string | undefined {
  const parsed = parseM0StringComplete(m0, rootW, rootH);
  if (!parsed.ok) return undefined;
  const placed = parsed.ir.renderFrames[0];
  if (!placed) return undefined;

  const labels: Record<string, M0Label> = {};
  labels[String(placed.meta.stableKey)] = { text: "placed" };

  const cx0 = placed.x;
  const cy0 = placed.y;
  const cx1 = placed.x + placed.width;
  const cy1 = placed.y + placed.height;

  for (const f of parsed.ir.editorFrames) {
    if (f.kind !== "null") continue;
    if (f.width <= 0 || f.height <= 0) continue;
    const fcx = f.x + f.width / 2;
    const fcy = f.y + f.height / 2;
    const dTop = Math.max(0, cy0 - fcy);
    const dBottom = Math.max(0, fcy - cy1);
    const dLeft = Math.max(0, cx0 - fcx);
    const dRight = Math.max(0, fcx - cx1);
    const max = Math.max(dTop, dBottom, dLeft, dRight);
    if (max === 0) continue;
    let text: string;
    if (max === dTop) text = "padding-top";
    else if (max === dBottom) text = "padding-bottom";
    else if (max === dLeft) text = "padding-left";
    else text = "padding-right";
    labels[String(f.meta.stableKey)] = { text };
  }

  if (Object.keys(labels).length === 0) return undefined;
  return serializeM0cFile({
    m0,
    size: { width: rootW, height: rootH },
    app: "place-rect-generator",
    labels,
  });
}
