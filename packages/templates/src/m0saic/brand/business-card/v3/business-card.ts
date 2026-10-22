/**
 * ============================================================================
 * @m0saic/brand/business-card/v3 — the m0saic business card, two themes, three backs
 * ============================================================================
 *
 * v2's card — same faces, same print discipline, v1's own `layout.ts` and
 * `back-catalog.ts` (frozen, imported, never copied) — with the jewelry show's
 * fork (`@jewelry-showcase/brand/business-card/v1`, 2026-10-18) folded back in
 * as two choices:
 *
 *  - `theme`: "light" — the m0saic.io solutions look (the app's light mode, the
 *    booth banner): an ivory page, warm tiles at 0.7, ink letters; "dark" —
 *    v2's navy card with tiles that survive print (below).
 *  - `back`: what the back shows.
 *      "solutions" — the industry solutions page: a big QR to `qrUrl`, a title,
 *        the link as typed and an optional line; with a `backImage`, the
 *        picture beside a smaller code instead (the fork's back).
 *      "hello-world" — v2's default back: the hello-world card, `m0saic.io/hello`.
 *      "template" — v2's back for any other shipped template (`backTemplate`):
 *        the template rendered live, the QR opens it on Mosaic Web.
 *
 * `{ theme: "dark", back: "hello-world" }` paints v2's default card, and
 * `back: "template"` v2's card for that template, with two inks changed for
 * print (the tests lock both):
 *
 *  - The field. v2's tiles are L* 6.5 on an L* 1.3 navy — a gap a backlit
 *    screen shows and paper cannot. Soft-proofed through the press profiles,
 *    the navy prints at L* 11 (coated FOGRA39) or 29 (uncoated FOGRA29), and
 *    v2's tiles only 2.4 / 1.6 above it: one flat black, the brick visible
 *    only under a strong light (the printer, 2026-10-18). v3 lifts the tiles
 *    to L* 31.1, which prints 20 / 10.6 above the navy, and keeps them on the
 *    navy's hue at chroma 30. Print takes a sixth (coated) to a third
 *    (uncoated) of that chroma, and 30 is what still reads blue on uncoated
 *    stock (the founder: "the brand is blue on orange and tan on orange").
 *  - The secondary ink (role, handle, the back's command), lifted so it still
 *    reads at the 8 pt floor on the lighter tiles.
 *
 * A double-sided US business card (3.5 x 2 in) rendered at press resolution.
 * One render emits TWO PNG stills as an `emit: "multi"` pipeline — the CLI
 * writes `<out>-front.png` and `<out>-back.png`; Make previews both faces.
 * The engine writes no DPI metadata — tag the PNGs at 300 DPI before upload
 * (`sips -s dpiWidth 300 -s dpiHeight 300 …` or sharp's `withMetadata`).
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
import { asAssetId, asTemplateId } from "@m0saic/types";
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
  bindProps,
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
  displayUrl as typeableUrl,
  frozenProps,
  longestCommand,
  makeUrl,
  type BackKey,
} from "../v1/back-catalog";
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
} from "../v1/layout";
import { buildQrBackLayout } from "./layout";

export const CARD_THEMES = ["light", "dark"] as const;
export type CardTheme = (typeof CARD_THEMES)[number];

export const BACK_MODES = ["solutions", "hello-world", "template"] as const;
export type BackMode = (typeof BACK_MODES)[number];

/** The shipped templates `back: "template"` offers — v2's catalog, hello-world aside (it is its own back). */
export const TEMPLATE_BACK_KEYS = BACK_KEYS.filter((k) => k !== "hello-world") as Exclude<BackKey, "hello-world">[];
export type TemplateBackKey = (typeof TEMPLATE_BACK_KEYS)[number];

