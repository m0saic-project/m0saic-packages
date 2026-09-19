/**
 * ============================================================================
 * @m0saic/collage/image-collage/v1 — the layout-solver contact sheet
 * ============================================================================
 *
 * Point it at N images (any sizes, any aspects) and get back a designed
 * collage: a unit-lattice pack with consistent pixel gutters, cover-cropped
 * cells sized to each image's intrinsic aspect within a soft crop budget,
 * hero/portrait/panorama spans, and staggered masonry rhythm.
 *
 * The template SEARCHES: it enumerates lattice candidates, solves each
 * (span assignment + staggered-shelf tiling), scores, and keeps the best —
 * then emits a tiny ratio m0 (unit weights, gutters in the fiber) and
 * declares its intent through the layout contract: per-image planned aspect,
 * 2-D lattice gutters, null-space coverage, and equal-size span classes.
 * `debugLayout: true` verifies all of it at render time and stamps
 * `editor.layoutContract` (the `audit:layout-envelope` sweep keys off this).
 *
 * PAGING: when the set exceeds one sheet (`maxImagesPerSheet`, or
 * geometrically when N images can't fit at readable cell sizes), the render
 * returns an `emit:"multi"` pipeline — one PNG page per step, balanced counts
 * in input order. `pageLattice` picks whether pages share one mix-fitted
 * lattice (default — the sheets read as a set) or each search their own.
 *
 * Every render surfaces its crop accounting: `doc.labels` carries a per-image
 * `img:k · span · crop N%` display entry and the doc's editor label carries
 * the page's mean crop — visible in Make, File Details, and the `--report`
 * sidecar.
 *
 * Intrinsic dimensions come from `ctx.media` (the host probes before render);
 * the template performs no I/O. With no `sourceIds` it packs a deterministic
 * demo set of colored tiles — the zero-setup preview.
 * ============================================================================
 */

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
  slugifyAssetKeyFromPath,
  withLayoutContract,
  type LayoutConstraint,
  type RelationalConstraint,
} from "@m0saic/template-utils";
import { solvePages, type PageSolve } from "./packer/paging";
import { emitCollageLayout, type EmitCollageResult } from "./emit";
import { DEMO_IMAGES } from "./demo-fixture";
import { renderImageCollageTutorial } from "./tutorial";

export type ImageCollageProps = {
  /** The images to pack — files or a folder (the host expands folders). */
  sourceIds?: string[];
  /** Gutter between images as a fraction of the canvas short edge. Default 0.01. */
  gutter?: number;
  /** Outer margin as a fraction of the gutter (0..1). Default 1 (margin = gutter). */
  margin?: number;
  /** Explicit gutter in pixels (wins over `gutter`; 0 = flush collage). */
  gutterPx?: number;
  /** Explicit outer margin in pixels (wins over `margin`; must not exceed the gutter). */
  marginPx?: number;
  /** Max fraction an image may be cover-cropped — SOFT: exceeded minimally when nothing fits, and reported. Default 0.3. */
  cropBudget?: number;
  /** Readability bounds on the typical cell scale √(cellW·cellH), px. Defaults 120 / 320. */
  minCellPx?: number;
  maxCellPx?: number;
  /** Cap images per sheet — beyond it the render pages into an emit:multi pipeline. */
  maxImagesPerSheet?: number;
  /** Paged sets: share one mix-fitted lattice ("uniform", default) or search per page ("independent"). */
  pageLattice?: "uniform" | "independent";
  /** Seed for the layout search's taste tie-breaks (hero picks, band rhythm). Default 1. */
  seed?: number;
  /** Canvas background (shows in gutters and margins). */
  background?: MosaicColor;
  /** Dev-only: verify the declared layout contract at render and stamp editor.layoutContract. */
  debugLayout?: boolean;
};

const TEMPLATE_ID = "@m0saic/collage/image-collage/v1";
const DEFAULT_BACKGROUND: MosaicColor = "#101014" as MosaicColor;

