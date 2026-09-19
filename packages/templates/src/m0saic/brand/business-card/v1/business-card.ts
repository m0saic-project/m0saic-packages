/**
 * ============================================================================
 * @m0saic/brand/business-card/v1 — the m0saic business card, print-ready
 * ============================================================================
 *
 * A double-sided US business card (3.5 x 2 in) rendered at press resolution.
 * One render emits TWO PNG stills as an `emit: "multi"` pipeline — the CLI
 * writes `<out>-front.png` and `<out>-back.png`; Make previews both faces.
 *
 *   FRONT — the brand surface: the Home-screen tile field cover-fit across the
 *           bleed canvas, the M + wordmark lockup, then name / role and the
 *           contact lines in the product's mono face.
 *   BACK  — one shipped template (the `back` knob), rendered LIVE as a nested
 *           child with its motion frozen, beside a QR that opens it on Mosaic
 *           Web (`app.m0saic.io/make?t=<id>`), the site's typeable link
 *           (`m0saic.io/t/<pack>/<slug>/<vN>`) and the `npx` one-liner.
 *
 * Print discipline lives in `layout.ts`: inches × dpi, trim centred on a
 * bleed canvas (MOO's 3.66 x 2.16 in box by default — 1098 x 648 px at 300
 * DPI, exact; 1/8 in for FedEx Office / Staples, 1/16 in for Vistaprint),
 * a 1/8 in safe area, MOO's 8 pt type floor (the back's `npx` line is the one
 * exception: every card prints it at the size the LONGEST catalog command
 * fits), even lattice-friendly canvas edges.
 * The engine writes no DPI metadata — tag the PNGs at 300 DPI before upload
 * (`sips -s dpiWidth 300 -s dpiHeight 300 …` or sharp's `withMetadata`).
 *
 * Everything is real geometry (the Rect Thesis): field tiles, the glyph
 * masks, every text line, the poster and QR cells are m0 cells laundered
 * through `placeInsetPieces` — zero drift, bounded precision.
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
  MosaicTemplateOutputHints,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  BRAND_ORANGE,
  HEADER_M_GLYPH,
  NAVY,
  NAVY_SOFT,
  WORDMARK_BOUNDS,
  WORDMARK_LETTER_PATHS,
  WORDMARK_ZERO_PATHS,
  bindProp,
  brandGlyphTile,
  definePropsSchema,
  getTemplate,
  makeColorTile,
  makeErrorMosaic,
  mixHex,
  placeInsetPieces,
  qrToRenderable,
  registerTemplate,
  renderNestedTemplate,
  tag,
  withLayoutContract,
  type InsetPiece,
  type LayoutConstraint,
} from "@m0saic/template-utils";
import {
  BACK_CATALOG,
  BACK_KEYS,
  commandFor,
  displayUrl,
  frozenProps,
  longestCommand,
  makeUrl,
  pickBack,
  type BackKey,
} from "./back-catalog";
import {
  BLEEDS,
  DPI_DEFAULT,
  DPI_MAX,
  DPI_MIN,
  buildBackLayout,
  buildFrontLayout,
  cardCanvas,
  clampDpi,
  effectiveDpi,
  outlineRects,
  pickBleed,
  type Bleed,
  type CardCanvas,
  type Rect,
  type TextLine,
} from "./layout";

export type BusinessCardProps = {
  /** Name — the bold line. */
  name?: string;
  /** Role / company line under the name. Empty = none. */
  role?: string;
  /** Email (mono). Empty = none. */
  email?: string;
  /** Website (mono). Empty = none. */
  site?: string;
  /** Social handle (mono, beside the site). Empty = none. */
  handle?: string;
  /** Which shipped template the back shows. */
  back?: BackKey;
  /** Printer bleed per side: MOO's 0.08 in box (default), none (trim only), 1/16 in, 1/8 in. */
  bleed?: Bleed;
  /** Print resolution; the whole card scales with it. Default 300. */
  dpi?: number;
  /** Field tile tint over the navy (Home uses 0.16; print wants more). */
  fieldOpacity?: number;
  /** Accent — the M and the wordmark's zero. */
  accent?: MosaicColor;
  /** Draw the trim and safe-area outlines (proofing only). */
  guides?: boolean;
  /** Dev-only: check the layout contract (marks keep their aspect, the back's template keeps ITS aspect, everything inside the safe area). */
  debugLayout?: boolean;
};

