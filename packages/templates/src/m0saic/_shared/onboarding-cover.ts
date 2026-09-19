/**
 * The mosaic-branding cover kit — the ONE cover theme every shipped
 * template's editor first-open face is built on.
 *
 * Born on screencap_grid/v2 (gate 24), reused by aspect_safe (gate 25) and
 * subtitle-burn (gate 26); hoisted here per the founder's gate-26 directive
 * ("i want the other shipped templates to rework their cover to match this
 * theme. the mosaic branding cover") so alpine/charts consumers stop
 * importing across `media/screencap_grid/…` (wrong-way coupling).
 *
 * The theme contract (the internal mosaic-branding-covers notes):
 *   left CHAT PANE — brand row (m0saic M + product name), headline +
 *   one-sentence overview, three accent message bubbles (the template's
 *   3-step mental model), a framed START HERE tip;
 *   right HERO — REAL MATERIAL: the template's own output, never abstract
 *   placeholder art.
 *
 * Everything from the v2 kit re-exports UNCHANGED below (byte-identical
 * pass-throughs — existing consumers can migrate imports without churn);
 * `buildBrandedCover` is the new copy-parameterized assembler that turns a
 * per-template cover into a ~40-line copy declaration + a hero composition.
 */
import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicEngineContext,
  MosaicThemeTokens,
} from "@m0saic/types";
import {
  coverTypeRamp,
  onboardingFrame,
  onboardingOverlay,
  onboardingSolid,
  onboardingSplit,
  onboardingTextBlock,
  resolveScreencapOnboardingTheme,
  type OnboardingComposition,
  type OnboardingTypeRamp,
} from "../media/screencap_grid/v2/screencap-grid-cover";
import {
  tutorialAssets,
  tutorialBrand,
} from "../media/screencap_grid/v2/screencap-grid-tutorial";

/** Only the brand M (data-uri) — covers never reference the tutorial sheet,
 *  so the sheet's file asset must not ride every cover manifest. */
function brandLogoAssets(): MosaicAssetManifest {
  const all = tutorialAssets() as Record<string, { kind?: string }>;
  const out: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(all)) {
    if (entry?.kind === "data-uri") out[id] = entry;
  }
  return out as MosaicAssetManifest;
}

// ── The kit, re-exported (byte-identical) ──
export {
  SCREENCAP_ONBOARDING_THEME as ONBOARDING_THEME,
  resolveScreencapOnboardingTheme as resolveOnboardingTheme,
  onboardingTypeRamp,
  coverTypeRamp,
  onboardingLeaf,
  onboardingSplit,
  onboardingOverlay,
  onboardingGuttered,
  onboardingTextSource,
  onboardingTextBlock,
  onboardingSolid,
  onboardingFrame,
  onboardingTimestampTile,
} from "../media/screencap_grid/v2/screencap-grid-cover";
export type {
  OnboardingComposition,
  OnboardingTypeRamp,
} from "../media/screencap_grid/v2/screencap-grid-cover";
export {
  tutorialAssets as onboardingBrandAssets,
  tutorialBrand as onboardingBrandRow,
} from "../media/screencap_grid/v2/screencap-grid-tutorial";

// ── The branded-cover assembler ──

/** One accent message bubble: micro label + one-line body. */
export type BrandedCoverMessage = {
  label: string;
  body: string;
  /** Shorter body used under 480px min-dim. Falls back to `body`. */
  bodyCompact?: string;
};