export type BusinessCardV3Props = {
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
  /** "light" (the solutions look: ivory, warm tiles, ink) or "dark" (v2's navy, print-strength tiles). */
  theme?: CardTheme;
  /** What the back shows: the solutions QR, the hello-world card, or another shipped template. */
  back?: BackMode;
  /** The shipped template on the back when `back` is "template". */
  backTemplate?: TemplateBackKey;
  /** Solutions back: what the QR opens. Printed under it as typed. */
  qrUrl?: string;
  /** Solutions back: the bold line beside the QR. */
  backTitle?: string;
  /** Solutions back: a last line under the link (mono). Empty = none. */
  backLine?: string;
  /** Solutions back: one picture beside a smaller QR (cropped to 16:9). Empty = the big QR alone. */
  backImage?: string[];
  /** Printer bleed per side: MOO's 0.08 in box (default), none (trim only), 1/16 in, 1/8 in. */
  bleed?: Bleed;
  /** Print resolution; the whole card scales with it. Default 300. */
  dpi?: number;
  /** Field tile tint over the page. Empty = the theme's: 0.7 on light, 0.5 on dark. */
  fieldOpacity?: number;
  /** Accent — the M, the wordmark's zero and the QR. */
  accent?: MosaicColor;
  /** Draw the trim and safe-area outlines (proofing only). */
  guides?: boolean;
  /** Dev-only: check the layout contract (marks keep their aspect, the back's picture keeps its own, everything inside the safe area). */
  debugLayout?: boolean;
};

const TEMPLATE_ID = "@m0saic/brand/business-card/v3";
const LABEL = "Business Card";

/** The solutions look — m0saic.io's /solutions pages, the app's light mode, the booth banner (#FAF7F2 / #DCD1C2 / #14112A). */
const LIGHT = { page: "#FAF7F2" as MosaicColor, tile: "#DCD1C2" as MosaicColor, ink: "#14112A" as MosaicColor };
/**
 * Each theme's own tile tint. Light: the banner's 0.7 (L* 88 under a 97 page —
 * "clearly there, still soft", proven on printed fabric). Dark: 0.5 toward
 * `DARK_FIELD_INK` — #434574, L* 31.1 over a 1.3 navy; v2's 0.28 toward
 * navy-soft was L* 6.5 and printed as solid black.
 */
const DEFAULT_FIELD_OPACITY: Record<CardTheme, number> = { light: 0.7, dark: 0.5 };
/**
 * What the dark field mixes the navy toward: a periwinkle on the navy's own hue
 * (293° vs 294°, CIELCh), so every strength stays the brand's blue. Lifting the
 * old grey (#8A89A3, chroma 14) to print lightness read as slate; this one
 * holds chroma 27–33 across the 0.4–0.6 ladder (0.5 = #434574, chroma 30,
 * printing at about 26 coated / 20 uncoated, hue 288°).
 */
const DARK_FIELD_INK = "#8187D4" as MosaicColor;
/** Proof guides: trim in the accent, safe in green. */
const GUIDE_TRIM = "#EF7525" as MosaicColor;
const GUIDE_SAFE = "#5CB85C" as MosaicColor;
/** The branded QR's module rounding — `media/qr/code/v1`'s default "circle" (radius 1.0). */
const QR_MODULE_RADIUS = 1.0;
/** Steps are stills; the engine still wants a duration per step. */
const STEP_DURATION_MS = 1000;
/** The solutions back's picture: a 16:9 cell. */
const PICTURE_ASPECT = 16 / 9;
const SOLUTIONS_URL = "https://m0saic.io/solutions";

const onBack = (mode: BackMode) => ({ ui: { visibleWhen: { prop: "back", equals: mode } } });

