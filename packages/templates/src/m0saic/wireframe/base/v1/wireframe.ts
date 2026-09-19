import { asTemplateId } from "@m0saic/types";
import type {
    MosaicEngineContext,
    MosaicDocument,
    MosaicRenderableFile,
    MosaicSource,
    MosaicTemplate,
    MosaicColor,
    RoundingOptions,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
    definePropsSchema,
    registerTemplate,
    renderNestedTemplate,
    parseMosaicFrames,
    solidBackground,
} from "@m0saic/template-utils";
import type { WireframeCellSchemaProps, WireframeCellTheme } from "../../utils/wireframeCell";

// ── Preset types ────────────────────────────────────────────────────────────

export type WireframePreset =
    | "thumb-dark"
    | "thumb-light"
    | "debug-contrast"
    | "heatmap-depth"
    | "grid-paper";

export type WireframeTheme = {
    backgroundColor?: MosaicColor;
    tileColor?: MosaicColor;
    tileColorAlt?: MosaicColor;
    borderColor?: MosaicColor;
    borderWidthFrac?: number;
    borderAlpha?: number;
    rounding?: { borderRadius?: number; cornerStyle?: "rounded" | "pill" };
    dropShadow?: { dx?: number; dy?: number; blur?: number; color?: string };
    paperGrid?: { enabled?: boolean; stepFrac?: number; alpha?: number };
    heatmap?: { enabled?: boolean; shades?: string[] };
};

export type ResolvedTheme = {
    backgroundColor: MosaicColor;
    tileColor: MosaicColor;
    tileColorAlt: MosaicColor;
    borderColor: MosaicColor;
    borderAlpha: number;
    borderWidthFrac: number;
    rounding: RoundingOptions;
    dropShadow?: { dx?: number; dy?: number; blur?: number; color?: string };
    heatmap?: { enabled: boolean; shades: string[] };
    paperGrid?: { enabled: boolean; stepFrac: number; alpha: number };
    useThumb: boolean;
    useDebugText: boolean;
};

// ── Preset definitions ──────────────────────────────────────────────────────

const PRESET_THEMES: Record<WireframePreset, Partial<ResolvedTheme>> = {
    "thumb-dark": {
        backgroundColor: "#0f1116",
        tileColor: "#141824",
        tileColorAlt: "#101522",
        borderColor: "#ffffff",
        borderAlpha: 0.10,
        borderWidthFrac: 0.0015,
        rounding: { borderRadius: 0.04, cornerStyle: "rounded" },
        useThumb: true,
        useDebugText: false,
    },
    "thumb-light": {
        backgroundColor: "#ffffff",
        tileColor: "#f3f5f8",
        tileColorAlt: "#eef1f5",
        borderColor: "#000000",
        borderAlpha: 0.12,
        borderWidthFrac: 0.0015,
        rounding: { borderRadius: 0.04, cornerStyle: "rounded" },
        useThumb: true,
        useDebugText: false,
    },
    "debug-contrast": {
        backgroundColor: "#ffffff",
        tileColor: "#ffffff",
        tileColorAlt: "#fbfbfc",
        borderColor: "#000000",
        borderAlpha: 0.22,
        borderWidthFrac: 0.0025,
        rounding: { borderRadius: 0.015, cornerStyle: "rounded" },
        useThumb: false,
        useDebugText: true,
    },
    "heatmap-depth": {
        backgroundColor: "#0f1116",
        tileColor: "#141824",
        tileColorAlt: "#141824",
        borderColor: "#ffffff",
        borderAlpha: 0.10,
        borderWidthFrac: 0.0015,
        rounding: { borderRadius: 0.04, cornerStyle: "rounded" },
        heatmap: {
            enabled: true,
            shades: ["#141824", "#121b2a", "#0f2133", "#0b273d", "#072d47"],
        },
        useThumb: true,
        useDebugText: false,
    },
    "grid-paper": {
        backgroundColor: "#ffffff",
        tileColor: "#f3f5f8",
        tileColorAlt: "#eef1f5",
        borderColor: "#000000",
        borderAlpha: 0.12,
        borderWidthFrac: 0.0015,
        rounding: { borderRadius: 0.04, cornerStyle: "rounded" },
        paperGrid: {
            enabled: true,
            stepFrac: 0.0625,
            alpha: 0.08,
        },
        useThumb: true,
        useDebugText: false,
    },
};