const propsSchema = definePropsSchema<ImageCollageProps>({
  sourceIds: {
    type: "media[]",
    required: true,
    description:
      "Images to pack — pick a folder, one or more files, or drag-and-drop. Empty renders a built-in demo set so you can preview the layout before adding photos.",
    meta: {
      ui: { label: "Images", order: 1 },
      control: { multiple: true, picker: "folder", accept: ["image"] },
    },
  },
  // ── Layout (optional sliders — safe, bounded ranges) ──
  gutter: {
    type: "number",
    required: false,
    description: "Space between images, as a fraction of the canvas short edge.",
    meta: {
      constraints: { min: 0, max: 0.1 },
      control: { flavor: "slider", step: 0.005 },
      ui: { label: "Gutter", order: 1 },
    },
  },
  margin: {
    type: "number",
    required: false,
    description:
      "Outer margin as a fraction of the gutter — 1 matches the gutter, 0 runs the images to the canvas edge.",
    meta: {
      constraints: { min: 0, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Margin", order: 2 },
    },
  },
  cropBudget: {
    type: "number",
    required: false,
    description:
      "How much of an image the cover-crop may trim. Soft — exceeded minimally when nothing else fits.",
    meta: {
      constraints: { min: 0, max: 0.6 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Crop budget", order: 3 },
    },
  },
  seed: {
    type: "number",
    required: true,
    description:
      "Seed for the layout search's taste tie-breaks (which images become heroes, band rhythm). Same seed → same layout.",
    meta: {
      constraints: { min: 0, max: 9999 },
      ui: { label: "Seed", order: 4 },
    },
  },
  // ── Paging ──
  maxImagesPerSheet: {
    type: "number",
    required: true,
    description:
      "Images per sheet. Sets larger than this page into a multi-file pipeline (one PNG per page). 30 is a tuned default.",
    meta: {
      constraints: { min: 1, max: 200 },
      ui: { label: "Max per sheet", order: 1 },
    },
  },
  pageLattice: {
    type: "string",
    required: false,
    description:
      'Paged sets: "uniform" shares one mix-fitted lattice across pages (a designed set); "independent" re-searches per page (best per-page crops).',
    meta: {
      constraints: { oneOf: ["uniform", "independent"] },
      ui: { label: "Page lattice", order: 2 },
    },
  },
  // ── Style ──
  background: {
    type: "string",
    required: false,
    description: "Canvas background color (shows in gutters and margins).",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Background", order: 1 },
    },
  },
  // ── Sizing (readability bounds — advanced) ──
  minCellPx: {
    type: "number",
    required: false,
    description: "Smallest typical cell scale in px (readability floor). Default 120.",
    meta: { constraints: { min: 16, max: 2000 }, ui: { label: "Min cell (px)", order: 1 } },
  },
  maxCellPx: {
    type: "number",
    required: false,
    description: "Largest typical cell scale in px. Default 320.",
    meta: { constraints: { min: 16, max: 4000 }, ui: { label: "Max cell (px)", order: 2 } },
  },
  // ── Advanced px overrides (win over the ratio sliders above) ──
  gutterPx: {
    type: "number",
    required: false,
    description: "Explicit gutter in pixels (overrides Gutter; 0 = flush collage).",
    meta: { control: { placeholder: "from Gutter fraction" }, constraints: { min: 0, max: 200 }, ui: { label: "Gutter (px)", order: 1 } },
  },
  marginPx: {
    type: "number",
    required: false,
    description: "Explicit outer margin in pixels (overrides Margin; must not exceed the gutter).",
    meta: { control: { placeholder: "from Margin fraction" }, constraints: { min: 0, max: 200 }, ui: { label: "Margin (px)", order: 2 } },
  },
  debugLayout: {
    type: "boolean",
    required: false,
    description:
      "Dev-only layout contract: verify per-image aspect, lattice gutters, coverage and equal-size classes; on violation render a LAYOUT_CONTRACT error mosaic and stamp editor.layoutContract. Deterministic default false.",
    meta: { ui: { label: "Debug layout", order: 1, collapsedByDefault: true } },
  },
});

type ResolvedInput = {
  aspects: number[];
  /** Source for GLOBAL image index k (labeled `img:k`; no placement.inset). */
  sourceFor: (imageIndex: number) => MosaicSource;
  /** Asset manifest entry for GLOBAL image index k (undefined in demo mode). */
  assetEntryFor: (imageIndex: number) => [string, MosaicAssetManifest[keyof MosaicAssetManifest]] | undefined;
};

/** Demo mode: deterministic synthetic photos as labeled lavfi tiles. */
function demoInput(): ResolvedInput {
  return {
    aspects: DEMO_IMAGES.map((d) => d.aspect),
    sourceFor: (i) =>
      ({
        type: "lavfi",
        color: DEMO_IMAGES[i].color,
        editor: { owner: "template", label: `img:${i}` },
      } as unknown as MosaicSource),
    assetEntryFor: () => undefined,
  };
}

/** Real mode: probed images from ctx.media, fail-fast on anything unusable. */
function mediaInput(sourceIds: string[], ctx: MosaicEngineContext): ResolvedInput | string {
  const problems: string[] = [];
  const aspects: number[] = [];
  const assetIds: string[] = [];
  const entries: Array<[string, { kind: "file"; path: string; mediaType: "image" }]> = [];
  for (const id of sourceIds) {
    const meta = ctx.media[asAssetId(id)];
    if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
      problems.push(`no probed dimensions for "${id}"`);
      continue;
    }
    if (meta.kind !== "image") {
      problems.push(`"${id}" is ${meta.kind ?? "unknown"} - the collage packs images only (for now)`);
      continue;
    }
    const assetId = String(asAssetId(slugifyAssetKeyFromPath(id)));
    aspects.push(meta.width / meta.height);
    assetIds.push(assetId);
    entries.push([assetId, { kind: "file", path: id, mediaType: "image" }]);
  }
  if (problems.length > 0) return problems.join("; ");
  return {
    aspects,
    sourceFor: (i) =>
      ({
        type: "media",
        mediaType: "image",
        assetId: assetIds[i],
        editor: { owner: "template", label: `img:${i}` },
      } as unknown as MosaicSource),
    assetEntryFor: (i) => entries[i] as unknown as [string, MosaicAssetManifest[keyof MosaicAssetManifest]],
  };
}

