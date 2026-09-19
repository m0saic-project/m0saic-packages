import { asTemplateId } from "@m0saic/types";
import type {
  MosaicEngineContext,
  MosaicDocument,
  MosaicTextLayer,
  MosaicTextSource,
  MosaicTextStyleProps,
  MosaicTemplate,
  MosaicSource,
  MosaicColor,
  MosaicEffectProps,
  RoundingOptions,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  registerTemplate,
} from "@m0saic/template-utils";

// ── Debug-mode layout constants ──
const INDEX_PADDING_X = 0.03;
const INDEX_PADDING_Y = 0.03;
const INDEX_FONT_SCALE = 0.9;
const INDEX_FONT_MIN = 10;
const INDEX_FONT_MAX = 120;
const DIM_FONT_SCALE = 1.25;
const AR_FONT_SCALE = 0.85;
// Stack gap: the dims line's descenders touched the ratio line's caps at 1.2
// (gate-30 battery eyeball) — 1.45 opens a real gap without breaking the
// fit model in animated/v1 (CELL_LINE_SPACING mirrors this value).
const LINE_SPACING = 1.45;
const CENTER_BLOCK_NUDGE = 0.02;

export type WireframeCellTheme = {
  tileBackgroundColor?: MosaicColor;
  borderColor?: MosaicColor;
  borderAlpha?: number;
  borderWidthFrac?: number;
  rounding?: RoundingOptions;
  dropShadow?: { dx?: number; dy?: number; blur?: number; color?: string };
};

export type WireframeCellSchemaProps = {
  orderString: string;
  showOrderString?: boolean;
  text?: string;
  /**
   * Optional base font size used for the orderString.
   * The optional text overlay will scale relative to this.
   */
  textSize?: number;
  /** Render mode: "debug" shows labels/dims, "thumb" shows clean tiles only. */
  mode?: "debug" | "thumb";
};

// optional styles for text sources
type WireframeCellStyles = {
  // 0 - base frame/background text style (font, border, etc.)
  baseFrameStyle?: MosaicTextStyleProps;
  // 1 - optional text overlay style
  textStyle?: MosaicTextStyleProps;
};

export type WireframeCellProps = WireframeCellSchemaProps & WireframeCellStyles & {
  theme?: WireframeCellTheme;
};

// public props schema for editors and validation (meta per mosaic-templates.ts)
const propsSchema = definePropsSchema<WireframeCellSchemaProps>({
  orderString: {
    type: "string",
    required: true,
    description: "Primary label for the cell (e.g., '1', 'A1', 'B3')",
    meta: {
      control: {
        placeholder: "e.g., 1, A1, B3",
      },
      ui: {
        label: "Order Label",
      },
    },
  },
  showOrderString: {
    type: "boolean",
    required: false,
    description: "If true, renders the orderString label. Default: true.",
    meta: {
      ui: {
        label: "Show Order Label",
      },
    },
  },
  text: {
    type: "string",
    required: false,
    description: "Optional label for this cell",
    meta: {
      control: {
        placeholder: "Optional cell label",
      },
      ui: {
        label: "Cell Text",
      },
    },
  },
  textSize: {
    type: "number",
    required: false,
    description:
      "Base font size for the orderString; the text overlay scales relative to this.",
    meta: {
      constraints: {
        min: 8,
        max: 200,
      },
      control: {
        placeholder: "e.g., 64",
      },
      ui: {
        label: "Text Size",
      },
    },
  },
  mode: {
    type: "string",
    required: false,
    description:
      'Render mode. "debug" (default) shows labels/dims. "thumb" shows clean tiles only.',
    meta: {
      constraints: { oneOf: ["debug", "thumb"] },
      control: {
        options: [
          { value: "debug", label: "Debug" },
          { value: "thumb", label: "Thumbnail" },
        ],
      },
      ui: { label: "Mode" },
    },
  },
});