const TEMPLATE_ID = "@m0saic/brand/business-card/v1";
const LABEL = "Business Card";

/** Wordmark letterforms (logo.svg paints them white). */
const INK = "#FFFFFF" as MosaicColor;
/** Name ink — a hair under white so the wordmark stays the brightest thing. */
const NAME_INK = "#F0F0F6" as MosaicColor;
/** Role / secondary ink. */
const MUTED_INK = "#8A89A3" as MosaicColor;
/** Contact lines. */
const MONO_INK = "#E6E6F0" as MosaicColor;
/** Proof guides: trim in the accent, safe in green. */
const GUIDE_TRIM = "#EF7525" as MosaicColor;
const GUIDE_SAFE = "#5CB85C" as MosaicColor;
/** Home's tile opacity is 0.16 — on dark stock that is ΔL≈2 and vanishes. */
const DEFAULT_FIELD_OPACITY = 0.28;
/** The branded QR's module rounding — `media/qr/code/v1`'s default "circle" (radius 1.0). */
const QR_MODULE_RADIUS = 1.0;
/** Poster frame = navy-soft mixed onto navy (the hairline around the Home card). */
const POSTER_FRAME_MIX = 0.45;
/** Steps are stills; the engine still wants a duration per step. */
const STEP_DURATION_MS = 1000;

const propsSchema = definePropsSchema<BusinessCardProps>({
  name: {
    type: "string",
    required: false,
    description: "Name — the bold line on the front.",
    meta: { control: { placeholder: "none" }, ui: { label: "Name", order: 1, primary: true } },
  },
  role: {
    type: "string",
    required: false,
    description: "Role / company line under the name. Empty removes it.",
    meta: { control: { placeholder: "none" }, ui: { label: "Role", order: 2 } },
  },
  email: {
    type: "string",
    required: false,
    description: "Email address (mono). Empty removes it.",
    meta: { control: { placeholder: "none" }, ui: { label: "Email", order: 3 } },
  },
  site: {
    type: "string",
    required: false,
    description: "Website (mono). Empty removes it.",
    meta: { control: { flavor: "url", placeholder: "none" }, ui: { label: "Site", order: 4 } },
  },
  handle: {
    type: "string",
    required: false,
    description: "Social handle, printed beside the site. Empty removes it.",
    meta: { control: { placeholder: "none" }, ui: { label: "Handle", order: 5 } },
  },
  back: {
    type: "string",
    required: false,
    description: "Which shipped template the back of the card shows (rendered live, with a QR that opens it on Mosaic Web).",
    meta: { constraints: { oneOf: [...BACK_KEYS] }, ui: { label: "Back", order: 1, primary: true } },
  },
  bleed: {
    type: "string",
    required: false,
    description: 'Printer bleed per side: "moo" (MOO — 3.66 x 2.16 in, 1098 x 648 px at 300 DPI, exact), "none" (trim only, 3.5 x 2 in), "sixteenth" (Vistaprint), "eighth" (FedEx Office / Staples).',
    meta: { constraints: { oneOf: [...BLEEDS] }, ui: { label: "Bleed", order: 1 } },
  },
  dpi: {
    type: "number",
    required: false,
    description: "Print resolution in dots per inch — every dimension scales with it. 300 is press standard.",
    meta: { constraints: { min: DPI_MIN, max: DPI_MAX }, control: { flavor: "slider", step: 50 }, ui: { label: "DPI", order: 2 } },
  },
  fieldOpacity: {
    type: "number",
    required: false,
    description: "Tint of the field tiles over the navy. The app uses 0.16; print stock needs more contrast.",
    meta: { constraints: { min: 0, max: 0.6 }, control: { flavor: "slider", step: 0.01 }, ui: { label: "Field opacity", order: 3 } },
  },
  accent: {
    type: "string",
    required: false,
    description: "Accent colour — the M and the wordmark's zero.",
    meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Accent", order: 4 } },
  },
  guides: {
    type: "boolean",
    required: false,
    description: "Draw the trim (orange) and safe-area (green) outlines for proofing. Off for the press file.",
    meta: { ui: { label: "Proof guides", order: 5 } },
  },
  debugLayout: {
    type: "boolean",
    required: false,
    description: "Dev-only: overlay the layout contract (every mark keeps its aspect, the back's template keeps its own, every glyph stays inside the safe area).",
    meta: { ui: { label: "Debug layout", order: 6 } },
  },
});

