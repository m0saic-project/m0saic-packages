/**
 * @m0saic/brand/business-card/v1 — print geometry (pure, exported for tests).
 *
 * Everything is specified in INCHES on the US standard card (3.5 x 2 in) and
 * scaled by `dpi`, so one layout serves the 300 DPI press file and a 150 DPI
 * proof alike. The canvas is the TRIM plus the printer's bleed on every side;
 * the trim rect stays centred; the SAFE rect (1/8 in inside the trim) is where
 * every glyph lives.
 *
 * Canvas edges are snapped to EVEN, lattice-friendly lengths (±4 px, ±0.34 mm
 * at 300 DPI — far inside any trim tolerance): `placeInsetPieces` quantizes to
 * a divisor lattice of the axis, and a divisor-poor axis (1125 = 3²·5³ has
 * only a 75-slot lattice; 1126 = 2·563 has none) makes the m0 pay per band.
 * Hosts round `outputHints` to even, so the snap is even-only and the two
 * axes are chosen JOINTLY to keep the spec aspect ratio (the trim + bleed
 * box the printer scales the file into).
 *
 * The MOO preset is the exception: MOO's uploader fits the file to its stated
 * 3.66 x 2.16 in box, so the bitmap IS that box at the DPI (1098 x 648 at
 * 300) and a snapped canvas would only be rescaled back. It rounds to even and
 * nothing more — 1098 = 2·3²·61 is a usable (61-slot) axis, 648 = 2³·3⁴ is on
 * the lattice, and the template declares its canvas physical.
 *
 * Text is measured against the bundled faces (`@m0saic/text`) so every line
 * rect is exactly as wide as its glyphs: svg text never wraps or scales, and
 * the `textFits` gate re-measures with the same font.
 */

import { measureText, resolveFontFile } from "@m0saic/text";
import { WORDMARK_BOUNDS, coverFitField, isSmooth, latticeAxisTier, latticeMaxSlots, type Rect } from "@m0saic/template-utils";

export type { Rect };

// ---------------------------------------------------------------------------
// Print spec
// ---------------------------------------------------------------------------

export const BLEEDS = ["moo", "none", "sixteenth", "eighth"] as const;
export type Bleed = (typeof BLEEDS)[number];

/**
 * Bleed per side, in inches. MOO's box is 3.66 x 2.16 (0.08 in, ~2 mm — the
 * Luxe / Super / Original cards all share it); Vistaprint 1/16 (3.62 x 2.12);
 * FedEx Office / Staples 1/8 (3.75 x 2.25).
 */
export const BLEED_IN: Record<Bleed, number> = { moo: 0.08, none: 0, sixteenth: 1 / 16, eighth: 1 / 8 };

/**
 * Presets whose printer fits the upload to its stated box: the canvas is that
 * box at the DPI, rounded to even only (an odd length — 549 at 150 DPI — still
 * has to move, hosts round hints to even). Every other preset takes the
 * lattice snap below.
 */
const EXACT_BLEEDS: ReadonlySet<Bleed> = new Set<Bleed>(["moo"]);

/** US standard business card trim. */
export const TRIM_IN = { w: 3.5, h: 2 } as const;
/** Safe area inset from the trim (printers' universal 1/8 in). */
export const SAFE_INSET_IN = 0.125;

export const DPI_DEFAULT = 300;
export const DPI_MIN = 150;
export const DPI_MAX = 600;

/**
 * Type floor — MOO's 8 pt ("keep all text at 8pt or higher"; reversed-out
 * mono on uncoated stock fills in below it). Role, contact, and the url print
 * AT the floor; the name and the back's title sit above it. The one line
 * allowed under it is the back's `npx …` command, which every card prints at
 * the SAME size — the longest catalog command sets it (`sharedLineFont`).
 */
const MIN_FONT_PT = 8;
/** measureText / textToPath default leading — svg mode is pinned to it. */
const LINE_HEIGHT = 1.25;
/** Horizontal slack on every text rect (quantization takes 1–2 px per level). */
const TEXT_PAD_X = 3;

export const SANS_FAMILY = "Roboto";
export const MONO_FAMILY = "JetBrains Mono";

export function inToPx(inches: number, dpi: number): number {
  return Math.max(1, Math.round(inches * dpi));
}

export function ptToPx(pt: number, dpi: number): number {
  return Math.max(1, Math.round((pt / 72) * dpi));
}

// ---------------------------------------------------------------------------
// Canvas snap
// ---------------------------------------------------------------------------

