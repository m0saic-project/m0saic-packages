/**
 * ============================================================================
 * @m0saic/social/quote-card/v1 — pull-quote social cards
 * ============================================================================
 *
 * A pull-quote graphic for social: quote text + attribution + optional
 * circular avatar over a hand-tuned themed card — emitted as a lossless PNG
 * still. Square by default; the layout re-derives from `ctx.target` every
 * render, so 4:5 / 9:16 / 16:9 exports come from `-w`/`-h` alone.
 *
 * Everything is real geometry (the Rect Thesis): the decorative quote mark,
 * the wrapped quote block, the accent bar, the avatar circle and the
 * name/role lines are m0 cells with StableKeys; margins and gaps are `-`
 * null tiles. Text is rendered with the svg glyph rasterizer (bundled
 * deterministic font — no host fontconfig, no drawtext spawn); the quote is
 * greedy word-wrapped in the layout against that same font, since the
 * rasterizer has no auto-wrap. The avatar is a media source clipped to a
 * circle via `effects.rounding` (pill in a square cell).
 *
 * Still-first by design: `outputHints.format` container-locks the CLI
 * output, so an animated sibling ships as its own video-hinted template id
 * (the qr-stamp still/video precedent) — see TEMPLATE-NOTES.
 * ============================================================================
 */

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  bindProp,
  bindProps,
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
  slugifyAssetKeyFromPath,
} from "@m0saic/template-utils";
import { buildQuoteCardLayout, QuoteLayoutError, type QuoteCell, type QuoteHAlign } from "./layout";

export type QuoteCardProps = {
  /** The quote body. Wrapped automatically; supports any length (shrinks to fit). */
  quote?: string;
  /** Who said it (rendered bold under the accent bar). Empty = no attribution. */
  attribution?: string;
  /** Second attribution line — title, handle, book, episode. Empty = none. */
  role?: string;
  /** Avatar image, clipped to a circle beside the attribution. */
  avatar?: string;
  /** Card composition: "center" (classic) or "left" (editorial). Default "center". */
  align?: "center" | "left";
  /** Show the decorative opening-quote glyph above the quote. Default true. */
  quoteMark?: boolean;
  /** Accent color (quote mark + bar). Default m0saic orange. */
  accent?: MosaicColor;
  /** Hand-tuned background/ink duo. Default "light". */
  preset?: "light" | "dark";
  /** Background override (the card color). */
  background?: MosaicColor;
  /** Ink override (quote + attribution name). */
  ink?: MosaicColor;
  /** Outer margin, as a fraction of the canvas short edge. Default 0.09. */
  margin?: number;
};

const TEMPLATE_ID = "@m0saic/social/quote-card/v1";

/** Hand-tuned card duos (dark is retuned, not derived). `subtle` inks the role line. */
const PRESETS: Record<"light" | "dark", { bg: MosaicColor; ink: MosaicColor; subtle: MosaicColor }> = {
  light: { bg: "#faf9f7" as MosaicColor, ink: "#17181c" as MosaicColor, subtle: "#6b6f76" as MosaicColor },
  dark: { bg: "#101014" as MosaicColor, ink: "#e8e8ee" as MosaicColor, subtle: "#a3a7b0" as MosaicColor },
};

const DEFAULT_ACCENT = "#f97316" as MosaicColor; // m0saic brand orange
const DEFAULT_MARGIN = 0.09;
const DEFAULT_QUOTE = "Everything is rectangles on a canvas.";
const DEFAULT_ATTRIBUTION = "The m0saic Thesis";

/** Blank-string color pickers mean "unset" — fall back to the preset. */
function pickColor(value: MosaicColor | undefined, fallback: MosaicColor): MosaicColor {
  const s = typeof value === "string" ? value.trim() : value;
  return s ? (s as MosaicColor) : fallback;
}

