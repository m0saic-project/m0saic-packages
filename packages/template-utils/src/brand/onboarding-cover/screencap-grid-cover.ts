/**
 * Screencap Grid v2 — first-open cover and the small design kit shared with
 * its tutorial.
 *
 * Hoisted copy of `packages/templates/src/m0saic/media/screencap_grid/v2/
 * screencap-grid-cover.ts` (the original stays for the frozen first-party
 * templates). Only the imports differ: the `@m0saic/template-utils` helpers
 * are reached relatively and the theme preset is the sibling `theme-tokens`.
 *
 * The cover is editor-only. It replaces the zero-input error on a pure-default
 * first open, then disappears permanently after the first prop edit. It never
 * reads media, time, or ambient state.
 *
 * Every visible region below is real m0 geometry. Copy is split into one cell
 * per line because static SVG text does not soft-wrap (and its v1 path ignores
 * drawtext y expressions). The production cover uses a bundled brand mark and
 * the template registry's own preview image; the tutorial owns the diagrams.
 */
import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicSource,
  MosaicTextSource,
  MosaicThemeTokens,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import { applyTheme } from "../../theming/theming";
import { fadeInExpr } from "../../anim";
import { makeColorTile } from "../../sources/makeColorTile";
import { wrapText } from "../../text/wrapText";
import { resolveTheme } from "./theme-tokens";
import {
  SCREENCAP_COVER_LOGO_URI,
  SCREENCAP_COVER_PREVIEW_URL,
} from "./screencap-grid-cover-assets";

/** Canonical Desktop dark tokens, sourced from App.css through theming/v1. */
export const SCREENCAP_ONBOARDING_THEME = resolveTheme("dark");

/**
 * Resolve the onboarding palette. The canonical Desktop tokens are the local
 * fallback; an upstream theme may override them through the standard channel.
 */
export function resolveScreencapOnboardingTheme(
  ctx: MosaicEngineContext,
): MosaicThemeTokens {
  return applyTheme(SCREENCAP_ONBOARDING_THEME, ctx);
}

export type OnboardingTypeRamp = {
  display: number;
  headline: number;
  body: number;
  callout: number;
  label: number;
  micro: number;
  chip: number;
};

const clampRound = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/**
 * Optical type ramp driven by the canvas short edge. Each role has its own
 * ratio and clamp: display type grows faster than utility copy, so the
 * hierarchy survives thumbnails, portrait canvases, and very large stages
 * without behaving like one uniformly-scaled poster.
 */
export function onboardingTypeRamp(
  canvasW: number,
  canvasH: number,
): OnboardingTypeRamp {
  const shortEdge = Math.max(1, Math.min(canvasW, canvasH));
  return {
    display: clampRound(shortEdge * 0.072, 18, 88),
    headline: clampRound(shortEdge * 0.052, 15, 58),
    body: clampRound(shortEdge * 0.027, 11, 30),
    callout: clampRound(shortEdge * 0.022, 10, 24),
    label: clampRound(shortEdge * 0.016, 8, 18),
    micro: clampRound(shortEdge * 0.0125, 8, 14),
    chip: clampRound(shortEdge * 0.011, 8, 12),
  };
}

/**
 * Cover typography follows the stage above 1080p instead of staying pinned to
 * the shared tutorial caps. Normalize the canvas to a 1080px short edge, build
 * the established optical ramp there, then scale every role back up. A 4K
 * cover therefore gets exactly 2× the 1080p type while preserving wrapping
 * and hierarchy; compact canvases retain the shared ramp's minimums.
 */
export function coverTypeRamp(
  canvasW: number,
  canvasH: number,
): OnboardingTypeRamp {
  const shortEdge = Math.max(1, Math.min(canvasW, canvasH));
  const stageScale = Math.max(1, shortEdge / 1080);
  const base = onboardingTypeRamp(
    canvasW / stageScale,
    canvasH / stageScale,
  );
  const scale = (value: number) => Math.max(1, Math.round(value * stageScale));
  return {
    display: scale(base.display),
    headline: scale(base.headline),
    body: scale(base.body),
    callout: scale(base.callout),
    label: scale(base.label),
    micro: scale(base.micro),
    chip: scale(base.chip),
  };
}

/** A piece of real m0 geometry and the sources bound to its leaves. */
export type OnboardingComposition = {
  m0: string;
  sources: MosaicSource[];
};

export function onboardingLeaf(source: MosaicSource): OnboardingComposition {
  return { m0: "1", sources: [source] };
}

