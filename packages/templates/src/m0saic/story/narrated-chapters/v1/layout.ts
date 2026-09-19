/**
 * Aspect table + m0 assembly. ONE table keyed by aspect class — builders
 * read it, they never branch on dimensions (the plan's aspect-adaptivity
 * rule). Type scales off the short edge S = min(W, H).
 *
 * The body m0 is a nested image stack (`F{F{F}}` — nest, never chain:
 * `F{F}{F}` is an illegal overlay chain). Overlay nesting IS the z-order:
 * image k is the overlay of image k−1 and paints above it, which is what
 * makes a single fade-in a true dissolve.
 */

import { isValidM0String } from "@m0saic/dsl";
import type { M0String } from "@m0saic/dsl";
import { weightedSplit } from "@m0saic/dsl-stdlib";

export type AspectClass = "landscape" | "portrait" | "square";

/** Plan-mandated thresholds: landscape ar ≥ 1.2, portrait ar ≤ 0.85. */
export function classifyAspect(width: number, height: number): AspectClass {
  const ar = width / height;
  if (ar >= 1.2) return "landscape";
  if (ar <= 0.85) return "portrait";
  return "square";
}

export type AspectSpec = {
  /** Ken Burns focus-travel multiplier — full amplitude reads as shake in a tight portrait crop. */
  cameraAmpScale: number;
  /** Default cover-crop vertical anchor (heads sit high in portrait shots). */
  coverFocusY: number;
  /** Headline font cap as a fraction of the short edge. */
  headingScale: number;
  /** Subtitle / kicker font cap as a fraction of the short edge. */
  subScale: number;
  /** Horizontal text-safe fraction of the canvas width on cards. */
  cardSafeW: number;
  /** Caption font cap as a fraction of the short edge. */
  captionScale: number;
  /** Max wrapped lines per cue. */
  captionLines: number;
  /**
   * Caption band height as a fraction of H — a LIVE weight in every
   * aspect's band split (buildBodyM0): portrait carves its bottom band
   * directly; landscape/square carve a lower-third band whose top band is
   * claimed by a transparent tile so the images show through. (Painting a
   * strip via inset is illegal — the engine caps placement.inset at
   * 0.49/side.)
   */
  captionBandFrac: number;
};

export const ASPECT_TABLE: Record<AspectClass, AspectSpec> = {
  landscape: {
    cameraAmpScale: 1.0, coverFocusY: 0.5, headingScale: 0.085, subScale: 0.036, cardSafeW: 0.72,
    captionScale: 0.042, captionLines: 2, captionBandFrac: 0.22,
  },
  portrait: {
    cameraAmpScale: 0.75, coverFocusY: 0.42, headingScale: 0.08, subScale: 0.036, cardSafeW: 0.84,
    captionScale: 0.044, captionLines: 3, captionBandFrac: 0.32,
  },
  square: {
    cameraAmpScale: 0.85, coverFocusY: 0.46, headingScale: 0.08, subScale: 0.036, cardSafeW: 0.8,
    captionScale: 0.042, captionLines: 2, captionBandFrac: 0.24,
  },
};

/**
 * Card scenes carve REAL vertical bands (Rect Thesis — no drawtext
 * positioning, no full-frame hacks). Weights are integer fractions of the
 * height; every band is claimed (a "0" claimant would donate its space
 * forward and inflate the next band).
 */
export type CardBand =
  | { kind: "spacer"; weight: number }
  | { kind: "kicker"; weight: number }
  | { kind: "heading"; weight: number }
  | { kind: "bar"; weight: number }
  | { kind: "sub"; weight: number };

export const CARD_BANDS: Record<"title" | "section-card" | "outro", CardBand[]> = {
  title: [
    { kind: "spacer", weight: 30 },
    { kind: "heading", weight: 14 },
    { kind: "spacer", weight: 3 },
    { kind: "bar", weight: 2 },
    { kind: "spacer", weight: 5 },
    { kind: "sub", weight: 8 },
    { kind: "spacer", weight: 38 },
  ],
  "section-card": [
    { kind: "spacer", weight: 32 },
    { kind: "kicker", weight: 6 },
    { kind: "spacer", weight: 2 },
    { kind: "heading", weight: 12 },
    { kind: "spacer", weight: 4 },
    { kind: "bar", weight: 2 },
    { kind: "spacer", weight: 42 },
  ],
  outro: [
    { kind: "spacer", weight: 36 },
    { kind: "heading", weight: 11 },
    { kind: "spacer", weight: 3 },
    { kind: "bar", weight: 2 },
    { kind: "spacer", weight: 6 },
    { kind: "sub", weight: 7 },
    { kind: "spacer", weight: 35 },
  ],
};