const propsSchema = definePropsSchema<QuoteCardProps>({
  quote: {
    type: "string",
    required: true,
    description:
      "The quote body. Wrapped and sized to fit automatically — long quotes shrink, short quotes render large.",
    meta: { ui: { label: "Quote", order: 1, primary: true } },
  },
  attribution: {
    type: "string",
    required: false,
    description: "Who said it — rendered bold under the accent bar. Empty removes the attribution.",
    meta: { ui: { label: "Attribution", order: 2 } },
  },
  role: {
    type: "string",
    required: false,
    description: "Second attribution line — a title, handle, book or episode. Empty removes it.",
    meta: { control: { placeholder: "none" }, ui: { label: "Role / source", order: 3 } },
  },
  avatar: {
    type: "media",
    required: false,
    description: "Avatar image, clipped to a circle beside the attribution.",
    meta: {
      ui: { label: "Avatar", order: 4 },
      control: { picker: "file", accept: ["image"] },
    },
  },
  align: {
    type: "string",
    required: false,
    description: 'Card composition: "center" (classic quote card) or "left" (editorial).',
    meta: {
      constraints: { oneOf: ["center", "left"] },
      ui: { label: "Alignment", order: 1 },
    },
  },
  quoteMark: {
    type: "boolean",
    required: false,
    description: "Show the decorative opening-quote glyph above the quote.",
    meta: { ui: { label: "Quote mark", order: 2 } },
  },
  accent: {
    type: "string",
    required: false,
    description: "Accent color for the quote mark and the divider bar.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true },
      ui: { label: "Accent", order: 3 },
    },
  },
  preset: {
    type: "string",
    required: false,
    description: 'Hand-tuned card duo: "light" (default) or "dark".',
    meta: {
      constraints: { oneOf: ["light", "dark"] },
      ui: { label: "Preset", order: 4 },
    },
  },
  background: {
    type: "string",
    required: false,
    description: "Card background override.",
    meta: {
      constraints: { isColor: true },
      control: { placeholder: "preset background", colorPicker: true },
      ui: { label: "Background", order: 5 },
    },
  },
  ink: {
    type: "string",
    required: false,
    description: "Ink override (quote body and attribution name).",
    meta: {
      constraints: { isColor: true },
      control: { placeholder: "preset ink", colorPicker: true },
      ui: { label: "Ink", order: 6 },
    },
  },
  margin: {
    type: "number",
    required: false,
    description: "Outer margin, as a fraction of the canvas short edge.",
    meta: {
      constraints: { min: 0.02, max: 0.2 },
      control: { flavor: "slider", step: 0.005 },
      ui: { label: "Margin", order: 1 },
    },
  },
});

/** SVG-glyph text cell (bundled deterministic font; no drawtext spawn). */
function textCell(opts: {
  text: string;
  fontSize: number;
  color: MosaicColor;
  bold?: boolean;
  hAlign: QuoteHAlign;
  label: string;
}): MosaicSource {
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    layers: [
      {
        content: { kind: "literal", text: opts.text },
        style: {
          fontSize: opts.fontSize,
          fontColor: opts.color,
          ...(opts.bold ? { fontWeight: "bold" as const } : {}),
        },
        placement: { hAlign: opts.hAlign, vAlign: "middle" as const },
      },
    ],
    editor: { owner: "template", label: opts.label },
  } as unknown as MosaicSource;
}