/**
 * Split compositions in document order. Null entries are actual `-` space and
 * therefore produce no source.
 */
export function onboardingSplit(
  axis: "row" | "col",
  weights: number[],
  parts: Array<OnboardingComposition | null>,
): OnboardingComposition {
  if (weights.length !== parts.length || parts.length < 2) {
    throw new Error("onboardingSplit requires matching weights and 2+ parts");
  }
  return {
    m0: weightedSplit(weights, axis, {
      claimants: parts.map((part) => part?.m0 ?? "-"),
    }),
    sources: parts.flatMap((part) => part?.sources ?? []),
  };
}

/** Attach paint geometry over a base while preserving both real rect trees. */
export function onboardingOverlay(
  base: OnboardingComposition,
  paint: OnboardingComposition,
): OnboardingComposition {
  return {
    m0: `${base.m0}{${paint.m0}}`,
    sources: [...base.sources, ...paint.sources],
  };
}

/** Even items separated by real null gutters. */
export function onboardingGuttered(
  axis: "row" | "col",
  items: OnboardingComposition[],
  itemWeight = 12,
  gutterWeight = 1,
): OnboardingComposition {
  if (items.length === 1) return items[0];
  const parts: Array<OnboardingComposition | null> = [];
  const weights: number[] = [];
  items.forEach((item, index) => {
    if (index > 0) {
      parts.push(null);
      weights.push(gutterWeight);
    }
    parts.push(item);
    weights.push(itemWeight);
  });
  return onboardingSplit(axis, weights, parts);
}

/** One deterministic, literal SVG-glyph text cell. */
export function onboardingTextSource(args: {
  text: string;
  fontSize: number;
  color: MosaicColor;
  hAlign?: "left" | "center" | "right";
  backgroundColor?: MosaicColor;
  fadeDelaySec?: number;
  label?: string;
}): MosaicTextSource {
  const hAlign = args.hAlign ?? "center";
  return {
    type: "text",
    rasterizer: "svg",
    style: { fontSize: args.fontSize, fontColor: args.color },
    layers: [{ content: { kind: "literal", text: args.text } }],
    placement: { hAlign, vAlign: "middle" },
    ...(args.backgroundColor
      ? { visual: { backgroundColor: args.backgroundColor } }
      : {}),
    ...(args.fadeDelaySec != null
      ? { overlay: { alpha: fadeInExpr(args.fadeDelaySec, 0.28) } }
      : {}),
    renderMode: { kind: "image" },
    editor: {
      owner: "template",
      ...(args.label ? { label: args.label } : {}),
    },
  };
}

/**
 * Static wrapped copy as real geometry: one SVG text source per line, nested
 * in padded row cells. This avoids both rasterizers' no-wrap trap and avoids
 * the SVG rasterizer's intentionally unsupported drawtext y expressions.
 */
export function onboardingTextBlock(args: {
  text: string;
  fontSize: number;
  color: MosaicColor;
  cellWidthPx: number;
  hAlign?: "left" | "center" | "right";
  widthFrac?: number;
  fadeDelaySec?: number;
  label?: string;
}): OnboardingComposition {
  const trimmed = args.text.trim();
  if (!trimmed) {
    throw new Error("onboardingTextBlock requires non-empty copy");
  }
  const usableW = args.cellWidthPx * (args.widthFrac ?? 0.94);
  const maxCharsPerLine = Math.max(
    5,
    Math.floor(usableW / (args.fontSize * 0.58)),
  );
  const lines = wrapText(trimmed, maxCharsPerLine);
  const lineParts = lines.map((line, index) =>
    onboardingLeaf(
      onboardingTextSource({
        text: line,
        fontSize: args.fontSize,
        color: args.color,
        hAlign: args.hAlign,
        fadeDelaySec: args.fadeDelaySec,
        label:
          args.label && lines.length > 1
            ? `${args.label} ${index + 1}`
            : args.label,
      }),
    ),
  );
  return onboardingSplit(
    "row",
    [1, ...lineParts.map(() => 3), 1],
    [null, ...lineParts, null],
  );
}

export function onboardingSolid(
  color: MosaicColor,
  fadeDelaySec?: number,
): OnboardingComposition {
  return onboardingLeaf(
    makeColorTile(
      color,
      fadeDelaySec == null
        ? undefined
        : { overlay: { alpha: fadeInExpr(fadeDelaySec, 0.3) } },
    ),
  );
}