// What each value IS. How Make presents it (label, hint, order, placeholder)
// is the catalog sidecar's — business-card.catalog.json.
const propsSchema = definePropsSchema<BusinessCardV3Props>({
  name: { type: "string", required: false },
  role: { type: "string", required: false },
  email: { type: "string", required: false },
  site: { type: "string", required: false, meta: { control: { flavor: "url" } } },
  handle: { type: "string", required: false },
  theme: { type: "string", required: false, meta: { constraints: { oneOf: [...CARD_THEMES] } } },
  back: { type: "string", required: false, meta: { constraints: { oneOf: [...BACK_MODES] } } },
  backTemplate: { type: "string", required: false, meta: { constraints: { oneOf: [...TEMPLATE_BACK_KEYS] }, ...onBack("template") } },
  qrUrl: { type: "string", required: false, meta: { control: { flavor: "url" }, ...onBack("solutions") } },
  backTitle: { type: "string", required: false, meta: onBack("solutions") },
  backLine: { type: "string", required: false, meta: onBack("solutions") },
  backImage: { type: "media[]", required: false, meta: { control: { multiple: false, picker: "file", accept: ["image"] }, ...onBack("solutions") } },
  bleed: { type: "string", required: false, meta: { constraints: { oneOf: [...BLEEDS] } } },
  dpi: {
    type: "number",
    required: false,
    meta: { constraints: { min: DPI_MIN, max: DPI_MAX }, control: { flavor: "slider", step: 50 } },
  },
  fieldOpacity: {
    type: "number",
    required: false,
    meta: { constraints: { min: 0, max: 1 }, control: { flavor: "slider", step: 0.01 } },
  },
  accent: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true } } },
  guides: { type: "boolean", required: false },
  debugLayout: { type: "boolean", required: false },
});

export function pickTheme(value: string | undefined): CardTheme {
  return value === "dark" ? "dark" : "light";
}

export function pickBackMode(value: string | undefined): BackMode {
  return (BACK_MODES as readonly string[]).includes(value ?? "") ? (value as BackMode) : "solutions";
}

export function pickTemplateBack(value: string | undefined): TemplateBackKey {
  return (TEMPLATE_BACK_KEYS as readonly string[]).includes(value ?? "") ? (value as TemplateBackKey) : TEMPLATE_BACK_KEYS[0];
}

/** "https://m0saic.io/solutions/" → "m0saic.io/solutions": the link as a person types it. */
export function printedUrl(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** The card's inks. Dark is v2's with the print field and a lifted secondary grey; light is the solutions look. */
export type CardPalette = { page: MosaicColor; tile: MosaicColor; letters: MosaicColor; name: MosaicColor; muted: MosaicColor; mono: MosaicColor; frame: MosaicColor; qrPaper: MosaicColor };

export function cardPalette(theme: CardTheme, fieldOpacity: number): CardPalette {
  if (theme === "dark") {
    return {
      page: NAVY,
      tile: mixHex(NAVY, DARK_FIELD_INK, fieldOpacity),
      // Wordmark letterforms (logo.svg paints them white).
      letters: "#FFFFFF" as MosaicColor,
      // A hair under white so the wordmark stays the brightest thing.
      name: "#F0F0F6" as MosaicColor,
      // v2's #8A89A3 is 2.7:1 on the print tiles; this is 4.2:1 (and 9.5:1 on the navy).
      muted: "#B0AFC6" as MosaicColor,
      mono: "#E6E6F0" as MosaicColor,
      // Navy-soft mixed onto navy — the hairline around the Home card.
      frame: mixHex(NAVY, NAVY_SOFT, 0.45),
      qrPaper: "#FFFFFF" as MosaicColor,
    };
  }
  const tile = mixHex(LIGHT.page, LIGHT.tile, fieldOpacity);
  return {
    page: LIGHT.page,
    tile,
    letters: LIGHT.ink,
    name: LIGHT.ink,
    // A warm grey between the ink and the page (the banner has no second ink).
    muted: mixHex(LIGHT.ink, LIGHT.page, 0.42),
    mono: mixHex(LIGHT.ink, LIGHT.page, 0.12),
    frame: tile,
    // The code on the page's own ivory.
    qrPaper: LIGHT.page,
  };
}

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

/** A hairline frame around a picture cell so it reads as a picture. */
function framePiece(cell: Rect, k: Knobs): InsetPiece {
  const s = Math.max(1, Math.round(k.c.dpi / 150));
  const frame: Rect = { x: cell.x - s, y: cell.y - s, w: cell.w + 2 * s, h: cell.h + 2 * s };
  return { rect: { ...frame, importance: 1 }, source: tag(makeColorTile(k.P.frame) as MosaicSource, "poster-frame") };
}

/** A child document in a cell, scaled to fit (same aspect, so `contain` never letterboxes). */
function childSource(ref: string, label: string): MosaicSource {
  return { type: "mosaic", ref, placement: { fit: "contain" }, editor: { owner: "template", label } } as MosaicSource;
}

type Knobs = {
  c: CardCanvas;
  P: CardPalette;
  accent: MosaicColor;
  guides: boolean;
  fps: number;
  durationMs: number;
};

function stillDoc(
  c: CardCanvas,
  placed: { m0: unknown; sources: MosaicSource[] },
  k: Knobs,
  label: string,
  extra: { children?: Record<string, MosaicDocument>; assets?: MosaicAssetManifest } = {},
): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    assets: extra.assets ?? ({} as MosaicAssetManifest),
    m0: toM0String(String(placed.m0), label),
    sources: placed.sources,
    backgroundColor: k.P.page,
    fps: k.fps,
    durationMs: k.durationMs,
    size: { width: c.W, height: c.H },
    format: { kind: "image", container: "png" },
    ...(extra.children ? { children: extra.children } : {}),
    editor: { label },
  } as MosaicDocument;
}