/** Blank-string colour pickers mean "unset" — fall back. */
function pickColor(value: MosaicColor | undefined, fallback: MosaicColor): MosaicColor {
  const s = typeof value === "string" ? value.trim() : value;
  return s ? (s as MosaicColor) : fallback;
}

/** One svg-rasterized text line, left-aligned in its measured rect. */
function textSource(line: TextLine, color: MosaicColor, label: string): MosaicSource {
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    layers: [
      {
        content: { kind: "literal", text: line.text },
        style: {
          fontSize: line.fontSize,
          fontColor: color,
          fontFamily: line.family,
          ...(line.bold ? { fontWeight: "bold" as const } : {}),
        },
        placement: { hAlign: "left" as const, vAlign: "middle" as const },
      },
    ],
    editor: { owner: "template", label },
  } as unknown as MosaicSource;
}

/** A single-colour silhouette clipped by SVG paths (the wordmark halves). */
function pathTile(paths: readonly string[], color: MosaicColor): MosaicSource {
  return makeColorTile(color, {
    mask: {
      kind: "inline-mask",
      localPath: paths.join(" "),
      bounds: { x: 0, y: 0, width: WORDMARK_BOUNDS.width, height: WORDMARK_BOUNDS.height },
    },
  }) as MosaicSource;
}

function fieldPieces(field: Rect[], tile: MosaicColor): InsetPiece[] {
  return field.map((r) => ({ rect: { ...r, importance: 0 }, source: tag(makeColorTile(tile) as MosaicSource, "field") }));
}

function guidePieces(c: CardCanvas): InsetPiece[] {
  const stroke = Math.max(1, Math.round(c.dpi / 150));
  return [
    ...outlineRects(c.trim, stroke).map((r) => ({ rect: { ...r, importance: 9 }, source: tag(makeColorTile(GUIDE_TRIM) as MosaicSource, "guide-trim") })),
    ...outlineRects(c.safe, stroke).map((r) => ({ rect: { ...r, importance: 9 }, source: tag(makeColorTile(GUIDE_SAFE) as MosaicSource, "guide-safe") })),
  ];
}

type Knobs = {
  c: CardCanvas;
  tile: MosaicColor;
  accent: MosaicColor;
  guides: boolean;
  fps: number;
  durationMs: number;
};

function stillDoc(c: CardCanvas, placed: { m0: unknown; sources: MosaicSource[] }, k: Knobs, label: string, children?: Record<string, MosaicDocument>): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as MosaicAssetManifest,
    m0: toM0String(String(placed.m0), label),
    sources: placed.sources,
    backgroundColor: NAVY,
    fps: k.fps,
    durationMs: k.durationMs,
    size: { width: c.W, height: c.H },
    format: { kind: "image", container: "png" },
    ...(children ? { children } : {}),
    editor: { label },
  } as MosaicDocument;
}

/** JetBrains Mono advances exactly 0.6 em per glyph; the sans lines are measured, not modelled. */
const MONO_FIT = { charWidthEm: 0.6, padPx: 0 } as const;

/**
 * The layout contract — label-keyed, canvas-independent, shared by `render`
 * (`debugLayout`) and the gate test's canvas sweep. Every glyph/mark on a face
 * must stay inside the safe area; the marks keep their aspect; and on the
 * back the NESTED TEMPLATE keeps ITS OWN aspect (the cell is cut to the
 * child's canvas, so a stretched poster is a contract violation, not a
 * render surprise).
 */