// ── Theme resolver ──────────────────────────────────────────────────────────

export function resolveTheme(
    props: Pick<WireframeSchemaProps, "mode" | "preset" | "theme">
): ResolvedTheme {
    // Debug baseline — matches original behavior structurally
    const resolved: ResolvedTheme = {
        backgroundColor: "#ffffff",
        tileColor: "#ffffff",
        tileColorAlt: "#ffffff",
        borderColor: "#000000",
        borderAlpha: 1.0,
        borderWidthFrac: 0.005,
        rounding: { borderRadius: 0, cornerStyle: "rounded" },
        useThumb: false,
        useDebugText: true,
    };

    // Layer 1: preset base
    if (props.preset && props.preset in PRESET_THEMES) {
        const p = PRESET_THEMES[props.preset as WireframePreset];
        Object.assign(resolved, p);
        // Deep-merge rounding
        if (p.rounding) resolved.rounding = { ...resolved.rounding, ...p.rounding };
    }

    // Layer 2: explicit theme overrides
    const t = props.theme;
    if (t) {
        if (t.backgroundColor != null) resolved.backgroundColor = t.backgroundColor;
        if (t.tileColor != null) resolved.tileColor = t.tileColor;
        if (t.tileColorAlt != null) resolved.tileColorAlt = t.tileColorAlt;
        if (t.borderColor != null) resolved.borderColor = t.borderColor;
        if (t.borderAlpha != null) resolved.borderAlpha = t.borderAlpha;
        if (t.borderWidthFrac != null) resolved.borderWidthFrac = t.borderWidthFrac;
        if (t.rounding) resolved.rounding = { ...resolved.rounding, ...t.rounding };
        if (t.dropShadow) resolved.dropShadow = t.dropShadow;
        if (t.heatmap) {
            resolved.heatmap = {
                enabled: t.heatmap.enabled ?? resolved.heatmap?.enabled ?? false,
                shades: t.heatmap.shades ?? resolved.heatmap?.shades ?? [],
            };
        }
        if (t.paperGrid) {
            resolved.paperGrid = {
                enabled: t.paperGrid.enabled ?? resolved.paperGrid?.enabled ?? false,
                stepFrac: t.paperGrid.stepFrac ?? resolved.paperGrid?.stepFrac ?? 0.0625,
                alpha: t.paperGrid.alpha ?? resolved.paperGrid?.alpha ?? 0.08,
            };
        }
    }

    // Layer 3: `mode` decides thumb-vs-debug ONLY when no preset is chosen.
    // A preset names its mode (thumb-* / heatmap-depth / grid-paper → thumb;
    // debug-contrast → debug), and since gate 29 the base/v2 defaultProps
    // carry an explicit `mode: "debug"` so the editor form reads the state
    // it renders — a default value must never silently override a chosen
    // preset (it would have turned every thumb preset into labelled debug
    // tiles, incl. the Layout page's Dark/Light/Heatmap/Textbook styles).
    if (!props.preset) {
        if (props.mode === "thumb") {
            resolved.useThumb = true;
            resolved.useDebugText = false;
        } else if (props.mode === "debug") {
            resolved.useThumb = false;
            resolved.useDebugText = true;
        }
    }

    return resolved;
}

// ── Schema props ────────────────────────────────────────────────────────────

type WireframeSchemaProps = {
    M0String: string;
    labels?: string[];
    /** "debug" (default) renders numbers/dims/AR. "thumb" renders clean tiles. */
    mode?: "debug" | "thumb";
    /** Named theme preset. Overrides mode and theme defaults. */
    preset?: WireframePreset | "none"; // "none" = mode-driven (the visible unset state)
    /** Theme overrides applied on top of preset defaults. */
    theme?: WireframeTheme;
};