/** JetBrains Mono advances exactly 0.6 em per glyph; the sans lines are measured, not modelled. */
const MONO_FIT = { charWidthEm: 0.6, padPx: 0 } as const;

/**
 * The layout contract — label-keyed, canvas-independent, shared by `render`
 * (`debugLayout`) and the tests. Every glyph/mark on a face stays inside the
 * safe area; the marks and the QR keep their aspect; a picture on the back
 * keeps ITS OWN aspect (the cell is cut to the child's canvas, so a stretched
 * poster is a contract violation, not a render surprise).
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
    if (has("role")) out.push({ label: "role", within: safe });
    for (const label of ["email", "site", "handle"]) if (has(label)) out.push({ label, within: safe, textFits: MONO_FIT });
    return out;
  }
  if (has("poster")) out.push({ label: "poster", aspect: present.posterAspect ?? PICTURE_ASPECT, aspectTolerance: 0.03, within: safe });
  out.push({ label: "qr", aspect: 1, aspectTolerance: 0.03, within: safe }, { label: "title", within: safe }, { label: "url", within: safe, textFits: MONO_FIT });
  for (const label of ["command", "line"]) if (has(label)) out.push({ label, within: safe, textFits: MONO_FIT });
  return out;
}

function contractCtx(ctx: MosaicEngineContext, c: CardCanvas): MosaicEngineContext {
  return { ...ctx, target: { ...ctx.target, width: c.W, height: c.H } } as MosaicEngineContext;
}

function buildFront(props: BusinessCardV3Props, k: Knobs, ctx: MosaicEngineContext): MosaicDocument {
  const { c, P } = k;
  const copy = {
    name: (props.name ?? "").trim() || " ",
    role: (props.role ?? "").trim(),
    email: (props.email ?? "").trim(),
    site: (props.site ?? "").trim(),
    handle: (props.handle ?? "").trim(),
  };
  const f = buildFrontLayout(c, copy);

  const pieces: InsetPiece[] = [
    ...fieldPieces(f.field, P.tile),
    { rect: { ...f.mark, importance: 2 }, source: bindProp(tag(brandGlyphTile(HEADER_M_GLYPH, k.accent), "mark"), "accent") },
    { rect: { ...f.wordmark, importance: 2 }, source: tag(pathTile(WORDMARK_LETTER_PATHS, P.letters), "wordmark") },
    { rect: { ...f.wordmark, importance: 3 }, source: bindProp(tag(pathTile(WORDMARK_ZERO_PATHS, k.accent), "wordmark-zero"), "accent") },
    // The name rect also carries every EMPTY contact line as an add handle —
    // the only way to bring one back from the canvas once it has no rect.
    {
      rect: { ...f.name.rect, importance: 2 },
      source: bindProps(textSource(f.name, P.name, "name"), [
        { propKey: "name" },
        ...(["role", "email", "site", "handle"] as const).filter((key) => !copy[key]).map((propKey) => ({ propKey })),
      ]),
    },
  ];
  if (f.role) pieces.push({ rect: { ...f.role.rect, importance: 2 }, source: bindProp(textSource(f.role, P.muted, "role"), "role") });
  if (f.email) pieces.push({ rect: { ...f.email.rect, importance: 2 }, source: bindProp(textSource(f.email, P.mono, "email"), "email") });
  if (f.site) pieces.push({ rect: { ...f.site.rect, importance: 2 }, source: bindProp(textSource(f.site, P.mono, "site"), "site") });
  if (f.handle) pieces.push({ rect: { ...f.handle.rect, importance: 2 }, source: bindProp(textSource(f.handle, P.muted, "handle"), "handle") });
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
 * would otherwise lay out for the PARENT's canvas and stretch their masks by
 * the parent's aspect (v2's nestedCtx).
 */
