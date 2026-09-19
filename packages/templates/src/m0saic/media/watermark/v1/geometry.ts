/**
 * Pure geometry + gating helpers for `@m0saic/media/watermark/v1`.
 *
 * Everything here is deterministic and engine-free (types-only imports)
 * so the HOST can call the same math the template uses — the adaptive
 * luma prep step (packages/product) resolves the probe region through
 * {@link resolveWatermarkProbeRegion} and the template's `render`
 * resolves the stamp rect through {@link resolveWatermarkRect}; because
 * both go through the same functions, host math can't drift from
 * template math.
 *
 * User-facing failures throw plain `Error`s with presentable messages;
 * `render` catches them into error mosaics.
 */

import type { MosaicEngineContext, RegionPctRect } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { isValidM0String, parseM0StringToRenderFrames, getFrameCount } from "@m0saic/dsl";
import {
  measureText,
  resolveStampRect,
  type StampPosition,
  type StampRectPx,
} from "@m0saic/template-utils";
import type { WatermarkV1Props } from "./watermark";

// ── Constants ─────────────────────────────────────────────────

/** Reference size text is measured at; fit-to-box scales linearly from it. */
export const REF_FONT_PX = 100;

/**
 * Width safety pad on measured text. The app fits text slightly wider
 * than the CLI (known drift); the pad keeps the wordmark inside its
 * box on both.
 */
export const TEXT_WIDTH_PAD = 1.04;

/** Canonical defaults — exported so the host prep step resolves props identically. */
export const WATERMARK_DEFAULTS = {
  mode: "static",
  content: "logo",
  text: "yourbrand.com",
  textColor: "#ffffff",
  textColorOnLight: "#111111",
  lockupLayout: "text-right",
  position: "bottom-right",
  sizeRatio: 0.18,
  sizeBasis: "min",
  marginRatio: 0.022,
  opacity: 0.85,
  imageOutputFormat: "match",
  // adaptive
  variant: "auto",
  windowing: "always",
  fadeMs: 400,
  crossfadeMs: 400,
  lumaThreshold: 128,
  minGapMs: 3000,
  // page mode
  angleDeg: -30,
  tileGapRatio: 0.08,
  stagger: true,
  maxTiles: 24,
  debugLayout: false,
} as const;

// ── Lockup geometry constants ─────────────────────────────────

/** Text height as a fraction of the lockup's logo height. */
export const LOCKUP_TEXT_TO_LOGO = 0.28;
/** Gap between logo and text (text-right), fraction of lockup height. */
export const LOCKUP_GAP = 0.15;
/** Logo band height (text-below), fraction of lockup height. */
export const LOCKUP_LOGO_BAND = 0.78;
/** Text band height (text-below), fraction of lockup height. */
export const LOCKUP_TEXT_BAND = 0.22;

export type LockupLayout = "text-right" | "text-below";

/**
 * Intrinsic w/h aspect of a lockup composed from logo aspect `aL` and
 * text aspect `aT` (both intrinsic w/h). Mirrors the rect math in
 * `buildLockupChild` (content.ts) — unit-tested together so they can't
 * drift.
 */
export function lockupAspect(aL: number, aT: number, layout: LockupLayout): number {
  if (layout === "text-below") {
    return Math.max(aL * LOCKUP_LOGO_BAND, aT * LOCKUP_TEXT_BAND);
  }
  return aL + LOCKUP_GAP + aT * LOCKUP_TEXT_TO_LOGO;
}

// ── Content aspect ────────────────────────────────────────────

/** Measured intrinsic aspect (w/h) of a text wordmark. */
export function textContentAspect(text: string): number {
  const m = measureText(text, { fontSize: REF_FONT_PX });
  if (!(m.width > 0) || !(m.height > 0)) {
    throw new Error("Watermark text measures to an empty box — provide non-empty text.");
  }
  return (m.width * TEXT_WIDTH_PAD) / m.height;
}

