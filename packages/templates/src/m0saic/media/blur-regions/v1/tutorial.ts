/**
 * Easy Blur — the editor "?" tutorial.
 *
 * Answers ONE question for a brand-new user: "How do I use this, what can it
 * do, and what use cases haven't I thought of?" Consumed by the Make "?"
 * player AND `m0saic make <id> --tutorial` (a video) — so every beat must
 * read as a small product page, not a dev wireframe: window-framed visuals,
 * rounded cards, pill chips, one brand accent.
 *
 * RECORDING SEAM: the action beats carry founder-recorded Make captures
 * (converted to small mp4s). `TUTORIAL_CLIPS` maps beat → { path, durationMs };
 * a clip becomes the beat's visual inside the window frame and the beat runs
 * the clip's length. Beats without clips render their animated mocks. No fs
 * probing — templates stay deterministic.
 */

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { fadeInExpr, makeColorTile } from "@m0saic/template-utils";
import {
  onboardingGuttered,
  onboardingLeaf,
  onboardingOverlay,
  onboardingSplit,
  onboardingTextBlock,
  onboardingTextSource,
  onboardingTypeRamp,
  type OnboardingComposition,
  type OnboardingTypeRamp,
} from "../../screencap_grid/v2/screencap-grid-cover";

const TUTORIAL_FPS = 30;

/** Founder-recorded action clips per beat (small mp4 screen captures).
 *  Empty until the recordings land; beats fall back to animated mocks. */
type TutorialClip = { path: string; durationMs: number };
const SR = "/Users/qusimone/src/m0saic/packages/sandbox/production/media-blur-regions-v1/fixtures/screen_recordings";
const TUTORIAL_CLIPS: Partial<Record<string, TutorialClip>> = {
  draw: { path: `${SR}/invoice_sr.mp4`, durationMs: 10483 },
  brush: { path: `${SR}/signed-letter_sr.mp4`, durationMs: 7967 },
  inbox: { path: `${SR}/inbox_sr.mp4`, durationMs: 17533 },
  chat: { path: `${SR}/chat_sr.mp4`, durationMs: 13133 },
};

// ---------------------------------------------------------------------------
// SaaS palette — deliberate single dark look (brand orange accent).
// ---------------------------------------------------------------------------
const P = {
  bg: "#0a0c12" as MosaicColor,
  surface: "#141926" as MosaicColor,
  raised: "#1d2433" as MosaicColor,
  inset: "#10141f" as MosaicColor,
  border: "#2a3347" as MosaicColor,
  accent: "#f97316" as MosaicColor,
  accentSoft: "#fdba74" as MosaicColor,
  textHi: "#f5f7fa" as MosaicColor,
  textLo: "#9aa5b5" as MosaicColor,
  textMute: "#5f6b7d" as MosaicColor,
  frost: "#c8ccd2@0.55" as MosaicColor,
  target: "#e5484d" as MosaicColor,
};

type BeatSpec = {
  name: string;
  durationMs: number;
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  buildVisual: (type: OnboardingTypeRamp) => OnboardingComposition;
};

// ---------------------------------------------------------------------------
// SaaS building blocks
// ---------------------------------------------------------------------------

/** Rounded card tile (optionally stroked / fading in). */
function cardTile(color: MosaicColor, opts: { radius?: number; stroke?: MosaicColor; atSec?: number } = {}): OnboardingComposition {
  return onboardingLeaf(
    makeColorTile(color, {
      effects: {
        rounding: { cornerStyle: "rounded", borderRadius: opts.radius ?? 0.08 },
        ...(opts.stroke ? { stroke: { position: "inner", width: 0.004, color: opts.stroke, alpha: 0.9 } } : {}),
      },
      ...(opts.atSec != null ? { overlay: { alpha: fadeInExpr(opts.atSec, 0.3) } } : {}),
    }),
  );
}

/** Inset content into a card by carving margins (SaaS breathing room). */
function padded(content: OnboardingComposition, pad = 5): OnboardingComposition {
  const mid = onboardingSplit("col", [pad, 100 - 2 * pad, pad], [null, content, null]);
  return onboardingSplit("row", [pad, 100 - 2 * pad, pad], [null, mid, null]);
}

/** An app-window frame: rounded shell, title bar with three dots, content.
 *  chrome:false drops the title bar — for beats where the content is the
 *  hero (screen recordings) and every pixel of height belongs to it. */
