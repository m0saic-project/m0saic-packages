/**
 * Subtitle Burn — the editor first-open cover.
 *
 * The family chat-pane structure (screencap_grid/v2, gate 24 — "i quite
 * like this cover"; aspect-safe, gate 25) with this template's pitch. The
 * hero is REAL MATERIAL, not brand art: Big Buck Bunny's title card at
 * full 1080p with a subtitle burned onto it in the template's own style —
 * white glyphs, bottom center — so the first thing a user sees IS the
 * deliverable.
 */
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicThemeTokens,
} from "@m0saic/types";
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
import { asAssetId } from "@m0saic/types";
import type { MosaicAssetManifest, MosaicMediaSource } from "@m0saic/types";
import {
  tutorialAssets,
  tutorialBrand,
} from "../../screencap_grid/v2/screencap-grid-tutorial";

const COVER_FRAME_ASSET_ID = asAssetId("subtitle-burn-cover-frame");

/**
 * The hero still: Big Buck Bunny's title card (~27s — founder-picked: "the
 * big buck bunny logo part"), full 1080p. Node contexts read the bundled
 * jpg via __dirname (the highlights web-safe pattern); the browser uses
 * the copy served from the registered template-assets tree.
 */
function coverFrameAssets(): MosaicAssetManifest {
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  const unpackedAsar = (p: string) =>
    p.includes("/app.asar/")
      ? p.split("/app.asar/").join("/app.asar.unpacked/")
      : p.split("\\app.asar\\").join("\\app.asar.unpacked\\");
  return {
    [COVER_FRAME_ASSET_ID]: isNode
      ? {
          kind: "file",
          path: unpackedAsar(`${__dirname}/assets/cover-frame.jpg`),
          mediaType: "image",
        }
      : {
          kind: "url",
          url: "/template-assets/assets/templates/@m0saic__media__subtitle-burn__v1/cover-frame.jpg",
          mediaType: "image",
        },
  } as MosaicAssetManifest;
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
        text: "Drop a video with embedded subtitles into Source. The default track burns immediately.",
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
  const brand = tutorialBrand(theme, type, "Subtitle Burn");
  const title = onboardingTextBlock({
    text: "Captions, burned in.",
    fontSize: type.headline,
    color: theme.textPrimary,
    cellWidthPx: paneWidth * 0.83,
    hAlign: "left",
    widthFrac: 0.9,
    label: "cover title",
  });
  const overview = onboardingTextBlock({
    text: compact
      ? "Reads the subtitle track inside your video and burns it onto the pixels."
      : "Reads the subtitle track already inside your MKV/MP4 and burns it onto the pixels — no player settings, no sidecar files, plays everywhere.",
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
    "ADD A SOURCE",
    compact
      ? "The default-flagged track wins."
      : "Drop a subbed video. The default-flagged track wins out of the box.",
  );
  const trackMessage = coverMessage(
    paneWidth,
    theme,
    type,
    "PICK THE TRACK",
    compact
      ? "By language or exact index."
      : "By language (\"eng\", \"spa\") or exact track index; strict or fallback.",
  );
  const clipMessage = coverMessage(
    paneWidth,
    theme,
    type,
    "CLIP + STYLE",
    compact
      ? "Cue-aware trim; placement, size, colors."
      : "Trim with the cue-aware range picker. Placement, size, and colors are yours.",
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
      trackMessage,
      null,
      clipMessage,
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

/**
 * The hero: a real film frame with a subtitle burned onto it — white
 * glyphs anchored to the lower quarter, exactly the template's default
 * look. A second thin strip beneath shows the next cue arriving, hinting
 * at the time axis without needing motion.
 */
function coverHero(
  theme: MosaicThemeTokens,
  type: OnboardingTypeRamp,
): OnboardingComposition {
  const subtitle = onboardingLeaf(
    onboardingTextSource({
      text: "Burned right onto the frame.",
      fontSize: Math.round(type.headline * 0.62),
      color: "#ffffff" as MosaicColor,
      hAlign: "center",
      label: "hero burned subtitle",
    }),
  );
  const subtitleBand = onboardingSplit(
    "row",
    [11, 3, 1],
    [null, subtitle, null],
  );
  const frame = onboardingOverlay(
    onboardingLeaf({
      type: "media",
      mediaType: "image",
      assetId: COVER_FRAME_ASSET_ID,
      placement: { fit: "cover" },
      editor: { owner: "template", label: "hero film frame" },
    } as MosaicMediaSource),
    subtitleBand,
  );
  const nextCue = onboardingSplit(
    "col",
    [5, 8, 5],
    [
      null,
      onboardingLeaf(
        onboardingTextSource({
          text: "00:03 → 00:05   “the next cue is already timed”",
          fontSize: type.micro,
          color: theme.textSecondary,
          hAlign: "center",
          backgroundColor: theme.surfaceInset,
          label: "hero cue strip",
        }),
      ),
      null,
    ],
  );
  return onboardingFrame(
    onboardingSplit("row", [15, 1, 2], [frame, null, nextCue]),
    theme.borderStrong,
  );
}

/** Production cover: the instruction pane beside a burned-subtitle frame. */
export function renderSubtitleBurnCover(
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
  const hero = coverHero(theme, type);

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
    assets: { ...tutorialAssets(), ...coverFrameAssets() } as MosaicAssetManifest,
    size: { width: canvasW, height: canvasH },
    backgroundColor: theme.surfaceApp,
    m0: page.m0 as MosaicDocument["m0"],
    sources: page.sources,
  };
}
