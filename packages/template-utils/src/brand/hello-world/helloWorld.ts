/**
 * ============================================================================
 * Hello, World — the brand card, as a FACTORY every template repo can call
 * ============================================================================
 *
 * The headline template behind `m0saic hello-world` (`@m0saic/hello-world/v1`
 * is `defineHelloWorldTemplate({ id })` and nothing else): the app's Home
 * screen, said as a greeting. The official brand-pattern field — the SAME
 * permutation the app's live mosaic field draws — wipes into place, a rounded
 * navy card rises over it, the M assembles out of the same rectangle language,
 * and the wordmark and the greeting arrive in eye order. Then it holds: the
 * last frame is the poster.
 *
 * Lifted from `packages/templates` on 2026-09-14 (founder: "the starters
 * should take on the same hello world — make it the canonical starter") so a
 * third-party repo, which may only import `@m0saic/template-utils`, gets the
 * exact card with ONE call:
 *
 *   defineHelloWorldTemplate({ id: "@acme/basics/hello-world/v1", subline: "by Acme" })
 *
 * `subline` seeds the `caption` prop (the muted line under the greeting) so
 * the author edits one string; everything else — the M, the wordmark, the
 * field — stays the brand ("made with m0saic"). A pack that wants its own
 * look writes its own template and names it as the repo's front door instead.
 * The factory returns a plain `MosaicTemplate`; the host registers it
 * (`registerTemplate` in core, the repo's `templates` export elsewhere).
 *
 * Built to run on a machine with nothing on it: zero required props, zero
 * media inputs, zero bundled assets. Every mark is code — the field is a list
 * of rects (`field-data.ts`), the M is 26 rects (`m-rects.ts`) plus its baked
 * silhouette (the brand glyphs beside this module), the wordmark is baked SVG
 * paths (`wordmark.ts`), the text is the bundled deterministic font.
 *
 * Every element is a real m0 cell (the Rect Thesis): field rects, card, M,
 * wordmark and text lines are exact pixel rects laundered into a RATIO m0 by
 * `placeInsetPieces` — zero drift, precision bounded at ~120 on any canvas.
 * The document is TWO named children — `field` (the canvas: tiles + wipe) and
 * `card` (the card's own canvas: M rects, silhouette, wordmark, text over an
 * opaque navy background — the rounding, hairline and rise sit on the parent's
 * `card` source, so no child ever needs an alpha intermediate).
 * The field's TOPOLOGY follows the canvas: landscape and square cover-fit the
 * native 2177×1008 layout the way the Home screen does; portrait transposes it
 * so the pattern's rows become columns instead of cropping most of it away.
 *
 * Motion, in the engine's cheapest currencies (perf rules R4 / R6): a STATIC
 * field revealed by ONE lavfi curtain track; the M's 26 rects flown in on ONE
 * drawbox track (stepwise at the output fps); only the card, the marks and
 * the text lines ride the overlay chain. `animate:false` renders the poster.
 * ============================================================================
 */

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicOverlayExpr,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { placeRects } from "@m0saic/dsl-stdlib";
import { measureText, resolveFontFile } from "@m0saic/text";
import { curtainSource, gatedBoxTrackSource, type GatedBox } from "../../anim/tracks";
import { easingExpr, progressExpr } from "../../anim";
import { bindProp, tag, type LayoutConstraint } from "../../geometry-contract/layoutConstraint";
import { withLayoutContract } from "../../geometry-contract/withLayoutContract";
import { placeInsetPieces, type InsetPiece } from "../../layout/placeInsetPieces";
import { makeColorTile } from "../../sources/makeColorTile";
import { definePropsSchema } from "../../template/definePropsSchema";
import { BRAND_ORANGE, HEADER_M_GLYPH } from "../brandGlyphs";
import { FIELD_NATIVE_H, FIELD_NATIVE_W, FIELD_RECTS } from "./field-data";
import { M_RECTS, M_VIEWBOX } from "./m-rects";
import { WORDMARK_BOUNDS, WORDMARK_LETTER_PATHS, WORDMARK_ZERO_PATHS } from "./wordmark";
import { ceilToSmooth, nearestSmooth } from "../../lattice/smooth";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type HelloWorldProps = {
  /** The line under the wordmark. Default "Hello, world.". */
  greeting?: string;
  /** Optional muted second line (a URL, a name). Empty = none. */
  caption?: string;
  /** Accent — the M and the wordmark's 0. Default the brand orange. */
  accent?: MosaicColor;
  /** Field tile opacity over the navy canvas (Home uses 0.16). */
  fieldOpacity?: number;
  /** Edge the field wipes in from (the Home screen rolls one of the four). Default "left". */
  sweep?: HelloSweep;
  /** How the M arrives: assembled from its rectangles, or a plain fade. Default "assemble". */
  markReveal?: HelloMarkReveal;
  /** Animate the build (field wipe, card and content rising). Off = the poster. */
  animate?: boolean;
  /** Dev-only: check the layout contract (card / mark / wordmark / greeting fit). */
  debugLayout?: boolean;
};

/** The four wipe edges of the Home field (`LiveMosaicField` WIPES). */
export const HELLO_SWEEPS = ["left", "right", "top", "bottom"] as const;
export type HelloSweep = (typeof HELLO_SWEEPS)[number];

/** How the M arrives. */
export const HELLO_MARK_REVEALS = ["assemble", "fade"] as const;
export type HelloMarkReveal = (typeof HELLO_MARK_REVEALS)[number];

/** The card's props schema — exported so a repo module can carry it
 *  structurally (see the starters' hello-world: the no-install contract
 *  check inspects the module with the substrate stubbed). */
