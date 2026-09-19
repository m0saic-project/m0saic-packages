/**
 * Image Collage — the editor "?" tutorial.
 *
 * Three beats, one question: "How do I use this?" — pick photos (files or a
 * whole folder), render (the sheet lays itself out), and big sets page into
 * more sheets. Consumed by the Make "?" player AND `m0saic make <id>
 * --tutorial`. Same SaaS-page kit as the blur-regions / logo-animate
 * tutorials: copy column + visual, progress dots, one brand accent.
 *
 * The collage visuals are REAL: each beat inlines a live solve of the demo
 * set (`solvePages` + `emitCollageLayout`, pure and sync) at the visual
 * slot's TRUE pixel size — probed with resolveDocFrames, never estimated —
 * so the inset-recovered gutters land exactly (the gate-21 lesson).
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicSource,
} from "@m0saic/types";
import { fadeInExpr, makeColorTile, resolveDocFrames } from "@m0saic/template-utils";
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
} from "../../../media/screencap_grid/v2/screencap-grid-cover";
import { solvePages } from "./packer/paging";
import { emitCollageLayout } from "./emit";
import { DEMO_IMAGES } from "./demo-fixture";

const TUTORIAL_FPS = 30;

// SaaS palette — the shared single dark look (brand orange accent).
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
};

type BeatSpec = {
  name: string;
  durationMs: number;
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  /** Builds the visual for the slot's TRUE pixel size (two-pass probe). */
  buildVisual: (type: OnboardingTypeRamp, slotW: number, slotH: number) => OnboardingComposition;
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

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

function padded(content: OnboardingComposition, pad = 5): OnboardingComposition {
  const mid = onboardingSplit("col", [pad, 100 - 2 * pad, pad], [null, content, null]);
  return onboardingSplit("row", [pad, 100 - 2 * pad, pad], [null, mid, null]);
}

/** App-window shell: rounded card, three-dot title bar, content. */
function windowCard(content: OnboardingComposition): OnboardingComposition {
  const dot = (c: MosaicColor) => onboardingSplit("row", [1, 2, 1], [null, cardTile(c, { radius: 0.5 }), null]);
  const titleBar = onboardingSplit(
    "col",
    [10, 9, 5, 9, 5, 9, 440],
    [null, dot(P.textMute), null, dot(P.textMute), null, dot(P.accent), null],
  );
  const inner = onboardingSplit("row", [8, 1, 89], [titleBar, null, content]);
  return onboardingOverlay(cardTile(P.surface, { radius: 0.05, stroke: P.border }), padded(inner, 3));
}

/** A live demo-set solve at exactly `w`×`h` px — the collage's own emitter. */
function liveCollage(w: number, h: number, opts: { aspects?: number[]; colors?: string[]; seed?: number } = {}): OnboardingComposition {
  const aspects = opts.aspects ?? DEMO_IMAGES.map((d) => d.aspect);
  const colors = opts.colors ?? DEMO_IMAGES.map((d) => d.color);
  const W = Math.max(64, Math.round(w));
  const H = Math.max(64, Math.round(h));
  const gutterPx = Math.max(2, Math.round(Math.min(W, H) * 0.012));
  try {
    const [page] = solvePages({
      canvasW: W,
      canvasH: H,
      gutterXPx: gutterPx,
      gutterYPx: gutterPx,
      marginPx: gutterPx,
      // Slots are small (a few hundred px): let cells go small so the demo
      // set still packs as ONE sheet, and cap the taste bound to the slot.
      minCellPx: 24,
      maxCellPx: Math.max(48, Math.round(Math.min(W, H) * 0.6)),
      aspects,
      seed: opts.seed ?? 1,
      cropBudget: 0.3,
      maxImagesPerSheet: aspects.length,
    });
    const layout = emitCollageLayout({
      placed: page.solve.placed,
      cols: page.solve.candidate.cols,
      rows: page.solve.candidate.rows,
      canvasW: W,
      canvasH: H,
      gutterXPx: gutterPx,
      gutterYPx: gutterPx,
      marginPx: gutterPx,
      sourceFor: (i) =>
        ({
          type: "lavfi",
          color: colors[i % colors.length],
          effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.06 } },
          editor: { owner: "template", label: `tutorial img:${i}` },
        } as unknown as MosaicSource),
    });
    return { m0: layout.m0, sources: layout.sources };
  } catch {
    // Never expected on the demo set; degrade to a labelled surface.
    return cardTile(P.raised, { radius: 0.04 });
  }
}