function windowCard(content: OnboardingComposition, opts: { chrome?: boolean } = {}): OnboardingComposition {
  const dot = (c: MosaicColor) =>
    onboardingSplit("row", [1, 2, 1], [null, cardTile(c, { radius: 0.5 }), null]);
  const titleBar = onboardingSplit(
    "col",
    [10, 9, 5, 9, 5, 9, 440],
    [null, dot(P.textMute), null, dot(P.textMute), null, dot(P.accent), null],
  );
  const inner = opts.chrome === false ? content : onboardingSplit("row", [8, 1, 89], [titleBar, null, content]);
  return onboardingOverlay(cardTile(P.surface, { radius: 0.05, stroke: P.border }), padded(inner, opts.chrome === false ? 2 : 3));
}

/** A pill chip. */
function pill(text: string, type: OnboardingTypeRamp, opts: { active?: boolean; atSec?: number } = {}): OnboardingComposition {
  const base = cardTile(opts.active ? P.accent : P.raised, { radius: 0.5, atSec: opts.atSec });
  const label = onboardingLeaf(
    onboardingTextSource({
      text,
      fontSize: type.micro,
      color: opts.active ? P.bg : P.textLo,
      ...(opts.atSec != null ? { fadeDelaySec: opts.atSec } : {}),
      label: `chip ${text.toLowerCase()}`,
    }),
  );
  return onboardingOverlay(base, label);
}

function fadeTile(color: MosaicColor, atSec: number, durSec = 0.25): OnboardingComposition {
  return onboardingLeaf(makeColorTile(color, { overlay: { alpha: fadeInExpr(atSec, durSec) } }));
}

function dashedEdge(axis: "row" | "col", atSec: number): OnboardingComposition {
  const parts: Array<OnboardingComposition | null> = [];
  const weights: number[] = [];
  for (let i = 0; i < 9; i++) {
    parts.push(i % 2 === 0 ? fadeTile(P.accent, atSec, 0.15) : null);
    weights.push(1);
  }
  return onboardingSplit(axis, weights, parts);
}

/** A soft "footage" mock: rounded gradient-ish blocks standing in for video. */
function footageMock(withTarget: boolean): OnboardingComposition {
  return onboardingSplit(
    "col",
    [7, 6, 7],
    [
      onboardingGuttered("row", [cardTile("#243049" as MosaicColor, { radius: 0.12 }), cardTile("#1a2336" as MosaicColor, { radius: 0.12 })], 12, 1),
      onboardingSplit(
        "row",
        [4, 6, 6],
        [
          cardTile("#1a2336" as MosaicColor, { radius: 0.12 }),
          withTarget ? cardTile(P.target, { radius: 0.12 }) : cardTile("#2c3a57" as MosaicColor, { radius: 0.12 }),
          cardTile("#22304b" as MosaicColor, { radius: 0.12 }),
        ],
      ),
      onboardingGuttered("row", [cardTile("#202b42" as MosaicColor, { radius: 0.12 }), cardTile("#243049" as MosaicColor, { radius: 0.12 })], 12, 1),
    ],
  );
}

// ---------------------------------------------------------------------------
// Beat visuals
// ---------------------------------------------------------------------------

function buildHeroVisual(type: OnboardingTypeRamp): OnboardingComposition {
  const before = windowCard(padded(footageMock(true), 4));
  const frostLayer = onboardingSplit(
    "row",
    [8, 6, 7],
    [null, onboardingSplit("col", [5, 7, 9], [null, fadeTile(P.frost, 0.9, 0.45), null]), null],
  );
  const after = windowCard(padded(onboardingOverlay(footageMock(true), frostLayer), 4));
  const caption = (text: string) =>
    onboardingLeaf(onboardingTextSource({ text, fontSize: type.micro, color: P.textMute, label: text.toLowerCase() }));
  // Vertical padding keeps the window pair near-square instead of letting
  // it stretch to the full content band (founder: "less stretched").
  return onboardingSplit(
    "row",
    [2, 12, 1, 2, 4],
    [
      null,
      onboardingGuttered("col", [before, after], 12, 1),
      null,
      onboardingGuttered("col", [caption("YOUR FILE"), caption("SAME FILE · CENSORED")], 12, 1),
      null,
    ],
  );
}