export function businessCardConstraints(
  face: "front" | "back",
  c: CardCanvas,
  present: { labels: readonly string[]; posterAspect?: number },
): LayoutConstraint[] {
  const has = (label: string) => present.labels.includes(label);
  const safe = { xFrac: [c.safe.x / c.W, (c.safe.x + c.safe.w) / c.W] as [number, number], yFrac: [c.safe.y / c.H, (c.safe.y + c.safe.h) / c.H] as [number, number] };
  const out: LayoutConstraint[] = [{ label: "field" }];
  if (face === "front") {
    out.push(
      { label: "mark", aspect: 1, aspectTolerance: 0.05, within: safe },
      { label: "wordmark", aspect: WORDMARK_BOUNDS.width / WORDMARK_BOUNDS.height, aspectTolerance: 0.05, within: safe },
      { label: "name", within: safe },
    );
    for (const label of ["role"]) if (has(label)) out.push({ label, within: safe });
    for (const label of ["email", "site", "handle"]) if (has(label)) out.push({ label, within: safe, textFits: MONO_FIT });
  } else {
    out.push(
      { label: "poster", aspect: present.posterAspect ?? 16 / 9, aspectTolerance: 0.03, within: safe },
      { label: "qr", aspect: 1, aspectTolerance: 0.03, within: safe },
      { label: "title", within: safe },
      { label: "url", within: safe, textFits: MONO_FIT },
      { label: "command", within: safe, textFits: MONO_FIT },
    );
  }
  return out;
}

function contractCtx(ctx: MosaicEngineContext, c: CardCanvas): MosaicEngineContext {
  return { ...ctx, target: { ...ctx.target, width: c.W, height: c.H } } as MosaicEngineContext;
}

function buildFront(props: BusinessCardProps, k: Knobs, ctx: MosaicEngineContext): MosaicDocument {
  const { c } = k;
  const copy = {
    name: (props.name ?? "").trim() || " ",
    role: (props.role ?? "").trim(),
    email: (props.email ?? "").trim(),
    site: (props.site ?? "").trim(),
    handle: (props.handle ?? "").trim(),
  };
  const f = buildFrontLayout(c, copy);

  const pieces: InsetPiece[] = [
    ...fieldPieces(f.field, k.tile),
    { rect: { ...f.mark, importance: 2 }, source: bindProp(tag(brandGlyphTile(HEADER_M_GLYPH, k.accent), "mark"), "accent") },
    { rect: { ...f.wordmark, importance: 2 }, source: tag(pathTile(WORDMARK_LETTER_PATHS, INK), "wordmark") },
    { rect: { ...f.wordmark, importance: 3 }, source: bindProp(tag(pathTile(WORDMARK_ZERO_PATHS, k.accent), "wordmark-zero"), "accent") },
    { rect: { ...f.name.rect, importance: 2 }, source: bindProp(textSource(f.name, NAME_INK, "name"), "name") },
  ];
  if (f.role) pieces.push({ rect: { ...f.role.rect, importance: 2 }, source: bindProp(textSource(f.role, MUTED_INK, "role"), "role") });
  if (f.email) pieces.push({ rect: { ...f.email.rect, importance: 2 }, source: bindProp(textSource(f.email, MONO_INK, "email"), "email") });
  if (f.site) pieces.push({ rect: { ...f.site.rect, importance: 2 }, source: bindProp(textSource(f.site, MONO_INK, "site"), "site") });
  if (f.handle) pieces.push({ rect: { ...f.handle.rect, importance: 2 }, source: bindProp(textSource(f.handle, MUTED_INK, "handle"), "handle") });
  if (k.guides) pieces.push(...guidePieces(c));

  const placed = placeInsetPieces({ rootW: c.W, rootH: c.H, pieces });
  const doc = stillDoc(c, placed, k, `${LABEL} · front`);
  const labels = ["mark", "wordmark", "name", ...(f.role ? ["role"] : []), ...(f.email ? ["email"] : []), ...(f.site ? ["site"] : []), ...(f.handle ? ["handle"] : [])];
  return withLayoutContract(doc, contractCtx(ctx, c), {
    templateId: TEMPLATE_ID,
    constraints: businessCardConstraints("front", c, { labels }),
    relations: [],
    debug: props.debugLayout === true,
  });
}

/**
 * A child's engine context at ITS OWN canvas. `renderNestedTemplate`'s `slot`
 * only moves `ctx.target`; shipped templates that size off `ctx.output.*`
 * (donut v4, the QR family, brand/logo — 26 of them, all frozen) would
 * otherwise lay out for the PARENT's canvas and stretch their masks by the
 * parent's aspect. Same move the editor covers make (donut.ts renderCover).
 */
function nestedCtx(ctx: MosaicEngineContext, width: number, height: number, fps: number): MosaicEngineContext {
  return {
    ...ctx,
    target: { width, height, fps, durationMs: STEP_DURATION_MS },
    output: { ...ctx.output, width, height },
  } as MosaicEngineContext;
}

