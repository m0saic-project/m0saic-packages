/**
 * Screencap Grid v2 — the editor "?" tutorial.
 *
 * Eight authored pages teach the shortest path to a useful result, then reveal
 * the template's real depth. Each page is a real mosaic document; diagrams are
 * structural geometry rather than illustrations painted into a full-canvas
 * text source. The pipeline owns its fixed 25-second pace.
 */
import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicPipelineStep,
  MosaicThemeTokens,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import {
  SCREENCAP_COVER_LOGO_URI,
  SCREENCAP_COVER_PREVIEW_URL,
} from "./screencap-grid-cover-assets";
import {
  onboardingFrame,
  onboardingGuttered,
  onboardingLeaf,
  onboardingOverlay,
  onboardingSolid,
  onboardingSplit,
  onboardingTextBlock,
  onboardingTextSource,
  onboardingTimestampTile,
  onboardingTypeRamp,
  resolveScreencapOnboardingTheme,
  type OnboardingComposition,
  type OnboardingTypeRamp,
} from "./screencap-grid-cover";

const TUTORIAL_FPS = 30;
const PAGE_COUNT = 8;

// ── Real material (the founder's "dev cut" note, gate 24): every page now
//    draws from the template's REGISTERED preview render — the pane strip
//    is the real pane's pixels, "footage" tiles are sourceRect windows into
//    the sheet's own tiles — instead of flat placeholder solids. ──

const TUT_SHEET_ASSET_ID = asAssetId("screencap-tutorial-sheet");
const TUT_LOGO_ASSET_ID = asAssetId("screencap-tutorial-logo");

/** Registered-preview geometry (1920×1080 defaults render): pane 110px,
 *  then a 4×4 grid of 480×242.5 tiles. Windows inset 10px so a chip or
 *  gap seam never rides along. */
const SHEET_W = 1920;
const SHEET_PANE_H = 110;
const SHEET_TILE_W = 480;
const SHEET_TILE_H = 242.5;

function sheetTileRect(row: number, col: number): { x: number; y: number; w: number; h: number } {
  // Bottom trim is deliberately deep (46px): the sheet's own baked
  // timestamp chips ride each tile's bottom-right and must never leak
  // into a window that is standing in for raw footage.
  return {
    x: Math.round(col * SHEET_TILE_W + 10),
    y: Math.round(SHEET_PANE_H + row * SHEET_TILE_H + 10),
    w: SHEET_TILE_W - 20,
    h: Math.round(SHEET_TILE_H - 56),
  };
}

/**
 * The tutorial's media manifest. Node (CLI --tutorial, electron main) reads
 * the bundled jpg via __dirname string concat — the highlights-cover
 * web-safe pattern (the internal 2026-08-25 notes): no node:path import, asar
 * rewrite inlined. The browser uses the same picture through the public
 * template-assets URL the cover already ships.
 */
export function tutorialAssets(): MosaicAssetManifest {
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  const unpackedAsar = (p: string) =>
    p.includes("/app.asar/")
      ? p.split("/app.asar/").join("/app.asar.unpacked/")
      : p.split("\\app.asar\\").join("\\app.asar.unpacked\\");
  return {
    [TUT_SHEET_ASSET_ID]: isNode
      ? {
          kind: "file",
          path: unpackedAsar(`${__dirname}/assets/tutorial-sheet.jpg`),
          mediaType: "image",
        }
      : {
          kind: "url",
          url: SCREENCAP_COVER_PREVIEW_URL,
          mediaType: "image",
        },
    [TUT_LOGO_ASSET_ID]: {
      kind: "data-uri",
      uri: SCREENCAP_COVER_LOGO_URI,
      mediaType: "image",
      displayName: "m0saic M",
    },
  } as MosaicAssetManifest;
}