export const HELLO_WORLD_PROPS_SCHEMA = definePropsSchema<HelloWorldProps>({
  greeting: {
    type: "string",
    required: false,
    description: "The line under the wordmark — the tagline slot of the Home screen.",
    meta: { ui: { label: "Greeting", order: 1, primary: true } },
  },
  caption: {
    type: "string",
    required: false,
    description: "Optional muted second line under the greeting (a URL, a name). Empty removes it.",
    meta: { control: { placeholder: "none" }, ui: { label: "Caption", order: 2 } },
  },
  accent: {
    type: "string",
    required: false,
    description: "Accent colour — paints the M and the wordmark's 0.",
    meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Accent", order: 3 } },
  },
  fieldOpacity: {
    type: "number",
    required: false,
    description: "Opacity of the brand-pattern field over the navy canvas (the Home screen uses 0.16).",
    meta: { constraints: { min: 0, max: 0.6 }, control: { flavor: "slider", step: 0.01 }, ui: { label: "Field opacity", order: 4 } },
  },
  sweep: {
    type: "string",
    required: false,
    description: "Edge the field wipes in from — the Home screen rolls one of the four each pass.",
    meta: { constraints: { oneOf: [...HELLO_SWEEPS] }, ui: { label: "Sweep from", order: 5 } },
  },
  markReveal: {
    type: "string",
    required: false,
    description: "How the M arrives: assembled from its 26 rectangles (the field's own language), or a plain fade.",
    meta: { constraints: { oneOf: [...HELLO_MARK_REVEALS] }, ui: { label: "Mark reveal", order: 6 } },
  },
  animate: {
    type: "boolean",
    required: false,
    description: "Animate the build — the field wipes in, then the card, M, wordmark and greeting rise. Off renders the still poster.",
    meta: { ui: { label: "Animate", order: 7 } },
  },
  debugLayout: {
    type: "boolean",
    required: false,
    description: "Dev-only: draw the layout contract (card, mark, wordmark and greeting fit their cells) instead of the card.",
    meta: { ui: { label: "Debug layout", order: 9 } },
  },
});

// ---------------------------------------------------------------------------
// Brand tokens (apps/mosaic/web/src/App.css — the product's own values)
// ---------------------------------------------------------------------------

/** `--brand-navy` — the app canvas and the card surface. */
export const NAVY = "#050314" as MosaicColor;
/** `--brand-navy-soft` — the field tile tint. */
export const NAVY_SOFT = "#3A394F" as MosaicColor;
/** Wordmark letterforms (logo.svg paints them white). */
const INK = "#FFFFFF" as MosaicColor;
/** Greeting ink — bright, a hair under white so the wordmark stays the brightest thing. */
const GREETING_INK = "#E6E6F0" as MosaicColor;
/** Caption ink — the tertiary text of the Home tagline. */
const CAPTION_INK = "#8A89A3" as MosaicColor;
/** `--tile-bg-opacity` on the Home field. */
export const DEFAULT_FIELD_OPACITY = 0.16;
/** Card border = navy-soft mixed onto navy (the hairline around the Home card). */
const CARD_BORDER_MIX = 0.35;
/** The M's rects start as a field tile would read at this opacity, then ease to the accent. */
const ASSEMBLE_START_MIX = 0.55;
/** The product's mono face (bundled with @m0saic/text). */
const MONO_FAMILY = "JetBrains Mono";
const MIN_FONT_PX = 10;
/** measureText / textToPath default leading — svg mode is pinned to it. */
const LINE_HEIGHT = 1.25;
/** Portrait threshold: taller than this ratio transposes the field. */
const PORTRAIT_RATIO = 1.25;


// ---------------------------------------------------------------------------
// Geometry (pure; exported for the gate test)
// ---------------------------------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number };

export type HelloTextLine = { rect: Rect; text: string; fontSize: number };

export type HelloGeometry = {
  /** Short canvas side — every size below derives from it. */
  S: number;
  card: Rect;
  cardRadiusPx: number;
  mark: Rect;
  wordmark: Rect;
  greeting: HelloTextLine;
  caption: HelloTextLine | null;
  /** Field rects on the canvas (all of them — the card paints over its share). */
  field: Rect[];
  /** True when the field was transposed for a portrait canvas. */
  fieldTransposed: boolean;
};

