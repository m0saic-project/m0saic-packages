/**
 * Aspect-safe screencap grid — the editor "?" tutorial.
 *
 * Seven pages in the rebuilt screencap_grid/v2 tutorial language (gate 24):
 * brand row on every page, and REAL material throughout — footage tiles are
 * `sourceRect` windows into the family's registered render (imported from
 * the v2 tutorial's exported machinery), so nothing reads as placeholder
 * blocks. The story is this template's own: one video → a coordinated
 * landscape + portrait pair, steered by the shape question.
 */
import type {
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicThemeTokens,
} from "@m0saic/types";
import {
  onboardingFrame,
  onboardingGuttered,
  onboardingLeaf,
  onboardingOverlay,
  onboardingSolid,
  onboardingSplit,
  onboardingTextBlock,
  onboardingTextSource,
  onboardingTypeRamp,
  resolveScreencapOnboardingTheme,
  type OnboardingComposition,
  type OnboardingTypeRamp,
} from "../../screencap_grid/v2/screencap-grid-cover";
import {
  footageWindow,
  sheetStill,
  tutorialAssets,
  tutorialBrand,
} from "../../screencap_grid/v2/screencap-grid-tutorial";

const TUTORIAL_FPS = 30;
const PAGE_COUNT = 7;

type TutorialPageSpec = {
  name: string;
  durationMs: number;
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  buildVisual: (
    theme: MosaicThemeTokens,
    type: OnboardingTypeRamp,
  ) => OnboardingComposition;
};

function diagramLabel(
  text: string,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
  backgroundColor = theme.surfaceInset,
): OnboardingComposition {
  return onboardingLeaf(
    onboardingTextSource({
      text,
      fontSize: type.micro,
      color: theme.textSecondary,
      hAlign: "center",
      backgroundColor,
      label: text.toLowerCase(),
    }),
  );
}

function fileCard(
  text: string,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
  output = false,
): OnboardingComposition {
  return onboardingLeaf(
    onboardingTextSource({
      text,
      fontSize: type.callout,
      color: output ? theme.accent : theme.textPrimary,
      backgroundColor: output ? theme.surfaceInset : theme.surfaceRaised,
      label: output ? "output file" : "source file",
    }),
  );
}

/** A mini grid of real footage windows with a gutter — rows × cols. */
function miniGrid(
  rows: number,
  cols: number,
  windows: Array<[number, number]>,
  labelPrefix: string,
): OnboardingComposition {
  let i = 0;
  const rowComps: OnboardingComposition[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: OnboardingComposition[] = [];
    for (let c = 0; c < cols; c++) {
      const [wr, wc] = windows[i % windows.length];
      i++;
      cells.push(footageWindow(wr, wc, `${labelPrefix} r${r}c${c}`));
    }
    rowComps.push(onboardingGuttered("col", cells, 8, 1));
  }
  return onboardingGuttered("row", rowComps, 8, 1);
}

/** The 8 scenic moments the v2 tutorial sweeps (credits row avoided). */
const MOMENTS: Array<[number, number]> = [
  [0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 2], [2, 1], [2, 3],
];

/** A framed orientation card: label on top, mini grid below. */
function orientationCard(
  label: string,
  grid: OnboardingComposition,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  return onboardingFrame(
    onboardingSplit("row", [2, 1, 12], [diagramLabel(label, theme, type), null, grid]),
    theme.borderStrong,
  );
}

// ── Page visuals ──────────────────────────────────────────────

function buildIdeaVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  // The SAME eight moments arranged 2×4 on desktop and 4×2 on mobile —
  // the coordinated pair in one glance.
  // Desktop card vertically inset so its 2 × 4 grid lands LANDSCAPE cells;
  // the mobile column stays full height (portrait cells fall out naturally).
  const landscape = onboardingSplit(
    "row",
    [3, 10, 3],
    [
      null,
      orientationCard("DESKTOP · 2 × 4", miniGrid(2, 4, MOMENTS, "idea landscape"), theme, type),
      null,
    ],
  );
  const portrait = orientationCard(
    "MOBILE · 4 × 2",
    miniGrid(4, 2, MOMENTS, "idea portrait"),
    theme,
    type,
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [1, 14, 1, 2],
      [
        null,
        onboardingSplit("col", [12, 1, 5], [landscape, null, portrait]),
        null,
        diagramLabel("SAME 8 MOMENTS · SAME CELL SHAPE", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function buildSourcesVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const inputs = onboardingGuttered(
    "col",
    [fileCard("A.mov", theme, type), fileCard("B.mov", theme, type)],
  );
  const outputs = onboardingGuttered(
    "row",
    [
      onboardingGuttered("col", [
        fileCard("A__landscape.png", theme, type, true),
        fileCard("A__portrait.png", theme, type, true),
      ], 8, 1),
      onboardingGuttered("col", [
        fileCard("B__landscape.png", theme, type, true),
        fileCard("B__portrait.png", theme, type, true),
      ], 8, 1),
    ],
    8,
    1,
  );
  const flowRule = onboardingSplit(
    "col",
    [2, 8, 2],
    [null, onboardingSolid(theme.accent, 0.08), null],
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [2, 4, 1, 8, 2],
      [
        diagramLabel("SOURCE(S) · REQUIRED", theme, type),
        inputs,
        flowRule,
        outputs,
        diagramLabel("2 NAMED OUTPUTS PER FILE", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function buildShapeVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  // Three shape answers, each realized as real cells of that shape.
  const cards = onboardingGuttered(
    "col",
    [
      onboardingSplit("row", [10, 2], [
        miniGrid(3, 2, MOMENTS, "shape landscape"),
        diagramLabel("LANDSCAPE 16:9", theme, type, theme.surfaceRaised),
      ]),
      onboardingSplit("row", [10, 2], [
        miniGrid(3, 3, MOMENTS, "shape square"),
        diagramLabel("SQUARE 1:1", theme, type, theme.surfaceRaised),
      ]),
      onboardingSplit("row", [10, 2], [
        miniGrid(2, 4, MOMENTS, "shape portrait"),
        diagramLabel("PORTRAIT 9:16", theme, type, theme.surfaceRaised),
      ]),
    ],
    12,
    2,
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [14, 1, 2],
      [cards, null, diagramLabel("ONE ANSWER STEERS BOTH GRIDS", theme, type)],
    ),
    theme.borderStrong,
  );
}

function buildChoiceVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  // The ranked list: three candidate pairs, #0 wearing the accent frame.
  const candidate = (
    label: string,
    rows: number,
    cols: number,
    best: boolean,
  ): OnboardingComposition => {
    const grid = miniGrid(rows, cols, MOMENTS, `choice ${label}`);
    const card = onboardingSplit(
      "row",
      [2, 10],
      [diagramLabel(label, theme, type, best ? theme.accentSoft : theme.surfaceRaised), grid],
    );
    return best
      ? onboardingFrame(card, theme.accent)
      : onboardingFrame(card, theme.border);
  };
  return onboardingFrame(
    onboardingSplit(
      "row",
      [14, 1, 2],
      [
        onboardingGuttered(
          "col",
          [
            candidate("0 · BEST", 3, 4, true),
            candidate("1", 2, 4, false),
            candidate("2", 4, 4, false),
          ],
          10,
          1,
        ),
        null,
        diagramLabel("GRID CHOICE WALKS THE RANKED PAIRS", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function buildSearchVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const sparse = orientationCard(
    "MIN CELLS 4",
    miniGrid(2, 2, MOMENTS, "search sparse"),
    theme,
    type,
  );
  const dense = orientationCard(
    "MAX CELLS 32",
    miniGrid(4, 8, MOMENTS, "search dense"),
    theme,
    type,
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [1, 14, 1, 2],
      [
        null,
        onboardingSplit("col", [7, 1, 10], [sparse, null, dense]),
        null,
        diagramLabel("CELL ASPECT (EXACT) OVERRIDES THE PRESET", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function buildOutputVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const still = onboardingSplit(
    "row",
    [3, 1, 12, 1, 3],
    [
      diagramLabel("PNG", theme, type, theme.surfaceRaised),
      null,
      onboardingFrame(sheetStill("png pair sheet"), theme.borderStrong),
      null,
      diagramLabel("EVERY TILE IS STILL", theme, type),
    ],
  );
  const playing = (row: number, col: number): OnboardingComposition =>
    onboardingOverlay(
      footageWindow(row, col, "playing tile"),
      onboardingSplit("row", [8, 1], [null, onboardingSolid(theme.accent)]),
    );
  const animated = onboardingSplit(
    "row",
    [3, 1, 12, 1, 3],
    [
      diagramLabel("MP4", theme, type, theme.surfaceRaised),
      null,
      onboardingGuttered("col", [playing(0, 1), playing(1, 2), playing(2, 1)], 8, 1),
      null,
      diagramLabel("EVERY TILE PLAYS FROM ITS TIMESTAMP", theme, type),
    ],
  );
  return onboardingFrame(
    onboardingGuttered("row", [still, animated], 12, 2),
    theme.borderStrong,
  );
}

function buildStartVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const pair = onboardingSplit(
    "col",
    [12, 1, 5],
    [
      onboardingSplit(
        "row",
        [3, 10, 3],
        [
          null,
          orientationCard("DESKTOP", miniGrid(2, 4, MOMENTS, "start landscape"), theme, type),
          null,
        ],
      ),
      null,
      orientationCard("MOBILE", miniGrid(4, 2, MOMENTS, "start portrait"), theme, type),
    ],
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [1, 14, 1, 2],
      [
        null,
        pair,
        null,
        diagramLabel("SOURCE(S) IS ALL IT NEEDS", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

// ── Pages ─────────────────────────────────────────────────────

const PAGES: TutorialPageSpec[] = [
  {
    name: "idea",
    durationMs: 4000,
    eyebrow: "01 · THE IDEA",
    title: "Both orientations. One pass.",
    body:
      "Every source video renders a coordinated pair: a desktop landscape grid and a mobile portrait grid — the same cell count, the same cell shape, exact at both canvases. Not a transpose; a matched pair.",
    detail: "One video · two deliverables",
    buildVisual: buildIdeaVisual,
  },
  {
    name: "sources",
    durationMs: 3800,
    eyebrow: "02 · SOURCE(S)",
    title: "Bring footage your way.",
    body:
      "Source(s) is the one required field. Pick files or a whole directory — every file fans out to two named outputs, __landscape and __portrait.",
    detail: "N inputs · 2 × N outputs",
    buildVisual: buildSourcesVisual,
  },
  {
    name: "shape",
    durationMs: 4200,
    eyebrow: "03 · CELL SHAPE",
    title: "Answer the shape question.",
    body:
      "What shape should a cell be? Landscape 16:9 suits video frames; square and portrait re-factorize both grids — portrait cells put many columns on the desktop canvas and many rows on mobile.",
    detail: "Landscape · square · portrait",
    buildVisual: buildShapeVisual,
  },
  {
    name: "choice",
    durationMs: 4000,
    eyebrow: "04 · GRID CHOICE",
    title: "Scroll the ranked pairs.",
    body:
      "The search enumerates every feasible pair in the cell-count window and ranks them — both orientations closest to your shape first. Grid Choice walks that list; 0 is the best match.",
    detail: "0 = best · out-of-range clamps",
    buildVisual: buildChoiceVisual,
  },
  {
    name: "search",
    durationMs: 4000,
    eyebrow: "05 · GRID SEARCH",
    title: "Tune the sweep.",
    body:
      "Min and Max Cells bound the search — few cells for big readable tiles, many for dense sheets. Cell Aspect (exact) overrides the preset when you need 3:2, 4:5, or anything else.",
    detail: "Min Cells · Max Cells · Cell Aspect (exact)",
    buildVisual: buildSearchVisual,
  },
  {
    name: "output",
    durationMs: 4000,
    eyebrow: "06 · OUTPUT",
    title: "Choose what time does.",
    body:
      "PNG freezes one sampled frame per tile — contact sheets for both orientations. MP4 lets every tile play from its own timestamp. Info pane, timestamps, gap, and fit all still apply.",
    detail: "PNG · scan   MP4 · watch",
    buildVisual: buildOutputVisual,
  },
  {
    name: "start",
    durationMs: 3600,
    eyebrow: "07 · START",
    title: "The pair is one drop away.",
    body:
      "Defaults do the rest: landscape cells, the best-ranked pair, info pane and timestamps on. Drop a video into Source(s) and read both orientations at once.",
    detail: "Start with Source(s). The expert controls can wait.",
    buildVisual: buildStartVisual,
  },
];

// ── Page chrome (the v2 rebuilt-page shell) ───────────────────

function pageProgress(
  pageIndex: number,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const counter = onboardingLeaf(
    onboardingTextSource({
      text: `${String(pageIndex + 1).padStart(2, "0")} / ${String(PAGE_COUNT).padStart(2, "0")}`,
      fontSize: type.micro,
      color: theme.textMuted,
      hAlign: "left",
      label: "tutorial progress",
    }),
  );
  const bars = onboardingGuttered(
    "col",
    Array.from({ length: PAGE_COUNT }, (_, index) =>
      onboardingSolid(
        index === pageIndex
          ? theme.accent
          : index < pageIndex
            ? theme.accentSoft
            : theme.border,
        index === pageIndex ? 0.04 : undefined,
      ),
    ),
    8,
    1,
  );
  return onboardingSplit(
    "col",
    [6, 12, 48, 28, 6],
    [null, counter, null, bars, null],
  );
}

function pageCopy(
  spec: TutorialPageSpec,
  copyWidth: number,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  return onboardingSplit(
    "row",
    [4, 3, 1, 2, 4, 14, 16, 3, 6, 3],
    [
      tutorialBrand(theme, type, "Aspect Safe Grid"),
      null,
      onboardingSolid(theme.accent, 0.03),
      null,
      onboardingTextBlock({
        text: spec.eyebrow,
        fontSize: type.label,
        color: theme.eyebrow,
        cellWidthPx: copyWidth,
        hAlign: "left",
        fadeDelaySec: 0.04,
        label: "page eyebrow",
      }),
      onboardingTextBlock({
        text: spec.title,
        fontSize: type.headline,
        color: theme.textPrimary,
        cellWidthPx: copyWidth,
        hAlign: "left",
        widthFrac: 0.9,
        fadeDelaySec: 0.08,
        label: "page title",
      }),
      onboardingTextBlock({
        text: spec.body,
        fontSize: type.body,
        color: theme.textSecondary,
        cellWidthPx: copyWidth,
        hAlign: "left",
        widthFrac: 0.91,
        fadeDelaySec: 0.12,
        label: "page body",
      }),
      null,
      onboardingTextBlock({
        text: spec.detail,
        fontSize: type.micro,
        color: theme.accentSoft as MosaicColor,
        cellWidthPx: copyWidth,
        hAlign: "left",
        fadeDelaySec: 0.16,
        label: "page detail",
      }),
      null,
    ],
  );
}

function buildPage(
  spec: TutorialPageSpec,
  pageIndex: number,
  canvasW: number,
  canvasH: number,
  theme: MosaicThemeTokens,
): MosaicDocument {
  const type = onboardingTypeRamp(canvasW, canvasH);
  const stacked = canvasH > canvasW * 0.9;
  const copyWidth = stacked ? canvasW * 0.84 : canvasW * 0.38;
  const copy = pageCopy(spec, copyWidth, theme, type);
  const visual = spec.buildVisual(theme, type);
  const progress = pageProgress(pageIndex, theme, type);

  const page = stacked
    ? onboardingSplit(
        "row",
        [4, 34, 4, 43, 2, 7, 6],
        [
          null,
          onboardingSplit("col", [8, 84, 8], [null, copy, null]),
          null,
          onboardingSplit("col", [7, 86, 7], [null, visual, null]),
          null,
          progress,
          null,
        ],
      )
    : onboardingSplit(
        "row",
        [6, 80, 8, 6],
        [
          null,
          onboardingSplit(
            "col",
            [6, 38, 5, 45, 6],
            [null, copy, null, visual, null],
          ),
          progress,
          null,
        ],
      );

  return {
    kind: "mosaic_document",
    version: 1,
    assets: tutorialAssets(),
    size: { width: canvasW, height: canvasH },
    backgroundColor: theme.surfaceApp,
    m0: page.m0 as MosaicDocument["m0"],
    sources: page.sources,
  };
}

/** Build the fixed, scrubbable seven-page walkthrough. */
export function renderScreencapGridAspectSafeTutorial(
  ctx: MosaicEngineContext,
): MosaicDocumentPipeline {
  const canvasW = ctx.target.width;
  const canvasH = ctx.target.height;
  const theme = resolveScreencapOnboardingTheme(ctx);
  const steps: MosaicPipelineStep[] = PAGES.map((page, pageIndex) => ({
    name: page.name,
    durationMs: page.durationMs,
    file: buildPage(page, pageIndex, canvasW, canvasH, theme),
  }));

  return {
    kind: "mosaic_pipeline",
    version: 1,
    fps: ctx.target.fps ?? TUTORIAL_FPS,
    durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
    defaultTransition: { type: "cut" },
    backgroundColor: theme.surfaceApp,
    steps,
  };
}
