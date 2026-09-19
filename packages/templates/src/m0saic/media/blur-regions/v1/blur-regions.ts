/**
 * Easy Blur — `@m0saic/media/blur-regions/v1`.
 *
 * Pick one video OR image, draw one or more rectangles over the areas
 * to hide (the `picker: "regions"` draw-on-canvas editor, or
 * hand-authored `--props` JSON), and get the same media back with those
 * regions blurred or pixelated — audio intact on video, canvas matched
 * to the probed source, container following the user's `-o` extension.
 * Image inputs render as a single frame (watermark precedent).
 *
 * The result is a 1-step `emit:"multi"` pipeline, NOT a plain document:
 * only a pipeline step's canvas tracks the input's probed dims (a plain
 * document's `size` is overridden by explicit CLI `-w`/`-h`, which
 * would misalign the mask regions against the re-fitted content). The
 * planner collapses the single step to the bare `-o` file and the
 * per-step format is inert — the `-o` extension wins (highlights
 * single-range + watermark precedents).
 *
 * First adopter of the `picker: "regions"` prop contract
 * (`MosaicRegionsValue` in `@m0saic/types`): integer px in the authored
 * canvas, optional `canvas` wrapper for rescaling, missing `kind` =
 * rect. Regions drawn in Make arrive in the preview canvas (= probed
 * video dims once a source is picked); hand-authored regions may omit
 * `canvas` and are read as px in the video's own canvas. The m0-native
 * flavor (`{ m0 }` or a bare m0 string) takes a LAYOUT whose leaf cells
 * are the regions — a series of rects is always expressible as m0.
 *
 * By default the regions become REAL m0 geometry (`geometry: "inset"`,
 * via placeInsetPieces): each region is a cell whose source shows the
 * exact media window underneath it (`placement.sourceRect` — this
 * template is the primitive's first consumer) with the effect applied —
 * visible and selectable in every m0 surface. `"exact"` trades DSL
 * length for exact cells; `"mask"` keeps the original full-canvas
 * inline-mask overlay (no geometry, cheapest for many regions).
 *
 * ZERO regions is the working BASE CASE, not an error: pick a source
 * and the preview shows it untouched — that's the surface the user
 * draws on. Fail-fast posture for what IS provided: any invalid region
 * (entirely outside the canvas, degenerate size) fails the WHOLE render
 * rather than silently dropping it — this is a privacy feature;
 * partially-applied censoring must never ship quietly. Overshoot that
 * still intersects the canvas is clamped, not rejected.
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRegion,
  MosaicRegionsValue,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import {
  buildStepNames,
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  parseRegionsValue,
  regionRectsFromM0,
  registerTemplate,
  resolveDocFrames,
  resolveRegionsToPx,
} from "@m0saic/template-utils";
import { renderBlurRegionsTutorial } from "./tutorial";
import {
  buildBlurRegionsStep,
  evenRound,
  BLUR_SIGMA_MAX,
  BLUR_SIGMA_MIN,
  MAX_REGIONS,
  resolveBlurRegionsKnobs,
  type BlurRegionRect,
  type BlurRegionsGeometry,
  type BlurRegionsMode,
} from "./plan";
import {
  buildBrandedCover,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

export type BlurRegionsV1Props = {
  /** The video or image to blur regions of. */
  sourceId?: string;
  /** Regions to hide — drawn rects, hand-authored px rects, or an m0 layout. */
  regions?: MosaicRegionsValue | MosaicRegion[] | string;
  /** Effect style: gaussian "blur" (default) or censor-block "pixelate". */
  mode?: BlurRegionsMode;
  /** Effect strength: blur sigma px (1-200) / pixel block px (2-128). Default 24. */
  strength?: number;
  /** Region document structure: "inset" (default, compact real m0), "exact", "mask". */
  geometry?: BlurRegionsGeometry;
};