const SNAP_TOLERANCE_PX = 4;
const SNAP_BASIS = 120;

type AxisCandidate = { value: number; tier: number; slots: number; delta: number };

function evenCandidates(px: number, tol: number): AxisCandidate[] {
  const out: AxisCandidate[] = [];
  for (let o = -tol; o <= tol; o++) {
    const value = px + o;
    if (value < 2 || value % 2 !== 0) continue;
    out.push({ value, tier: latticeAxisTier(value, SNAP_BASIS), slots: latticeMaxSlots(value, SNAP_BASIS), delta: Math.abs(o) });
  }
  return out;
}

/**
 * Snap a (w, h) canvas to even, lattice-friendly lengths, jointly: maximise
 * the tier sum, then keep the spec aspect (|w'/h' − w/h| relative), then move
 * the fewest pixels, then the finest lattices, then the smallest pair.
 * Deterministic pure integer search over (2·tol+1)² candidates.
 */
export function snapCanvasEven(w: number, h: number, tol: number = SNAP_TOLERANCE_PX): { w: number; h: number } {
  const target = w / h;
  let best: { w: number; h: number; tier: number; aspectErr: number; delta: number; slots: number } | null = null;
  for (const cw of evenCandidates(w, tol)) {
    for (const ch of evenCandidates(h, tol)) {
      const cand = {
        w: cw.value,
        h: ch.value,
        tier: cw.tier + ch.tier,
        aspectErr: Math.abs(cw.value / ch.value - target) / target,
        delta: cw.delta + ch.delta,
        slots: cw.slots + ch.slots,
      };
      const better =
        !best ||
        cand.tier > best.tier ||
        (cand.tier === best.tier &&
          (cand.aspectErr < best.aspectErr - 1e-9 ||
            (Math.abs(cand.aspectErr - best.aspectErr) <= 1e-9 &&
              (cand.delta < best.delta ||
                (cand.delta === best.delta &&
                  (cand.slots > best.slots || (cand.slots === best.slots && (cand.w < best.w || (cand.w === best.w && cand.h < best.h)))))))));
      if (better) best = cand;
    }
  }
  return best ? { w: best.w, h: best.h } : { w, h };
}

// ---------------------------------------------------------------------------
// Card canvas
// ---------------------------------------------------------------------------

export type CardCanvas = {
  W: number;
  H: number;
  dpi: number;
  bleed: Bleed;
  /** The trim (cut) rect on the canvas — centred. */
  trim: Rect;
  /** The safe rect — trim inset by 1/8 in. Every glyph lands inside it. */
  safe: Rect;
};

export function clampDpi(dpi: number | undefined): number {
  const n = typeof dpi === "number" && Number.isFinite(dpi) ? dpi : DPI_DEFAULT;
  return Math.min(DPI_MAX, Math.max(DPI_MIN, Math.round(n)));
}

export function pickBleed(value: string | undefined): Bleed {
  return (BLEEDS as readonly string[]).includes(value ?? "") ? (value as Bleed) : "moo";
}

export function cardCanvas(bleed: Bleed, dpi: number): CardCanvas {
  const trimW = inToPx(TRIM_IN.w, dpi);
  const trimH = inToPx(TRIM_IN.h, dpi);
  const b = bleed === "none" ? 0 : inToPx(BLEED_IN[bleed], dpi);
  // ±1 px admits only the even neighbour of an odd length — the exact box otherwise.
  const { w: W, h: H } = snapCanvasEven(trimW + 2 * b, trimH + 2 * b, EXACT_BLEEDS.has(bleed) ? 1 : SNAP_TOLERANCE_PX);
  const trim: Rect = { x: Math.round((W - trimW) / 2), y: Math.round((H - trimH) / 2), w: trimW, h: trimH };
  const s = inToPx(SAFE_INSET_IN, dpi);
  const safe: Rect = { x: trim.x + s, y: trim.y + s, w: trimW - 2 * s, h: trimH - 2 * s };
  return { W, H, dpi, bleed, trim, safe };
}

/**
 * The DPI to lay out at when the host hands a canvas that is not the card's
 * own (Make's canvas knob, an explicit `-w/-h`): scale uniformly so the card
 * fits the target, aspect preserved. Within ±4 px of the natural canvas the
 * requested DPI is used as-is (hosts round hints to even).
 */