/** The declared design intent, generated from the solved layout (GLOBAL labels). */
function collageContract(
  cells: EmitCollageResult["cells"],
  expectedNullFrac: number,
  gutterPx: number,
): { constraints: LayoutConstraint[]; relations: RelationalConstraint[] } {
  const constraints: LayoutConstraint[] = cells.map((c) => ({
    label: `img:${c.imageIndex}`,
    aspect: c.target.w / c.target.h,
    aspectTolerance: 0.02,
  }));
  const allLabels = cells.map((c) => `img:${c.imageIndex}`);
  const relations: RelationalConstraint[] = [
    { label: allLabels, lattice: { gutterXPx: gutterPx, gutterYPx: gutterPx } },
    { label: allLabels, coverage: { expectedNullFrac } },
  ];
  const byClass = new Map<string, { labels: string[]; minPx: number }>();
  for (const c of cells) {
    const entry = byClass.get(c.span.span) ?? { labels: [], minPx: Infinity };
    entry.labels.push(`img:${c.imageIndex}`);
    entry.minPx = Math.min(entry.minPx, c.target.w, c.target.h);
    byClass.set(c.span.span, entry);
  }
  for (const { labels, minPx } of byClass.values()) {
    if (labels.length >= 2)
      relations.push({ label: labels, equal: "size", tolerance: Math.max(0.02, 3 / Math.max(1, minPx)) });
  }
  return { constraints, relations };
}