/** A real-footage window: one sheet tile's pixels, cover-filling its cell. */
export function footageWindow(row: number, col: number, label: string): OnboardingComposition {
  const source: MosaicMediaSource = {
    type: "media",
    mediaType: "image",
    assetId: TUT_SHEET_ASSET_ID,
    placement: { fit: "cover", sourceRect: sheetTileRect(row, col) },
    editor: { owner: "template", label },
  };
  return onboardingLeaf(source);
}

/** The real info pane's own pixels (title + metadata strip of the sheet). */
export function paneStrip(label: string): OnboardingComposition {
  const source: MosaicMediaSource = {
    type: "media",
    mediaType: "image",
    assetId: TUT_SHEET_ASSET_ID,
    placement: { fit: "cover", sourceRect: { x: 0, y: 0, w: SHEET_W, h: SHEET_PANE_H } },
    editor: { owner: "template", label },
  };
  return onboardingLeaf(source);
}

/** The whole registered sheet, contain-fit — "this is the deliverable". */
export function sheetStill(label: string, fit: "contain" | "cover" = "contain"): OnboardingComposition {
  const source: MosaicMediaSource = {
    type: "media",
    mediaType: "image",
    assetId: TUT_SHEET_ASSET_ID,
    placement: { fit },
    editor: { owner: "template", label },
  };
  return onboardingLeaf(source);
}

/** A footage window carrying a real timestamp chip in a chosen corner. */
export function windowWithChip(args: {
  row: number;
  col: number;
  chipText: string;
  corner: "tl" | "tr" | "bl" | "br";
  chipColor: MosaicColor;
  chipBg: MosaicColor;
  chipFontSize: number;
}): OnboardingComposition {
  const chip = onboardingLeaf(
    onboardingTextSource({
      text: args.chipText,
      fontSize: args.chipFontSize,
      color: args.chipColor,
      backgroundColor: args.chipBg,
      label: `chip ${args.chipText}`,
    }),
  );
  const onRight = args.corner === "tr" || args.corner === "br";
  const onBottom = args.corner === "bl" || args.corner === "br";
  const h = onboardingSplit("col", onRight ? [4, 1] : [1, 4], onRight ? [null, chip] : [chip, null]);
  const anchored = onboardingSplit("row", onBottom ? [2, 1] : [1, 2], onBottom ? [null, h] : [h, null]);
  return onboardingOverlay(footageWindow(args.row, args.col, `chip tile ${args.corner}`), anchored);
}

/** The cover's brand row: M mark + product name, opening every page. */
export function tutorialBrand(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
  productName = "Screencap Grid",
): OnboardingComposition {
  const logo = onboardingLeaf({
    type: "media",
    mediaType: "image",
    assetId: TUT_LOGO_ASSET_ID,
    placement: { fit: "contain" },
    editor: { owner: "template", label: "m0saic M logo" },
  } as MosaicMediaSource);
  const name = onboardingLeaf(
    onboardingTextSource({
      text: productName,
      fontSize: Math.max(type.body, Math.round(type.headline * 0.55)),
      color: theme.textPrimary,
      hAlign: "left",
      label: "tutorial product name",
    }),
  );
  return onboardingSplit("col", [4, 2, 24], [logo, null, name]);
}

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

function realGrid(
  rows: number,
  cols: number,
  tileAt: (row: number, col: number) => OnboardingComposition,
): OnboardingComposition {
  const rowCompositions: OnboardingComposition[] = [];
  for (let row = 0; row < rows; row++) {
    const cells: OnboardingComposition[] = [];
    for (let col = 0; col < cols; col++) {
      cells.push(tileAt(row, col));
    }
    rowCompositions.push(onboardingGuttered("col", cells, 12, 1));
  }
  return onboardingGuttered("row", rowCompositions, 12, 1);
}

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

function buildIdeaVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  // Eight real moments, sweeping the sheet's own tiles in reading order —
  // the timeline strip IS footage now, not colored placeholders.
  const sweep: Array<[number, number]> = [
    [0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 2], [2, 1], [2, 3],
  ];
  const timeline = onboardingGuttered(
    "col",
    sweep.map(([r, c], i) => footageWindow(r, c, `timeline moment ${i + 1}`)),
    8,
    1,
  );
  const sheet = onboardingFrame(sheetStill("idea result sheet"), theme.borderStrong);
  return onboardingFrame(
    onboardingSplit(
      "row",
      [2, 4, 1, 2, 13],
      [
        diagramLabel("ONE TIMELINE", theme, type),
        timeline,
        null,
        diagramLabel("SIXTEEN MOMENTS · ONE SHEET", theme, type),
        sheet,
      ],
    ),
    theme.borderStrong,
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

function buildInputVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const choices = onboardingGuttered(
    "col",
    [
      fileCard("clip.mov", theme, type),
      fileCard("A.mov + B.mov", theme, type),
      fileCard("directory/", theme, type),
    ],
  );
  const arrow = onboardingSplit(
    "col",
    [2, 8, 2],
    [null, onboardingSolid(theme.accent, 0.08), null],
  );
  const result = onboardingFrame(sheetStill("sources result sheet"), theme.borderStrong);
  return onboardingFrame(
    onboardingSplit(
      "row",
      [2, 1, 12, 1, 2],
      [
        diagramLabel("SOURCE(S) · REQUIRED", theme, type),
        null,
        onboardingSplit("col", [6, 1, 9], [choices, arrow, result]),
        null,
        diagramLabel("PICK OR DROP · DEFAULTS DO THE REST", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function buildBatchVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const inputs = onboardingGuttered(
    "col",
    ["A.mov", "B.mov", "C.mov"].map((name) => fileCard(name, theme, type)),
  );
  const outputs = onboardingGuttered(
    "col",
    ["A.png", "B.png", "C.png"].map((name) =>
      onboardingSplit(
        "row",
        [5, 2],
        [
          onboardingFrame(sheetStill(`batch output ${name}`), theme.borderStrong),
          fileCard(name, theme, type, true),
        ],
      ),
    ),
  );
  const flowRule = onboardingSplit(
    "col",
    [2, 8, 2],
    [null, onboardingSolid(theme.accent, 0.08), null],
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [2, 5, 1, 7, 2],
      [
        diagramLabel("SOURCES", theme, type),
        inputs,
        flowRule,
        outputs,
        diagramLabel("ONE NAMED OUTPUT PER FILE", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function motionTile(
  row: number,
  col: number,
  theme: MosaicThemeTokens,
): OnboardingComposition {
  // A real footage window with the accent playhead riding its right edge.
  const progress = onboardingSplit(
    "row",
    [8, 1],
    [null, onboardingSolid(theme.accent)],
  );
  return onboardingOverlay(footageWindow(row, col, "playing tile"), progress);
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
      onboardingFrame(sheetStill("png contact sheet"), theme.borderStrong),
      null,
      diagramLabel("EVERY TILE IS STILL", theme, type),
    ],
  );
  const playingGrid = realGrid(2, 3, (row, col) => motionTile(row, col + 1, theme));
  const animated = onboardingSplit(
    "row",
    [3, 1, 12, 1, 3],
    [
      diagramLabel("MP4", theme, type, theme.surfaceRaised),
      null,
      playingGrid,
      null,
      diagramLabel("EVERY TILE PLAYS FROM ITS TIMESTAMP", theme, type),
    ],
  );
  return onboardingFrame(
    onboardingGuttered("row", [still, animated], 12, 2),
    theme.borderStrong,
  );
}

function buildLayoutVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const grid = realGrid(4, 4, (row, col) =>
    col === 1
      ? onboardingFrame(footageWindow(row, col, `layout tile r${row} highlighted`), theme.accent)
      : footageWindow(row, col, `layout tile r${row}c${col}`),
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [2, 1, 18, 1, 2],
      [
        diagramLabel("4 ROWS · 4 COLS", theme, type),
        null,
        grid,
        null,
        diagramLabel("16 EVENLY SPACED MOMENTS", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function fitCard(
  label: string,
  footer: string,
  contain: boolean,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const media = contain
    ? onboardingSplit(
        "col",
        [2, 6, 2],
        [
          onboardingSolid(theme.surfaceInset),
          footageWindow(0, 3, "contain letterboxed frame"),
          onboardingSolid(theme.surfaceInset),
        ],
      )
    : footageWindow(0, 3, "cover cropped frame");
  return onboardingSplit(
    "row",
    [2, 1, 10, 1, 2],
    [
      diagramLabel(label, theme, type, theme.surfaceRaised),
      null,
      media,
      null,
      diagramLabel(footer, theme, type),
    ],
  );
}

function buildTilesVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const fits = onboardingGuttered(
    "row",
    [
      fitCard("COVER", "CROPS TO FILL", false, theme, type),
      fitCard("CONTAIN", "KEEPS THE WHOLE FRAME", true, theme, type),
    ],
    12,
    2,
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [16, 1, 2],
      [
        fits,
        null,
        diagramLabel("GAP IS EXACT IN PIXELS AT EVERY CANVAS", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function buildDetailsVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  // The top band IS the registered render's info pane — its actual pixels.
  // Window the LEFT 1280px so the band's aspect stays close to the strip's
  // and cover-fit never zooms into a fragment.
  const pane = onboardingFrame(
    onboardingLeaf({
      type: "media",
      mediaType: "image",
      assetId: TUT_SHEET_ASSET_ID,
      placement: { fit: "cover", focusX: 0, sourceRect: { x: 0, y: 0, w: 1280, h: SHEET_PANE_H } },
      editor: { owner: "template", label: "real info pane strip" },
    } as MosaicMediaSource),
    theme.borderStrong,
  );
  const strips = onboardingGuttered(
    "row",
    [
      windowWithChip({
        row: 1, col: 2, chipText: "00:12", corner: "br",
        chipColor: "#ffffff" as MosaicColor, chipBg: "#000000" as MosaicColor,
        chipFontSize: type.label,
      }),
      windowWithChip({
        row: 0, col: 1, chipText: "00:31", corner: "tl",
        chipColor: "#ffffff" as MosaicColor, chipBg: "#000000" as MosaicColor,
        chipFontSize: type.label,
      }),
      windowWithChip({
        row: 2, col: 1, chipText: "00:50", corner: "br",
        chipColor: "#0d0d0d" as MosaicColor, chipBg: theme.accent,
        chipFontSize: type.label,
      }),
    ],
    12,
    1,
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [3, 1, 12, 1, 2],
      [
        pane,
        null,
        strips,
        null,
        diagramLabel("PANE ALIGN · CHIP CORNER · CHIP COLORS", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

function numberedTile(
  number: string,
  row: number,
  col: number,
  emphasized: boolean,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const badge = onboardingLeaf(
    onboardingTextSource({
      text: number,
      fontSize: type.headline,
      color: theme.textPrimary,
      backgroundColor: "#0d0d0d@0.55" as MosaicColor,
      label: `custom cell ${number}`,
    }),
  );
  const anchored = onboardingSplit(
    "row",
    [3, 7],
    [onboardingSplit("col", [3, 7], [badge, null]), null],
  );
  const win = onboardingOverlay(
    footageWindow(row, col, `custom cell footage ${number}`),
    anchored,
  );
  return emphasized ? onboardingFrame(win, theme.accent) : win;
}

function buildCustomGridVisual(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const right = onboardingSplit(
    "row",
    [4, 1, 3],
    [
      numberedTile("2", 1, 1, false, theme, type),
      null,
      numberedTile("3", 2, 2, false, theme, type),
    ],
  );
  const customGrid = onboardingSplit(
    "col",
    [6, 1, 4],
    [numberedTile("1", 1, 2, true, theme, type), null, right],
  );
  return onboardingFrame(
    onboardingSplit(
      "row",
      [2, 1, 16, 1, 2],
      [
        diagramLabel("ADVANCED · CUSTOM GRID  2(1,2[1,1])", theme, type),
        null,
        customGrid,
        null,
        diagramLabel("CELLS BIND IN DOCUMENT ORDER", theme, type),
      ],
    ),
    theme.borderStrong,
  );
}

const PAGES: TutorialPageSpec[] = [
  {
    name: "idea",
    durationMs: 3600,
    eyebrow: "01 · THE IDEA",
    title: "See time all at once.",
    body:
      "I sample a video from beginning to end, then give every moment a real tile. The default 4 × 4 sheet is ready as soon as Source(s) has a file.",
    detail: "One timeline · sixteen moments",
    buildVisual: buildIdeaVisual,
  },
  {
    name: "sources",
    durationMs: 4000,
    eyebrow: "02 · SOURCE(S)",
    title: "Bring footage your way.",
    body:
      "Source(s) is the one required field. Pick one video, multi-select files, choose an entire directory, or drop videos onto Make. The defaults do the rest.",
    detail: "One file · many files · a whole directory",
    buildVisual: buildInputVisual,
  },
  {
    name: "batch",
    durationMs: 4000,
    eyebrow: "03 · MULTI-FILE",
    title: "Batch is built in.",
    body:
      "One source makes one sheet. Several sources fan out cleanly — one named deliverable per file, in the output format you choose.",
    detail: "1 input · 1 output   N inputs · N outputs",
    buildVisual: buildBatchVisual,
  },
  {
    name: "output",
    durationMs: 4400,
    eyebrow: "04 · OUTPUT",
    title: "Choose what time does.",
    body:
      "PNG freezes one sampled frame in every tile. MP4 lets every tile play from its own timestamp. Output changes the deliverable, not just the extension.",
    detail: "PNG · scan   MP4 · watch",
    buildVisual: buildOutputVisual,
  },
  {
    name: "layout",
    durationMs: 4200,
    eyebrow: "05 · LAYOUT",
    title: "Shape the sheet.",
    body:
      "Rows and Cols set the rhythm and the sample count. The default 4 × 4 grid reads sixteen evenly spaced moments from beginning to end.",
    detail: "Rows 4 · Cols 4 · sixteen sampled moments",
    buildVisual: buildLayoutVisual,
  },
  {
    name: "tiles",
    durationMs: 4200,
    eyebrow: "06 · TILES",
    title: "Decide what each tile keeps.",
    body:
      "Gap is carved in exact pixels at every canvas. Fit cover crops each frame to fill its tile; contain keeps the whole frame and letterboxes the rest.",
    detail: "Gap 2 px · Fit cover or contain",
    buildVisual: buildTilesVisual,
  },
  {
    name: "details",
    durationMs: 4200,
    eyebrow: "07 · CONTEXT",
    title: "Keep the context.",
    body:
      "Hide the Info Pane or align it left, center, or right. Hide timestamps or move them to any corner, then set their text and background colors.",
    detail: "Pane align · timestamp corner · text and background color",
    buildVisual: buildDetailsVisual,
  },
  {
    name: "custom-grid",
    durationMs: 4400,
    eyebrow: "08 · ADVANCED",
    title: "The grid is still yours.",
    body:
      "Rows × Cols is the fast path. Advanced: Custom Grid replaces it with authored m0, so one moment can take more space. Fit, gap, pane, and timestamps still apply.",
    detail: "Start with Source(s). The expert controls can wait.",
    buildVisual: buildCustomGridVisual,
  },
];

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
      tutorialBrand(theme, type),
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
        color: theme.accentSoft,
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

/** Build the fixed, scrubbable eight-page walkthrough. */
export function renderScreencapGridV2Tutorial(
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