const propsSchema = definePropsSchema<WireframeSchemaProps>({
    M0String: {
        type: "m0",
        required: true,
        description: "m0 string to generate layout of",
        meta: {
            control: {
                placeholder: "e.g., F, 2(1,1), 3[1,0,1]",
            },
            ui: {
                label: "Mosaic Layout String",
            },
        },
    },
    labels: {
        type: "string[]",
        required: false,
        description: "Optional labels for wireframe cells (1-based order). If omitted, dimensions and aspect ratio are rendered.",
        meta: {
            ui: {
                label: "Cell Labels",
            },
        },
    },
    mode: {
        type: "string",
        required: false,
        description: 'Render mode. "debug" (default) shows numbers/dims/AR. "thumb" shows clean tiles only.',
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
    preset: {
        type: "string",
        required: false,
        description: 'Named theme preset. Sets mode, colors, borders, and effects. Explicit mode/theme override preset values.',
        meta: {
            constraints: {
                oneOf: ["none", "thumb-dark", "thumb-light", "debug-contrast", "heatmap-depth", "grid-paper"],
            },
            control: {
                options: [
                    { value: "none", label: "None (mode-driven)" },
                    { value: "thumb-dark", label: "Thumb Dark" },
                    { value: "thumb-light", label: "Thumb Light" },
                    { value: "debug-contrast", label: "Debug Contrast" },
                    { value: "heatmap-depth", label: "Heatmap Depth" },
                    { value: "grid-paper", label: "Grid Paper" },
                ],
            },
            ui: { label: "Preset" },
        },
    },
    theme: {
        type: "group",
        required: false,
        description: "Theme overrides applied on top of preset defaults. Colors, borders, rounding, shadows.",
        meta: {
            ui: {
                label: "Theme",
                collapsedByDefault: true,
            },
        },
    },
});

// ── Adaptive debug-label density thresholds (px) ─────────────────────────────
// Controls what auto-generated metadata is shown based on tile width.
// Custom labels bypass these thresholds.
const DEBUG_SHOW_DIMS_AND_AR = 220;   // >= 220px: dimensions + AR
const DEBUG_SHOW_DIMS_ONLY  = 120;    // >= 120px: dimensions only
                                       // < 120px:  index only (no center text)

// ── Template ────────────────────────────────────────────────────────────────

export const Wireframe: MosaicTemplate<WireframeSchemaProps> = {
    id: asTemplateId("@m0saic/wireframe/base/v1"),
    label: "Wireframe",
    version: 1,
    description: "Standard wireframe template for auto-gen docs",
    capabilities: {
        tier: "core"
    },
    // Superseded by v2, which renders the same wireframe in a single pass
    // (each frame = one masked color tile; text + border as glyph outlines)
    // instead of N nested cell documents with per-cell `drawtext`. Kept,
    // fully callable, as the perf baseline and as living documentation of how
    // the template evolved. Still requireable by id and via "Show deprecated".
    deprecated: {
        reason:
            "v1 renders N nested cell documents (one ffmpeg command + a drawtext pass per frame), so render time grows with the frame count. v2 collapses it to a single masked-tile pass.",
        replacement: asTemplateId("@m0saic/wireframe/base/v2"),
        since: "2026-06-27",
    },
    tags: ["wireframe", "docs-only"],
    outputHints: {
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 1000,
        note: "Wireframe for documentation (layout visualization)",
        format: {
            kind: "image",
            container: "png",
            pixelFormat: "rgba",
        }
    },
    propsSchema,
    defaultProps: {
        preset: "none",
        mode: "debug",
        M0String: "F",
    },

    async render(props: WireframeSchemaProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
        // "none" is the visible unset state of the preset picker — identical to omitting it.
        if (props.preset === "none") { const { preset: _none, ...rest } = props; props = rest; }
        const { M0String, labels } = props;
        const hasTheming = !!props.preset || !!props.theme || props.mode === "thumb";
        const resolved = hasTheming ? resolveTheme(props) : null;
        const useThumb = resolved?.useThumb ?? false;
        const useDebugText = resolved?.useDebugText ?? true;

        const frames = parseMosaicFrames(M0String, ctx);
        const sources: MosaicSource[] = [];
        const children: Record<string, MosaicRenderableFile> = {};

        // Build cell theme only when theming is active
        const baseCellTheme: WireframeCellTheme | undefined = resolved
            ? {
                tileBackgroundColor: resolved.tileColor,
                borderColor: resolved.borderColor,
                borderAlpha: resolved.borderAlpha,
                borderWidthFrac: resolved.borderWidthFrac,
                rounding: resolved.rounding,
                dropShadow: resolved.dropShadow,
            }
            : undefined;

        // Min text size: slightly higher for debug-contrast
        const minTextSize = props.preset === "debug-contrast" ? 18 : 14;

        let order = 0;

        for (const frame of frames) {
            if ((frame as any).nullRender) {
                continue;
            }

            order += 1;

            // Text content
            let textString = "";
            let renderOrderNumberString = false;

            if (useDebugText) {
                const useCustomLabels = (labels?.length ?? 0) > 0;
                renderOrderNumberString = !useCustomLabels;
                if (!useCustomLabels) {
                    // Adaptive density: collapse metadata on narrow tiles
                    const w = frame.width;
                    if (w >= DEBUG_SHOW_DIMS_AND_AR) {
                        const dimensionsString = `${frame.width}x${frame.height}`;
                        const aspectRatio = frame.width / frame.height;
                        textString = `${dimensionsString}\nAR: ${aspectRatio.toFixed(2)}`;
                    } else if (w >= DEBUG_SHOW_DIMS_ONLY) {
                        textString = `${frame.width}x${frame.height}`;
                    }
                    // else: w < DEBUG_SHOW_DIMS_ONLY → index only, no center text
                }
                else {
                    textString = labels?.[order - 1] ?? "";
                }
            }

            const smallerDim = Math.min(frame.width, frame.height);
            const textSize = Math.max(
                minTextSize,
                Math.min(96, Math.round(smallerDim * 0.18))
            );

            // Per-cell tile color
            let tileCellTheme = baseCellTheme;
            if (baseCellTheme && resolved) {
                let tileBg = resolved.tileColor;
                if (resolved.heatmap?.enabled && resolved.heatmap.shades.length > 0) {
                    tileBg = resolved.heatmap.shades[
                        (order - 1) % resolved.heatmap.shades.length
                    ] as MosaicColor;
                } else if (order % 2 === 0) {
                    tileBg = resolved.tileColorAlt;
                }
                tileCellTheme = { ...baseCellTheme, tileBackgroundColor: tileBg };
            }

            const templateProps: WireframeCellSchemaProps & { theme?: WireframeCellTheme } = {
                orderString: String(order),
                showOrderString: renderOrderNumberString,
                text: textString,
                textSize,
                mode: useThumb ? "thumb" : "debug",
                theme: tileCellTheme,
            };

            const childId = `cell-${frame.logicalIndex}`;
            const childFile = await renderNestedTemplate(
                "@m0saic/wireframe/cell/v1",
                templateProps,
                ctx
            );

            children[childId] = childFile;

            sources.push({
                type: "mosaic",
                ref: childId
            });
        }

        // TODO: templates should NOT set durationMs directly
        const doc: MosaicDocument = {
            kind: "mosaic_document",
            version: 1,
            assets: {} as any,
            m0: toM0String(M0String, "Wireframe"),
            sources,
            durationMs: 1000,
            // `solidBackground` keeps the bg opaque on the rgba PNG output
            // (see its docs for the engine bgFill branch that defaults
            // alpha-output bgs to fully transparent).
            ...(resolved?.backgroundColor != null
                ? { backgroundColor: solidBackground(resolved.backgroundColor) }
                : {}),
            children,
        };

        return Promise.resolve(doc);
    },
};

registerTemplate(Wireframe);