type PageDocKnobs = {
  W: number;
  H: number;
  gutterPx: number;
  marginPx: number;
  background: MosaicColor;
  debugLayout: boolean;
  page: number;
  pageCount: number;
};

/** Build one sheet's document from a page solve (labels/assets in GLOBAL indexes). */
function buildPageDoc(
  pageSolve: PageSolve,
  input: ResolvedInput,
  ctx: MosaicEngineContext,
  knobs: PageDocKnobs,
): MosaicDocument {
  const { imageIndexes, solve } = pageSolve;
  const layout = emitCollageLayout({
    placed: solve.placed,
    cols: solve.candidate.cols,
    rows: solve.candidate.rows,
    canvasW: knobs.W,
    canvasH: knobs.H,
    gutterXPx: knobs.gutterPx,
    gutterYPx: knobs.gutterPx,
    marginPx: knobs.marginPx,
    sourceFor: (local) => input.sourceFor(imageIndexes[local]),
  });
  // Globalize the cell mapping (the solve works in page-local indexes).
  const cells = layout.cells.map((c) => ({ ...c, imageIndex: imageIndexes[c.imageIndex] }));

  // Crop surfacing: per-image display labels + a page summary on the doc.
  const cropByLocal = new Map(solve.assignments.map((a) => [a.imageIndex, a.cost]));
  const labels: Record<string, string> = {};
  layout.cells.forEach((c, i) => {
    const crop = cropByLocal.get(c.imageIndex) ?? 0;
    labels[c.stableKey] = `img:${cells[i].imageIndex} · ${c.span.span} · crop ${(crop * 100).toFixed(0)}%`;
  });
  const meanCropPct = (solve.metrics.meanCrop * 100).toFixed(1);
  const pageNote = knobs.pageCount > 1 ? ` — page ${knobs.page}/${knobs.pageCount}` : "";
  const editorLabel = `Image Collage${pageNote} · ${imageIndexes.length} images · mean crop ${meanCropPct}%`;

  const assets: MosaicAssetManifest = {} as MosaicAssetManifest;
  for (const g of imageIndexes) {
    const entry = input.assetEntryFor(g);
    if (entry) (assets as Record<string, unknown>)[entry[0]] = entry[1];
  }

  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    assets,
    m0: layout.m0,
    sources: layout.sources,
    labels,
    fps: ctx.target.fps,
    durationMs: ctx.target.durationMs,
    size: { width: knobs.W, height: knobs.H },
    backgroundColor: knobs.background,
    // Gate-26 convention: every rendered doc declares its format. A contact
    // sheet is an opaque PNG still (the background is a solid fill).
    format: { kind: "image", container: "png" },
    editor: { label: editorLabel },
  };

  const { constraints, relations } = collageContract(cells, layout.expectedNullFrac, knobs.gutterPx);
  return withLayoutContract(doc, ctx, {
    templateId: TEMPLATE_ID,
    constraints,
    relations,
    debug: knobs.debugLayout,
  });
}