export function effectiveDpi(bleed: Bleed, dpi: number, target: { width: number; height: number } | null | undefined): number {
  if (!target || !(target.width > 0) || !(target.height > 0)) return dpi;
  const natural = cardCanvas(bleed, dpi);
  if (Math.abs(target.width - natural.W) <= SNAP_TOLERANCE_PX && Math.abs(target.height - natural.H) <= SNAP_TOLERANCE_PX) return dpi;
  const k = Math.min(target.width / natural.W, target.height / natural.H);
  return Math.min(DPI_MAX, Math.max(72, Math.round(dpi * k)));
}

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

export type TextLine = {
  rect: Rect;
  text: string;
  fontSize: number;
  family: string;
  bold: boolean;
};

function fontPathFor(family: string, bold: boolean): string | undefined {
  return resolveFontFile({ family, weight: bold ? "bold" : "normal" })?.path;
}

function widthAt(text: string, fontSize: number, fontPath: string | undefined): number {
  return measureText(text, { fontSize, fontPath }).width;
}

/**
 * Shrink-to-fit one line into `boxW`, never below the 8 pt print floor;
 * ellipsis-truncate only when even the floor overflows. A ceiling UNDER the
 * floor is the floor (the shared command size is handed in as `maxFont`).
 */
export function fitLine(
  text: string,
  boxW: number,
  maxFont: number,
  dpi: number,
  family: string,
  bold: boolean,
): { text: string; fontSize: number; width: number } {
  const fontPath = fontPathFor(family, bold);
  const minFont = Math.min(ptToPx(MIN_FONT_PT, dpi), maxFont);
  const w100 = widthAt(text, 100, fontPath);
  const fontSize = w100 > 0 ? Math.max(minFont, Math.min(maxFont, Math.floor((100 * boxW) / w100))) : maxFont;
  const w = widthAt(text, fontSize, fontPath);
  if (w <= boxW) return { text, fontSize, width: Math.ceil(w) };
  let lo = 1;
  let hi = Math.max(1, text.length - 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (widthAt(`${text.slice(0, mid).trimEnd()}…`, minFont, fontPath) <= boxW) lo = mid;
    else hi = mid - 1;
  }
  const cut = `${text.slice(0, lo).trimEnd()}…`;
  return { text: cut, fontSize: minFont, width: Math.ceil(widthAt(cut, minFont, fontPath)) };
}

/**
 * The one size a SET of lines shares: the largest size ≤ `maxFont` at which
 * `longest` fits `boxW` — no floor. The card prints every back's `npx …` at
 * this size (founder 2026-09-16: a stack of cards reads as one typeface, and
 * every card keeps all three of QR / url / command), so the longest catalog
 * command decides, even under the 8 pt floor.
 */
export function sharedLineFont(longest: string, boxW: number, maxFont: number, family: string, bold: boolean): number {
  const w100 = widthAt(longest, 100, fontPathFor(family, bold));
  const w = Math.max(4, boxW - 2 * TEXT_PAD_X);
  return w100 > 0 ? Math.max(1, Math.min(maxFont, Math.floor((100 * w) / w100))) : maxFont;
}

function line(text: string, x: number, y: number, boxW: number, maxFont: number, dpi: number, family: string, bold: boolean): TextLine {
  const fit = fitLine(text, Math.max(4, boxW - 2 * TEXT_PAD_X), maxFont, dpi, family, bold);
  const w = Math.min(boxW, fit.width + 2 * TEXT_PAD_X);
  const h = Math.round(fit.fontSize * LINE_HEIGHT) + 2;
  return { rect: { x, y, w: Math.max(1, w), h }, text: fit.text, fontSize: fit.fontSize, family, bold };
}

// ---------------------------------------------------------------------------
// Front
// ---------------------------------------------------------------------------

export type FrontLayout = {
  field: Rect[];
  /** The M, a square cell. */
  mark: Rect;
  /** The m0saic wordmark beside the M (letters + zero share this rect). */
  wordmark: Rect;
  name: TextLine;
  role: TextLine | null;
  email: TextLine | null;
  site: TextLine | null;
  handle: TextLine | null;
};

export type FrontCopy = { name: string; role: string; email: string; site: string; handle: string };