export type BrandedCoverCopy = {
  /** Brand-row product name (beside the m0saic M mark). */
  productName: string;
  /** Short declarative headline. */
  title: string;
  /** Pane variant only: one-sentence overview under the headline. */
  overview?: string;
  /** Shorter overview used under 480px min-dim. Falls back to `overview`. */
  overviewCompact?: string;
  /** Pane variant only: the template's 3-step mental model. */
  messages?: BrandedCoverMessage[];
  /** Pane variant only: the one action that produces output. */
  tip?: string;
  /** Tip micro label — theme default "START HERE". */
  tipLabel?: string;
};

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
  label: string,
  body: string,
): OnboardingComposition {
  const copy = onboardingSplit(
    "row",
    [2, 5],
    [
      onboardingTextBlock({
        text: label,
        fontSize: type.micro,
        color: theme.accent,
        cellWidthPx: paneWidth * 0.72,
        hAlign: "left",
        label: "cover start tip label",
      }),
      onboardingTextBlock({
        text: body,
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
  copy: BrandedCoverCopy,
): OnboardingComposition {
  const brand = tutorialBrand(theme, type, copy.productName);
  const title = onboardingTextBlock({
    text: copy.title,
    fontSize: type.headline,
    color: theme.textPrimary,
    cellWidthPx: paneWidth * 0.83,
    hAlign: "left",
    widthFrac: 0.9,
    label: "cover title",
  });
  const overview = onboardingTextBlock({
    text: (compact ? (copy.overviewCompact ?? copy.overview) : copy.overview) ?? "",
    fontSize: type.callout,
    color: theme.textSecondary,
    cellWidthPx: paneWidth * 0.83,
    hAlign: "left",
    widthFrac: 0.9,
    label: "cover overview",
  });
  const bubbles = (copy.messages ?? []).map((m) =>
    coverMessage(
      paneWidth,
      theme,
      type,
      m.label,
      compact ? (m.bodyCompact ?? m.body) : m.body,
    ),
  );
  const tip = coverTip(
    paneWidth,
    theme,
    type,
    copy.tipLabel ?? "START HERE",
    copy.tip ?? "Set the props and render.",
  );

  // The subtitle-burn conversation weights, generalized over the bubble
  // count: [lead 1, brand 6, 2, title, overview, 2, (bubble 7, 1)…, last
  // bubble 7, 2, tip 6, tail 1] — three bubbles reproduces gate 26 exactly.
  const weights: number[] = [1, 6, 2, compact ? 9 : 10, compact ? 8 : 9, 2];
  const cells: (OnboardingComposition | null)[] = [
    null,
    brand,
    null,
    title,
    overview,
    null,
  ];
  bubbles.forEach((b, i) => {
    weights.push(7, i === bubbles.length - 1 ? 2 : 1);
    cells.push(b, null);
  });
  weights.push(6, 1);
  cells.push(tip, null);

  const conversation = onboardingSplit("row", weights, cells);
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

/** Band-variant height: px-clamped so it survives tiny canvases (gate-17). */
function bandModePx(canvasH: number): number {
  return Math.max(34, Math.min(120, Math.round(canvasH * 0.12)));
}

/**
 * Inline-flat hero from a rendered document — the gate-15/21 keeper path:
 * procedural masked content (donut rings, rounded shapes) must NEVER ride a
 * nested `type:"mosaic"` child (the child composite pass bleeds seams and
 * distorts); its m0 + sources inline directly as the hero cell's claimant.
 */
export function inlineHeroDoc(doc: MosaicDocument): OnboardingComposition {
  return {
    m0: doc.m0 as unknown as string,
    sources: (doc.sources ?? []) as OnboardingComposition["sources"],
  };
}

/**
 * Assemble the branded cover document: chat pane + hero on the onboarding
 * theme surface, landscape `[4,30,3,59,4]` columns / stacked portrait /
 * compact copy under 480px min-dim — the exact layout shipped on gates
 * 24-26.
 *
 * `hero` receives the resolved theme + type ramp and the layout flags and
 * returns the right-side composition (REAL MATERIAL — often the template's
 * own static render nested via `children`). `heroAssets` merge over the
 * brand assets; `children` attach to the returned document for nested-doc
 * heroes (`{type:"mosaic", ref:"…"}` leaves).
 */
export function buildBrandedCover(args: {
  ctx: MosaicEngineContext;
  copy: BrandedCoverCopy;
  hero: (
    theme: MosaicThemeTokens,
    type: OnboardingTypeRamp,
    layout: { stacked: boolean; compact: boolean },
  ) => OnboardingComposition;
  heroAssets?: MosaicAssetManifest;
  children?: Record<string, MosaicDocument>;
  /**
   * "band" (founder ruling 08-30): the SIMPLE brand view for basic viz
   * templates — hero full-bleed + a px-clamped brand band (M mark, product
   * name, title). "pane" (default) keeps the full chat-pane conversation —
   * defensible for media-class templates that genuinely need explaining.
   */
  variant?: "pane" | "band";
}): MosaicDocument {
  const { ctx, copy, hero, heroAssets, children } = args;
  const canvasW = ctx.target.width;
  const canvasH = ctx.target.height;
  const theme = resolveScreencapOnboardingTheme(ctx);
  const type = coverTypeRamp(canvasW, canvasH);
  const compact = Math.min(canvasW, canvasH) < 480;
  const stacked = canvasH > canvasW * 1.05;

  // Band layout: always for variant "band"; for "pane" it is the
  // tiny-canvas fallback (the gate-17 keeper: %-bands cull below ~310px —
  // the conversation pane's text cells land under the ~20px min-cell floor
  // and the entire cover culls blank).
  if (
    args.variant === "band" ||
    (!stacked && (canvasH < 420 || Math.min(canvasW, canvasH) < 380))
  ) {
    const bandPx = bandModePx(canvasH);
    const brand = tutorialBrand(theme, type, copy.productName);
    const title = onboardingTextBlock({
      text: copy.title,
      fontSize: type.callout,
      color: theme.textSecondary,
      cellWidthPx: canvasW * 0.55,
      hAlign: "left",
      label: "cover band title",
    });
    const band = onboardingOverlay(
      onboardingSolid(theme.surface),
      onboardingSplit("col", [1, 12, 1, 22, 1], [null, brand, null, title, null]),
    );
    const heroComp = hero(theme, type, { stacked: false, compact: true });
    const page = onboardingSplit(
      "row",
      [Math.max(1, canvasH - bandPx), bandPx],
      [heroComp, band],
    );
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: { ...brandLogoAssets(), ...(heroAssets ?? {}) } as MosaicAssetManifest,
      size: { width: canvasW, height: canvasH },
      backgroundColor: theme.surfaceApp,
      m0: page.m0 as MosaicDocument["m0"],
      sources: page.sources,
    };
    if (children && Object.keys(children).length > 0) {
      (doc as { children?: Record<string, MosaicDocument> }).children = children;
    }
    return doc;
  }

  const paneWidth = stacked ? canvasW * 0.88 : canvasW * 0.3;
  const pane = coverChatPane(paneWidth, theme, type, compact, copy);
  const heroComp = hero(theme, type, { stacked, compact });

  const content = stacked
    ? onboardingSplit(
        "row",
        [47, 3, 50],
        [
          onboardingSplit("col", [6, 88, 6], [null, pane, null]),
          null,
          onboardingSplit("col", [6, 88, 6], [null, heroComp, null]),
        ],
      )
    : onboardingSplit(
        "col",
        [4, 30, 3, 59, 4],
        [null, pane, null, heroComp, null],
      );
  const page = onboardingSplit("row", [5, 90, 5], [null, content, null]);

  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    assets: { ...brandLogoAssets(), ...(heroAssets ?? {}) } as MosaicAssetManifest,
    size: { width: canvasW, height: canvasH },
    backgroundColor: theme.surfaceApp,
    m0: page.m0 as MosaicDocument["m0"],
    sources: page.sources,
  };
  if (children && Object.keys(children).length > 0) {
    (doc as { children?: Record<string, MosaicDocument> }).children = children;
  }
  return doc;
}

/**
 * The approximate pixel box the landscape hero composition paints into —
 * for sizing a nested child render so its internal proportions match the
 * tile it lands in (page row 90% × content hero column 59%).
 */
export function brandedCoverHeroBox(
  ctx: MosaicEngineContext,
  variant?: "pane" | "band",
): {
  width: number;
  height: number;
} {
  const stacked = ctx.target.height > ctx.target.width * 1.05;
  const W = ctx.target.width;
  const H = ctx.target.height;
  if (variant === "band" || (!stacked && (H < 420 || Math.min(W, H) < 380))) {
    return { width: W, height: Math.max(1, H - bandModePx(H)) };
  }
  return stacked
    ? {
        width: Math.max(1, Math.round(ctx.target.width * 0.88)),
        height: Math.max(1, Math.round(ctx.target.height * 0.9 * 0.5 * 0.88)),
      }
    : {
        width: Math.max(1, Math.round(ctx.target.width * 0.59)),
        height: Math.max(1, Math.round(ctx.target.height * 0.9)),
      };
}