export const ImageCollage: MosaicTemplate<ImageCollageProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: "Image Collage",
  version: 1,
  description:
    "Packs any set of photos into a designed contact sheet: a searched layout with hero, portrait and panorama cells sized to each image's aspect, even pixel gutters, and a soft crop budget so nothing is trimmed too hard. Big sets page into one PNG per sheet. With no images it shows a demo set.",
  capabilities: { tier: "core" },
  tags: ["media", "collage", "image", "layout-solver", "contact-sheet", "creators", "designers", "photos", "grid", "social"],
  outputHints: { width: 1920, height: 1080, format: { kind: "image", container: "png" } },
  propsSchema,

  defaultProps: {
    maxCellPx: 320,
    minCellPx: 120,
    pageLattice: "uniform",
    gutter: 0.01,
    margin: 1,
    cropBudget: 0.3,
    maxImagesPerSheet: 30,
    seed: 1,
    background: DEFAULT_BACKGROUND,
    debugLayout: false,
  },

  async render(props: ImageCollageProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const fail = (message: string): MosaicDocument =>
      makeErrorMosaic(message, { title: "Image Collage", width: W, height: H });

    // ── knobs ──
    const gutterPx =
      props.gutterPx != null
        ? Math.max(0, Math.round(props.gutterPx))
        : Math.max(0, Math.round((props.gutter ?? 0.01) * Math.min(W, H)));
    const marginPx =
      props.marginPx != null
        ? Math.max(0, Math.round(props.marginPx))
        : Math.round(Math.max(0, Math.min(1, props.margin ?? 1)) * gutterPx);
    if (marginPx > gutterPx && props.marginPx != null)
      return fail(
        // ASCII only: makeErrorMosaic's drawtext card maps non-ASCII to "?".
        `marginPx ${marginPx} exceeds the gutter ${gutterPx}px - margins beyond the gutter need an m0-level wrapper (not supported yet).`,
      );
    const cropBudget = Math.min(0.9, Math.max(0, props.cropBudget ?? 0.3));
    const minCellPx = Math.max(16, Math.round(props.minCellPx ?? 120));
    const maxCellPx = Math.max(minCellPx, Math.round(props.maxCellPx ?? 320));
    const seed = Math.floor(props.seed ?? 1);
    const maxImagesPerSheet = Math.max(1, Math.round(props.maxImagesPerSheet ?? 30));
    const background = props.background ?? DEFAULT_BACKGROUND;
    const debugLayout = props.debugLayout === true;

    // ── inputs ──
    const ids = (props.sourceIds ?? []).map((s) => String(s).trim()).filter((s) => s.length > 0);
    const input = ids.length === 0 ? demoInput() : mediaInput(ids, ctx);
    if (typeof input === "string") return fail(input);

    // ── search (pages when the set outgrows one sheet) ──
    let pages: PageSolve[];
    try {
      pages = solvePages({
        canvasW: W,
        canvasH: H,
        gutterXPx: gutterPx,
        gutterYPx: gutterPx,
        marginPx,
        minCellPx,
        maxCellPx,
        aspects: input.aspects,
        seed,
        cropBudget,
        maxImagesPerSheet,
        pageLattice: props.pageLattice === "independent" ? "independent" : "uniform",
      });
    } catch {
      return fail(
        `no lattice fits any sheet of ${input.aspects.length} image(s) on ${W}x${H} within cell bounds ` +
          `[${minCellPx}, ${maxCellPx}]px - lower minCellPx or enlarge the canvas.`,
      );
    }

    const knobs = { W, H, gutterPx, marginPx, background, debugLayout, pageCount: pages.length };
    if (pages.length === 1) return buildPageDoc(pages[0], input, ctx, { ...knobs, page: 1 });

    const durationMs = ctx.target.durationMs ?? 40;
    const steps: MosaicPipelineStep[] = pages.map((p, i) => ({
      name: `page_${String(i + 1).padStart(2, "0")}`,
      label: `page_${String(i + 1).padStart(2, "0")}`,
      durationMs,
      file: buildPageDoc(p, input, ctx, { ...knobs, page: i + 1 }),
    }));
    const pipeline: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      emit: "multi",
      steps,
    };
    return pipeline;
  },

  // The Make "?" walkthrough (gate 31, founder: "prepare a render tutorial.
  // keep it simple on how to use. select images, or a folder of images").
  // Three beats: pick photos or a folder → the sheet lays itself out → big
  // sets page. Deterministic, media-free, own step timing.
  renderTutorial(_props: ImageCollageProps, ctx: MosaicEngineContext) {
    return renderImageCollageTutorial(ctx);
  },
};

registerTemplate(ImageCollage);