export function buildFrontLayout(c: CardCanvas, copy: FrontCopy): FrontLayout {
  const { dpi, safe } = c;
  const inset = inToPx(0.08, dpi);
  const x0 = safe.x + inset;
  const colW = safe.w - 2 * inset;

  // Lockup row: the M and the wordmark, the wordmark's cap height ≈ 0.62 of the M.
  const markSide = inToPx(0.52, dpi);
  const gapMarkWord = inToPx(0.12, dpi);
  const wmH = Math.max(1, Math.round(markSide * 0.62));
  const wmW = Math.max(1, Math.round((wmH * WORDMARK_BOUNDS.width) / WORDMARK_BOUNDS.height));

  const gapLockupName = inToPx(0.17, dpi);
  const gapNameRole = inToPx(0.02, dpi);
  const gapRoleContact = inToPx(0.1, dpi);
  const gapContact = inToPx(0.03, dpi);
  const gapSiteHandle = inToPx(0.22, dpi);

  const nameFont = inToPx(0.165, dpi);
  // Role and the contact lines print at the floor (8 pt = 33 px at 300 DPI).
  const roleFont = ptToPx(MIN_FONT_PT, dpi);
  const monoFont = ptToPx(MIN_FONT_PT, dpi);

  const name = line(copy.name, x0, 0, colW, nameFont, dpi, SANS_FAMILY, true);
  const role = copy.role ? line(copy.role, x0, 0, colW, roleFont, dpi, SANS_FAMILY, false) : null;
  const email = copy.email ? line(copy.email, x0, 0, colW, monoFont, dpi, MONO_FAMILY, false) : null;
  const site = copy.site ? line(copy.site, x0, 0, colW, monoFont, dpi, MONO_FAMILY, false) : null;
  const handle = copy.handle ? line(copy.handle, x0, 0, colW, monoFont, dpi, MONO_FAMILY, false) : null;
  // The handle shares the site's row when both fit; otherwise it takes its own.
  const handleBesideSite = site != null && handle != null && site.rect.w + gapSiteHandle + handle.rect.w <= colW;

  // Contact rows, top to bottom (the handle row is absent when it rides beside the site).
  const contactRows: TextLine[] = [];
  if (email) contactRows.push(email);
  if (site) contactRows.push(site);
  if (handle && !handleBesideSite) contactRows.push(handle);

  let stackH = markSide + gapLockupName + name.rect.h;
  if (role) stackH += gapNameRole + role.rect.h;
  if (contactRows.length > 0) stackH += gapRoleContact + contactRows.reduce((a, l) => a + l.rect.h, 0) + gapContact * (contactRows.length - 1);

  // Centre the stack on the trim; it is shorter than the safe rect by construction.
  let y = Math.round(c.trim.y + (c.trim.h - stackH) / 2);
  const mark: Rect = { x: x0, y, w: markSide, h: markSide };
  const wordmark: Rect = { x: x0 + markSide + gapMarkWord, y: y + Math.round((markSide - wmH) / 2), w: wmW, h: wmH };
  y += markSide + gapLockupName;
  name.rect.y = y;
  y += name.rect.h;
  if (role) {
    y += gapNameRole;
    role.rect.y = y;
    y += role.rect.h;
  }
  if (contactRows.length > 0) y += gapRoleContact;
  contactRows.forEach((l, i) => {
    if (i > 0) y += gapContact;
    l.rect.y = y;
    y += l.rect.h;
  });
  if (handle && handleBesideSite && site) {
    handle.rect.x = site.rect.x + site.rect.w + gapSiteHandle;
    handle.rect.y = site.rect.y;
  }

  return { field: coverFitField(c.W, c.H, false), mark, wordmark, name, role, email, site, handle };
}

// ---------------------------------------------------------------------------
// Back
// ---------------------------------------------------------------------------

export type BackLayout = {
  field: Rect[];
  /** The live-rendered template, aspect-fit inside its box (cell = slot). */
  poster: Rect;
  /** The QR, a square cell (white child canvas, quiet zone included). */
  qr: Rect;
  title: TextLine;
  url: TextLine;
  command: TextLine;
};

export type BackCopy = {
  title: string;
  /** The typeable url as printed (`m0saic.io/t/…`) — must fit at the floor. */
  url: string;
  command: string;
  /** The longest command in the set; sizes `command` so every card shares one size. Default: `command` itself. */
  commandSizedFor?: string;
  posterAspect: number;
};

/** Even 5-smooth lengths within ±`tol` px of `n` that do not exceed `max` (`n` itself when it qualifies). */
function smoothEvenCandidates(n: number, max: number, tol: number): number[] {
  const out: number[] = [];
  for (let v = Math.max(2, n - tol); v <= Math.min(max, n + tol); v++) if (v % 2 === 0 && isSmooth(v)) out.push(v);
  return out;
}

