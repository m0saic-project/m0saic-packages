/**
 * Logo Animate — the editor "?" tutorial.
 *
 * Answers the brand-new-user question: "How do I use this with MY logo,
 * and what can it do?" Consumed by the Make "?" player AND
 * `m0saic make <id> --tutorial`. SaaS-page beats (blur-regions precedent):
 * copy column + visual, progress rail, one brand accent.
 *
 * The visuals are REAL: beats nest live logo-animate documents (built-in
 * marks are baked SVGs and the vector pipeline is pure + sync), so the
 * hero assembles, the modes beat loops/fills for real, and the marks beat
 * shows the actual three built-ins — no mocks except the bitmap beat's
 * pixel grid (rasterization is async/sharp, deliberately not embedded).
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicOverlayExpr,
  MosaicPipelineStep,
  MosaicSource,
  MosaicSourceMask,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { generateStableKeyRankSet, queryFrames, rankFramesFromM0 } from "@m0saic/dsl-stdlib";
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
} from "../../screencap_grid/v2/screencap-grid-cover";
import {
  buildLoopEnableExpr,
  buildModuleAlphaExpr,
  buildProgressFillEnableExpr,
  buildShimmerEnableExpr,
} from "./expressions";
import { buildLogoGrid, buildMasksByStableKey } from "./svg-source";
import { buildContainLayout } from "./layout";
import { DEFAULT_LOGO_SVG } from "./default-logo";

/** A hand-baked "your logo" for the bring-your-own beat: ascending bars +
 *  a pennant triangle — deliberately NOT a m0saic brand mark (those live in
 *  M0saic Brand Marks v3 at their dictionary-locked resolutions). The
 *  triangle exercises the silhouette-mask path the beat's detail line
 *  mentions. */