/** The QR template's carve: a 272² safe square, 8% padding — mirrored here for the version probe. */
const QR_CENTER = { show: true, width: 272, height: 272, paddingPct: 8 } as const;
const QR_EYES = { outerBorderRadius: 0.3, innerLightBorderRadius: 0.3, innerDotBorderRadius: 0.5 } as const;

/**
 * The smallest QR version that encodes `text` with the template's carve
 * (ECC H + the centre safe area). The QR template pins a cutout to version
 * 6 exactly (~58 bytes of URL); a long template id overflows it and renders
 * an error card. Same encoder, same arguments — so what fits here fits there.
 */
export function pickQrVersion(text: string, moduleColor: MosaicColor): number {
  for (let version = 6; version <= 14; version++) {
    try {
      qrToRenderable({
        text,
        moduleColor,
        errorCorrectionLevel: "H",
        backgroundColor: INK,
        eyes: { darkColor: moduleColor, ...QR_EYES },
        version,
        safeArea: { width: QR_CENTER.width, height: QR_CENTER.height, paddingPct: QR_CENTER.paddingPct },
      });
      return version;
    } catch {
      // too small for the payload at ECC H — try the next
    }
  }
  return 14;
}

/** The picture to show for a nested render: the document itself, or a pipeline's last output step. */
function posterDocument(file: MosaicRenderableFile): MosaicDocument | null {
  if (file.kind === "mosaic_document") return file;
  if (file.kind === "mosaic_pipeline") {
    const outputs = file.steps.filter((s) => !s.intermediate && s.file?.kind === "mosaic_document");
    const last = outputs[outputs.length - 1];
    return last ? (last.file as MosaicDocument) : null;
  }
  return null;
}

