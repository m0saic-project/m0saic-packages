/**
 * ============================================================================
 * @m0saic/social/quote-card/v2 — pull-quote social cards, edited on the canvas
 * ============================================================================
 *
 * v1's card, unchanged in look, held to the 0.3.1 template conventions:
 *
 *  - Every prop a person would change is a HANDLE on the Make canvas
 *    (`bindingsDeclared`). v1 bound the quote, the name and the colours;
 *    the role line, the avatar and the attribution itself only had a rect
 *    while they held a value, so a card rendered without them offered no way
 *    back from the canvas. v2 hangs those as ADD handles on the rect beside
 *    where they would appear: the name rect carries `role` (a second field in
 *    its form) and `avatar` (drop a photo on the name), and with no name at
 *    all the quote rect carries `attribution`, `role` and `avatar`. Once a
 *    value exists it gets its own rect and its own handle, as in v1.
 *  - What DESCRIBES the card — its label, description, tags, and every prop's
 *    label / hint / order — lives in `quote-card.catalog.json` beside this
 *    file (`catalogSidecar`), so the copy can change after this code freezes.
 *  - The card is a handle (founder, 2026-10-03: "nice to have the bg
 *    selectable for theme"): a full-canvas rect in the background colour sits
 *    under the layout and carries `preset`, `background` and `margin`, so a
 *    click on any empty part of the card changes its look. It paints the same
 *    colour as `document.backgroundColor`, so the picture is v1's.
 *  - An empty quote is an INPUT the card is waiting on, not an error:
 *    `makeIncompleteMosaic` (Make opens the pane instead of blaming the edit).
 *
 * Geometry is v1's own, imported from the frozen `../v1/layout` (shipped
 * files never change, so sharing them is safe — the screencap-grid v2 and
 * donut v4 precedent): the same inputs place the same rects.
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
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  bindProp,
  bindProps,
  definePropsSchema,
  makeErrorMosaic,
  makeIncompleteMosaic,
  registerTemplate,
  slugifyAssetKeyFromPath,
} from "@m0saic/template-utils";
import { buildQuoteCardLayout, QuoteLayoutError, type QuoteCell, type QuoteHAlign } from "../v1/layout";

export type QuoteCardV2Props = {
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

const TEMPLATE_ID = "@m0saic/social/quote-card/v2";

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

// What each value IS. How Make presents it (label, hint, order, placeholder)
// is the catalog sidecar's — quote-card.catalog.json.
const propsSchema = definePropsSchema<QuoteCardV2Props>({
  quote: { type: "string", required: true },
  attribution: { type: "string", required: false },
  role: { type: "string", required: false },
  avatar: {
    type: "media",
    required: false,
    meta: { control: { picker: "file", accept: ["image"] } },
  },
  align: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["center", "left"] } },
  },
  quoteMark: { type: "boolean", required: false },
  accent: {
    type: "string",
    required: false,
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },
  preset: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["light", "dark"] } },
  },
  background: {
    type: "string",
    required: false,
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },
  ink: {
    type: "string",
    required: false,
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },
  margin: {
    type: "number",
    required: false,
    meta: {
      constraints: { min: 0.02, max: 0.2 },
      control: { flavor: "slider", step: 0.005 },
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

export const QuoteCardV2: MosaicTemplate<QuoteCardV2Props> = {
  id: asTemplateId(TEMPLATE_ID),
  version: 2,
  capabilities: { tier: "core" },
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

  async render(props: QuoteCardV2Props, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
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
    if (quote.length === 0) {
      return makeIncompleteMosaic("Type the quote — it wraps and sizes itself to the card.", {
        title: "Quote Card",
        width: W,
        height: H,
      });
    }
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

    // ── ADD handles: a prop whose rect does not exist yet rides the rect
    //    beside where it would appear — the name when there is one, else the
    //    quote. Text entries join that rect's form; `avatar` makes it a drop
    //    target. Once the value exists it binds its own rect below. ──
    const hasName = attribution.length > 0;
    const addHandles: Array<{ propKey: keyof QuoteCardV2Props & string }> = [
      ...(!hasName ? [{ propKey: "attribution" as const }] : []),
      ...(role.length === 0 ? [{ propKey: "role" as const }] : []),
      ...(avatarAssetKey == null ? [{ propKey: "avatar" as const }] : []),
    ];

    // ── source factory: one source per cell, fed into v1's inset-recovery
    //    packer, which returns them in the m0's frame order. Colour props bind
    //    the rect they PAINT: `accent` the mark and the bar; `ink` rides the
    //    quote / name rects as a stacked entry. The role line's `subtle` ink is
    //    preset-derived, never a prop. ──
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
            [{ propKey: "quote" }, { propKey: "ink" }, ...(hasName ? [] : addHandles)],
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
          return bindProp(
            {
              type: "media",
              mediaType: "image",
              assetId: avatarAssetKey,
              placement: { fit: "cover" },
              // Pill in a square cell = circle; the cell IS square by construction.
              effects: { rounding: { cornerStyle: "pill" } },
              editor: { owner: "template", label: "avatar" },
            } as unknown as MosaicSource,
            "avatar",
          );
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
            [{ propKey: "attribution" }, { propKey: "ink" }, ...addHandles],
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
          attribution: hasName ? attribution : null,
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

    // ── the card itself is a handle: a full-canvas rect in the document
    //    background's own colour (paints nothing new), under the layout as its
    //    overlay. A click on any empty part of the card — the margin, the gaps —
    //    lands here: light / dark, the background colour, the margin. Every
    //    text rect sits on top and keeps its own click. ──
    const card = bindProps(
      {
        type: "lavfi",
        color: bg,
        editor: { owner: "template", label: "card" },
      } as unknown as MosaicSource,
      [{ propKey: "preset" }, { propKey: "background" }, { propKey: "margin" }],
    );

    const assets: MosaicAssetManifest = {} as MosaicAssetManifest;
    if (avatarAssetKey != null)
      (assets as Record<string, unknown>)[avatarAssetKey] = { kind: "file", path: avatarId, mediaType: "image" };

    return {
      kind: "mosaic_document",
      version: 1,
      assets,
      m0: toM0String(`1{${layout.m0}}`, "QuoteCardV2"),
      sources: [card, ...layout.sources],
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
      backgroundColor: bg,
      editor: {
        label: `Quote Card · ${hasName ? attribution : "unattributed"} · ${preset}`,
      },
    };
  },
};

registerTemplate(QuoteCardV2);
export default QuoteCardV2;