function buildFlowVisual(type: OnboardingTypeRamp): OnboardingComposition {
  const step = (n: string, label: string, cap: string, atSec: number): OnboardingComposition => {
    const badge = onboardingOverlay(
      cardTile(P.accent, { radius: 0.5, atSec }),
      onboardingLeaf(onboardingTextSource({ text: n, fontSize: type.callout, color: P.bg, fadeDelaySec: atSec, label: `step ${n}` })),
    );
    const inner = onboardingSplit(
      "row",
      [2, 4, 2, 3, 3, 4],
      [
        null,
        onboardingSplit("col", [10, 10, 10], [null, badge, null]),
        null,
        onboardingLeaf(onboardingTextSource({ text: label, fontSize: type.callout, color: P.textHi, fadeDelaySec: atSec, label: label.toLowerCase() })),
        onboardingLeaf(onboardingTextSource({ text: cap, fontSize: type.micro, color: P.textLo, fadeDelaySec: atSec + 0.05, label: cap.toLowerCase() })),
        null,
      ],
    );
    return onboardingOverlay(cardTile(P.surface, { radius: 0.1, stroke: P.border, atSec }), padded(inner, 6));
  };
  const cards = onboardingGuttered(
    "col",
    [
      step("1", "Pick", "video or image", 0.2),
      step("2", "Draw", "boxes over anything", 0.7),
      step("3", "Render", "same file, censored", 1.2),
    ],
    12,
    1,
  );
  // Same height-cap treatment as the hero pair — wider, shorter cards.
  return onboardingSplit("row", [3, 10, 4], [null, cards, null]);
}

function buildDrawVisual(type: OnboardingTypeRamp): OnboardingComposition {
  const drawnRegion = onboardingSplit(
    "row",
    [1, 8, 1],
    [
      dashedEdge("col", 0.6),
      onboardingSplit("col", [1, 8, 1], [dashedEdge("row", 1.5), fadeTile(P.frost, 2.0, 0.5), dashedEdge("row", 0.9)]),
      dashedEdge("col", 1.2),
    ],
  );
  // Aligned to the target block: footageMock centers the red block at
  // x 35-65% (col [7,6,7]) and y 25-62% (inner row [4,6,6]) — the drawn
  // region wraps it with a small margin.
  const regionLayer = onboardingSplit(
    "row",
    [21, 46, 33],
    [null, onboardingSplit("col", [31, 38, 31], [null, drawnRegion, null]), null],
  );
  const canvas = onboardingOverlay(footageMock(true), regionLayer);
  const hint = onboardingSplit(
    "col",
    [12, 4, 1],
    [
      onboardingLeaf(onboardingTextSource({ text: "drag on the preview", fontSize: type.micro, color: P.textMute, hAlign: "left", label: "drag hint" })),
      onboardingSplit("row", [1, 3, 1], [null, pill("Blur regions", type, { active: true }), null]),
      null,
    ],
  );
  return windowCard(onboardingSplit("row", [16, 1, 2], [padded(canvas, 3), null, hint]));
}

function buildBrushVisual(type: OnboardingTypeRamp): OnboardingComposition {
  const chips = onboardingGuttered(
    "col",
    [pill("Rect", type), pill("Ellipse", type), pill("Polygon", type), pill("Lasso", type), pill("Brush", type, { active: true })],
    10,
    1,
  );
  const COLS = 18;
  const strokeRow = (from: number, to: number): OnboardingComposition => {
    const parts: Array<OnboardingComposition | null> = [];
    const weights: number[] = [];
    for (let i = 0; i < COLS; i++) {
      parts.push(i >= from && i <= to ? fadeTile(P.frost, 0.6 + i * 0.12, 0.18) : null);
      weights.push(1);
    }
    return onboardingSplit("col", weights, parts);
  };
  const canvas = onboardingOverlay(
    footageMock(false),
    onboardingSplit(
      "row",
      [4, 2, 2, 2, 2, 2, 5],
      [null, strokeRow(2, 5), strokeRow(3, 8), strokeRow(6, 12), strokeRow(10, 15), strokeRow(13, 16), null],
    ),
  );
  return windowCard(onboardingSplit("row", [3, 1, 15], [chips, null, padded(canvas, 2)]));
}