function fileRow(name: string, dims: string, type: OnboardingTypeRamp, atSec: number): OnboardingComposition {
  const swatch = onboardingSplit("row", [1, 3, 1], [null, cardTile(P.accent, { radius: 0.3, atSec }), null]);
  return onboardingSplit(
    "col",
    [6, 2, 52, 40],
    [
      swatch,
      null,
      onboardingLeaf(onboardingTextSource({ text: name, fontSize: type.callout, color: P.textHi, hAlign: "left", fadeDelaySec: atSec, label: `file ${name}` })),
      onboardingLeaf(onboardingTextSource({ text: dims, fontSize: type.micro, color: P.textMute, hAlign: "right", fadeDelaySec: atSec, label: `dims ${name}` })),
    ],
  );
}

/** Beat 1 visual: a folder listing — files of every size and shape. */
function folderVisual(type: OnboardingTypeRamp): OnboardingComposition {
  const header = onboardingSplit(
    "col",
    [60, 40],
    [
      onboardingLeaf(onboardingTextSource({ text: "summer-trip/", fontSize: type.body, color: P.accent, hAlign: "left", fadeDelaySec: 0.1, label: "folder name" })),
      onboardingLeaf(onboardingTextSource({ text: "or pick files one by one", fontSize: type.micro, color: P.textMute, hAlign: "right", fadeDelaySec: 0.1, label: "folder hint" })),
    ],
  );
  const rows = [
    ["IMG_0412.jpg", "6000 × 4000"],
    ["IMG_0413.jpg", "4000 × 6000"],
    ["pano-ridge.jpg", "9000 × 3000"],
    ["lake.heic", "3024 × 4032"],
    ["square-drone.png", "2048 × 2048"],
    ["IMG_0420.jpg", "6000 × 4000"],
  ].map(([n, d], i) => fileRow(n, d, type, 0.3 + i * 0.22));
  const list = onboardingGuttered("row", rows, 6, 1);
  const body = onboardingSplit("row", [10, 2, 88], [header, null, list]);
  return windowCard(padded(body, 4));
}

/** Beat 2 visual: the real demo sheet at the slot's true size. */
function sheetVisual(_type: OnboardingTypeRamp, slotW: number, slotH: number): OnboardingComposition {
  return windowCard(liveCollage(slotW * 0.94, slotH * 0.89 * 0.94));
}