function nestedCtx(ctx: MosaicEngineContext, width: number, height: number, fps: number): MosaicEngineContext {
  return {
    ...ctx,
    target: { width, height, fps, durationMs: STEP_DURATION_MS },
    output: { ...ctx.output, width, height },
  } as MosaicEngineContext;
}

/** The QR template's carve: a 272² safe square, 8% padding — mirrored here for the version probe. */
const QR_CENTER = { width: 272, height: 272, paddingPct: 8 } as const;
const QR_EYES = { outerBorderRadius: 0.3, innerLightBorderRadius: 0.3, innerDotBorderRadius: 0.5 } as const;

function encodeQr(text: string, moduleColor: MosaicColor, paper: MosaicColor, version: number) {
  return qrToRenderable({
    text,
    moduleColor,
    errorCorrectionLevel: "H",
    backgroundColor: paper,
    eyes: { darkColor: moduleColor, ...QR_EYES },
    version,
    safeArea: { ...QR_CENTER },
  });
}

/**
 * The smallest QR version (6–14) that encodes `text` with the carve (ECC H +
 * the centre safe area); 14 when none does, which the encode then reports.
 */
export function pickQrVersion(text: string, moduleColor: MosaicColor): number {
  for (let version = 6; version <= 14; version++) {
    try {
      encodeQr(text, moduleColor, "#FFFFFF" as MosaicColor, version);
      return version;
    } catch {
      // too small for the payload at ECC H — try the next
    }
  }
  return 14;
}

/**
 * The code as a child document at its own module grid: the brand look of
 * `media/qr/code/v1` (accent circle modules, the 3-layer rounded eyes, the
 * accent M in the carve), composed straight from the encoder as v2 does.
 */
