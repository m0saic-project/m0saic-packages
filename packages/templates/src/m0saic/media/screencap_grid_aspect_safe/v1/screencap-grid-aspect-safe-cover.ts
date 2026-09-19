/**
 * Aspect-safe screencap grid — the editor first-open cover.
 *
 * Mirrors the screencap_grid/v2 cover the founder approved (gate 24 —
 * "i quite like this cover"): an instruction chat-pane beside a dominant
 * sample, on the shared onboarding theme. The hero here is the template's
 * OWN registered preview — the coordinated landscape + portrait pair —
 * because the pair IS the pitch.
 *
 * Node contexts (CLI, electron main) read the bundled pair-sheet.jpg via
 * __dirname string concat (the highlights web-safe pattern — no node:path,
 * asar rewrite inlined); the browser uses the served template-assets URL.
 */
import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicThemeTokens,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import {
  coverTypeRamp,
  onboardingFrame,
  onboardingLeaf,
  onboardingOverlay,
  onboardingSolid,
  onboardingSplit,
  onboardingTextBlock,
  onboardingTextSource,
  resolveScreencapOnboardingTheme,
  type OnboardingComposition,
  type OnboardingTypeRamp,
} from "../../screencap_grid/v2/screencap-grid-cover";
import { SCREENCAP_COVER_LOGO_URI } from "../../screencap_grid/v2/screencap-grid-cover-assets";

const COVER_LOGO_ASSET_ID = asAssetId("aspect-safe-cover-logo");
const COVER_PAIR_ASSET_ID = asAssetId("aspect-safe-cover-pair");

/** The registered pair preview, served for browser contexts. */
export const ASPECT_SAFE_COVER_PREVIEW_URL =
  "/template-assets/assets/templates/@m0saic__media__screencap_grid_aspect_safe__v1/preview.png";

function coverAssets(): MosaicAssetManifest {
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  const unpackedAsar = (p: string) =>
    p.includes("/app.asar/")
      ? p.split("/app.asar/").join("/app.asar.unpacked/")
      : p.split("\\app.asar\\").join("\\app.asar.unpacked\\");
  return {
    [COVER_PAIR_ASSET_ID]: isNode
      ? {
          kind: "file",
          path: unpackedAsar(`${__dirname}/assets/pair-sheet.jpg`),
          mediaType: "image",
        }
      : {
          kind: "url",
          url: ASPECT_SAFE_COVER_PREVIEW_URL,
          mediaType: "image",
        },
    [COVER_LOGO_ASSET_ID]: {
      kind: "data-uri",
      uri: SCREENCAP_COVER_LOGO_URI,
      mediaType: "image",
      displayName: "m0saic M",
    },
  } as MosaicAssetManifest;
}

function coverBrand(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const logo = onboardingLeaf({
    type: "media",
    mediaType: "image",
    assetId: COVER_LOGO_ASSET_ID,
    placement: { fit: "contain" },
    editor: { owner: "template", label: "m0saic M logo" },
  } as MosaicMediaSource);
  const name = onboardingLeaf(
    onboardingTextSource({
      text: "Aspect Safe Grid",
      fontSize: Math.max(type.body, Math.round(type.headline * 0.64)),
      color: theme.textPrimary,
      hAlign: "left",
      label: "cover product name",
    }),
  );
  return onboardingSplit("col", [5, 2, 23], [logo, null, name]);
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
    text: "Both orientations. One pass.",
    fontSize: type.headline,
    color: theme.textPrimary,
    cellWidthPx: paneWidth * 0.83,
    hAlign: "left",
    widthFrac: 0.9,
    label: "cover title",
  });
  const overview = onboardingTextBlock({
    text: compact
      ? "Each video renders a matched desktop + mobile grid pair."
      : "Each source video renders a coordinated desktop + mobile pair — same cell count, same cell shape, exact at both canvases.",
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
      ? "Files or a folder — 2 outputs per file."
      : "Choose files or a folder. Every file fans out to 2 outputs.",
  );
  const shapeMessage = coverMessage(
    paneWidth,
    theme,
    type,
    "PICK THE SHAPE",
    compact
      ? "Cell Shape steers both grids."
      : "Cell Shape steers both grids: landscape, square, portrait, or an exact ratio.",
  );
  const pairMessage = coverMessage(
    paneWidth,
    theme,
    type,
    "SCROLL THE PAIRS",
    compact
      ? "Grid Choice walks the ranked list."
      : "Grid Choice walks the ranked pair list. Export PNG sheets or MP4 grids.",
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
      shapeMessage,
      null,
      pairMessage,
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

function coverHero(theme: MosaicThemeTokens): OnboardingComposition {
  const image = onboardingLeaf({
    type: "media",
    mediaType: "image",
    assetId: COVER_PAIR_ASSET_ID,
    placement: { fit: "contain" },
    editor: { owner: "template", label: "Aspect Safe registered pair preview" },
  } as MosaicMediaSource);
  return onboardingFrame(image, theme.borderStrong);
}

/** Production cover: an instruction pane beside the registered PAIR preview. */
export function renderScreencapGridAspectSafeCover(
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

  return {
    kind: "mosaic_document",
    version: 1,
    assets: coverAssets(),
    size: { width: canvasW, height: canvasH },
    backgroundColor: theme.surfaceApp,
    m0: page.m0 as MosaicDocument["m0"],
    sources: page.sources,
  };
}