export const WireframeCell: MosaicTemplate<WireframeCellProps> = {
  id: asTemplateId("@m0saic/wireframe/cell/v1"),
  label: "Wireframe Cell",
  version: 1,
  description: "Single numbered wireframe cell with optional text overlay",
  capabilities: {
    tier: "core",
  },
  tags: ["wireframe", "docs-only"],
  internal: true, // Building block for wireframe template, not meant for direct use
  outputHints: {
    width: 640,
    height: 480,
    fps: 30,
    durationMs: 1000,
    note: "Single wireframe cell for documentation",
  },
  propsSchema,
  defaultProps: {
    mode: "debug",
    orderString: "1",
    showOrderString: true,
    text: "",
    textSize: 64,
    baseFrameStyle: {
      fontSize: 64,
      fontColor: "#000000",
      fontFamily: "Arial, sans-serif",
      borderWidth: 0.005,
      borderColor: "#000000",
    },
    textStyle: {
      fontColor: "#000000",
      fontSize: 48,
    },
  },

  render(props: WireframeCellProps, _ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const { orderString, text, theme } = props;
    const isThumb = props.mode === "thumb";

    // ── Thumb mode: lavfi color source, no text at all ──
    if (isThumb) {
      const tileColor: MosaicColor = theme?.tileBackgroundColor ?? "#141824";

      const effects: MosaicEffectProps = {
        rounding: theme?.rounding ?? {
          borderRadius: 0.04,
          cornerStyle: "rounded",
        },
        stroke: {
          width: theme?.borderWidthFrac ?? 0.0015,
          color: (theme?.borderColor ?? "#ffffff") as MosaicColor,
          alpha: theme?.borderAlpha ?? 0.10,
          position: "inner",
        },
      };
      if (theme?.dropShadow) {
        effects.dropShadow = theme.dropShadow;
      }

      const cellSource: MosaicSource = {
        type: "lavfi",
        color: tileColor,
        effects,
      };

      return Promise.resolve({
        kind: "mosaic_document",
        version: 1,
      assets: {} as any,
        m0: toM0String("F", "WireframeCell"),
        sources: [cellSource],
      });
    }

    // ── Debug mode ──

    const showOrderString = props.showOrderString !== false;

    const baseFontSize = props.textSize ?? 64;
    const overlayFontSize = Math.round(baseFontSize * 0.75);

    // Base style for the order index / frame text
    let baseFrameStyle: MosaicTextStyleProps = {
      fontSize: 64,
      fontColor: "#000000",
      fontFamily: "Arial, sans-serif",
      borderWidth: 0.005,
      borderColor: "#000000" as MosaicColor,
      ...(props.baseFrameStyle ?? {}),
    };

    // Style for geometry / overlay text
    let textStyle: MosaicTextStyleProps = {
      fontColor: "#000000",
      fontSize: 48,
      ...(props.textStyle ?? {}),
    };

    if (props.textSize != null) {
      baseFrameStyle = { ...baseFrameStyle, fontSize: baseFontSize };
      textStyle = { ...textStyle, fontSize: overlayFontSize };
    }

    // When theme provides effects-based border, zero out text-style border to avoid double
    const hasThemeEffects = theme && (theme.borderWidthFrac != null || theme.rounding);
    if (hasThemeEffects) {
      baseFrameStyle = { ...baseFrameStyle, borderWidth: 0 };
    }

    const geometryText = (text ?? "").trim();
    const lines = geometryText
      ? geometryText.split("\n").filter((l) => l.length > 0)
      : [];

    const layers: MosaicTextLayer[] = [];

    if (lines.length > 0) {
      const baseTextFont = textStyle.fontSize ?? overlayFontSize;

      const dimFontSize = Math.round(baseTextFont * DIM_FONT_SCALE);
      const arFontSize = Math.round(baseTextFont * AR_FONT_SCALE);

      const lineHeights = lines.map((_, i) =>
        i === 0 ? `${dimFontSize}*${LINE_SPACING}` : `${arFontSize}*${LINE_SPACING}`
      );

      const blockHeightExpr = lineHeights.map((lh) => `(${lh})`).join("+");

      const y0Expr = `(h-(${blockHeightExpr}))/2 - h*${CENTER_BLOCK_NUDGE}`;

      lines.forEach((line, i) => {
        const isDim = i === 0;

        layers.push({
          content: { kind: "literal", text: line },
          style: {
            ...textStyle,
            fontSize: isDim ? dimFontSize : arFontSize,
          },
          placement: {
            hAlign: "left",
            vAlign: "top",
            xExpr: "(w-text_w)/2",
            yExpr: `${y0Expr} + (${lineHeights[i]})*${i}`,
          },
        });
      });
    }

    // index in top-left (ONLY if enabled)
    if (showOrderString) {
      const indexFontSize = Math.max(INDEX_FONT_MIN, Math.min(INDEX_FONT_MAX,
        Math.round(baseFontSize * INDEX_FONT_SCALE)));
      layers.push({
        content: { kind: "literal", text: orderString },
        placement: {
          fit: "contain",
          hAlign: "left",
          vAlign: "top",
          padding: { x: INDEX_PADDING_X, y: INDEX_PADDING_Y },
        },
        style: { ...baseFrameStyle, fontSize: indexFontSize },
      });
    }

    // A cell that shows nothing (blank custom label, or an unlabeled cell
    // under `unlabeledCells: "empty"`) must still be a renderable text
    // source: the engine refuses `layers: []` ("must have non-empty
    // layers[]") and the whole render exits 1 (gate 30 battery catch). One
    // empty literal keeps the frame border + background and draws no glyphs.
    if (layers.length === 0) {
      layers.push({ content: { kind: "literal", text: "" } });
    }

    const cellSource: MosaicTextSource = {
      type: "text",
      style: baseFrameStyle,
      visual: {
        backgroundColor: theme?.tileBackgroundColor ?? "#ffffff",
      },
      layers,
    };

    // Apply theme-based effects in debug mode (rounding, stroke, dropShadow)
    if (hasThemeEffects || theme?.dropShadow) {
      const effects: MosaicEffectProps = {};
      if (theme?.rounding) {
        effects.rounding = theme.rounding;
      }
      if (theme?.borderWidthFrac != null) {
        effects.stroke = {
          width: theme.borderWidthFrac,
          color: (theme.borderColor ?? "#000000") as MosaicColor,
          alpha: theme.borderAlpha ?? 1.0,
          position: "inner",
        };
      }
      if (theme?.dropShadow) {
        effects.dropShadow = theme.dropShadow;
      }
      cellSource.effects = effects;
    }

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: toM0String("F", "WireframeCell"),
      sources: [cellSource],
    };

    return Promise.resolve(doc);
  },
};

registerTemplate(WireframeCell);