async function buildBack(props: BusinessCardProps, k: Knobs, ctx: MosaicEngineContext): Promise<MosaicDocument | string> {
  const { c } = k;
  const key = pickBack(props.back);
  const entry = BACK_CATALOG[key];
  const child = getTemplate(entry.templateId);
  if (!child) return `back "${key}" needs ${entry.templateId}, which is not registered in this build`;
  const hints = child.outputHints;
  const hinted = hints?.width && hints?.height && hints.width > 0 && hints.height > 0 ? { width: hints.width, height: hints.height } : null;
  const natural = entry.slot === "cell" ? hinted : (entry.slot ?? hinted);
  const posterAspect = natural ? natural.width / natural.height : 16 / 9;

  const url = makeUrl(entry.templateId);
  const b = buildBackLayout(c, { title: entry.title, url: displayUrl(entry), command: commandFor(entry), commandSizedFor: longestCommand(), posterAspect });

  // The poster: the template itself with its motion frozen so frame 0 is the
  // finished picture. Rendered at ITS OWN hinted canvas — the canvas its
  // layout was designed for — and scaled into the cell (same aspect, so
  // `contain` never letterboxes). At the cell's size some layouts fall under
  // their safe minimum and cull to nothing.
  const posterProps = frozenProps(child.defaultProps as Record<string, unknown> | undefined, entry.flavour);
  const slotW = entry.slot === "cell" ? b.poster.w : (natural ? Math.round(natural.width) : b.poster.w);
  const slotH = entry.slot === "cell" ? b.poster.h : (natural ? Math.round(natural.height) : b.poster.h);
  let rendered: MosaicRenderableFile;
  try {
    rendered = await renderNestedTemplate(entry.templateId, posterProps, nestedCtx(ctx, slotW, slotH, k.fps), {
      slot: { width: slotW, height: slotH, fps: k.fps, durationMs: STEP_DURATION_MS },
    });
  } catch (err) {
    return `back "${key}" failed to render: ${err instanceof Error ? err.message : String(err)}`;
  }
  const poster = posterDocument(rendered);
  if (!poster) return `back "${key}" rendered a ${rendered.kind} with no final document; the back needs one picture`;
  if (poster.sources.length === 0) return `back "${key}" rendered an empty document`;

  // The QR: the brand look of `media/qr/code/v1` at its defaults (brand-orange
  // circle modules, the 3-layer rounded eye treatment, a carved centre; founder
  // pick 2026-09-15) composed straight from the same encoder. NOT nested as that template: it draws its centre M as a
  // `brand/m-33` child whose m0 is a 272-column split — fine at its 1080²
  // canvas, infeasible in a 1 in cell on a 3.5 in card (the editor's flatten
  // culls it and reports a 9605 px minimum). Here the carve holds ONE masked
  // tile — the accent M — so the whole back flattens at the card's own size.
  const version = pickQrVersion(url, k.accent);
  let qr;
  try {
    qr = qrToRenderable({
      text: url,
      moduleColor: k.accent,
      errorCorrectionLevel: "H",
      backgroundColor: INK,
      eyes: { darkColor: k.accent, ...QR_EYES },
      version,
      safeArea: { width: QR_CENTER.width, height: QR_CENTER.height, paddingPct: QR_CENTER.paddingPct },
    });
  } catch (err) {
    return `QR for ${url}: ${err instanceof Error ? err.message : String(err)}`;
  }
  // Source order (the encoder's eye-splice mode): data cells, then 3 eye
  // layers per finder, then the safe-area splice — see qr-code.ts.
  const eyeBlockCount = (qr.channelByRole.eyes?.frames.length ?? 0) * 3;
  const spliceCount = qr.safeAreaStableKey ? 1 : 0;
  const dataCellEnd = qr.sources.length - eyeBlockCount - spliceCount;
  const qrSources: MosaicSource[] = qr.sources.map((src, i) => {
    if (i < dataCellEnd) return makeColorTile(k.accent, { effects: { rounding: { borderRadius: QR_MODULE_RADIUS, cornerStyle: "rounded" } } }) as MosaicSource;
    if (i >= qr.sources.length - spliceCount) return bindProp(tag(brandGlyphTile(HEADER_M_GLYPH, k.accent), "qr-mark"), "accent");
    return src as MosaicSource;
  });
  const qrChild: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(qr.m0), `${LABEL} · qr`),
    sources: qrSources,
    assets: {} as MosaicAssetManifest,
    size: { width: qr.canvasW, height: qr.canvasH },
    backgroundColor: INK,
    fps: k.fps,
    durationMs: k.durationMs,
    editor: { label: "qr" },
    // A QR is a module grid — a baked raster the latticeSmooth convention
    // skips (the per-document form of `lattice.mode: "bitmap"`).
    engine: { lattice: { mode: "bitmap" } },
  };

  // A hairline frame under the poster (navy-soft on navy, the Home card's
  // border) so the nested render reads as a picture of the template.
  const frameStroke = Math.max(1, Math.round(c.dpi / 150));
  const frame: Rect = { x: b.poster.x - frameStroke, y: b.poster.y - frameStroke, w: b.poster.w + 2 * frameStroke, h: b.poster.h + 2 * frameStroke };
  const pieces: InsetPiece[] = [
    ...fieldPieces(b.field, k.tile),
    { rect: { ...frame, importance: 1 }, source: tag(makeColorTile(mixHex(NAVY, NAVY_SOFT, POSTER_FRAME_MIX)) as MosaicSource, "poster-frame") },
    {
      rect: { ...b.poster, importance: 2 },
      source: { type: "mosaic", ref: "poster", placement: { fit: "contain" }, editor: { owner: "template", label: "poster" } } as MosaicSource,
    },
    {
      rect: { ...b.qr, importance: 2 },
      source: { type: "mosaic", ref: "qr", placement: { fit: "contain" }, editor: { owner: "template", label: "qr" } } as MosaicSource,
    },
    { rect: { ...b.title.rect, importance: 2 }, source: textSource(b.title, NAME_INK, "title") },
    { rect: { ...b.url.rect, importance: 2 }, source: textSource(b.url, MONO_INK, "url") },
    { rect: { ...b.command.rect, importance: 2 }, source: textSource(b.command, MUTED_INK, "command") },
  ];
  if (k.guides) pieces.push(...guidePieces(c));

  const placed = placeInsetPieces({ rootW: c.W, rootH: c.H, pieces });
  const doc = stillDoc(c, placed, k, `${LABEL} · back · ${entry.title}`, { poster, qr: qrChild });
  // Unflattened on purpose: the contract judges the CELLS the children land
  // in (the poster keeps its template's aspect, the QR stays square). The
  // children render in their own framebuffers at their own canvas, so their
  // inner geometry is not what the cell shows.
  return withLayoutContract(doc, contractCtx(ctx, c), {
    templateId: TEMPLATE_ID,
    constraints: businessCardConstraints("back", c, { labels: ["poster", "qr", "title", "url", "command"], posterAspect }),
    relations: [],
    flatten: false,
    debug: props.debugLayout === true,
  });
}