function buildUseCasesVisual(type: OnboardingTypeRamp): OnboardingComposition {
  const useCase = (title: string, cap: string, atSec: number): OnboardingComposition => {
    const copy = onboardingSplit(
      "row",
      [4, 3],
      [
        onboardingLeaf(onboardingTextSource({ text: title, fontSize: type.callout, color: P.textHi, fadeDelaySec: atSec, label: title.toLowerCase() })),
        onboardingLeaf(onboardingTextSource({ text: cap, fontSize: type.micro, color: P.textLo, fadeDelaySec: atSec + 0.05, label: cap.toLowerCase() })),
      ],
    );
    return onboardingOverlay(cardTile(P.surface, { radius: 0.1, stroke: P.border, atSec }), padded(copy, 8));
  };
  const rowA = onboardingGuttered("col", [useCase("Interview faces", "blur bystanders before publishing", 0.2), useCase("Dashcam plates", "pixelate every plate in one pass", 0.5)], 12, 1);
  const rowB = onboardingGuttered("col", [useCase("Screen recordings", "hide emails, names, tokens", 0.8), useCase("Documents & photos", "PNG in, censored PNG out", 1.1)], 12, 1);
  return onboardingGuttered("row", [rowA, rowB], 12, 1);
}

function buildFinishVisual(type: OnboardingTypeRamp): OnboardingComposition {
  const row = (text: string, atSec: number): OnboardingComposition =>
    onboardingSplit(
      "col",
      [2, 1, 17],
      [
        cardTile(P.accent, { radius: 0.5, atSec }),
        null,
        onboardingLeaf(onboardingTextSource({ text, fontSize: type.body, color: P.textLo, hAlign: "left", fadeDelaySec: atSec, label: text.slice(0, 24).toLowerCase() })),
      ],
    );
  const rows = onboardingGuttered(
    "row",
    [
      row("Audio passes through untouched", 0.2),
      row("A bad region fails loudly — never silently dropped", 0.55),
      row("mp4 · webm · png — the container follows your output", 0.9),
      row("Up to 50 regions per file", 1.25),
    ],
    10,
    2,
  );
  return onboardingOverlay(cardTile(P.surface, { radius: 0.08, stroke: P.border }), padded(rows, 7));
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

const BEATS: BeatSpec[] = [
  {
    name: "hero",
    durationMs: 3800,
    eyebrow: "EASY BLUR",
    title: "Hide anything. Keep everything else.",
    body: "Draw a box over what must go — a face, a plate, a name — and render the same file back with that area unreadable.",
    detail: "Same container · same audio · censored pixels",
    buildVisual: buildHeroVisual,
  },
  {
    name: "flow",
    durationMs: 3600,
    eyebrow: "THE WHOLE JOB",
    title: "Three steps, no timeline.",
    body: "Pick a video or image. Draw regions on the preview. Render. That's the entire workflow — no editing skills required.",
    detail: "No regions yet? The file passes through untouched.",
    buildVisual: buildFlowVisual,
  },
  {
    name: "draw",
    durationMs: 5200,
    eyebrow: "WATCH · BLOCK OUT",
    title: "One drag covers the block.",
    body: "Open Blur regions and drag on the preview — here it's an invoice's name, address, and account number in a single box.",
    detail: "The box you draw is exactly what renders censored",
    buildVisual: buildDrawVisual,
  },
  {
    name: "brush",
    durationMs: 4600,
    eyebrow: "WATCH · KEEP IT SIMPLE",
    title: "The fastest shape wins.",
    body: "A signature isn't a rectangle — but one quick box covers it anyway. When you want precision, ellipse, polygon, lasso, and brush are right there.",
    detail: "Rect · ellipse · polygon · lasso · brush — mix freely",
    buildVisual: buildBrushVisual,
  },
  {
    name: "inbox",
    durationMs: 4200,
    eyebrow: "REAL WORLD · SCREENS",
    title: "Every address in one pass.",
    body: "Quick strips over each sender's email and the screenshot is safe to share — the list stays readable.",
    detail: "Works the same on any screen capture",
    buildVisual: buildUseCasesVisual,
  },
  {
    name: "chat",
    durationMs: 4200,
    eyebrow: "REAL WORLD · MESSAGES",
    title: "The code and the number.",
    body: "Anything you'd rather not forward: door codes, phone numbers, names. Draw, render, share the rest.",
    detail: "Blur reads softer · pixelate reads redacted",
    buildVisual: buildUseCasesVisual,
  },
  {
    name: "usecases",
    durationMs: 3400,
    eyebrow: "AND MORE",
    title: "Wherever pixels leak.",
    body: "Faces in interviews, plates in dashcam footage, whole documents. If it renders, it can be hidden.",
    detail: "Video or image · up to 50 regions",
    buildVisual: buildUseCasesVisual,
  },
  {
    name: "finish",
    durationMs: 3600,
    eyebrow: "GOOD TO KNOW",
    title: "Built for shipping.",
    body: "Close this and draw your first region — the preview is already your canvas.",
    detail: "Privacy is all-or-nothing by design",
    buildVisual: buildFinishVisual,
  },
];

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

function beatProgress(index: number, type: OnboardingTypeRamp): OnboardingComposition {
  const dots = onboardingGuttered(
    "col",
    BEATS.map((_, i) => cardTile(i === index ? P.accent : i < index ? "#7c4a12" as MosaicColor : P.border, { radius: 0.5, ...(i === index ? { atSec: 0.04 } : {}) })),
    3,
    2,
  );
  const counter = onboardingLeaf(
    onboardingTextSource({
      text: `${index + 1} / ${BEATS.length}`,
      fontSize: type.micro,
      color: P.textMute,
      hAlign: "left",
      label: "tutorial progress",
    }),
  );
  return onboardingSplit("col", [30, 12, 16, 30, 12], [null, counter, null, dots, null]);
}

function beatVisual(spec: BeatSpec, type: OnboardingTypeRamp): { comp: OnboardingComposition; assets: MosaicAssetManifest; clipMs?: number } {
  const clip = TUTORIAL_CLIPS[spec.name];
  if (!clip) return { comp: spec.buildVisual(type), assets: {} as MosaicAssetManifest };
  const assetId = asAssetId(`tut-clip-${spec.name}`);
  const media: MosaicSource = {
    type: "media",
    mediaType: "video",
    assetId,
    placement: { fit: "contain" },
    // Declared window = the whole recording. The Make preview's clip
    // machinery honors a source's own playback window over any segment
    // slice, so tutorial beats warm + play the full capture.
    playback: { clipStartMs: 0, clipDurationMs: clip.durationMs },
    editor: { owner: "template", label: `recording ${spec.name}` },
  };
  return {
    comp: windowCard(onboardingLeaf(media), { chrome: false }),
    assets: { [assetId]: { kind: "file", path: clip.path, mediaType: "video" } } as MosaicAssetManifest,
    clipMs: clip.durationMs,
  };
}

/** Clip-beat page: the recording owns the top of the canvas with NOTHING on
 *  it — no chrome, no overlays. Copy + progress live in a caption band BELOW
 *  the media, its card width matched to the video card so edges align. The
 *  video cell is sized to hug the 16:10 recordings (all captures are
 *  2880×1800 → 1920-wide converts) so the shell doesn't pillarbox. */
function buildHeroClipBeat(
  spec: BeatSpec,
  index: number,
  canvasW: number,
  canvasH: number,
  visual: OnboardingComposition,
  assets: MosaicAssetManifest,
): MosaicDocument {
  const type = onboardingTypeRamp(canvasW, canvasH);
  const stacked = canvasH > canvasW * 0.9;
  const capW = stacked ? canvasW * 0.8 : canvasW * 0.56;
  const captionText = onboardingSplit(
    "row",
    [2, 4, 1, 10, 1, 9, 2],
    [
      null,
      onboardingTextBlock({ text: spec.eyebrow, fontSize: type.label, color: P.accent, cellWidthPx: capW, hAlign: "left", fadeDelaySec: 0.1, label: "beat eyebrow" }),
      null,
      onboardingTextBlock({ text: spec.title, fontSize: type.headline, color: P.textHi, cellWidthPx: capW, hAlign: "left", widthFrac: 0.96, fadeDelaySec: 0.16, label: "beat title" }),
      null,
      onboardingTextBlock({ text: spec.body, fontSize: type.body, color: P.textLo, cellWidthPx: capW, hAlign: "left", widthFrac: 0.95, fadeDelaySec: 0.22, label: "beat body" }),
      null,
    ],
  );
  const captionCard = onboardingOverlay(cardTile(P.surface, { radius: 0.08, stroke: P.border, atSec: 0.06 }), padded(captionText, 4));
  const dots = onboardingGuttered(
    "col",
    BEATS.map((_, i) => cardTile(i === index ? P.accent : i < index ? "#7c4a12" as MosaicColor : P.border, { radius: 0.5 })),
    3,
    2,
  );
  const dotsBlock = onboardingSplit("row", [44, 12, 44], [null, dots, null]);
  const page = stacked
    ? onboardingSplit(
        "row",
        [4, 36, 3, 22, 3, 4, 28],
        [
          null,
          onboardingSplit("col", [4, 92, 4], [null, visual, null]),
          null,
          onboardingSplit("col", [4, 92, 4], [null, captionCard, null]),
          null,
          onboardingSplit("col", [30, 40, 30], [null, dots, null]),
          null,
        ],
      )
    : onboardingSplit(
        "row",
        [2, 69, 2, 23, 4],
        [
          null,
          onboardingSplit("col", [19, 62, 19], [null, visual, null]),
          null,
          onboardingSplit("col", [19, 62, 2, 12, 5], [null, captionCard, null, dotsBlock, null]),
          null,
        ],
      );
  return {
    kind: "mosaic_document",
    version: 1,
    assets,
    size: { width: canvasW, height: canvasH },
    backgroundColor: P.bg,
    m0: page.m0 as MosaicDocument["m0"],
    sources: page.sources,
  };
}

function buildBeat(spec: BeatSpec, index: number, canvasW: number, canvasH: number): { doc: MosaicDocument; durationMs: number } {
  const type = onboardingTypeRamp(canvasW, canvasH);
  const stacked = canvasH > canvasW * 0.9;
  const copyWidth = stacked ? canvasW * 0.84 : canvasW * 0.4;
  const { comp: visual, assets, clipMs } = beatVisual(spec, type);
  if (clipMs != null) {
    return { doc: buildHeroClipBeat(spec, index, canvasW, canvasH, visual, assets), durationMs: clipMs };
  }
  const copy = onboardingSplit(
    "row",
    [3, 4, 15, 20, 3, 6, 5],
    [
      null,
      onboardingTextBlock({ text: spec.eyebrow, fontSize: type.label, color: P.accent, cellWidthPx: copyWidth, hAlign: "left", fadeDelaySec: 0.04, label: "beat eyebrow" }),
      onboardingTextBlock({ text: spec.title, fontSize: type.headline, color: P.textHi, cellWidthPx: copyWidth, hAlign: "left", widthFrac: 0.9, fadeDelaySec: 0.08, label: "beat title" }),
      onboardingTextBlock({ text: spec.body, fontSize: type.body, color: P.textLo, cellWidthPx: copyWidth, hAlign: "left", widthFrac: 0.91, fadeDelaySec: 0.12, label: "beat body" }),
      null,
      onboardingTextBlock({ text: spec.detail, fontSize: type.micro, color: P.accentSoft, cellWidthPx: copyWidth, hAlign: "left", fadeDelaySec: 0.16, label: "beat detail" }),
      null,
    ],
  );
  const progress = beatProgress(index, type);
  const page = stacked
    ? onboardingSplit(
        "row",
        [5, 33, 3, 47, 3, 4, 5],
        [null, onboardingSplit("col", [7, 86, 7], [null, copy, null]), null, onboardingSplit("col", [6, 88, 6], [null, visual, null]), null, progress, null],
      )
    : onboardingSplit(
        "row",
        [7, 83, 2, 5, 3],
        [
          null,
          onboardingSplit("col", [5, 34, 4, 51, 6], [null, copy, null, visual, null]),
          null,
          progress,
          null,
        ],
      );

  return {
    doc: {
      kind: "mosaic_document",
      version: 1,
      assets,
      size: { width: canvasW, height: canvasH },
      backgroundColor: P.bg,
      m0: page.m0 as MosaicDocument["m0"],
      sources: page.sources,
    },
    durationMs: clipMs ?? spec.durationMs,
  };
}

/** Build the six-beat walkthrough (scrubbable; ~25s, longer when clips land). */
export function renderBlurRegionsTutorial(ctx: MosaicEngineContext): MosaicDocumentPipeline {
  const canvasW = ctx.target.width;
  const canvasH = ctx.target.height;
  const steps: MosaicPipelineStep[] = BEATS.map((beat, i) => {
    const { doc, durationMs } = buildBeat(beat, i, canvasW, canvasH);
    return { name: beat.name, durationMs, file: doc };
  });
  return {
    kind: "mosaic_pipeline",
    version: 1,
    fps: ctx.target.fps ?? TUTORIAL_FPS,
    durationMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
    defaultTransition: { type: "cut" },
    backgroundColor: P.bg,
    steps,
  };
}