/**
 * Vertically stacked bands claiming every cell — exactly bands.length
 * frames, plus an optional audio overlay leaf (the music bed rides every
 * step). Axis "row" = horizontal rows stacked top-to-bottom (the m0
 * `N[...]` form); "col" would lay the bands out side-by-side.
 */
export function buildCardM0(bands: CardBand[], audioCount = 0): M0String {
  const split = weightedSplit(
    bands.map((b) => b.weight),
    "row",
    { claimants: bands.map(() => "1") },
  );
  const audio = audioLeaf(audioCount);
  return audio === "" ? split : assertValid(`${split}{${audio}}`);
}

/** Nested audio leaves ("F", "F{F}") — audio-only sources still hold frames. */
function audioLeaf(count: number): string {
  if (count <= 0) return "";
  let m0 = "F";
  for (let i = 1; i < count; i++) m0 = `F{${m0}}`;
  return m0;
}

export type BodyM0Options = {
  aspect: AspectClass;
  /** Frames in the visual base: image count, or 2 for the panel fallback. */
  stackFrames: number;
  /** Append plate + text caption frames. */
  captions: boolean;
  /** Trailing audio leaves (narration and/or music). */
  audioCount: number;
};

/**
 * The full body m0. Frame order is ALWAYS [stack…, captions?, audio…] —
 * only the caption carve differs per aspect:
 *
 * - portrait: a real [12,56,32] band split — images in the top band,
 *   plate+text in the bottom band, audio as the root overlay. Caption
 *   frames: plate, text.
 * - landscape/square: the innermost image's overlay carves a REAL
 *   lower-third band split — the top band claimed by a transparent tile so
 *   the images show through, the bottom band = plate{text}. Caption
 *   frames: topSpacer, plate, text. (An inset-painted strip is illegal —
 *   the engine caps placement.inset at 0.49 per side.)
 */
export function buildBodyM0(opts: BodyM0Options): M0String {
  const { aspect, stackFrames, captions, audioCount } = opts;
  if (!Number.isInteger(stackFrames) || stackFrames < 1) {
    throw new Error(`buildBodyM0: stackFrames must be a positive integer, got ${stackFrames}`);
  }
  const audio = audioLeaf(audioCount);
  const bandWeight = Math.round(ASPECT_TABLE[aspect].captionBandFrac * 100);

  if (captions && aspect === "portrait") {
    // [12, 56, 32]: the 12% top margin donates forward into the image band.
    const stackClaimant = nest("1", stackFrames);
    const split = weightedSplit([12, 100 - 12 - bandWeight, bandWeight], "row", {
      claimants: ["0", stackClaimant, "1{1}"],
    });
    return assertValid(audio === "" ? String(split) : `${split}{${audio}}`);
  }

  if (captions) {
    const split = weightedSplit([100 - bandWeight, bandWeight], "row", {
      claimants: ["1", "1{1}"],
    });
    const tail = audio === "" ? String(split) : `${split}{${audio}}`;
    return assertValid(nest("F", stackFrames, tail));
  }

  return assertValid(nest("F", stackFrames, audio));
}

/** token nested `count` deep, innermost carrying `tail` as its overlay. */
function nest(token: string, count: number, tail = ""): string {
  let m0 = tail === "" ? token : `${token}{${tail}}`;
  for (let i = 1; i < count; i++) m0 = `${token}{${m0}}`;
  return m0;
}

/**
 * Body scene: a nested full-canvas image stack, one frame per image.
 * count 1 → "F"; count 3 → "F{F{F}}". Never chained.
 */
export function buildImageStackM0(count: number): M0String {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`buildImageStackM0: count must be a positive integer, got ${count}`);
  }
  let m0 = "F";
  for (let i = 1; i < count; i++) m0 = `F{${m0}}`;
  return assertValid(m0);
}

/**
 * Media-free body fallback (the built-in demo): a full-canvas panel with a
 * centered heading block — panel base + heading overlay.
 */
export function buildPanelBodyM0(): M0String {
  return assertValid("F{F}");
}

function assertValid(m0: string): M0String {
  if (!isValidM0String(m0)) {
    throw new Error(`layout: generated invalid m0 "${m0}"`);
  }
  return m0 as M0String;
}