export const QuoteCard: MosaicTemplate<QuoteCardProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: "Quote Card",
  version: 1,
  description:
    "Pull-quote social card — auto-wrapped quote, accent bar, attribution with an optional circular avatar; hand-tuned light/dark presets; lossless PNG still, aspect-safe from square to stories.",
  capabilities: { tier: "core" },
  tags: ["social", "quote", "card", "pull-quote", "promo", "creators", "marketers", "testimonial"],
  outputHints: { width: 1080, height: 1080, format: { kind: "image", container: "png" } },
  propsSchema,

  defaultProps: {
    quote: DEFAULT_QUOTE,
    attribution: DEFAULT_ATTRIBUTION,
    align: "center",
    quoteMark: true,
    accent: DEFAULT_ACCENT,
    preset: "light",
    margin: DEFAULT_MARGIN,
  },

  async render(props: QuoteCardProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const fail = (message: string): MosaicDocument =>
      makeErrorMosaic(message, { title: "Quote Card", width: W, height: H });

    // ── knobs ──
    const preset = props.preset === "dark" ? "dark" : "light";
    const duo = PRESETS[preset];
    const bg = pickColor(props.background, duo.bg);
    const ink = pickColor(props.ink, duo.ink);
    const accent = pickColor(props.accent, DEFAULT_ACCENT);
    const align: QuoteHAlign = props.align === "left" ? "left" : "center";
    const quoteMark = props.quoteMark !== false;
    const marginFrac = Math.min(0.2, Math.max(0.02, props.margin ?? DEFAULT_MARGIN));

    const quote = (props.quote ?? "").trim();
    if (quote.length === 0) return fail("quote must not be empty");
    const attribution = (props.attribution ?? "").trim();
    const role = (props.role ?? "").trim();

    // ── optional avatar (probed by the host; the template does no I/O) ──
    const avatarId = (props.avatar ?? "").trim();
    let avatarAssetKey: string | null = null;
    if (avatarId.length > 0) {
      const meta = ctx.media[asAssetId(avatarId)];
      if (!meta || !(meta.width > 0) || !(meta.height > 0))
        return fail(`no probed dimensions for avatar "${avatarId}"`);
      if (meta.kind !== "image")
        return fail(`avatar "${avatarId}" is ${meta.kind ?? "unknown"} — the avatar must be an image`);
      avatarAssetKey = String(slugifyAssetKeyFromPath(avatarId));
    }

    // ── source factory: one source per cell. Fed into the layout's
    //    inset-recovery packer, which returns them in the m0's frame order.
    //    The quote / name / role cells each DISPLAY one prop, so they carry
    //    a `bindProp` (Make's double-click → inline-edit handle). Colour
    //    props bind the rect they PAINT: `accent` inks the mark and fills the
    //    bar; `ink` rides the quote / name rects as a second (stacked) entry.
    //    `background` is `doc.backgroundColor` — no rect, nothing to bind;
    //    the role line's `subtle` ink is preset-derived, never a prop. ──
    const sourceForCell = (cell: QuoteCell): MosaicSource => {
      switch (cell.kind) {
        case "mark":
          return bindProp(
            textCell({
              text: cell.text,
              fontSize: cell.fontSize,
              color: accent,
              bold: true,
              hAlign: cell.hAlign,
              label: "mark",
            }),
            "accent",
          );
        case "quote":
          return bindProps(
            textCell({
              text: cell.text,
              fontSize: cell.fontSize,
              color: ink,
              hAlign: cell.hAlign,
              label: "quote",
            }),
            [{ propKey: "quote" }, { propKey: "ink" }],
          );
        case "accent-bar":
          return bindProp(
            {
              type: "lavfi",
              color: accent,
              editor: { owner: "template", label: "accent" },
            } as unknown as MosaicSource,
            "accent",
          );
        case "avatar":
          return {
            type: "media",
            mediaType: "image",
            assetId: avatarAssetKey,
            placement: { fit: "cover" },
            // Pill in a square cell = circle; the cell IS square by construction.
            effects: { rounding: { cornerStyle: "pill" } },
            editor: { owner: "template", label: "avatar" },
          } as unknown as MosaicSource;
        case "name":
          return bindProps(
            textCell({
              text: cell.text,
              fontSize: cell.fontSize,
              color: ink,
              bold: true,
              hAlign: cell.hAlign,
              label: "name",
            }),
            [{ propKey: "attribution" }, { propKey: "ink" }],
          );
        case "role":
          return bindProp(
            textCell({
              text: cell.text,
              fontSize: cell.fontSize,
              color: duo.subtle,
              hAlign: cell.hAlign,
              label: "role",
            }),
            "role",
          );
      }
    };

    // ── geometry + composed sources (ratio m0 + frame-ordered inset sources) ──
    let layout;
    try {
      layout = buildQuoteCardLayout(
        {
          W,
          H,
          quote,
          attribution: attribution.length > 0 ? attribution : null,
          role: role.length > 0 ? role : null,
          hasAvatar: avatarAssetKey != null,
          align,
          quoteMark,
          marginFrac,
        },
        sourceForCell,
      );
    } catch (e) {
      if (e instanceof QuoteLayoutError) return fail(e.message);
      throw e;
    }
    const sources = layout.sources;

    const assets: MosaicAssetManifest = {} as MosaicAssetManifest;
    if (avatarAssetKey != null)
      (assets as Record<string, unknown>)[avatarAssetKey] = { kind: "file", path: avatarId, mediaType: "image" };

    return {
      kind: "mosaic_document",
      version: 1,
      assets,
      m0: layout.m0,
      sources,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
      backgroundColor: bg,
      editor: {
        label: `Quote Card · ${attribution.length > 0 ? attribution : "unattributed"} · ${preset}`,
      },
    };
  },
};

registerTemplate(QuoteCard);
export default QuoteCard;