/** The natural canvas for a prop set — what the manifest, Make and the CLI seed. */
function naturalHints(props: BusinessCardProps): Partial<MosaicTemplateOutputHints> {
  const c = cardCanvas(pickBleed(props.bleed), clampDpi(props.dpi));
  return { width: c.W, height: c.H };
}

const DEFAULT_PROPS: BusinessCardProps = {
  name: "Quentin S",
  role: "Founder, m0saic",
  email: "quentin@m0saic.io",
  site: "m0saic.io",
  handle: "@qsbuilds",
  back: "hello-world",
  bleed: "moo",
  dpi: DPI_DEFAULT,
  fieldOpacity: DEFAULT_FIELD_OPACITY,
  accent: BRAND_ORANGE,
  guides: false,
  debugLayout: false,
};

const DEFAULT_CANVAS = cardCanvas("moo", DPI_DEFAULT);

export const BusinessCard: MosaicTemplate<BusinessCardProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: LABEL,
  version: 1,
  description:
    "The m0saic business card, print-ready: US 3.5 x 2 in at 300 DPI on MOO's bleed box (1098 x 648 px; Vistaprint / FedEx presets too), the brand field + M lockup and your contact on the front, a live-rendered shipped template with a QR to Mosaic Web on the back. One render, two PNGs (front + back).",
  capabilities: { tier: "core" },
  tags: ["brand", "print", "card", "business-card", "still", "qr", "founders", "marketers", "developers"],
  aspectRatio: { ideal: DEFAULT_CANVAS.W / DEFAULT_CANVAS.H, min: 1.5, max: 1.95, mode: "warn" },
  // The canvas is the print spec (MOO's 3.66 × 2.16 in box at 300 DPI = 1098 × 648
  // px, exact — the uploader fits the file to that box): no even 5-smooth width
  // exists within trim tolerance, so the rough canvas is declared physical — the
  // counts it explains are charged to it, and the QR child is a bitmap.
  // Everything else on the card is held to the lattice.
  lattice: { canvas: "physical" },
  outputHints: {
    width: DEFAULT_CANVAS.W,
    height: DEFAULT_CANVAS.H,
    fps: 30,
    durationMs: STEP_DURATION_MS,
    format: { kind: "image", container: "png" },
    note: "US 3.5 x 2 in on MOO's 3.66 x 2.16 in bleed box at 300 DPI (1098 x 648 px); emits <out>-front.png and <out>-back.png",
  },
  resolveOutputHints: naturalHints,
  propsSchema,
  defaultProps: DEFAULT_PROPS,

  async render(props: BusinessCardProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    const bleed = pickBleed(props.bleed);
    const dpi = effectiveDpi(bleed, clampDpi(props.dpi), ctx.target);
    const c = cardCanvas(bleed, dpi);
    const fail = (message: string): MosaicDocument => makeErrorMosaic(message, { title: LABEL, width: c.W, height: c.H });

    const fieldOpacity = Math.min(0.6, Math.max(0, props.fieldOpacity ?? DEFAULT_FIELD_OPACITY));
    const k: Knobs = {
      c,
      tile: mixHex(NAVY, NAVY_SOFT, fieldOpacity),
      accent: pickColor(props.accent, BRAND_ORANGE),
      guides: props.guides === true,
      fps: Math.max(1, Math.round(ctx.target.fps || 30)),
      durationMs: Math.max(1, Math.round(ctx.target.durationMs || STEP_DURATION_MS)),
    };

    const front = buildFront(props, k, ctx);
    const back = await buildBack(props, k, ctx);
    if (typeof back === "string") return fail(back);

    const steps: MosaicPipelineStep[] = [
      { name: "front", label: "front", durationMs: STEP_DURATION_MS, file: front },
      { name: "back", label: "back", durationMs: STEP_DURATION_MS, file: back },
    ];
    const pipeline: MosaicDocumentPipeline = { kind: "mosaic_pipeline", version: 1, emit: "multi", steps };
    return pipeline;
  },
};

registerTemplate(BusinessCard);
export default BusinessCard;