/** Beat 3 visual: two pages side by side, each a real solve of half the set. */
function pagesVisual(type: OnboardingTypeRamp, slotW: number, slotH: number): OnboardingComposition {
  const half = Math.ceil(DEMO_IMAGES.length / 2);
  const pageCard = (label: string, aspects: number[], colors: string[], seed: number, atSec: number): OnboardingComposition => {
    // Card geometry: [caption 10 | gap 2 | sheet 88] rows inside a padded card
    // whose column is ~48% of the slot → the sheet's true px follow.
    const cardW = slotW * 0.48 * 0.92;
    const cardH = slotH * 0.92 * 0.88;
    const sheet = liveCollage(cardW, cardH, { aspects, colors, seed });
    const caption = onboardingLeaf(
      onboardingTextSource({ text: label, fontSize: type.micro, color: P.accentSoft, hAlign: "left", fadeDelaySec: atSec, label: `page label ${label}` }),
    );
    const inner = onboardingSplit("row", [10, 2, 88], [caption, null, sheet]);
    return onboardingOverlay(cardTile(P.surface, { radius: 0.05, stroke: P.border, atSec }), padded(inner, 4));
  };
  const aspects = DEMO_IMAGES.map((d) => d.aspect);
  const colors = DEMO_IMAGES.map((d) => d.color);
  return onboardingSplit(
    "col",
    [48, 4, 48],
    [
      pageCard("page 1 · 6 photos", aspects.slice(0, half), colors.slice(0, half), 2, 0.1),
      null,
      pageCard("page 2 · 6 photos", aspects.slice(half), colors.slice(half), 3, 0.5),
    ],
  );
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

const BEATS: BeatSpec[] = [
  {
    name: "pick",
    durationMs: 4200,
    eyebrow: "Step 1 · Images",
    title: "Pick photos — or a whole folder.",
    body: "Choose image files, drop them in, or point the Images field at a folder. Any sizes, any shapes.",
    detail: "Images field: files, or a folder",  // no arrows — the bundled svg face has no U+2192
    buildVisual: (type) => folderVisual(type),
  },
  {
    name: "render",
    durationMs: 4400,
    eyebrow: "Step 2 · Render",
    title: "The sheet lays itself out.",
    body: "Wide photos get wide cells, tall ones tall, the strongest a hero spot — with even gutters and nothing cropped too hard.",
    detail: "Nudge Gutter, Margin and Crop budget if you like",
    buildVisual: (type, w, h) => sheetVisual(type, w, h),
  },
  {
    name: "pages",
    durationMs: 4200,
    eyebrow: "Step 3 · Big sets",
    title: "More photos? More sheets.",
    body: "Past the per-sheet cap the collage pages itself — one PNG per sheet, in the order you gave it.",
    detail: "Max per sheet · 30 by default",
    buildVisual: (type, w, h) => pagesVisual(type, w, h),
  },
];

/** Progress rail (the blur-regions shape): "n / 3" counter + three side-by-side dots. */
function beatProgress(index: number, type: OnboardingTypeRamp): OnboardingComposition {
  const dots = onboardingGuttered(
    "col",
    BEATS.map((_, i) =>
      cardTile(i === index ? P.accent : i < index ? ("#7c4a12" as MosaicColor) : P.border, {
        radius: 0.5,
        ...(i === index ? { atSec: 0.04 } : {}),
      }),
    ),
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
  // Dots ride a 10%-wide column of the 5%-tall rail → ~55px squares, i.e. circles.
  return onboardingSplit("col", [40, 8, 4, 10, 38], [null, counter, null, dots, null]);
}

/**
 * One beat page. Two passes: a probe tile stands in for the visual so its
 * resolved frame gives the slot's TRUE pixels, then the real visual is built
 * for exactly that size (inset gutters are pixel-exact only at the size they
 * were emitted for).
 */
function buildBeat(spec: BeatSpec, index: number, canvasW: number, canvasH: number): MosaicDocument {
  const type = onboardingTypeRamp(canvasW, canvasH);
  const stacked = canvasH > canvasW * 0.9;
  const copyWidth = stacked ? canvasW * 0.84 : canvasW * 0.4;
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
  const assemble = (visual: OnboardingComposition): OnboardingComposition =>
    stacked
      ? onboardingSplit(
          "row",
          [5, 33, 3, 47, 3, 4, 5],
          [null, onboardingSplit("col", [7, 86, 7], [null, copy, null]), null, onboardingSplit("col", [6, 88, 6], [null, visual, null]), null, progress, null],
        )
      : onboardingSplit(
          "row",
          [7, 83, 2, 5, 3],
          [null, onboardingSplit("col", [5, 34, 4, 51, 6], [null, copy, null, visual, null]), null, progress, null],
        );

  // Pass 1 — probe the visual slot's true pixels.
  const probeTile = makeColorTile(P.raised);
  const probePage = assemble(onboardingLeaf(probeTile));
  const probed = resolveDocFrames(
    { kind: "mosaic_document", version: 1, m0: probePage.m0, sources: probePage.sources, assets: {} } as unknown as MosaicDocument,
    canvasW,
    canvasH,
  );
  const slot = probed.framesByLogical[probePage.sources.indexOf(probeTile)];
  const slotW = slot ? Math.round(slot.width) : Math.round(canvasW * 0.42);
  const slotH = slot ? Math.round(slot.height) : Math.round(canvasH * 0.7);

  // Pass 2 — the real page.
  const page = assemble(spec.buildVisual(type, slotW, slotH));
  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as MosaicDocument["assets"],
    size: { width: canvasW, height: canvasH },
    backgroundColor: P.bg,
    m0: page.m0 as MosaicDocument["m0"],
    sources: page.sources,
  };
}

/** The three-beat walkthrough (scrubbable, ~13s). Deterministic; no ctx.media. */
export function renderImageCollageTutorial(ctx: MosaicEngineContext): MosaicDocumentPipeline {
  const canvasW = Math.max(1, Math.round(ctx.target.width));
  const canvasH = Math.max(1, Math.round(ctx.target.height));
  const steps: MosaicPipelineStep[] = BEATS.map((beat, i) => ({
    name: beat.name,
    durationMs: beat.durationMs,
    file: buildBeat(beat, i, canvasW, canvasH),
  }));
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