const DEMO_SVG = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="9" width="4" height="7"/><rect x="6" y="5" width="4" height="11"/><rect x="12" y="0" width="4" height="16"/><rect x="0" y="4" width="4" height="3"/><path d="M6 3L10 3L8 0Z"/></svg>`;

const TUTORIAL_FPS = 30;

// SaaS palette (single dark look, brand accent — the blur-regions family).
const P = {
  bg: "#0a0c12" as MosaicColor,
  surface: "#141926" as MosaicColor,
  raised: "#1d2433" as MosaicColor,
  border: "#2a3347" as MosaicColor,
  accent: "#f97316" as MosaicColor,
  accentSoft: "#fdba74" as MosaicColor,
  textHi: "#f4f6fa" as MosaicColor,
  textLo: "#aab3c2" as MosaicColor,
  textMute: "#5d667a" as MosaicColor,
};

// ---------------------------------------------------------------------------
// Live logo children — the real pipeline, sync, built-in marks only.
// ---------------------------------------------------------------------------

type MiniAnimation = "assemble" | "logo_loop" | "progress_fill" | "shimmer" | "static";

/**
 * A live logo INLINED as a flat composition (m0 + sources spliced into the
 * page lattice) — never a nested child: the child-composite pass emits a
 * video-only deliverable that breaks the tutorial's audio concat, and
 * nested procedural masks bleed seams (the donut-cover lesson). Returns
 * null when the mark's lattice would CULL at this cell size (sub-pixel
 * cells fold and fail the whole doc) — callers degrade to a labeled card.
 *
 * `cellW`/`cellH` are the slot's TRUE resolved pixels (the caller probes
 * them via resolveDocFrames — never layout-parameter approximations, which
 * is exactly how the gate-21 square-canvas stretch happened). The contain
 * rect keeps the mark's EXACT intrinsic aspect and is centered on a px/4
 * basis, so quantization drift is ≤4px per side: the founder's 1:1
 * contract for square marks, held by construction and locked in tests.
 */
function inlineLogo(
  svg: string,
  animation: MiniAnimation,
  cellW: number,
  cellH: number,
): OnboardingComposition | null {
  const logo = buildLogoGrid(svg, { driftPercent: 2, packing: "multi" });
  const masksByKey = buildMasksByStableKey(logo.grid, logo.m0);
  const contain = buildContainLayout(
    Math.max(2, Math.round(cellW * 0.94)),
    Math.max(2, Math.round(cellH * 0.94)),
    logo.intrinsic.w,
    logo.intrinsic.h,
  );
  const native = queryFrames(logo.m0, { width: logo.intrinsic.w * 4, height: logo.intrinsic.h * 4 }).logical().length;
  const frames = queryFrames(logo.m0, { width: contain.rect.w, height: contain.rect.h }).logical();
  if (frames.length === 0 || frames.length < native) return null; // would cull → degrade
  const rankSet = generateStableKeyRankSet(
    rankFramesFromM0(logo.m0, { canvasW: contain.rect.w, canvasH: contain.rect.h }),
    "diag",
  );
  const overlayFor = (rank: number): MosaicOverlayExpr | undefined => {
    switch (animation) {
      case "assemble":
        return {
          alpha: buildModuleAlphaExpr(rank, {
            spawnDurSec: 1.2,
            tileFadeSec: 0.25,
            exitStartSec: 9999, // no exit inside a tutorial beat
            fadeOutSec: 0.1,
          }),
        };
      case "logo_loop":
        return {
          enable: buildLoopEnableExpr(rank, {
            loopSec: 2.4,
            inEnd: 0.25,
            outStart: 0.75,
            feather: 0.02,
            fps: TUTORIAL_FPS,
            startDelay: 0.1,
            endDelay: 0.2,
            easing: "smoothstep",
          }),
        };
      case "progress_fill":
        return {
          enable: buildProgressFillEnableExpr(rank, {
            progressSec: 2.0,
            oneShot: false,
            feather: 0.02,
            fps: TUTORIAL_FPS,
          }),
        };
      case "shimmer":
        return {
          enable: buildShimmerEnableExpr(rank, {
            shimmerSec: 1.4,
            shimmerWidth: 0.2,
            feather: 0.02,
            fps: TUTORIAL_FPS,
          }),
        };
      case "static":
      default:
        return undefined;
    }
  };
  const sources: MosaicSource[] = frames.map((f) => {
    const entry = masksByKey[String(f.meta.stableKey)];
    const mask: MosaicSourceMask | undefined = entry
      ? { kind: "inline-mask", localPath: entry.localPath, bounds: entry.bounds }
      : undefined;
    const overlay = overlayFor(rankSet.ranks[String(f.meta.stableKey)] ?? 0);
    return makeColorTile(P.accent, { ...(overlay ? { overlay } : {}), mask });
  });
  // Center the exact-aspect rect on a px/4 basis (never raw px — the
  // px-per-weight ≥4 law; never percentage approximations — the stretch).
  const u = (px: number) => Math.max(1, Math.round(px / 4));
  const padW = Math.max(2, (cellW - contain.rect.w) / 2);
  const padH = Math.max(2, (cellH - contain.rect.h) / 2);
  const inner: OnboardingComposition = { m0: logo.m0, sources };
  const centered = onboardingSplit("col", [u(padW), u(contain.rect.w), u(padW)], [null, inner, null]);
  return onboardingSplit("row", [u(padH), u(contain.rect.h), u(padH)], [null, centered, null]);
}

// ---------------------------------------------------------------------------
// Small SaaS primitives (the blur-regions kit dialect).
// ---------------------------------------------------------------------------

function cardTile(color: MosaicColor, opts: { radius?: number; stroke?: MosaicColor } = {}): OnboardingComposition {
  return onboardingLeaf(
    makeColorTile(color, {
      effects: {
        ...(opts.radius != null ? { cornerRadius: opts.radius } : {}),
        ...(opts.stroke ? { stroke: { color: opts.stroke, widthPx: 1 } } : {}),
      },
    } as never),
  );
}

function padded(content: OnboardingComposition, pad = 5): OnboardingComposition {
  const mid = onboardingSplit("col", [pad, 100 - 2 * pad, pad], [null, content, null]);
  return onboardingSplit("row", [pad, 100 - 2 * pad, pad], [null, mid, null]);
}

/** A measured card slot: the probe pass measures the slot's TRUE content
 *  cell, the real pass calls `build(trueW, trueH)` — no visual ever sizes
 *  itself from layout-parameter estimates (the stretch class). */
type MeasuredSlot = (build: (trueW: number, trueH: number) => OnboardingComposition) => OnboardingComposition;

/** A live logo in a measured slot, with its degrade label. */
function logoIn(
  slot: MeasuredSlot,
  svg: string,
  animation: MiniAnimation,
  fallbackLabel: string,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  return slot(
    (w, h) =>
      inlineLogo(svg, animation, w, h) ??
      onboardingSplit("row", [2, 1, 2], [null, onboardingLeaf(onboardingTextSource({ text: fallbackLabel, fontSize: type.body, color: P.accentSoft, label: `mark ${fallbackLabel.toLowerCase()}` })), null]),
  );
}

function chip(text: string, type: OnboardingTypeRamp, active = false): OnboardingComposition {
  return onboardingOverlay(
    cardTile(active ? P.accent : P.raised, { radius: 0.5 }),
    onboardingLeaf(onboardingTextSource({ text, fontSize: type.micro, color: active ? P.bg : P.textLo, label: `chip ${text.toLowerCase()}` })),
  );
}

/**
 * Fit-first text block (the timeline-v2 pattern): wrap at the ramp font,
 * then STEP THE FONT DOWN until every wrapped line's cell can hold its
 * glyphs (line cell = 3/(3N+2) of the band; 1.18x headroom covers
 * ascender/descender + leading + the analytic-vs-quantized cell drift). Fonts never clip — they shrink. The
 * text-fit contract in tutorial.test.ts locks this at four canvases.
 */
function fittedTextBlock(args: {
  text: string;
  fontSize: number;
  color: MosaicColor;
  cellWidthPx: number;
  bandPx: number;
  hAlign?: "left" | "center" | "right";
  widthFrac?: number;
  fadeDelaySec?: number;
  label?: string;
}): OnboardingComposition {
  const { bandPx, ...blockArgs } = args;
  let font = args.fontSize;
  for (let i = 0; i < 12; i++) {
    const block = onboardingTextBlock({ ...blockArgs, fontSize: font });
    const n = block.sources.length;
    const lineCell = (bandPx * 3) / (3 * n + 2);
    if (lineCell >= font * 1.32 || font <= 11) return block;
    font = Math.max(11, Math.floor(font * 0.92));
  }
  return onboardingTextBlock({ ...blockArgs, fontSize: font });
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

type BeatSpec = {
  name: string;
  durationMs: number;
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  buildVisual: (type: OnboardingTypeRamp, slot: MeasuredSlot, cellW: number, cellH: number) => OnboardingComposition;
};

const BEATS: BeatSpec[] = [
  {
    name: "hero",
    durationMs: 4200,
    eyebrow: "LOGO ANIMATE",
    title: "Your logo, assembled.",
    body: "Drop in an SVG and every shape becomes a tile on the canvas — then the tiles animate. What you see here is the template rendering itself.",
    detail: "Real geometry, not baked pixels — the DSL view shows every shape",
    buildVisual: (t, slot) => logoIn(slot, DEFAULT_LOGO_SVG, "assemble", "Mosaic M", t),
  },
  {
    name: "yoursvg",
    durationMs: 5200,
    eyebrow: "BRING YOUR OWN",
    title: "Any flattened SVG works.",
    body: "Pick your .svg with the Logo SVG file picker. Only <path> and <rect> shapes parse — in Inkscape: select all, Object to Path, ungroup, save as Plain SVG.",
    detail: "Rectilinear marks convert exactly · curvy shapes get silhouette masks",
    buildVisual: (t, slot) => {
      const steps = onboardingGuttered(
        "row",
        [chip("1 · Flatten to paths", t), chip("2 · Drop the .svg in", t), chip("3 · Pick an animation", t, true)],
        10,
        2,
      );
      return onboardingSplit("row", [13, 1, 6], [logoIn(slot, DEMO_SVG, "assemble", "your logo", t), null, steps]);
    },
  },
  {
    name: "modes",
    durationMs: 5200,
    eyebrow: "FIVE WAYS TO MOVE",
    title: "One logo, five animations.",
    body: "Assemble spawns the tiles in. Loop reveals seamlessly, forever. Progress fills like a loading bar, breathing pulses, shimmer sweeps a highlight.",
    detail: "Left: loop · right: progress fill — both rendering live",
    buildVisual: (t, slot) => {
      const labeled = (anim: MiniAnimation, label: string) =>
        onboardingSplit(
          "col",
          [13, 1, 4],
          [
            logoIn(slot, DEFAULT_LOGO_SVG, anim, label, t),
            null,
            onboardingSplit("row", [8, 3, 8], [null, chip(label, t, true), null]),
          ],
        );
      return onboardingGuttered("row", [labeled("logo_loop", "logo_loop"), labeled("progress_fill", "progress_fill")], 12, 1);
    },
  },
  {
    name: "bitmap",
    durationMs: 4600,
    eyebrow: "CURVY LOGO?",
    title: "Bitmap mode animates pixels.",
    body: "A single-shape SVG has nothing to stagger — the template tells you so instead of rendering a static frame. Flip on Bitmap mode to rasterize the mark and animate it pixel-by-pixel.",
    detail: "Precision: draft 32² to ultra 512² · higher = crisper, slower",
    buildVisual: (_t, slot) => {
      // Mock pixel-circle (rasterization is async — deliberately not
      // embedded). Measured slot + px/4-centered SQUARE, and every pixel
      // fades in on a diagonal stagger — the mock ASSEMBLES like bitmap
      // mode actually does.
      return slot((w, h) => {
        const N = 11;
        const rows: OnboardingComposition[] = [];
        for (let r = 0; r < N; r++) {
          const cells: Array<OnboardingComposition | null> = [];
          const weights: number[] = [];
          for (let c = 0; c < N; c++) {
            const dx = c - (N - 1) / 2;
            const dy = r - (N - 1) / 2;
            const inside = Math.sqrt(dx * dx + dy * dy) <= N / 2 - 0.4;
            cells.push(
              inside
                ? onboardingLeaf(
                    makeColorTile(P.accent, {
                      effects: { cornerRadius: 0.14 },
                      overlay: { alpha: fadeInExpr(0.2 + (r + c) * 0.09, 0.22) },
                    } as never),
                  )
                : null,
            );
            weights.push(1);
          }
          rows.push(onboardingSplit("col", weights, cells));
        }
        const grid = onboardingSplit("row", Array(N).fill(1), rows);
        const side = Math.max(2, Math.round(Math.min(w, h) * 0.9));
        const u = (px: number) => Math.max(1, Math.round(px / 4));
        const padW = Math.max(2, (w - side) / 2);
        const padH = Math.max(2, (h - side) / 2);
        const centered = onboardingSplit("col", [u(padW), u(side), u(padW)], [null, grid, null]);
        return onboardingSplit("row", [u(padH), u(side), u(padH)], [null, centered, null]);
      });
    },
  },
  {
    name: "finish",
    durationMs: 3800,
    eyebrow: "MAKE IT YOURS",
    title: "Order, color, aspect.",
    body: "Order picks the sweep: diag, scatter, cascade, radial. Presets pair ink and background — or override both. Render at your logo's own aspect for an undistorted mark.",
    detail: "MAKE renders exactly what the preview shows",
    buildVisual: (t, _slot, w) => {
      // Width-capped row font vs the TRUE text cell (17/20 of the padded
      // card): the knob list must never clip at narrow canvases (960-wide
      // caught by the text-fit contract).
      const rowTextW = w * 0.86 * (17 / 20);
      const row = (text: string) => {
        const font = Math.max(11, Math.min(t.body, Math.floor((rowTextW * 0.94) / (text.length * 0.62))));
        return onboardingSplit(
          "col",
          [2, 1, 17],
          [
            cardTile(P.accent, { radius: 0.5 }),
            null,
            onboardingLeaf(onboardingTextSource({ text, fontSize: font, color: P.textLo, hAlign: "left", label: text.slice(0, 22).toLowerCase() })),
          ],
        );
      };
      const rows = onboardingGuttered(
        "row",
        [
          row("Order: diag · scatter · cascade · radial"),
          row("Light / dark presets, or your own ink + background"),
          row("fit: contain letterboxes · fill stretches"),
          row("Match the canvas to your logo's aspect"),
        ],
        10,
        2,
      );
      return onboardingOverlay(cardTile(P.surface, { radius: 0.08, stroke: P.border }), padded(rows, 7));
    },
  },
];

// ---------------------------------------------------------------------------
// Page assembly (the blur-regions static-beat dialect).
// ---------------------------------------------------------------------------

function beatProgress(index: number, type: OnboardingTypeRamp): OnboardingComposition {
  const dots = onboardingGuttered(
    "col",
    BEATS.map((_, i) => cardTile(i === index ? P.accent : i < index ? "#7c4a12" as MosaicColor : P.border, { radius: 0.5 })),
    3,
    2,
  );
  const counter = onboardingLeaf(
    onboardingTextSource({ text: `${index + 1} / ${BEATS.length}`, fontSize: type.micro, color: P.textLo, hAlign: "left", label: "tutorial progress" }),
  );
  return onboardingSplit("col", [30, 12, 16, 30, 12], [null, counter, null, dots, null]);
}

function buildBeat(spec: BeatSpec, index: number, canvasW: number, canvasH: number): { doc: MosaicDocument; durationMs: number } {
  const type = onboardingTypeRamp(canvasW, canvasH);
  const stacked = canvasH > canvasW * 0.9;
  // TRUE copy-column width from the authored lattice fractions below —
  // never an estimate (the 0.4 legacy estimate let 960-wide canvases skip
  // the wrap and clip horizontally; the text-fit contract caught it).
  const copyWidth = stacked ? canvasW * 0.86 : canvasW * 0.34;
  const visualW = Math.round(canvasW * (stacked ? 0.88 : 0.51));
  const visualH = Math.round(canvasH * (stacked ? 0.47 : 0.83));

  const assemblePage = (slot: MeasuredSlot): OnboardingComposition => {
    const visual = spec.buildVisual(type, slot, visualW, visualH);
    // Copy bands in px (fractions ARE the authored lattice below): the
    // fit-first blocks size their fonts against these, so no canvas can
    // clip a line (the gate-21 bitmap-title catch).
    const copyH = Math.round(canvasH * (stacked ? 0.33 : 0.83));
    const bandPx = (weight: number) => (copyH * weight) / 56;
    const copy = onboardingSplit(
      "row",
      [3, 4, 15, 20, 3, 6, 5],
      [
        null,
        fittedTextBlock({ text: spec.eyebrow, fontSize: type.label, color: P.accent, cellWidthPx: copyWidth, bandPx: bandPx(4), hAlign: "left", fadeDelaySec: 0.04, label: "beat eyebrow" }),
        fittedTextBlock({ text: spec.title, fontSize: type.headline, color: P.textHi, cellWidthPx: copyWidth, bandPx: bandPx(15), hAlign: "left", widthFrac: 0.9, fadeDelaySec: 0.08, label: "beat title" }),
        fittedTextBlock({ text: spec.body, fontSize: type.body, color: P.textLo, cellWidthPx: copyWidth, bandPx: bandPx(20), hAlign: "left", widthFrac: 0.91, fadeDelaySec: 0.12, label: "beat body" }),
        null,
        fittedTextBlock({ text: spec.detail, fontSize: type.micro, color: P.accentSoft, cellWidthPx: copyWidth, bandPx: bandPx(6), hAlign: "left", fadeDelaySec: 0.16, label: "beat detail" }),
        null,
      ],
    );
    const progress = beatProgress(index, type);
    return stacked
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
  };

  const cardShell = (content: OnboardingComposition): OnboardingComposition =>
    onboardingOverlay(cardTile(P.surface, { radius: 0.06, stroke: P.border }), padded(content, 6));

  // ── Pass 1: probe. Each slot places a bare tile inside the SAME card
  // chrome as the real slot, so its resolved frame IS the logo cell —
  // true pixels, not layout-parameter estimates (the square-canvas
  // stretch came from estimating).
  const probeTiles: MosaicSource[] = [];
  const probePage = assemblePage(() => {
    const tile = makeColorTile(P.raised);
    probeTiles.push(tile);
    return cardShell(onboardingLeaf(tile));
  });
  const probed = resolveDocFrames(
    { kind: "mosaic_document", version: 1, m0: probePage.m0, sources: probePage.sources, assets: {} } as unknown as MosaicDocument,
    canvasW,
    canvasH,
  );
  const slotFrames = probeTiles.map((t) => probed.framesByLogical[probePage.sources.indexOf(t)]);

  // ── Pass 2: real. Each slot's builder receives its probed TRUE pixels.
  let slotIdx = 0;
  const page = assemblePage((build) => {
    const frame = slotFrames[slotIdx++];
    const content = frame
      ? build(Math.round(frame.width), Math.round(frame.height))
      : build(320, 240); // probe miss — arbitrary sane cell, never expected
    return cardShell(content);
  });

  return {
    doc: {
      kind: "mosaic_document",
      version: 1,
      assets: {} as MosaicDocument["assets"],
      size: { width: canvasW, height: canvasH },
      backgroundColor: P.bg,
      m0: page.m0 as MosaicDocument["m0"],
      sources: page.sources,
    },
    durationMs: spec.durationMs,
  };
}

export function renderLogoAnimateTutorial(ctx: MosaicEngineContext): MosaicDocumentPipeline {
  const W = Math.max(1, Math.round(ctx.target.width));
  const H = Math.max(1, Math.round(ctx.target.height));
  const steps: MosaicPipelineStep[] = BEATS.map((spec, i) => {
    const { doc, durationMs } = buildBeat(spec, i, W, H);
    return { name: spec.name, label: spec.title, durationMs, file: doc };
  });
  return {
    kind: "mosaic_pipeline",
    version: 1,
    fps: ctx.target.fps ?? TUTORIAL_FPS,
    durationMs: steps.reduce((a, s) => a + s.durationMs, 0),
    defaultTransition: { type: "cut" },
    backgroundColor: P.bg,
    steps,
  };
}