/**
 * Snap a (w, h) cell to even 5-smooth sides JOINTLY: the pair within ±`tol`
 * px whose aspect is closest to the requested one, then the fewest pixels
 * moved. 533×300 (16:9 at 300 DPI) becomes 512×288 — exactly 16:9 and both
 * sides on the lattice — rather than 540×300 (1.80). Falls back to the input
 * when no pair exists in the window.
 */
export function smoothEvenPair(w: number, h: number, maxW: number, maxH: number, aspect: number, tol = 24): { w: number; h: number } {
  let best: { w: number; h: number; err: number; delta: number } | null = null;
  for (const cw of smoothEvenCandidates(w, maxW, tol)) {
    for (const ch of smoothEvenCandidates(h, maxH, tol)) {
      const err = Math.abs(Math.log(cw / ch / aspect));
      const delta = Math.abs(cw - w) + Math.abs(ch - h);
      if (!best || err < best.err - 1e-9 || (Math.abs(err - best.err) <= 1e-9 && delta < best.delta)) best = { w: cw, h: ch, err, delta };
    }
  }
  return best ? { w: best.w, h: best.h } : { w, h };
}

export function buildBackLayout(c: CardCanvas, copy: BackCopy): BackLayout {
  const { dpi, safe } = c;
  const inset = inToPx(0.08, dpi);
  const x0 = safe.x + inset;
  const y0 = safe.y + inset;
  const innerW = safe.w - 2 * inset;

  // 1.05 in: the branded QR carves its centre (version >= 6, 41 modules) — keep each module >= 0.5 mm.
  const qrSide = inToPx(1.05, dpi);
  const gapPosterQr = inToPx(0.14, dpi);
  const boxW = innerW - qrSide - gapPosterQr;
  const boxH = inToPx(1.0, dpi);
  const aspect = copy.posterAspect > 0 ? copy.posterAspect : 16 / 9;
  let pw = boxW;
  let ph = Math.round(pw / aspect);
  if (ph > boxH) {
    ph = boxH;
    pw = Math.round(ph * aspect);
  }
  // The poster is a CHILD rendered at exactly this cell, so the cell is that
  // child's canvas: snap it to even 5-smooth sides (532 = 2²·7·19 handed every
  // split inside the poster a 19; 512 hands it nothing), jointly so the aspect
  // survives (512×288 IS 16:9). The child re-lays itself out at the new size.
  ({ w: pw, h: ph } = smoothEvenPair(Math.max(2, pw - (pw % 2)), Math.max(2, ph - (ph % 2)), boxW, boxH, aspect));
  const poster: Rect = { x: x0, y: y0 + Math.round((boxH - ph) / 2), w: pw, h: ph };
  const qr: Rect = { x: x0 + innerW - qrSide, y: y0 + Math.round((boxH - qrSide) / 2), w: qrSide, h: qrSide };

  const titleFont = inToPx(0.125, dpi);
  // The url prints at the floor; the command at the set's shared size (≤ floor).
  const monoFont = ptToPx(MIN_FONT_PT, dpi);
  const commandFont = sharedLineFont(copy.commandSizedFor ?? copy.command, innerW, monoFont, MONO_FAMILY, false);
  const gapBandTitle = inToPx(0.1, dpi);
  const gapLines = inToPx(0.025, dpi);

  let y = y0 + boxH + gapBandTitle;
  const title = line(copy.title, x0, y, innerW, titleFont, dpi, SANS_FAMILY, true);
  y += title.rect.h + gapLines;
  const url = line(copy.url, x0, y, innerW, monoFont, dpi, MONO_FAMILY, false);
  y += url.rect.h + gapLines;
  const command = line(copy.command, x0, y, innerW, commandFont, dpi, MONO_FAMILY, false);

  return { field: coverFitField(c.W, c.H, false), poster, qr, title, url, command };
}

// ---------------------------------------------------------------------------
// Proof guides
// ---------------------------------------------------------------------------

/** Four hairline rects outlining `r` (stroke inside the rect). */
export function outlineRects(r: Rect, strokePx: number): Rect[] {
  const s = Math.max(1, strokePx);
  return [
    { x: r.x, y: r.y, w: r.w, h: s },
    { x: r.x, y: r.y + r.h - s, w: r.w, h: s },
    { x: r.x, y: r.y, w: s, h: r.h },
    { x: r.x + r.w - s, y: r.y, w: s, h: r.h },
  ];
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