/** Mix `over` onto `base` at `t` (0..1) — an opaque hex, so no runtime alpha. */
export function mixHex(base: string, over: string, t: number): MosaicColor {
  const k = Math.min(1, Math.max(0, t));
  const ch = (i: number) => Math.round(parseInt(base.slice(i, i + 2), 16) * (1 - k) + parseInt(over.slice(i, i + 2), 16) * k);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(ch(1))}${hex(ch(3))}${hex(ch(5))}`.toUpperCase() as MosaicColor;
}

/**
 * Cover-fit the native field onto the canvas — exactly what the Home screen
 * does (`scale = max(W/nativeW, H/nativeH)`, centred, edges cropped). With
 * `transpose` the native layout is turned on its side first (rows become
 * columns), which is how a portrait canvas keeps most of the pattern instead
 * of cropping to a sliver. Each boundary rounds independently (no
 * accumulated drift); rects that clip to less than `minPx` are dropped.
 */
export function coverFitField(W: number, H: number, transpose = false, minPx = 4): Rect[] {
  const nativeW = transpose ? FIELD_NATIVE_H : FIELD_NATIVE_W;
  const nativeH = transpose ? FIELD_NATIVE_W : FIELD_NATIVE_H;
  const s = Math.max(W / nativeW, H / nativeH);
  const ox = (nativeW * s - W) / 2;
  const oy = (nativeH * s - H) / 2;
  const out: Rect[] = [];
  for (const r of FIELD_RECTS) {
    const [x, y, w, h] = transpose ? [r[1], r[0], r[3], r[2]] : r;
    const x0 = Math.max(0, Math.round(x * s - ox));
    const y0 = Math.max(0, Math.round(y * s - oy));
    const x1 = Math.min(W, Math.round((x + w) * s - ox));
    const y1 = Math.min(H, Math.round((y + h) * s - oy));
    if (x1 - x0 >= minPx && y1 - y0 >= minPx) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

/** The field for a canvas: transposed on portrait, native otherwise. */
export function isPortraitField(W: number, H: number): boolean {
  return H > W * PORTRAIT_RATIO;
}

function monoFontPath(): string | undefined {
  return resolveFontFile({ family: MONO_FAMILY })?.path;
}

function widthAt(text: string, fontSize: number, fontPath: string | undefined): number {
  return measureText(text, { fontSize, fontPath }).width;
}

/**
 * Shrink-to-fit a single mono line into `boxW`; ellipsis-truncate only when
 * even the floor font overflows (svg text never wraps or scales itself).
 */
function fitLine(text: string, boxW: number, maxFont: number, fontPath: string | undefined): { text: string; fontSize: number } {
  const w100 = widthAt(text, 100, fontPath);
  const fontSize = w100 > 0 ? Math.max(MIN_FONT_PX, Math.min(maxFont, Math.floor((100 * boxW) / w100))) : maxFont;
  if (widthAt(text, fontSize, fontPath) <= boxW) return { text, fontSize };
  let lo = 1;
  let hi = Math.max(1, text.length - 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (widthAt(`${text.slice(0, mid).trimEnd()}…`, MIN_FONT_PX, fontPath) <= boxW) lo = mid;
    else hi = mid - 1;
  }
  return { text: `${text.slice(0, lo).trimEnd()}…`, fontSize: MIN_FONT_PX };
}

/**
 * The card and its stack, centred on the canvas. Sizes are fractions of the
 * short side so the card reads the same on 1080p, portrait and square; the
 * text lines are measured against the real bundled font so they always fit.
 */
export function buildHelloGeometry(opts: { W: number; H: number; greeting: string; caption: string }): HelloGeometry {
  const W = Math.max(1, Math.round(opts.W));
  const H = Math.max(1, Math.round(opts.H));
  const S = Math.min(W, H);
  const r = (f: number) => Math.max(1, Math.round(f * S));
  const fontPath = monoFontPath();

  const padX = r(0.06);
  const padY = r(0.062);
  const textPadX = r(0.008);
  // The card is 64% of the short side — unless a line needs more. A long
  // greeting or subline ("by <a repo's display name>") WIDENS the card, up
  // to 92% of the canvas, before any type shrinks or truncates (founder,
  // 2026-09-14: the starter's subline ellipsized at 640×360). The default
  // card never widens, so the shipped geometry is unchanged.
  const baseCardW = r(0.64);
  const greetingMaxFont = r(0.032);
  const captionMaxFont = r(0.02);
  // Measured at the font the fitter will actually use — never below the
  // legibility floor, which is where a small canvas truncated the subline.
  const lineNeed = (text: string, maxFont: number): number =>
    text ? Math.ceil(widthAt(text, Math.max(MIN_FONT_PX, maxFont), fontPath)) + 2 * textPadX : 0;
  const needW = Math.max(lineNeed(opts.greeting, greetingMaxFont), opts.caption ? lineNeed(opts.caption, captionMaxFont) : 0);
  const maxCardW = Math.max(baseCardW, Math.round(W * 0.92));
  // The card is a CHILD document rendered at exactly its own size, so its
  // dimensions are that child's canvas — and a rough card (691 px, prime, at
  // 1080p) put every split inside it on a prime basis (latticeSmooth). Snap
  // both sides to the nearest 5-smooth size: never below what the content
  // needs, never past the cap (a few px, invisible; the stack re-centres).
  const smoothSize = (n: number, min: number, max: number): number => {
    const near = nearestSmooth(n, max);
    if (near >= min) return near;
    const up = ceilToSmooth(n);
    return up <= max ? up : n;
  };
  const cardWRaw = Math.min(maxCardW, Math.max(baseCardW, needW + 2 * padX));
  const cardW = smoothSize(cardWRaw, Math.min(cardWRaw, needW + 2 * padX), maxCardW);
  const innerW = Math.max(8, cardW - 2 * padX);

  const markSide = r(0.165);
  const gapMarkWord = r(0.036);
  // Round the SHORT side first, then derive the long side from it: the mask
  // scales per axis, so the aspect error is the long side's half-pixel
  // (~0.25%), not the short side's (~1%).
  const wmH = Math.max(1, Math.round((r(0.19) * WORDMARK_BOUNDS.height) / WORDMARK_BOUNDS.width));
  const wmW = Math.max(1, Math.round((wmH * WORDMARK_BOUNDS.width) / WORDMARK_BOUNDS.height));
  const gapWordGreet = r(0.032);
  const gapGreetCap = r(0.014);

  const fitText = (text: string, maxFont: number): HelloTextLine => {
    const fit = fitLine(text, Math.max(4, innerW - 2 * textPadX), maxFont, fontPath);
    const w = Math.min(innerW, Math.ceil(widthAt(fit.text, fit.fontSize, fontPath)) + 2 * textPadX);
    const h = Math.round(fit.fontSize * LINE_HEIGHT) + 2;
    return { rect: { x: 0, y: 0, w: Math.max(1, w), h }, text: fit.text, fontSize: fit.fontSize };
  };
  const greeting = fitText(opts.greeting, greetingMaxFont);
  const caption = opts.caption ? fitText(opts.caption, captionMaxFont) : null;

  const stackH =
    markSide + gapMarkWord + wmH + gapWordGreet + greeting.rect.h + (caption ? gapGreetCap + caption.rect.h : 0);
  const cardHRaw = padY + stackH + padY;
  const cardH = smoothSize(cardHRaw, cardHRaw, H);
  const card: Rect = { x: Math.round((W - cardW) / 2), y: Math.round((H - cardH) / 2), w: cardW, h: cardH };
  const cx = W / 2;
  const centred = (w: number, h: number, y: number): Rect => ({ x: Math.round(cx - w / 2), y, w, h });

  // Whatever the smooth snap added to the height pads the stack evenly.
  let y = card.y + padY + Math.floor((cardH - cardHRaw) / 2);
  const mark = centred(markSide, markSide, y);
  y += markSide + gapMarkWord;
  const wordmark = centred(wmW, wmH, y);
  y += wmH + gapWordGreet;
  greeting.rect = centred(greeting.rect.w, greeting.rect.h, y);
  y += greeting.rect.h;
  if (caption) {
    y += gapGreetCap;
    caption.rect = centred(caption.rect.w, caption.rect.h, y);
  }

  // Keep EVERY field rect, including those the card will cover: static tiles are
  // free on the engine's sheet, and dropping them left a hole in the field while
  // the card was still fading in (founder review 2026-09-11, 1920×1080 mid-wipe).
  const fieldTransposed = isPortraitField(W, H);
  const field = coverFitField(W, H, fieldTransposed);
  return { S, card, cardRadiusPx: r(0.028), mark, wordmark, greeting, caption, field, fieldTransposed };
}

/** The M's 26 rects placed inside the mark cell (the 272 viewBox scaled to it). */
export function markRectsIn(mark: Rect): Rect[] {
  const k = mark.w / M_VIEWBOX;
  return M_RECTS.map(([x, y, w, h]) => {
    const x0 = Math.round(mark.x + x * k);
    const y0 = Math.round(mark.y + y * k);
    const x1 = Math.round(mark.x + (x + w) * k);
    const y1 = Math.round(mark.y + (y + h) * k);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  });
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

const r3 = (n: number): number => Number(n.toFixed(3));

function ramp(atSec: number, durSec: number): string {
  return easingExpr("easeOut", progressExpr(r3(atSec), Math.max(0.001, r3(durSec))));
}

/** Rise in from `dyPx` below while fading up — scalar offset + an eased alpha
 *  ramp carrying its `window` (perf rule R4). */
function riseIn(atSec: number, durSec: number, dyPx: number): MosaicOverlayExpr {
  const p = ramp(atSec, durSec);
  return { alpha: p, yExpr: `(1-${p})*${dyPx}`, startAtSec: r3(atSec), window: { startSec: r3(atSec) } };
}

/** Fade in place (no offset) — for a mark that must stay registered with what is under it. */
function fadeIn(atSec: number, durSec: number): MosaicOverlayExpr {
  return { alpha: ramp(atSec, durSec), startAtSec: r3(atSec), window: { startSec: r3(atSec) } };
}

/** Inverse of smoothstep on [0, 1] (bisection — pure, deterministic). */
export function inverseSmoothstep(u: number): number {
  const target = Math.min(1, Math.max(0, u));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (mid * mid * (3 - 2 * mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Ease-out (quadratic) on [0, 1]. */
const easeOut = (u: number): number => 1 - (1 - Math.min(1, Math.max(0, u))) ** 2;

/** Strip width for the wipe: fine enough to read as a continuous edge, capped
 *  so the track stays well under the gated-box budget on any canvas. */
export function sweepStripPx(axisPx: number): number {
  return Math.max(8, Math.ceil(axisPx / 240));
}

/**
 * The Home screen's directional wipe, rebuilt in ffmpeg: ONE lavfi track of
 * navy strips covering the canvas, each switching off (`lt(t, revealAt)`) as
 * the edge passes it. The edge eases like the app's `cubic-bezier(0.4,0,0.2,1)`
 * — strips reveal at the inverse-smoothstep of their position. Hard edge, no
 * per-tile expressions, so the field beneath stays on the static sheet.
 */
export function fieldWipe(W: number, H: number, sweep: HelloSweep, startSec: number, durSec: number): MosaicSource | null {
  const horizontal = sweep === "left" || sweep === "right";
  const axis = horizontal ? W : H;
  const step = sweepStripPx(axis);
  const n = Math.max(1, Math.ceil(axis / step));
  const boxes: { x: number; y: number; w: number; h: number; revealAtSec: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const len = Math.min(step, axis - a);
    // Order along the sweep: the first strip revealed sits at the origin edge.
    const order = sweep === "left" || sweep === "top" ? i : n - 1 - i;
    const revealAtSec = r3(startSec + durSec * inverseSmoothstep((order + 1) / n));
    boxes.push(horizontal ? { x: a, y: 0, w: len, h: H, revealAtSec } : { x: 0, y: a, w: W, h: len, revealAtSec });
  }
  return curtainSource(boxes, NAVY) as MosaicSource | null;
}

/** Gated-box budget per assembly track source — the helper's own argv cap, so
 *  the default clip (26 rects × 19 frames = 494 boxes) stays ONE track. */
export const ASSEMBLE_BOXES_PER_TRACK = 500;

export type MarkAssembly = {
  /** Every box of the assembly, in emission order (rect-major, then frame). */
  boxes: GatedBox[];
  /** Frames the assembly spans. */
  frames: number;
};

/**
 * The M assembling from its 26 rectangles — the field's own language. Each
 * rect starts displaced outward from the mark's centre (into the field) at a
 * field-tile tint and eases into its final position and the accent over
 * `durSec`, staggered along the brand "diag" sweep. Motion is STEPWISE: one
 * `drawbox` per rect per output frame, gated to that frame (perf rule R6 —
 * one lavfi track, no per-tile overlay expressions); at the fps the output
 * plays at, that is continuous motion. The final box of each rect persists
 * so the silhouette that fades in over it never reveals a gap.
 */
export function markAssembly(opts: {
  W: number;
  H: number;
  S: number;
  mark: Rect;
  startSec: number;
  durSec: number;
  fps: number;
  fromColor: MosaicColor;
  toColor: MosaicColor;
}): MarkAssembly {
  const { W, H, S, mark, startSec, durSec, fps, fromColor, toColor } = opts;
  const finals = markRectsIn(mark);
  const frames = Math.max(2, Math.round(durSec * fps));
  const stagger = 0.35; // fraction of durSec spread across the rects
  const distance = 0.26 * S;
  const mcx = mark.x + mark.w / 2;
  const mcy = mark.y + mark.h / 2;
  // Order rects along a diagonal sweep of their (272-space) centres.
  const order = M_RECTS.map((r, i) => ({ i, k: r[0] + r[2] / 2 + r[1] + r[3] / 2 })).sort((a, b) => a.k - b.k);
  const rank = new Array<number>(M_RECTS.length);
  order.forEach((o, n) => (rank[o.i] = order.length > 1 ? n / (order.length - 1) : 0));
  const clip = (x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } | null => {
    const x0 = Math.max(0, Math.min(W, Math.round(x)));
    const y0 = Math.max(0, Math.min(H, Math.round(y)));
    const x1 = Math.max(0, Math.min(W, Math.round(x + w)));
    const y1 = Math.max(0, Math.min(H, Math.round(y + h)));
    return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };

  const boxes: GatedBox[] = [];
  finals.forEach((f, i) => {
    const fcx = f.x + f.w / 2;
    const fcy = f.y + f.h / 2;
    let dx = fcx - mcx;
    let dy = fcy - mcy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Cap the travel so the START position still sits inside the canvas the
    // track paints (a nested framebuffer clips at its edge; a rect entering
    // sliced would read as a glitch, not a reveal).
    const margin = 2;
    const roomX = ux > 0 ? (W - margin - (f.x + f.w)) / ux : ux < 0 ? (f.x - margin) / -ux : Infinity;
    const roomY = uy > 0 ? (H - margin - (f.y + f.h)) / uy : uy < 0 ? (f.y - margin) / -uy : Infinity;
    const travel = Math.max(0, Math.min(distance, roomX, roomY));
    dx = ux * travel;
    dy = uy * travel;
    const delay = rank[i] * stagger;
    const span = Math.max(0.05, 1 - stagger);
    for (let fr = 0; fr < frames; fr++) {
      const u = (fr + 1) / frames; // progress through the whole window at this frame's END
      const p = easeOut((u - delay) / span);
      const b = clip(f.x + (1 - p) * dx, f.y + (1 - p) * dy, f.w, f.h);
      if (!b) continue;
      const last = fr === frames - 1;
      boxes.push({
        ...b,
        fromSec: r3(startSec + fr / fps),
        ...(last ? {} : { toSec: r3(startSec + (fr + 1) / fps) }),
        color: mixHex(fromColor, toColor, p),
      });
    }
  });
  return { boxes, frames };
}

/** Split a box list into track sources under the per-source budget. */
export function assemblyTracks(boxes: GatedBox[], color: MosaicColor): MosaicSource[] {
  const out: MosaicSource[] = [];
  for (let i = 0; i < boxes.length; i += ASSEMBLE_BOXES_PER_TRACK) {
    out.push(gatedBoxTrackSource(boxes.slice(i, i + ASSEMBLE_BOXES_PER_TRACK), { color }) as MosaicSource);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function monoText(line: HelloTextLine, color: MosaicColor, label: string, overlay?: MosaicOverlayExpr): MosaicSource {
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    ...(overlay ? { overlay } : {}),
    layers: [
      {
        content: { kind: "literal", text: line.text },
        style: { fontSize: line.fontSize, fontColor: color, fontFamily: MONO_FAMILY },
        placement: { hAlign: "center" as const, vAlign: "middle" as const },
      },
    ],
    editor: { owner: "template", label },
  } as unknown as MosaicSource;
}

function pathTile(paths: readonly string[], bounds: { width: number; height: number }, color: MosaicColor, overlay?: MosaicOverlayExpr): MosaicSource {
  return makeColorTile(color, {
    mask: { kind: "inline-mask", localPath: paths.join(" "), bounds: { x: 0, y: 0, width: bounds.width, height: bounds.height } },
    ...(overlay ? { overlay } : {}),
  }) as MosaicSource;
}

/** Blank-string colour pickers mean "unset" — fall back. */
function pickColor(value: MosaicColor | undefined, fallback: MosaicColor): MosaicColor {
  const s = typeof value === "string" ? value.trim() : value;
  return s ? (s as MosaicColor) : fallback;
}

function pickOneOf<T extends string>(value: string | undefined, options: readonly T[], fallback: T): T {
  return (options as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

// ---------------------------------------------------------------------------
// Timeline — fractions of the clip (the §10 time source is ctx.target), so a
// longer `-d` slows the whole build proportionally.
// ---------------------------------------------------------------------------

export type HelloTimeline = {
  wipeDur: number;
  beatDur: number;
  card: number;
  assembleStart: number;
  assembleDur: number;
  mark: number;
  markDur: number;
  wordmark: number;
  greeting: number;
  caption: number;
};

/** Beat times in SECONDS for a clip of `T` seconds. */
export function helloTimeline(T: number, markReveal: HelloMarkReveal): HelloTimeline {
  const at = (f: number) => r3(f * T);
  if (markReveal === "assemble") {
    return {
      wipeDur: at(0.42),
      beatDur: at(0.16),
      card: at(0.26),
      assembleStart: at(0.34),
      assembleDur: at(0.24),
      mark: at(0.54),
      markDur: at(0.1),
      wordmark: at(0.6),
      greeting: at(0.68),
      caption: at(0.74),
    };
  }
  return {
    wipeDur: at(0.45),
    beatDur: at(0.18),
    card: at(0.28),
    assembleStart: 0,
    assembleDur: 0,
    mark: at(0.38),
    markDur: at(0.18),
    wordmark: at(0.46),
    greeting: at(0.54),
    caption: at(0.6),
  };
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

export type HelloWorldTemplateOptions = {
  /** The template id — `@<repo>/<pack>/hello-world/v1` by convention. */
  id: string;
  /** Browse label. Default "Hello, World". */
  label?: string;
  /** Browse description. Default: the core template's. */
  description?: string;
  /** Browse tags. Default: the core template's. */
  tags?: string[];
  /**
   * Third-party subline — the muted line under the greeting ("by Acme
   * Studio"). Seeds `defaultProps.caption`, so it is one string the author
   * edits and one prop the user can still change in Make. Omitted = no caption
   * (the core card).
   */
  subline?: string;
  /** Override any default prop (a different greeting, sweep, accent…). */
  defaults?: Partial<HelloWorldProps>;
  /**
   * Paint the mark cell with a repo's OWN square image instead of the brand
   * M's 26 rectangles — the one part of the card a pack can make its own
   * without rewriting the layout (founder, 2026-09-17).
   *
   * The motivating case is the community repo's front door, whose mark is a
   * rendered PNG of the Community M as it currently stands: one asset,
   * replaced on every release, so the card changes as tiles get claimed.
   *
   * The caller resolves and PROBES the path (`bundledAssetPath` +
   * `existsSync`) and passes `undefined` when the file is absent — this
   * module stays free of `node:fs` so it keeps working in the browser build.
   * Undefined is the brand M, byte-identical to before this option existed.
   *
   * `markReveal: "assemble"` is meaningless for a bitmap (there are no rects
   * to fly in), so an image mark always uses the `fade`/rise reveal.
   */
  mark?: HelloWorldMarkImage;
};

/** A repo's own mark image for the card's mark cell. */
export type HelloWorldMarkImage = {
  /**
   * Absolute path to a SQUARE image, already asar-translated by the caller
   * (`bundledAssetPath`) and already known to exist. A non-square image is
   * contain-fitted into the square mark cell rather than cropped.
   */
  path: string;
  /** Asset id in the card document's manifest. Default `"hello_mark"`. */
  assetId?: string;
};

export const HELLO_WORLD_LABEL = "Hello, World";
export const HELLO_WORLD_DESCRIPTION =
  "The Home screen as a greeting: the brand-pattern field wipes in, a navy card rises, the M assembles from its own rectangles, then the wordmark and your greeting. Zero inputs — the first render on a fresh install.";
export const HELLO_WORLD_TAGS = ["hello", "brand", "animated", "intro", "card"] as const;

/** The core card's defaults — what `@m0saic/hello-world/v1` ships. */
export function helloWorldDefaultProps(opts: Pick<HelloWorldTemplateOptions, "subline" | "defaults"> = {}): HelloWorldProps {
  return {
    greeting: "Hello, world.",
    accent: BRAND_ORANGE,
    fieldOpacity: DEFAULT_FIELD_OPACITY,
    sweep: "left",
    markReveal: "assemble",
    animate: true,
    debugLayout: false,
    ...(opts.subline ? { caption: opts.subline } : {}),
    ...(opts.defaults ?? {}),
  };
}

/**
 * Build the Hello, World template under `opts.id`. Returns a plain
 * `MosaicTemplate` — the caller registers it (core: `registerTemplate`; a
 * repo: its `templates` export / `defineMosaicTemplate`).
 */
export function defineHelloWorldTemplate(opts: HelloWorldTemplateOptions): MosaicTemplate<HelloWorldProps> {
  const id = opts.id;
  const label = opts.label ?? HELLO_WORLD_LABEL;
  const template: MosaicTemplate<HelloWorldProps> = {
    id: asTemplateId(id),
    label,
    version: 1,
    description: opts.description ?? HELLO_WORLD_DESCRIPTION,
    capabilities: { tier: "core" },
    tags: opts.tags ? [...opts.tags] : [...HELLO_WORLD_TAGS],
    // Wide by default (founder, 2026-09-14): the website hero and every video
    // surface speak 16:9, and the field then shows more of the Home screen's
    // layout — one brand across the app, the site and the card. Square and
    // portrait stay one canvas knob away (the field transposes for portrait).
    aspectRatio: { ideal: 16 / 9, min: 0.5, max: 2.4, mode: "warn" },
    outputHints: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 2600,
      // The card is SETTLED here (the caption's fade ends ~0.9·T): Make's
      // scrubber lands on the finished card, not on the empty field the
      // wipe starts from, which reads as a black stage.
      posterTimeMs: 2450,
      // Declared so hosts treat "video" as the hint, not as an explicit ask —
      // a share link at the defaults then carries no `f=video`.
      format: { kind: "video", container: "mp4" },
      note: "Wide hello card (16:9)",
    },
    propsSchema: HELLO_WORLD_PROPS_SCHEMA,
    defaultProps: helloWorldDefaultProps(opts),

  async render(props: HelloWorldProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    // Size off the template's OWN canvas (ctx.target — the slot when nested).
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const greeting = (props.greeting ?? "").trim() || " ";
    const caption = (props.caption ?? "").trim();
    const accent = pickColor(props.accent, BRAND_ORANGE);
    const fieldOpacity = Math.min(0.6, Math.max(0, props.fieldOpacity ?? DEFAULT_FIELD_OPACITY));
    const sweep = pickOneOf(props.sweep, HELLO_SWEEPS, "left");
    const markReveal = pickOneOf(props.markReveal, HELLO_MARK_REVEALS, "assemble");
    const animate = (props.animate ?? true) && props.debugLayout !== true;

    const g = buildHelloGeometry({ W, H, greeting, caption });
    const tile = mixHex(NAVY, NAVY_SOFT, fieldOpacity);
    const border = mixHex(NAVY, NAVY_SOFT, CARD_BORDER_MIX);

    const T = Math.max(0.1, ctx.target.durationMs / 1000);
    const fps = Math.max(1, Math.round(ctx.target.fps || 30));
    const tl = helloTimeline(T, markReveal);
    const dy = Math.max(1, Math.round(0.02 * g.S));

    // ── Pieces, in canvas coordinates ──────────────────────────────────
    const fieldPieces: InsetPiece[] = [];
    // Field: static tiles (they lower onto the engine's static sheet)…
    for (const f of g.field) {
      fieldPieces.push({ rect: { ...f, importance: 0 }, source: tag(makeColorTile(tile) as MosaicSource, "field") });
    }
    // …revealed by the Home screen's wipe — one curtain track over the field.
    if (animate) {
      const wipe = fieldWipe(W, H, sweep, 0, tl.wipeDur);
      if (wipe) fieldPieces.push({ rect: { x: 0, y: 0, w: W, h: H, importance: 1 }, source: tag(wipe, "field-wipe") });
    }

    // Card: the Home card. Its SURFACE is the card child's own background
    // (opaque navy); the rounding, the hairline and the rise ride the parent's
    // `card` source, so the child never needs an alpha intermediate.
    const cardPieces: InsetPiece[] = [];
    const cardMin = Math.max(1, Math.min(g.card.w, g.card.h));

    // The M. "assemble": its 26 rects fly in (one drawbox track above the
    // card surface), then the silhouette fades over them and the V legs
    // resolve. "fade": the silhouette rises in. The track paints the whole
    // card canvas so its rects can start out in the card's margins.
    // An image mark has no rectangles to fly in, so it never assembles — it
    // rises like the wordmark does. The brand M is unchanged.
    const markImage = opts.mark;
    const markAssetId = markImage?.assetId ?? "hello_mark";
    const assembling = animate && markReveal === "assemble" && !markImage;
    const markOverlay = !animate ? undefined : assembling ? fadeIn(tl.mark, tl.markDur) : riseIn(tl.mark, tl.beatDur, dy);
    const markPiece: InsetPiece = {
      rect: { ...g.mark, importance: 4 },
      source: markImage
        ? tag(
            {
              type: "media",
              mediaType: "image",
              assetId: markAssetId as never,
              // Contain, not cover: a mark is a whole shape — cropping one to
              // fill a square would cut the glyph. Centred in the square cell.
              placement: { fit: "contain" },
              ...(markOverlay ? { overlay: markOverlay } : {}),
            } as MosaicSource,
            "mark",
          )
        : bindProp(tag(pathTile([HEADER_M_GLYPH.path], HEADER_M_GLYPH.bounds, accent, markOverlay), "mark"), "accent"),
    };
    const wmOverlay = animate ? riseIn(tl.wordmark, tl.beatDur, dy) : undefined;
    cardPieces.push(markPiece);
    cardPieces.push({ rect: { ...g.wordmark, importance: 4 }, source: tag(pathTile(WORDMARK_LETTER_PATHS, WORDMARK_BOUNDS, INK, wmOverlay), "wordmark") });
    cardPieces.push({ rect: { ...g.wordmark, importance: 5 }, source: bindProp(tag(pathTile(WORDMARK_ZERO_PATHS, WORDMARK_BOUNDS, accent, wmOverlay), "wordmark-zero"), "accent") });
    // The greeting (bound: Make's double-click edits it) and the caption.
    cardPieces.push({
      rect: { ...g.greeting.rect, importance: 4 },
      source: bindProp(monoText(g.greeting, GREETING_INK, "greeting", animate ? riseIn(tl.greeting, tl.beatDur, dy) : undefined), "greeting"),
    });
    if (g.caption) {
      cardPieces.push({
        rect: { ...g.caption.rect, importance: 4 },
        source: bindProp(monoText(g.caption, CAPTION_INK, "caption", animate ? riseIn(tl.caption, tl.beatDur, dy) : undefined), "caption"),
      });
    }

    const common = { fps: ctx.target.fps, durationMs: ctx.target.durationMs };

    // ── Two named children: `field` (the canvas) and `card` (the card's own
    //    canvas). Make's structure tree parents every source under them; the
    //    engine renders each into its own framebuffer first. The parent places
    //    the two through INSET RECOVERY (`placeInsetPieces`): the field is the
    //    lattice-aligned full canvas, the card lands in a coarse cell and its
    //    `placement.inset` paints it back on the exact rect. The child declares
    //    its own size (= that rect), so it is never rescaled, and the parent's
    //    precision stays at the inset basis instead of the canvas. (2026-09-13:
    //    was `placeRects`, which pinned the safe-minimum canvas to the render
    //    size for no visual gain at a head.) ──
    const local = (r: Rect): Rect => ({ x: r.x - g.card.x, y: r.y - g.card.y, w: r.w, h: r.h });
    // An explicit OPAQUE navy base as the child's first tile. The child's
    // `backgroundColor` alone is not enough on every path: a static build
    // hands the child an alpha (argb) intermediate, and the root then applies
    // the card's rounding with alphamerge, which REPLACES the child's alpha —
    // so anti-aliased text/mask edges that lived in that alpha came out
    // squared (the "chunky poster", 2026-09-11). With an opaque base the AA
    // is baked into colour and survives any alpha path.
    const cardLocal: InsetPiece[] = [
      { rect: { x: 0, y: 0, w: g.card.w, h: g.card.h, importance: 0 }, source: tag(makeColorTile(NAVY) as MosaicSource, "card-surface") },
      ...cardPieces.map((p) => ({ rect: { ...local(p.rect), importance: p.rect.importance }, source: p.source })),
    ];
    if (assembling) {
      const asm = markAssembly({
        W: g.card.w, H: g.card.h, S: g.S, mark: local(g.mark), startSec: tl.assembleStart, durSec: tl.assembleDur, fps,
        fromColor: mixHex(NAVY, NAVY_SOFT, ASSEMBLE_START_MIX), toColor: accent,
      });
      for (const track of assemblyTracks(asm.boxes, accent)) {
        cardLocal.push({ rect: { x: 0, y: 0, w: g.card.w, h: g.card.h, importance: 3 }, source: tag(track, "mark-rects") });
      }
    }
    // The child renders at EXACTLY its declared size, so its layout is
    // absolute and inset-free (`placeRects`): an inset-recovered text cell
    // hands the svg rasterizer a fractional box and the glyph mask is lost.
    const cardPacked = placeRects({ rootW: g.card.w, rootH: g.card.h, rects: cardLocal.map((p) => p.rect) });
    const cardPlaced = {
      m0: cardPacked.m0,
      sources: cardPacked.layers.flatMap((layer) => layer.rectIndices.map((i) => cardLocal[i].source)),
    };
    const fieldPlaced = placeInsetPieces({ rootW: W, rootH: H, pieces: fieldPieces });

    const parentPieces: InsetPiece[] = [
      {
        rect: { x: 0, y: 0, w: W, h: H, importance: 0 },
        source: { type: "mosaic", ref: "field", editor: { owner: "template", label: "field" } } as MosaicSource,
      },
      {
        rect: { ...g.card, importance: 1 },
        source: {
          type: "mosaic",
          ref: "card",
          effects: {
            rounding: { cornerStyle: "rounded", borderRadius: Math.min(1, (2 * g.cardRadiusPx) / cardMin) },
            stroke: { width: 1.5 / cardMin, color: border },
          },
          // overlay ≠ placement: the rise rides along untouched by the inset.
          ...(animate ? { overlay: riseIn(tl.card, tl.beatDur, dy) } : {}),
          editor: { owner: "template", label: "card" },
        } as MosaicSource,
      },
    ];
    // The two rects overlap, so each lands on its own layer (field first,
    // card on top); `sources` comes back in frame order.
    const parent = placeInsetPieces({ rootW: W, rootH: H, pieces: parentPieces });

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as MosaicAssetManifest,
      m0: parent.m0,
      sources: parent.sources,
      backgroundColor: NAVY,
      ...common,
      children: {
        field: {
          kind: "mosaic_document", version: 1, assets: {} as MosaicAssetManifest,
          m0: fieldPlaced.m0, sources: fieldPlaced.sources, backgroundColor: NAVY,
          size: { width: W, height: H }, ...common,
          editor: { label: "field" },
        },
        card: {
          kind: "mosaic_document", version: 1,
          assets: (markImage
            ? { [markAssetId]: { kind: "file", path: markImage.path, mediaType: "image" } }
            : {}) as MosaicAssetManifest,
          m0: cardPlaced.m0, sources: cardPlaced.sources, backgroundColor: NAVY,
          size: { width: g.card.w, height: g.card.h }, ...common,
          editor: { label: "card" },
        },
      },
      editor: { label: `${label} · ${greeting}` },
    } as MosaicDocument;

    return withLayoutContract(doc, ctx, {
      templateId: id,
      relations: [],
      constraints: helloLayoutConstraints(g.caption != null),
      debug: props.debugLayout === true,
    });
  },

  // First open in Make: the finished card (`animate: false` — the same
  // geometry, every beat at its end), not the frame the animation starts
  // from. Self-contained (no media), sized to the editor's canvas; the first
  // prop edit hands back to the live, animated preview.
  async renderCover(props: HelloWorldProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    return template.render({ ...props, animate: false }, ctx) as Promise<MosaicDocument>;
  },
  };
  return template;
}

/** The layout contract — shared by `render` (debugLayout) and the gate test's 7-canvas sweep. */
export function helloLayoutConstraints(hasCaption: boolean): LayoutConstraint[] {
  return [
    { label: "field" },
    { label: "mark", aspect: 1, aspectTolerance: 0.08 },
    { label: "wordmark", aspect: WORDMARK_BOUNDS.width / WORDMARK_BOUNDS.height, aspectTolerance: 0.08 },
    // JetBrains Mono advances exactly 0.6em per glyph.
    { label: "greeting", textFits: { charWidthEm: 0.6, padPx: 0 } },
    ...(hasCaption ? [{ label: "caption", textFits: { charWidthEm: 0.6, padPx: 0 } }] : []),
  ];
}