function qrChild(text: string, k: Knobs): MosaicDocument | string {
  let qr;
  try {
    qr = encodeQr(text, k.accent, k.P.qrPaper, pickQrVersion(text, k.accent));
  } catch (err) {
    return `QR for ${text}: ${err instanceof Error ? err.message : String(err)}`;
  }
  // Source order (the encoder's eye-splice mode): data cells, then 3 eye
  // layers per finder, then the safe-area splice — see qr-code.ts.
  const eyeBlockCount = (qr.channelByRole.eyes?.frames.length ?? 0) * 3;
  const spliceCount = qr.safeAreaStableKey ? 1 : 0;
  const dataCellEnd = qr.sources.length - eyeBlockCount - spliceCount;
  const sources: MosaicSource[] = qr.sources.map((src, i) => {
    if (i < dataCellEnd) return makeColorTile(k.accent, { effects: { rounding: { borderRadius: QR_MODULE_RADIUS, cornerStyle: "rounded" } } }) as MosaicSource;
    if (i >= qr.sources.length - spliceCount) return bindProp(tag(brandGlyphTile(HEADER_M_GLYPH, k.accent), "qr-mark"), "accent");
    return src as MosaicSource;
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(qr.m0), `${LABEL} · qr`),
    sources,
    assets: {} as MosaicAssetManifest,
    size: { width: qr.canvasW, height: qr.canvasH },
    backgroundColor: k.P.qrPaper,
    fps: k.fps,
    durationMs: k.durationMs,
    editor: { label: "qr" },
    // A QR is a module grid — a baked raster the latticeSmooth convention
    // skips (the per-document form of `lattice.mode: "bitmap"`).
    engine: { lattice: { mode: "bitmap" } },
  };
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

/** v2's back: a shipped template rendered live beside the QR that opens it on Mosaic Web. */
async function buildTemplateBack(props: BusinessCardV3Props, key: BackKey, k: Knobs, ctx: MosaicEngineContext): Promise<MosaicDocument | string> {
  const { c, P } = k;
  const entry = BACK_CATALOG[key];
  const child = getTemplate(entry.templateId);
  if (!child) return `back "${key}" needs ${entry.templateId}, which is not registered in this build`;
  const hints = child.outputHints;
  const hinted = hints?.width && hints?.height && hints.width > 0 && hints.height > 0 ? { width: hints.width, height: hints.height } : null;
  const natural = entry.slot === "cell" ? hinted : (entry.slot ?? hinted);
  const posterAspect = natural ? natural.width / natural.height : 16 / 9;

  const url = makeUrl(entry.templateId);
  const b = buildBackLayout(c, { title: entry.title, url: typeableUrl(entry), command: commandFor(entry), commandSizedFor: longestCommand(), posterAspect });

  // The poster: the template itself with its motion frozen so frame 0 is the
  // finished picture, rendered at ITS OWN hinted canvas and scaled into the cell.
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
  const nested = posterDocument(rendered);
  if (!nested) return `back "${key}" rendered a ${rendered.kind} with no final document; the back needs one picture`;
  if (nested.sources.length === 0) return `back "${key}" rendered an empty document`;
  // A picture on the card, not the template's editor: its handles name ITS props, not this card's.
  const poster = JSON.parse(JSON.stringify(nested), (k, v) => (k === "binding" || k === "bindings" ? undefined : v)) as MosaicDocument;

  const qr = qrChild(url, k);
  if (typeof qr === "string") return qr;

  // A click on the picture offers what the back shows (and, on a template back, which one).
  const posterKeys = [{ propKey: "back" }, ...(key === "hello-world" ? [] : [{ propKey: "backTemplate" }])];
  const pieces: InsetPiece[] = [
    ...fieldPieces(b.field, P.tile),
    framePiece(b.poster, k),
    { rect: { ...b.poster, importance: 2 }, source: bindProps(childSource("poster", "poster"), posterKeys) },
    { rect: { ...b.qr, importance: 2 }, source: childSource("qr", "qr") },
    { rect: { ...b.title.rect, importance: 2 }, source: textSource(b.title, P.name, "title") },
    { rect: { ...b.url.rect, importance: 2 }, source: textSource(b.url, P.mono, "url") },
    { rect: { ...b.command.rect, importance: 2 }, source: textSource(b.command, P.muted, "command") },
  ];
  if (k.guides) pieces.push(...guidePieces(c));

  const placed = placeInsetPieces({ rootW: c.W, rootH: c.H, pieces });
  const doc = stillDoc(c, placed, k, `${LABEL} · back · ${entry.title}`, { children: { poster, qr } });
  // Unflattened on purpose: the contract judges the CELLS the children land
  // in (the poster keeps its template's aspect, the QR stays square).
  return withLayoutContract(doc, contractCtx(ctx, c), {
    templateId: TEMPLATE_ID,
    constraints: businessCardConstraints("back", c, { labels: ["poster", "qr", "title", "url", "command"], posterAspect }),
    relations: [],
    flatten: false,
    debug: props.debugLayout === true,
  });
}

/**
 * The solutions back: the QR to `qrUrl` (m0saic.io/solutions — every
 * industry's page, so one card serves every show), the title, the link as
 * typed, an optional line. No picture: the code is the back, as big as the
 * text leaves it. With a picture: the picture beside a 1.05 in code.
 */
function buildSolutionsBack(props: BusinessCardV3Props, k: Knobs, ctx: MosaicEngineContext): MosaicDocument | string {
  const { c, P } = k;
  const qrUrl = (props.qrUrl ?? "").trim();
  if (!qrUrl) return "qrUrl is what the back's QR opens — it cannot be empty";
  if (props.backImage !== undefined && !Array.isArray(props.backImage)) return "backImage must be an array of zero or one path";
  const title = (props.backTitle ?? "").trim() || " ";
  const backLine = (props.backLine ?? "").trim();
  const image = (props.backImage ?? []).map((v) => String(v).trim()).filter(Boolean)[0] ?? "";

  const qr = qrChild(qrUrl, k);
  if (typeof qr === "string") return qr;

  // The title carries the last line as an add handle while it is empty; the
  // code carries what the back shows, and the picture while there is none.
  const titleKeys = [{ propKey: "backTitle" }, ...(backLine ? [] : [{ propKey: "backLine" }])];
  const qrKeys = [{ propKey: "qrUrl" }, { propKey: "back" }, ...(image ? [] : [{ propKey: "backImage", index: 0 }])];
  const pieces: InsetPiece[] = [];
  const assets = {} as MosaicAssetManifest;
  let labels: string[];

  if (image) {
    const PICTURE = asAssetId("back_image");
    assets[PICTURE] = { kind: "file", path: image, mediaType: "image" };
    // v2's poster back: the band and the QR, then three lines (the third sized by itself).
    const b = buildBackLayout(c, { title, url: printedUrl(qrUrl), command: backLine || " ", posterAspect: PICTURE_ASPECT });
    const picture = { type: "media", mediaType: "image", assetId: PICTURE, placement: { fit: "cover" }, editor: { owner: "template", label: "poster" } } as unknown as MosaicSource;
    pieces.push(
      ...fieldPieces(b.field, P.tile),
      framePiece(b.poster, k),
      { rect: { ...b.poster, importance: 2 }, source: bindProps(picture, [{ propKey: "backImage", index: 0 }]) },
      { rect: { ...b.qr, importance: 2 }, source: bindProps(childSource("qr", "qr"), qrKeys) },
      { rect: { ...b.title.rect, importance: 2 }, source: bindProps(textSource(b.title, P.name, "title"), titleKeys) },
      { rect: { ...b.url.rect, importance: 2 }, source: bindProp(textSource(b.url, P.mono, "url"), "qrUrl") },
    );
    if (backLine) pieces.push({ rect: { ...b.command.rect, importance: 2 }, source: bindProp(textSource(b.command, P.muted, "line"), "backLine") });
    labels = ["poster", "qr", "title", "url", ...(backLine ? ["line"] : [])];
  } else {
    const b = buildQrBackLayout(c, { title, url: printedUrl(qrUrl), line: backLine });
    pieces.push(
      ...fieldPieces(b.field, P.tile),
      { rect: { ...b.qr, importance: 2 }, source: bindProps(childSource("qr", "qr"), qrKeys) },
      ...b.title.map((l) => ({ rect: { ...l.rect, importance: 2 }, source: bindProps(textSource(l, P.name, "title"), titleKeys) })),
      { rect: { ...b.url.rect, importance: 2 }, source: bindProp(textSource(b.url, P.mono, "url"), "qrUrl") },
    );
    if (b.line) pieces.push({ rect: { ...b.line.rect, importance: 2 }, source: bindProp(textSource(b.line, P.muted, "line"), "backLine") });
    labels = ["qr", "title", "url", ...(b.line ? ["line"] : [])];
  }
  if (k.guides) pieces.push(...guidePieces(c));

  const placed = placeInsetPieces({ rootW: c.W, rootH: c.H, pieces });
  const doc = stillDoc(c, placed, k, `${LABEL} · back · Solutions`, { children: { qr }, assets });
  return withLayoutContract(doc, contractCtx(ctx, c), {
    templateId: TEMPLATE_ID,
    constraints: businessCardConstraints("back", c, { labels }),
    relations: [],
    flatten: false,
    debug: props.debugLayout === true,
  });
}

/** The natural canvas for a prop set — what the manifest, Make and the CLI seed. */
function naturalHints(props: BusinessCardV3Props): Partial<MosaicTemplateOutputHints> {
  const c = cardCanvas(pickBleed(props.bleed), clampDpi(props.dpi));
  return { width: c.W, height: c.H };
}

const DEFAULT_PROPS: BusinessCardV3Props = {
  name: "Quentin S",
  role: "Founder, m0saic",
  email: "quentin@m0saic.io",
  site: "m0saic.io",
  handle: "@qsbuilds",
  theme: "light",
  back: "solutions",
  backTemplate: TEMPLATE_BACK_KEYS[0],
  qrUrl: SOLUTIONS_URL,
  backTitle: "See it for your business",
  backLine: "",
  backImage: [],
  bleed: "moo",
  dpi: DPI_DEFAULT,
  accent: BRAND_ORANGE,
  guides: false,
  debugLayout: false,
};

const DEFAULT_CANVAS = cardCanvas("moo", DPI_DEFAULT);

export const BusinessCardV3: MosaicTemplate<BusinessCardV3Props> = {
  id: asTemplateId(TEMPLATE_ID),
  version: 3,
  capabilities: { tier: "core" },
  aspectRatio: { ideal: DEFAULT_CANVAS.W / DEFAULT_CANVAS.H, min: 1.5, max: 1.95, mode: "warn" },
  // The canvas is the print spec (MOO's 3.66 × 2.16 in box at 300 DPI = 1098 × 648
  // px, exact): declared physical, as v2's; the QR child is a bitmap.
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
  bindings: {
    unbound: {
      // Every dimension scales with it — a property of the file, not of a rect.
      dpi: "print resolution",
      // The tint of several hundred field tiles; a handle on each would sit
      // under every click on the card.
      fieldOpacity: "texture",
    },
  },
  defaultProps: DEFAULT_PROPS,

  async render(props: BusinessCardV3Props, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    const bleed = pickBleed(props.bleed);
    const dpi = effectiveDpi(bleed, clampDpi(props.dpi), ctx.target);
    const c = cardCanvas(bleed, dpi);
    const fail = (message: string): MosaicDocument => makeErrorMosaic(message, { title: LABEL, width: c.W, height: c.H });

    const theme = pickTheme(props.theme);
    const fieldOpacity = Math.min(1, Math.max(0, props.fieldOpacity ?? DEFAULT_FIELD_OPACITY[theme]));
    const k: Knobs = {
      c,
      P: cardPalette(theme, fieldOpacity),
      accent: pickColor(props.accent, BRAND_ORANGE),
      guides: props.guides === true,
      fps: Math.max(1, Math.round(ctx.target.fps || 30)),
      durationMs: Math.max(1, Math.round(ctx.target.durationMs || STEP_DURATION_MS)),
    };

    const mode = pickBackMode(props.back);
    const front = buildFront(props, k, ctx);
    const back =
      mode === "solutions"
        ? buildSolutionsBack(props, k, ctx)
        : await buildTemplateBack(props, mode === "hello-world" ? "hello-world" : pickTemplateBack(props.backTemplate), k, ctx);
    if (typeof back === "string") return fail(back);

    const steps: MosaicPipelineStep[] = [
      { name: "front", label: "front", durationMs: STEP_DURATION_MS, file: front },
      { name: "back", label: "back", durationMs: STEP_DURATION_MS, file: back },
    ];
    const pipeline: MosaicDocumentPipeline = { kind: "mosaic_pipeline", version: 1, emit: "multi", steps };
    return pipeline;
  },
};

registerTemplate(BusinessCardV3);
export default BusinessCardV3;