/** Four painted border cells around a nested composition. */
export function onboardingFrame(
  content: OnboardingComposition,
  borderColor: MosaicColor,
): OnboardingComposition {
  const middle = onboardingSplit(
    "col",
    [1, 72, 1],
    [onboardingSolid(borderColor), content, onboardingSolid(borderColor)],
  );
  return onboardingSplit(
    "row",
    [1, 46, 1],
    [onboardingSolid(borderColor), middle, onboardingSolid(borderColor)],
  );
}

/** A full-cell tile with a true bottom-right overlay chip. */
export function onboardingTimestampTile(args: {
  tileColor: MosaicColor;
  chipText: string;
  chipFontSize: number;
  theme: MosaicThemeTokens;
}): OnboardingComposition {
  const chip = onboardingLeaf(
    onboardingTextSource({
      text: args.chipText,
      fontSize: args.chipFontSize,
      color: args.theme.textPrimary,
      backgroundColor: args.theme.surfaceApp,
      label: "timestamp",
    }),
  );
  const chipCorner = onboardingSplit(
    "row",
    [7, 3],
    [
      null,
      onboardingSplit("col", [7, 3], [null, chip]),
    ],
  );
  return onboardingOverlay(onboardingSolid(args.tileColor), chipCorner);
}

const COVER_LOGO_ASSET_ID = asAssetId("screencap-cover-logo");
const COVER_HERO_ASSET_ID = asAssetId("screencap-cover-preview");

function coverMedia(args: {
  assetId: typeof COVER_LOGO_ASSET_ID;
  fit: "contain" | "cover";
  label: string;
  focusX?: number;
}): OnboardingComposition {
  const source: MosaicMediaSource = {
    type: "media",
    mediaType: "image",
    assetId: args.assetId,
    placement:
      args.fit === "cover"
        ? {
            fit: "cover",
            ...(args.focusX == null ? {} : { focusX: args.focusX }),
          }
        : { fit: "contain" },
    editor: { owner: "template", label: args.label },
  };
  return onboardingLeaf(source);
}

function coverBrand(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const logo = coverMedia({
    assetId: COVER_LOGO_ASSET_ID,
    fit: "contain",
    label: "m0saic M logo",
  });
  const name = onboardingLeaf(
    onboardingTextSource({
      text: "Screencap Grid",
      fontSize: Math.max(type.body, Math.round(type.headline * 0.64)),
      color: theme.textPrimary,
      hAlign: "left",
      label: "cover product name",
    }),
  );
  return onboardingSplit(
    "col",
    [5, 2, 23],
    [logo, null, name],
  );
}

function coverMessage(
  paneWidth: number,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
  label: string,
  body: string,
): OnboardingComposition {
  const copy = onboardingSplit(
    "row",
    [4, 11],
    [
      onboardingTextBlock({
        text: label,
        fontSize: type.micro,
        color: theme.accent,
        cellWidthPx: paneWidth * 0.72,
        hAlign: "left",
        label: `cover ${label.toLowerCase()} label`,
      }),
      onboardingTextBlock({
        text: body,
        fontSize: type.label,
        color: theme.textPrimary,
        cellWidthPx: paneWidth * 0.72,
        hAlign: "left",
        widthFrac: 0.92,
        label: `cover ${label.toLowerCase()} message`,
      }),
    ],
  );
  const bubble = onboardingOverlay(
    onboardingSolid(theme.surfaceRaised),
    onboardingSplit("col", [1, 18, 1], [null, copy, null]),
  );
  return onboardingSplit(
    "col",
    [1, 19],
    [onboardingSolid(theme.accent), bubble],
  );
}

function coverTip(
  paneWidth: number,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const copy = onboardingSplit(
    "row",
    [2, 5],
    [
      onboardingTextBlock({
        text: "START HERE",
        fontSize: type.micro,
        color: theme.accent,
        cellWidthPx: paneWidth * 0.72,
        hAlign: "left",
        label: "cover start tip label",
      }),
      onboardingTextBlock({
        text: "Choose Source(s) or edit any prop to start. Open ? for the full tutorial.",
        fontSize: type.label,
        color: theme.textPrimary,
        cellWidthPx: paneWidth * 0.72,
        hAlign: "left",
        widthFrac: 0.92,
        label: "cover start tip",
      }),
    ],
  );
  return onboardingFrame(
    onboardingOverlay(
      onboardingSolid(theme.surface),
      onboardingSplit("col", [1, 18, 1], [null, copy, null]),
    ),
    theme.borderStrong,
  );
}