/** Resolved content facts the step builders consume. */
export type WatermarkContentInfo = {
  /** Intrinsic w/h of the whole watermark artwork. */
  aspect: number;
  /** Intrinsic logo w/h (content: "logo" | "lockup"). */
  logoAspect?: number;
  /** Intrinsic text w/h (content: "text" | "lockup"). */
  textAspect?: number;
};

function resolveLogoAspect(
  image: string | undefined,
  media: Pick<MosaicEngineContext, "media">["media"],
  logoDims?: { width: number; height: number },
): number {
  if (!image) {
    throw new Error(
      'Watermark needs a logo image for this content — pick your logo file, or switch content to "text".',
    );
  }
  const dims = logoDims ?? media[asAssetId(image)];
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) {
    throw new Error(
      `Watermark logo has no probed dimensions (${image}) — is it a readable image file?`,
    );
  }
  const kind = (dims as { kind?: string }).kind;
  if (kind !== undefined && kind !== "image") {
    throw new Error(`Watermark logo must be an image, got kind "${kind}" (${image}).`);
  }
  return dims.width / dims.height;
}

function resolveTextAspect(props: WatermarkV1Props): number {
  const text = (props.text ?? WATERMARK_DEFAULTS.text).trim();
  if (!text) {
    throw new Error('Watermark text is empty — provide the wordmark text.');
  }
  return textContentAspect(text);
}

/**
 * Resolve the watermark artwork's intrinsic aspect facts from the
 * resolved content props. Logo dims come from the host-probed media
 * registry (`ctx.media`); pass them explicitly via `logoDims` when
 * calling from a host that has the registry but no engine context.
 */
export function resolveContentInfo(
  props: WatermarkV1Props,
  ctx: Pick<MosaicEngineContext, "media">,
  logoDims?: { width: number; height: number },
): WatermarkContentInfo {
  const content = props.content ?? WATERMARK_DEFAULTS.content;
  if (content === "logo") {
    const logoAspect = resolveLogoAspect(props.image, ctx.media, logoDims);
    return { aspect: logoAspect, logoAspect };
  }
  if (content === "text") {
    const textAspect = resolveTextAspect(props);
    return { aspect: textAspect, textAspect };
  }
  if (content === "lockup") {
    const logoAspect = resolveLogoAspect(props.image, ctx.media, logoDims);
    const textAspect = resolveTextAspect(props);
    const layout: LockupLayout = props.lockupLayout === "text-below" ? "text-below" : "text-right";
    return { aspect: lockupAspect(logoAspect, textAspect, layout), logoAspect, textAspect };
  }
  throw new Error(`Watermark content "${content}" is not recognized.`);
}

/** Back-compat shim: the artwork's combined intrinsic aspect. */
export function resolveContentAspect(
  props: WatermarkV1Props,
  ctx: Pick<MosaicEngineContext, "media">,
  logoDims?: { width: number; height: number },
): number {
  return resolveContentInfo(props, ctx, logoDims).aspect;
}

// ── m0 escape hatch ───────────────────────────────────────────

/**
 * Normalize the `layoutM0` prop: accepts a bare m0 or a pasted `.m0`
 * file (header `#` comment lines are stripped). Returns null when
 * empty. (Same convention as screencap-grid's `customGrid`.)
 */
export function normalizeLayoutM0(raw: string | undefined): string | null {
  if (!raw) return null;
  const m0 = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .join("");
  return m0.length > 0 ? m0 : null;
}

/**
 * Validate the escape-hatch layout string (canvas-independent checks).
 * Throws a user-facing error on invalid strings or frame counts.
 */
export function validateLayoutM0(m0: string): void {
  if (!isValidM0String(m0)) {
    throw new Error("Watermark layout is not a valid m0 string.");
  }
  const frames = getFrameCount(m0);
  if (frames !== 1) {
    throw new Error(
      `Watermark layout must resolve to exactly ONE frame (got ${frames ?? "unknown"}) — carve the box with \`-\` null tiles.`,
    );
  }
}