const propsSchema = definePropsSchema<BlurRegionsV1Props>({
  sourceId: {
    type: "media",
    required: true,
    description: "The video or image to blur regions of.",
    meta: {
      ui: { label: "Source", order: 1 },
      control: { picker: "file", accept: ["video", "image"] },
    },
  },
  regions: {
    type: "json",
    // Not required: "nothing drawn yet" is the working base case — the
    // preview shows the untouched media as the drawing surface.
    required: false,
    description:
      "Areas to hide — draw them on the preview. For pixel-precise placement, " +
      "the JSON escape hatch takes " +
      '{ "canvas": { "w", "h" }, "regions": [{ "x", "y", "w", "h" }, …] }, ' +
      "integer px (omit canvas to give px in the media's own canvas; overshoot " +
      "is clamped). No regions = the media passes through untouched.",
    meta: {
      constraints: {
        jsonSchema: {
          type: "object",
          properties: {
            canvas: {
              type: "object",
              required: ["w", "h"],
              properties: {
                w: { type: "integer", minimum: 1 },
                h: { type: "integer", minimum: 1 },
              },
            },
            regions: {
              type: "array",
              maxItems: MAX_REGIONS,
              items: {
                type: "object",
                required: ["x", "y", "w", "h"],
                properties: {
                  kind: { type: "string", enum: ["rect"] },
                  x: { type: "integer", minimum: 0 },
                  y: { type: "integer", minimum: 0 },
                  w: { type: "integer", minimum: 1 },
                  h: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
      },
      control: {
        picker: "regions",
        regions: { max: MAX_REGIONS, shapes: ["rect", "ellipse", "polygon", "lasso", "brush"] },
      },
      ui: { label: "Blur regions", order: 2, primary: true },
    },
  },
  mode: {
    type: "string",
    required: false,
    description:
      'Effect style: "blur" (gaussian, default) or "pixelate" (censor blocks).',
    meta: {
      constraints: { oneOf: ["blur", "pixelate"] },
      ui: { label: "Style", order: 3 },
    },
  },
  strength: {
    type: "number",
    required: false,
    description:
      "Effect strength. Blur: gaussian sigma in px (1-200). Pixelate: block size in px (2-128). Default 24.",
    meta: {
      constraints: { min: BLUR_SIGMA_MIN, max: BLUR_SIGMA_MAX },
      control: { flavor: "slider" },
      ui: { label: "Strength", order: 4 },
    },
  },
  geometry: {
    type: "string",
    required: false,
    description:
      'How regions become document structure. "inset" (default): real m0 cells on a compact lattice, insets recover exact bounds. ' +
      '"exact": real m0 cells at exact px (longer DSL). "mask": one masked full-canvas overlay — no region geometry in the m0, ' +
      "cheapest render for many regions, softest region edges.",
    meta: {
      constraints: { oneOf: ["inset", "exact", "mask"] },
      ui: { label: "Geometry", order: 5 },
    },
  },
});

const DEFAULTS: Omit<BlurRegionsV1Props, "sourceId" | "regions"> = {
  mode: "blur",
  strength: 24,
  geometry: "inset",
};

const ERROR_TITLE = "Easy Blur";

export const BlurRegions: MosaicTemplate<BlurRegionsV1Props> = {
  id: asTemplateId("@m0saic/media/blur-regions/v1"),
  label: "Easy Blur",
  description:
    "Pick a video or image, draw boxes over what should stay hidden — faces, plates, names — and get the same media back with those regions blurred or pixelated. Audio untouched.",
  version: 1,
  capabilities: { tier: "core" },
  tags: ["media", "blur", "privacy", "redact", "pixelate", "creators", "animated", "face-blur", "anonymize", "video"],

  // No `format` hint on purpose — the container follows the user's `-o`
  // extension (highlights precedent).
  outputHints: {
    format: { kind: "video", container: "mp4" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
  },

  propsSchema,
  defaultProps: { ...DEFAULTS },

  async render(
    props: BlurRegionsV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicRenderableFile> {
    const fail = (message: string) =>
      makeErrorMosaic(message, {
        title: ERROR_TITLE,
        width: ctx.target.width,
        height: ctx.target.height,
      });

    const sourceId = props.sourceId;
    if (!sourceId) {
      return fail('Missing required "Source": pick the video or image to blur regions of.');
    }

    if (props.mode !== undefined && props.mode !== "blur" && props.mode !== "pixelate") {
      return fail(`Unsupported mode "${String(props.mode)}" — use "blur" or "pixelate".`);
    }

    if (
      props.geometry !== undefined &&
      props.geometry !== "inset" &&
      props.geometry !== "exact" &&
      props.geometry !== "mask"
    ) {
      return fail(
        `Unsupported geometry "${String(props.geometry)}" — use "inset", "exact", or "mask".`,
      );
    }
    const geometry: BlurRegionsGeometry = props.geometry ?? "inset";

    const parsed = parseRegionsValue(props.regions);
    if (!parsed.ok) {
      return fail(parsed.error);
    }
    // Zero regions is NOT an error: it's the drawing base case — the
    // media renders untouched so the user can see it and draw on it.
    if (parsed.regions.length > MAX_REGIONS) {
      return fail(`Too many regions (${parsed.regions.length}) — the cap is ${MAX_REGIONS}.`);
    }

    const meta = ctx.media[asAssetId(sourceId)];
    if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
      return fail(`No probed dimensions for input: ${sourceId}`);
    }
    if (meta.kind !== "video" && meta.kind !== "image") {
      return fail(`Easy Blur needs a video or image input (kind: ${meta.kind}): ${sourceId}`);
    }
    const isVideo = meta.kind === "video";
    if (isVideo && !(meta.durationMs != null && meta.durationMs > 0)) {
      return fail(`Video input has no probed duration: ${sourceId}`);
    }

    const size = { width: evenRound(meta.width), height: evenRound(meta.height) };
    let rectsPx: BlurRegionRect[];
    if (parsed.m0 !== undefined) {
      // m0-native flavor: leaf cells at the media's canvas ARE the
      // regions — resolution-independent, exact by construction.
      rectsPx = regionRectsFromM0(parsed.m0, size);
      if (rectsPx.length > MAX_REGIONS) {
        return fail(`Too many regions (${rectsPx.length} m0 leaves) — the cap is ${MAX_REGIONS}.`);
      }
    } else {
      const verdicts = resolveRegionsToPx(parsed, size);
      const firstBad = verdicts.findIndex((v) => !v.ok);
      if (firstBad !== -1) {
        const bad = verdicts[firstBad];
        // Privacy posture: never silently drop a drawn region (see header).
        return fail(
          `Region ${firstBad + 1} invalid: ${bad.ok ? "" : bad.reason}. Fix or remove it — regions are never silently dropped.`,
        );
      }
      rectsPx = verdicts.map((v) =>
        v.ok
          ? { x: v.x, y: v.y, w: v.w, h: v.h, ...(v.mask ? { mask: v.mask } : {}) }
          : { x: 0, y: 0, w: 0, h: 0 },
      );
    }

    const knobs = resolveBlurRegionsKnobs(props);
    const fps =
      isVideo && meta.fps != null && meta.fps > 0
        ? Math.max(1, Math.round(meta.fps))
        : undefined;

    let step;
    try {
      step = buildBlurRegionsStep({
        inputPath: sourceId,
        stepBaseName: buildStepNames([sourceId])[0],
        mediaType: isVideo ? "video" : "image",
        size,
        ...(isVideo ? { durationMs: meta.durationMs! } : {}),
        rectsPx,
        knobs,
        geometry,
      });
    } catch (err) {
      return fail(
        `Region geometry failed (${geometry}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      ...(fps !== undefined ? { fps } : {}),
      steps: [step],
    };
  },

  // Editor-only first-open cover. Without a picked source the default state is
  // an error mosaic ("Missing Source") — the cover instead shows a synthetic
  // demo: a scenic mock frame with two "pixelated" regions, above a welcome
  // band (the metadata-stamp precedent). Adaptive band per the stat-card
  // lesson: px-clamped height, single title-only row when the hint row can't
  // make the engine's min-cell floor.
  // Editor-only first-open cover — the mosaic-branding BAND: the synthetic
  // scenic demo (sky/ridge/ground + two pixelated regions) full-bleed above
  // the brand band (M mark · product name · title).
  async renderCover(
    _props: BlurRegionsV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    // ── Synthetic "photo": sky / ridge / ground bands ──
    const scene = String(weightedSplit([46, 22, 32], "row", { claimants: ["1", "1", "1"] }));
    const sceneSources: MosaicSource[] = [
      makeColorTile("#3b6ea5" as MosaicColor), // sky
      makeColorTile("#5b8c5a" as MosaicColor), // ridge
      makeColorTile("#8a7f66" as MosaicColor), // ground
    ];

    // ── Two demo "pixelated" regions: 4x3 checker of two grays ──
    const checkerRow = (a: string, b: string) => String(weightedSplit([1, 1, 1, 1], "col", { claimants: [a, b, a, b] }));
    const checker = String(weightedSplit([1, 1, 1], "row", {
      claimants: [checkerRow("1", "1"), checkerRow("1", "1"), checkerRow("1", "1")],
    }));
    const GRAYS: MosaicColor[] = ["#9aa2ab" as MosaicColor, "#6f767e" as MosaicColor];
    const checkerSources = (flip: boolean): MosaicSource[] =>
      Array.from({ length: 12 }, (_, i) => makeColorTile(GRAYS[(i + (flip ? 1 : 0) + Math.floor(i / 4)) % 2]));

    const placeRegion = (xPct: number, yPct: number, wPct: number, hPct: number, inner: string) => {
      const col = String(weightedSplit([xPct, wPct, Math.max(1, 100 - xPct - wPct)], "col", { claimants: ["-", inner, "-"] }));
      return String(weightedSplit([yPct, hPct, Math.max(1, 100 - yPct - hPct)], "row", { claimants: ["-", col, "-"] }));
    };
    const regionA = placeRegion(12, 18, 26, 30, checker);
    const regionB = placeRegion(58, 52, 30, 34, checker);
    const sceneStack = `${scene}{${regionA}{${regionB}}}`;

    return buildBrandedCover({
      ctx,
      variant: "band",
      copy: { productName: "Easy Blur", title: "Draw boxes; ship the media back censored." },
      hero: (theme) =>
        onboardingFrame(
          { m0: sceneStack, sources: [...sceneSources, ...checkerSources(false), ...checkerSources(true)] },
          theme.borderStrong,
        ),
    });
  },

  // Editor "?" tutorial: six directed beats — the draw-the-red-square action
  // demonstrated, the brush stroke painting a mask, style/strength, render.
  // Real Make screenshots slot in per beat via tutorial.ts's screenshot map
  // when the founder provides captures.
  renderTutorial(_props: BlurRegionsV1Props, ctx: MosaicEngineContext) {
    return renderBlurRegionsTutorial(ctx);
  },
};

registerTemplate(BlurRegions);