function coverChatPane(
  paneWidth: number,
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
  compact: boolean,
): OnboardingComposition {
  const brand = coverBrand(theme, type);
  const title = onboardingTextBlock({
    text: "Video at a glance.",
    fontSize: type.headline,
    color: theme.textPrimary,
    cellWidthPx: paneWidth * 0.83,
    hAlign: "left",
    widthFrac: 0.9,
    label: "cover title",
  });
  const overview = onboardingTextBlock({
    text: compact
      ? "Turn source footage into a grid that is easy to scan."
      : "Turn source footage into a PNG contact sheet or MP4 animated grid. Sample the full timeline in one view.",
    fontSize: type.callout,
    color: theme.textSecondary,
    cellWidthPx: paneWidth * 0.83,
    hAlign: "left",
    widthFrac: 0.9,
    label: "cover overview",
  });

  const sourceMessage = coverMessage(
    paneWidth,
    theme,
    type,
    "ADD SOURCE(S)",
    compact
      ? "Choose files or a folder."
      : "Choose one file, multiple files, or a folder.",
  );
  const gridMessage = coverMessage(
    paneWidth,
    theme,
    type,
    "SHAPE THE GRID",
    compact
      ? "Set rows, columns, gap, and fit."
      : "Set rows, columns, tile gap, fit, info, and timestamps.",
  );
  const outputMessage = coverMessage(
    paneWidth,
    theme,
    type,
    "EXPORT OR CUSTOMIZE",
    compact
      ? "Choose PNG, MP4, or a custom m0 layout."
      : "Choose PNG or MP4. Advanced accepts a custom m0 layout.",
  );
  const tip = coverTip(paneWidth, theme, type);

  const conversation = onboardingSplit(
    "row",
    compact
      ? [1, 6, 2, 9, 8, 2, 7, 1, 7, 1, 7, 2, 6, 1]
      : [1, 6, 2, 10, 9, 2, 7, 1, 7, 1, 7, 2, 6, 1],
    [
      null,
      brand,
      null,
      title,
      overview,
      null,
      sourceMessage,
      null,
      gridMessage,
      null,
      outputMessage,
      null,
      tip,
      null,
    ],
  );
  const paddedConversation = onboardingSplit(
    "col",
    [2, 26, 2],
    [null, conversation, null],
  );
  return onboardingFrame(
    onboardingOverlay(onboardingSolid(theme.surfaceInset), paddedConversation),
    theme.border,
  );
}

function coverHero(
  theme: MosaicThemeTokens,
): OnboardingComposition {
  const image = coverMedia({
    assetId: COVER_HERO_ASSET_ID,
    fit: "contain",
    label: "Screencap Grid registered preview",
  });
  return onboardingFrame(image, theme.borderStrong);
}

/** Production cover: an instruction pane beside a dominant sample still. */
export function renderScreencapGridV2Cover(
  ctx: MosaicEngineContext,
): MosaicDocument {
  const canvasW = ctx.target.width;
  const canvasH = ctx.target.height;
  const theme = resolveScreencapOnboardingTheme(ctx);
  const type = coverTypeRamp(canvasW, canvasH);
  const compact = Math.min(canvasW, canvasH) < 480;
  const stacked = canvasH > canvasW * 1.05;

  const paneWidth = stacked ? canvasW * 0.88 : canvasW * 0.3;
  const pane = coverChatPane(paneWidth, theme, type, compact);
  const hero = coverHero(theme);

  const content = stacked
    ? onboardingSplit(
        "row",
        [47, 3, 50],
        [
          onboardingSplit("col", [6, 88, 6], [null, pane, null]),
          null,
          onboardingSplit("col", [6, 88, 6], [null, hero, null]),
        ],
      )
    : onboardingSplit(
        "col",
        [4, 30, 3, 59, 4],
        [null, pane, null, hero, null],
      );
  const page = onboardingSplit("row", [5, 90, 5], [null, content, null]);

  const assets: MosaicAssetManifest = {
    [COVER_LOGO_ASSET_ID]: {
      kind: "data-uri",
      uri: SCREENCAP_COVER_LOGO_URI,
      mediaType: "image",
      displayName: "m0saic M",
    },
    [COVER_HERO_ASSET_ID]: {
      kind: "url",
      url: SCREENCAP_COVER_PREVIEW_URL,
      mediaType: "image",
      displayName: "Screencap Grid preview.png",
    },
  };

  return {
    kind: "mosaic_document",
    version: 1,
    assets,
    size: { width: canvasW, height: canvasH },
    backgroundColor: theme.surfaceApp,
    m0: page.m0 as MosaicDocument["m0"],
    sources: page.sources,
  };
}