// ── Rect resolution ───────────────────────────────────────────

/** Resolved placement knobs the rect derives from. */
export type WatermarkRectKnobs = {
  position: StampPosition;
  sizeRatio: number;
  sizeBasis: "min" | "width" | "height";
  marginRatio: number;
  /** Normalized escape-hatch m0 (see {@link normalizeLayoutM0}); overrides everything else. */
  layoutM0?: string | null;
};

/**
 * Resolve the stamp cell for one canvas. The escape hatch parses the
 * user's single-frame m0 at this canvas and clamps to integer bounds;
 * otherwise the nine-position math applies. The rect is the stamp
 * CELL — content keeps its intrinsic aspect via `fit: "contain"`
 * inside it.
 */
export function resolveWatermarkRect(
  knobs: WatermarkRectKnobs,
  canvasW: number,
  canvasH: number,
  contentAspect: number,
): StampRectPx {
  if (knobs.layoutM0) {
    validateLayoutM0(knobs.layoutM0);
    const f = parseM0StringToRenderFrames(knobs.layoutM0, canvasW, canvasH)[0];
    if (!f) {
      throw new Error("Watermark layout produced no frame at this canvas size.");
    }
    const x = clamp(Math.round(f.x), 0, canvasW - 1);
    const y = clamp(Math.round(f.y), 0, canvasH - 1);
    const w = clamp(Math.round(f.width), 1, canvasW - x);
    const h = clamp(Math.round(f.height), 1, canvasH - y);
    return { x, y, w, h };
  }
  return resolveStampRect({
    canvasW,
    canvasH,
    position: knobs.position,
    sizeRatio: knobs.sizeRatio,
    sizeBasis: knobs.sizeBasis,
    marginRatio: knobs.marginRatio,
    contentAspect,
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── Host prep gating (adaptive luma) ──────────────────────────

/**
 * Whether the host should run the region-luminance probe for these
 * props. True only for `mode: "adaptive"` with `variant: "auto"` —
 * anything else needs no luma, and the host must skip the probe
 * entirely (the laziness guarantee).
 */
export function watermarkNeedsLumaProbe(props: WatermarkV1Props): boolean {
  const mode = props.mode ?? WATERMARK_DEFAULTS.mode;
  const variant = props.variant ?? WATERMARK_DEFAULTS.variant;
  return mode === "adaptive" && variant === "auto";
}

/**
 * The region the host's luma probe samples for one input canvas: the
 * resolved stamp rect expanded 10% total per axis (over-sampling
 * catches content just outside the stamp that bleeds under it after
 * fades), clamped to [0, 1] fractions.
 */
export function resolveWatermarkProbeRegion(
  props: WatermarkV1Props,
  canvasW: number,
  canvasH: number,
  logoDims?: { width: number; height: number },
): RegionPctRect {
  const aspect = resolveContentAspect(props, { media: {} }, logoDims);
  const rect = resolveWatermarkRect(
    {
      position: props.position ?? WATERMARK_DEFAULTS.position,
      sizeRatio: props.sizeRatio ?? WATERMARK_DEFAULTS.sizeRatio,
      sizeBasis: props.sizeBasis ?? WATERMARK_DEFAULTS.sizeBasis,
      marginRatio: props.marginRatio ?? WATERMARK_DEFAULTS.marginRatio,
      layoutM0: normalizeLayoutM0(props.layoutM0),
    },
    canvasW,
    canvasH,
    aspect,
  );
  const xPct = Math.max(0, (rect.x - 0.05 * rect.w) / canvasW);
  const yPct = Math.max(0, (rect.y - 0.05 * rect.h) / canvasH);
  return {
    xPct,
    yPct,
    wPct: Math.min(1 - xPct, (1.1 * rect.w) / canvasW),
    hPct: Math.min(1 - yPct, (1.1 * rect.h) / canvasH),
  };
}
