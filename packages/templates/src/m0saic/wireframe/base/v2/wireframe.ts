import { asTemplateId, asAssetId } from "@m0saic/types";
import type {
    MosaicEngineContext,
    MosaicDocument,
    MosaicDocumentPipeline,
    MosaicLavfiSource,
    MosaicPipelineStep,
    MosaicRenderableFile,
    MosaicSource,
    MosaicEffectProps,
    MosaicTemplate,
    MosaicColor,
    MosaicAssetManifest,
    MosaicBackgroundImage,
    MosaicPlacementFit,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
    bindProp,
    definePropsSchema,
    registerTemplate,
    parseMosaicFrames,
    parseMosaicRenderFrames,
    solidBackground,
    makeColorTile,
    textToPath,
    measureText,
} from "@m0saic/template-utils";
import {
    resolveTheme,
    type WireframePreset,
    type WireframeTheme,
} from "../v1/wireframe";
import { parseM0StringComplete, toCanonicalM0String, type StableKey } from "@m0saic/dsl";
import type { M0Label } from "@m0saic/dsl-file-formats";
import { appendTopOverlay, makePaperGridSource } from "../../utils/paperGrid";

/**
 * Wireframe v2 — same look as v1, rendered in a single pass.
 *
 * # Why v2 exists (living documentation)
 *
 * v1 builds the wireframe out of N nested `@m0saic/wireframe/cell/v1`
 * documents — one per frame. The engine renders each nested mosaic as its own
 * ffmpeg command, and in **debug mode** each of those commands runs a
 * `drawtext` filter (cold ffmpeg spawn + font init). For a 22-frame layout
 * that's ~23 serial ffmpeg processes; render time grows linearly with the
 * frame count (a high-fan-out layout is brutal).
 *
 * v2 collapses the whole thing into ONE flat document:
 *   - Every m0 frame is a real source already, so each frame becomes a single
 *     {@link makeColorTile} (lavfi `color=`) — these inline into one
 *     filtergraph; no nested documents, no per-cell commands.
 *   - In debug mode the per-cell text + border are baked into that tile's
 *     **inline-mask** as glyph OUTLINES via {@link textToPath} — so a single
 *     flat ink color shows through as the index / dimensions / label and the
 *     frame outline. Zero `drawtext` passes. The masks for the whole document
 *     rasterize in one batched child process.
 *
 * Net effect: the render is one ffmpeg command + one mask raster, flat in the
 * frame count, instead of N serial spawns. Glyphs are vector outlines from a
 * bundled font, so output is deterministic across platforms (no fontconfig).
 */

// ── Label content / overflow API (mirrors the editor's view-frame) ──
//
// Two orthogonal knobs, both string enums so they read nicely in the UI:
//
//   1. labelContent — the *most* you want to show in a tile, as a cumulative
//      ladder. Each level includes the ones below it:
//        none → number → dimensions (number + W×H) → aspect (+ ratio).
//   2. labelOverflow — what to do when the requested content can't fit a tile.
//      Tiles in a real layout vary wildly in size, so a fixed request can't
//      always be honoured. This says how to back off (see the enum docs).
//
// The fit math mirrors `apps/mosaic/web/src/components/viewframe/FrameInfo.tsx`
// (the editor's per-tile annotation), so the wireframe export looks like what
// you see while editing: a centered vertical stack — number (primary), W×H
// (secondary), ratio (tertiary) — that grows the font when fewer items show.

/** What to show in a tile. Cumulative: each value includes the ones above it. */
export enum WireframeLabelContent {
    /** Draw nothing inside the tile (just the frame outline). */
    None = "none",
    /** The tile's 1-based number only. */
    Number = "number",
    /** Number + pixel dimensions (W × H). */
    Dimensions = "dimensions",
    /** Number + dimensions + aspect ratio (e.g. `16:9 · 1.78`). */
    AspectRatio = "aspect",
}

/** How to back off when {@link WireframeLabelContent} won't fit a tile. */
export enum WireframeLabelOverflow {
    /** All-or-nothing — show the full requested content, or leave the tile blank. */
    Hide = "hide",
    /** Drop the richest line at a time (aspect → dimensions → number) until what
     *  remains fits. Small tiles still show at least their number when it fits. */
    Degrade = "degrade",
    /** Show the full content if it fits, otherwise fall straight back to just the
     *  number (skipping the in-between levels) — the smallest always-useful label. */
    NumberFloor = "number-floor",
}

/** Canvas backing for the wireframe (debug mode). */
export enum WireframeBackground {
    /** No fill — the canvas and every null / empty region stay transparent, so
     *  the wireframe is just lines + labels and composites over anything. */
    Transparent = "transparent",
    /** Bake an opaque white fill behind everything — null / empty regions read
     *  as solid white instead of transparent. */
    White = "white",
}

/**
 * Dev diagram knob (gate 29, founder). The final composite is every overlay
 * LAYER stacked; "show" explodes it — an emit:multi pipeline with ONE still
 * per overlay depth, each printing that depth's cells plus its `-` null
 * holes (which the engine never paints) as dashed, muted cells.
 */
export enum WireframeNullFrames {
    /** Normal single composite, null tiles skipped (the shipped default). */
    Hide = "hide",
    /** Layer explode: one PNG per overlay depth, null tiles drawn dashed + muted. */
    Show = "show",
}

/** String-value unions accepted by the props (what the schema validates). */
export type WireframeLabelContentValue = `${WireframeLabelContent}`;
export type WireframeNullFramesValue = `${WireframeNullFrames}`;
/** Text drawn inside a hole cell: the word `null`, or the m0 token `-`. */
export type WireframeNullLabelValue = "null" | "-";

/** What an UNLABELED cell shows once some cells carry custom labels. */
export enum WireframeUnlabeledCells {
    /** Keep the debug marks (number / dims / aspect) — label a few frames, the
     *  rest still read their geometry. The default. */
    Marks = "marks",
    /** Leave it blank — labels are the only text on the board (the pre-gate-30
     *  behaviour; opt-in). */
    Empty = "empty",
}
export type WireframeUnlabeledCellsValue = `${WireframeUnlabeledCells}`;
const DEFAULT_UNLABELED_CELLS: WireframeUnlabeledCellsValue = "marks";

/** Per-cell label decision shared by the composite and the layer-explode
 *  paths: a non-blank custom label wins; otherwise the cell falls back to its
 *  debug marks (`undefined`) unless `unlabeledCells: "empty"` asks for a blank
 *  cell (`""`) while ANY custom label is in play. */
function cellLabelFor(
    labels: readonly string[] | undefined,
    order: number,
    unlabeledCells: WireframeUnlabeledCellsValue,
): string | undefined {
    const custom = labels?.[order - 1];
    if (custom && custom.trim()) return custom;
    const anyCustom = (labels?.length ?? 0) > 0;
    return anyCustom && unlabeledCells === "empty" ? "" : undefined;
}

export type WireframeLabelOverflowValue = `${WireframeLabelOverflow}`;
export type WireframeBackgroundValue = `${WireframeBackground}`;

// Default matches the wireframe's historical behaviour — number + dimensions,
// degrading to just the number on tiles too small for both. Aspect ratio is
// opt-in via `labelContent: "aspect"`.
const DEFAULT_LABEL_CONTENT: WireframeLabelContentValue = "dimensions";
const DEFAULT_LABEL_OVERFLOW: WireframeLabelOverflowValue = "degrade";
// White by default (founder ruling, gate 29 take 4: "transparent bg is poor
// when the background is also black" — black ink on the editor's dark
// stage read as an empty canvas). Opt into a transparent canvas — lines +
// labels that composite over anything, null regions empty — with
// `background: "transparent"` (the Layout page's trace styles do).
const DEFAULT_BACKGROUND: WireframeBackgroundValue = "white";
const DEFAULT_NULL_FRAMES: WireframeNullFramesValue = "hide";
const DEFAULT_NULL_LABEL: WireframeNullLabelValue = "null";
// Null-frame treatment: muted ink + a dashed ring so a hole never reads as a
// painted cell. Dash/gap scale with the pen so the rhythm holds at any size.
const NULL_FRAME_ALPHA = 0.55;
// Each layer still is a 1s image step (emit:multi needs a step length).
const LAYER_STILL_MS = 1000;
const NULL_DASH_PER_PEN = 6;

// Default layout: a basic 2×2 grid (founder ruling, gate 29 take 3 — a dev
// template gets no cover; the default face is a real grid, not a bare cell).
const DEFAULT_LAYOUT = "2(2[1,1],2[1,1])";

// Sub-readable glyphs are noise in a baked export — a candidate that would draw
// any line below this px size is treated as "doesn't fit" and backs off.
const MIN_LEGIBLE_PX = 9;

// Debug frame outlines use ONE uniform pen width across every tile (a wireframe
// wants a single line weight, not a border that thins out on smaller tiles).
// The weight is a fraction of the CANVAS's smaller side, so it scales with
// render resolution but stays identical from tile to tile. 0.0015 ≈ 3px at
// 2160p / 2px at 1080p, matching the thumb presets' line weight.
const DEBUG_BORDER_FRAC = 0.0015;
// resolveTheme's debug *baseline* borderWidthFrac (0.005) is a legacy
// tile-relative value — far too heavy read canvas-relative — so we ignore it and
// only honour preset/explicit fracs at or below this sane canvas-relative cap.
const MAX_CANVAS_BORDER_FRAC = 0.003;

// FrameInfo line-size ratios (kept identical so the proportions match the
// editor): the number is the primary, dimensions ride at 65%, aspect at 55%,
// with a gap of 25% of the number size between stacked lines.
const SECONDARY_RATIO = 0.65; // dimensions size = numPx * this
const TERTIARY_RATIO = 0.55; // aspect size     = numPx * this
const STACK_GAP_RATIO = 0.25; // gap between lines = numPx * this
// Fraction of tile HEIGHT the stack aims to fill. Unlike FrameInfo (a subtle
// DOM overlay sized off a screen-space constant), a baked wireframe wants the
// label to read at a glance, so we size to fill the tile and then shrink to fit
// width. Fewer requested lines ⇒ the number divides the fill among fewer items
// ⇒ it grows — the same "boost when less is shown" behaviour FrameInfo gets
// from its numBoost constant.
const STACK_FILL_FRAC = 0.6;
// Absolute ceiling so huge canvases don't produce monster glyphs.
const MAX_NUM_PX = 240;

function gcd(a: number, b: number): number {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) {
        [a, b] = [b, a % b];
    }
    return a || 1;
}

function simplifyRatio(w: number, h: number): [number, number] {
    const g = gcd(w, h);
    return [Math.round(w) / g, Math.round(h) / g];
}

function fmtDec(n: number): string {
    return parseFloat(n.toFixed(2)).toString();
}

/** Numeric rung for a content level (0 = none). Higher = more detail. */
function contentLevel(c: WireframeLabelContentValue): number {
    return c === "aspect" ? 3 : c === "dimensions" ? 2 : c === "number" ? 1 : 0;
}

/** The lines a given level wants, richest item last. `order` is 1-based. */
function linesForLevel(
    level: number,
    order: number,
    cellW: number,
    cellH: number,
): Array<{ key: "num" | "dims" | "aspect"; text: string }> {
    const out: Array<{ key: "num" | "dims" | "aspect"; text: string }> = [];
    if (level >= 1) out.push({ key: "num", text: String(order) });
    if (level >= 2) out.push({ key: "dims", text: `${cellW} × ${cellH}` });
    if (level >= 3) {
        const [rw, rh] = simplifyRatio(cellW, cellH);
        out.push({ key: "aspect", text: `${rw}:${rh} · ${fmtDec(cellW / cellH)}` });
    }
    return out;
}

/** Ladder of content levels to try, richest first, per overflow policy. */
function candidateLevels(
    target: number,
    overflow: WireframeLabelOverflowValue,
): number[] {
    if (target <= 0) return [];
    if (overflow === "hide") return [target];
    if (overflow === "number-floor") return target > 1 ? [target, 1] : [1];
    // degrade: every rung from target down to 1
    const out: number[] = [];
    for (let l = target; l >= 1; l--) out.push(l);
    return out;
}

type SizedLine = { key: "num" | "dims" | "aspect"; text: string; size: number };
type FittedLabel = { lines: SizedLine[]; gap: number; pad: number };

/**
 * Try to fit `items` in a `cellW`×`cellH` tile using FrameInfo's sizing math.
 * Returns sized lines (+ stacking gap/pad) if every line is legible and the
 * stack fits both axes, else `null` so the caller can back off to fewer lines.
 */
function fitLines(
    items: Array<{ key: "num" | "dims" | "aspect"; text: string }>,
    cellW: number,
    cellH: number,
    minTextSize: number,
): FittedLabel | null {
    const count = items.length;
    if (count === 0) return null;

    const minSide = Math.min(cellW, cellH);
    const pad = Math.max(4, Math.round(minSide * 0.04));
    const availW = cellW - 2 * pad;
    if (availW <= 0) return null;

    const relOf = (key: SizedLine["key"]): number =>
        key === "num" ? 1.0 : key === "dims" ? SECONDARY_RATIO : TERTIARY_RATIO;

    // 1) Size to fill the tile height. The number divides the fill budget among
    //    all lines (weighted) + the inter-line gaps, so fewer lines ⇒ bigger
    //    number (the boost effect).
    const sumRel = items.reduce((a, it) => a + relOf(it.key), 0);
    const gapUnits = STACK_GAP_RATIO * (count - 1);
    let numPx = Math.min(MAX_NUM_PX, (cellH * STACK_FILL_FRAC) / (sumRel + gapUnits));

    // 2) Shrink to fit width — scale the whole stack down by the tightest line.
    let scale = 1;
    for (const it of items) {
        const w = measureText(it.text, { fontSize: numPx * relOf(it.key) }).width;
        if (w > availW) scale = Math.min(scale, availW / w);
    }
    numPx *= scale;

    // 3) Legibility floors — primary clears minTextSize, nothing is sub-legible.
    //    Failing here backs the caller off to fewer (hence larger) lines.
    if (numPx < minTextSize) return null;
    const sized: SizedLine[] = items.map((it) => ({ ...it, size: numPx * relOf(it.key) }));
    if (sized.some((s) => s.size < MIN_LEGIBLE_PX)) return null;

    return { lines: sized, gap: numPx * STACK_GAP_RATIO, pad };
}

/** Resolve the label that fits this tile, walking the overflow ladder. */
function resolveLabel(
    content: WireframeLabelContentValue,
    overflow: WireframeLabelOverflowValue,
    order: number,
    cellW: number,
    cellH: number,
    minTextSize: number,
): FittedLabel | null {
    const target = contentLevel(content);
    for (const level of candidateLevels(target, overflow)) {
        const fitted = fitLines(linesForLevel(level, order, cellW, cellH), cellW, cellH, minTextSize);
        if (fitted) return fitted;
    }
    return null;
}

type LocalRect = { x: number; y: number; w: number; h: number };

/**
 * The per-LINE rects (in the cell's local coords) the label this cell WOULD draw
 * actually inks — each line centered exactly as {@link buildDebugCellMaskPath}
 * lays it out. Testing these (not their union bounding box) against higher-z
 * tiles is what makes a small corner overlay leave a big hero label alone: the
 * dead space between the centered number and the wide dimensions line isn't part
 * of any line rect, so only a tile that truly covers a glyph row suppresses it.
 * Returns [] when the cell draws no label.
 */
function labelLineRects(opts: {
    cellW: number;
    cellH: number;
    order: number;
    label?: string;
    content: WireframeLabelContentValue;
    overflow: WireframeLabelOverflowValue;
    minTextSize: number;
}): LocalRect[] {
    const { cellW, cellH, order, label, content, overflow, minTextSize } = opts;
    const smallerDim = Math.min(cellW, cellH);
    const pad = Math.max(4, Math.round(smallerDim * 0.04));

    if (label != null) {
        const t = label.trim();
        if (!t) return [];
        const availW = Math.max(1, cellW - 2 * pad);
        let size = clampSize(minTextSize, smallerDim * 0.16, 72);
        let w = measureText(t, { fontSize: size }).width;
        if (w > availW) {
            size = Math.max(MIN_LEGIBLE_PX, Math.floor((size * availW) / w));
            w = measureText(t, { fontSize: size }).width;
        }
        // Custom label is vertically centered (vAlign "middle").
        return [{ x: (cellW - w) / 2, y: (cellH - size) / 2, w, h: size }];
    }

    const fitted = resolveLabel(content, overflow, order, cellW, cellH, minTextSize);
    if (!fitted) return [];
    let totalH = 0;
    fitted.lines.forEach((l, i) => {
        totalH += l.size;
        if (i > 0) totalH += fitted.gap;
    });
    const rects: LocalRect[] = [];
    let cursor = (cellH - totalH) / 2;
    for (const line of fitted.lines) {
        const w = measureText(line.text, { fontSize: line.size }).width;
        rects.push({ x: (cellW - w) / 2, y: cursor, w, h: line.size });
        cursor += line.size + fitted.gap;
    }
    return rects;
}

/** Axis-aligned rect overlap (strict: edge-touching is not an overlap). */
function rectsIntersect(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
): boolean {
    return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

// ── Debug-mode geometry helpers ──

/**
 * SVG path for a rectangular border ring (frame outline) of stroke width `t`
 * inside a `w`×`h` cell. Outer contour clockwise + inner counter-clockwise so
 * the non-zero fill rule punches the center out, leaving just the border. Baked
 * into the cell's inline-mask so the outline is the SAME ink as the text — one
 * masked color source draws both.
 */
function rectRingPath(w: number, h: number, t: number): string {
    const ti = Math.min(t, w / 2, h / 2);
    const outer = `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
    const inner = `M${ti} ${ti} L${ti} ${h - ti} L${w - ti} ${h - ti} L${w - ti} ${ti} Z`;
    return `${outer} ${inner}`;
}

/**
 * Dashed rectangular ring of pen `t` inside a `w`×`h` cell: `dash`-long
 * strokes separated by `gap` along each edge (corners always inked so the
 * rectangle reads). Same ink path as the solid ring — one masked tile.
 */
function dashedRingPath(w: number, h: number, t: number, dash: number, gap: number): string {
    const ti = Math.max(1, Math.min(t, w / 2, h / 2));
    const step = Math.max(2, dash + gap);
    const parts: string[] = [];
    // top + bottom edges
    for (let x = 0; x < w; x += step) {
        const x1 = Math.min(w, x + dash);
        parts.push(`M${x} 0 L${x1} 0 L${x1} ${ti} L${x} ${ti} Z`);
        parts.push(`M${x} ${h - ti} L${x1} ${h - ti} L${x1} ${h} L${x} ${h} Z`);
    }
    // left + right edges
    for (let y = 0; y < h; y += step) {
        const y1 = Math.min(h, y + dash);
        parts.push(`M0 ${y} L${ti} ${y} L${ti} ${y1} L0 ${y1} Z`);
        parts.push(`M${w - ti} ${y} L${w} ${y} L${w} ${y1} L${w - ti} ${y1} Z`);
    }
    return parts.join(" ");
}

/**
 * ONE null tile's inline-mask path: a dashed ring + a centered `null` /
 * `W × H` stack (the same FrameInfo sizing math as painted cells, degrading
 * to just `null` on small holes). Drawn muted via the tile's overlay alpha.
 */
function buildNullCellMaskPath(opts: {
    cellW: number;
    cellH: number;
    borderPx: number;
    minTextSize: number;
    /** Thumb mode: ring only (thumb tiles carry no labels). */
    ringOnly?: boolean;
    /** Primary line: `null` (default) or the m0 token `-`. */
    label?: WireframeNullLabelValue;
}): string {
    const { cellW, cellH, borderPx, minTextSize, ringOnly } = opts;
    const nullText = opts.label ?? DEFAULT_NULL_LABEL;
    const dash = Math.max(6, borderPx * NULL_DASH_PER_PEN);
    const parts: string[] = [dashedRingPath(cellW, cellH, borderPx, dash, dash)];
    if (ringOnly) return parts.join(" ");
    const canvas = { width: cellW, height: cellH };
    const items = [
        { key: "num" as const, text: nullText },
        { key: "dims" as const, text: `${cellW} × ${cellH}` },
    ];
    const fitted =
        fitLines(items, cellW, cellH, minTextSize) ??
        fitLines(items.slice(0, 1), cellW, cellH, minTextSize);
    if (fitted) {
        let totalH = 0;
        fitted.lines.forEach((l, i) => {
            totalH += l.size;
            if (i > 0) totalH += fitted.gap;
        });
        let cursor = (cellH - totalH) / 2;
        for (const line of fitted.lines) {
            parts.push(
                textToPath(
                    line.text,
                    { fontSize: line.size, hAlign: "center", vAlign: "top", padding: { x: fitted.pad, y: cursor } },
                    canvas,
                ),
            );
            cursor += line.size + fitted.gap;
        }
    }
    return parts.filter(Boolean).join(" ");
}

/** Alpha-0 tile: occupies a leaf slot, paints nothing (a leaf on another layer). */
function ghostTile(ink: MosaicColor): MosaicLavfiSource {
    return makeColorTile(ink, { overlay: { alpha: "0" } });
}

/** The dashed, muted `null` + size cell for one hole. */
function nullTile(opts: {
    ink: MosaicColor;
    cellW: number;
    cellH: number;
    borderPx: number;
    minTextSize: number;
    ringOnly: boolean;
    label: WireframeNullLabelValue;
}): MosaicLavfiSource {
    return makeColorTile(opts.ink, {
        mask: {
            kind: "inline-mask",
            localPath: buildNullCellMaskPath(opts),
            bounds: { x: 0, y: 0, width: opts.cellW, height: opts.cellH },
        },
        overlay: { alpha: String(NULL_FRAME_ALPHA) },
    });
}

/**
 * One painted cell — thumb: a flat colour tile with rounding/stroke effects;
 * debug: one ink tile masked to border ring + label glyphs. Shared by the
 * single composite and the layer explode so a cell looks identical in both.
 */
function paintedTile(opts: {
    cellW: number;
    cellH: number;
    order: number;
    useThumb: boolean;
    resolved: ReturnType<typeof resolveTheme> | null;
    label?: string;
    labelContent: WireframeLabelContentValue;
    labelOverflow: WireframeLabelOverflowValue;
    borderPx: number;
    minTextSize: number;
    fillAlpha: number;
    suppressLabel: boolean;
}): MosaicLavfiSource {
    const { cellW, cellH, order, useThumb, resolved } = opts;
    if (useThumb) {
        let tileColor: MosaicColor = resolved?.tileColor ?? "#141824";
        if (resolved?.heatmap?.enabled && resolved.heatmap.shades.length > 0) {
            tileColor = resolved.heatmap.shades[(order - 1) % resolved.heatmap.shades.length] as MosaicColor;
        } else if (resolved && order % 2 === 0) {
            tileColor = resolved.tileColorAlt;
        }
        const effects: MosaicEffectProps = {
            rounding: resolved?.rounding ?? { borderRadius: 0.04, cornerStyle: "rounded" },
            stroke: {
                width: resolved?.borderWidthFrac ?? 0.0015,
                color: (resolved?.borderColor ?? "#ffffff") as MosaicColor,
                alpha: resolved?.borderAlpha ?? 0.1,
                position: "inner",
            },
        };
        if (resolved?.dropShadow) effects.dropShadow = resolved.dropShadow;
        return makeColorTile(tileColor, { effects });
    }
    const ink: MosaicColor = (resolved?.borderColor ?? "#000000") as MosaicColor;
    const localPath = buildDebugCellMaskPath({
        cellW,
        cellH,
        order,
        label: opts.label,
        content: opts.labelContent,
        overflow: opts.labelOverflow,
        borderPx: opts.borderPx,
        minTextSize: opts.minTextSize,
        suppressLabel: opts.suppressLabel,
    });
    return makeColorTile(ink, {
        mask: {
            kind: "inline-mask",
            localPath,
            bounds: { x: 0, y: 0, width: cellW, height: cellH },
            ...(opts.fillAlpha > 0 ? { matte: opts.fillAlpha } : {}),
        },
    });
}

/** What the layer explode reads off the full parse's editorFrames. */
type LayerNode = {
    kind: string;
    overlayDepth: number;
    x: number;
    y: number;
    width: number;
    height: number;
    logicalIndex?: number;
    meta: { span: { start: number } | null };
};

/**
 * LAYER EXPLODE (dev diagram, gate 29): the composite is every overlay depth
 * stacked, so emit ONE still per depth. Every still carries the SAME m0
 * geometry (so a cell keeps its number and position across the set) — leaves
 * at the requested depth paint (cells as usual, `-` holes as dashed muted
 * `null` cells, their `-` swapped to `1` positionally via the parse span so
 * the engine binds a source), painted leaves at other depths ride as alpha-0
 * ghosts, and other depths' holes stay `-` (no source). Returns null when
 * the full parse fails (caller falls back to the composite).
 */
function buildLayerExplode(args: {
    m0: string;
    canvasW: number;
    canvasH: number;
    fps: number;
    useThumb: boolean;
    resolved: ReturnType<typeof resolveTheme> | null;
    labels?: string[];
    unlabeledCells: WireframeUnlabeledCellsValue;
    labelContent: WireframeLabelContentValue;
    labelOverflow: WireframeLabelOverflowValue;
    borderPx: number;
    minTextSize: number;
    fillAlpha: number;
    bg: string | null;
    assets: MosaicAssetManifest;
    backgroundImage?: MosaicBackgroundImage;
    nullLabel: WireframeNullLabelValue;
}): MosaicDocumentPipeline | null {
    const canon = String(toCanonicalM0String(args.m0));
    const full = parseM0StringComplete(canon, args.canvasW, args.canvasH);
    if (!full.ok) return null;
    const nodes = ((full.ir?.editorFrames ?? []) as unknown as LayerNode[])
        .filter((n) => n.kind === "frame" || n.kind === "null")
        .slice()
        .sort((a, b) => (a.meta.span?.start ?? 0) - (b.meta.span?.start ?? 0));
    if (nodes.length === 0) return null;
    // A hole must be addressable in the canonical string to become a slot.
    if (nodes.some((n) => n.kind === "null" && (n.meta.span == null || canon[n.meta.span.start] !== "-"))) {
        return null;
    }
    const maxDepth = nodes.reduce((m, n) => Math.max(m, n.overlayDepth), 0);
    const ink: MosaicColor = (args.resolved?.borderColor ?? "#000000") as MosaicColor;
    const steps: MosaicPipelineStep[] = [];
    for (let depth = 0; depth <= maxDepth; depth++) {
        const chars = canon.split("");
        const sources: MosaicSource[] = [];
        let order = 0;
        for (const n of nodes) {
            if (n.kind === "frame") {
                order += 1; // composite numbering — identical on every still
                if (n.overlayDepth !== depth) {
                    sources.push(ghostTile(ink));
                    continue;
                }
                sources.push(
                    paintedTile({
                        cellW: n.width,
                        cellH: n.height,
                        order,
                        useThumb: args.useThumb,
                        resolved: args.resolved,
                        label: cellLabelFor(args.labels, order, args.unlabeledCells),
                        labelContent: args.labelContent,
                        labelOverflow: args.labelOverflow,
                        borderPx: args.borderPx,
                        minTextSize: args.minTextSize,
                        fillAlpha: args.fillAlpha,
                        // one depth per still — nothing on this still covers a label
                        suppressLabel: false,
                    }),
                );
            } else if (n.overlayDepth === depth && n.meta.span) {
                chars[n.meta.span.start] = "1";
                sources.push(
                    nullTile({
                        ink,
                        cellW: n.width,
                        cellH: n.height,
                        borderPx: args.borderPx,
                        minTextSize: args.minTextSize,
                        ringOnly: args.useThumb,
                        label: args.nullLabel,
                    }),
                );
            }
        }
        let layerM0 = chars.join("");
        if (depth === 0 && args.resolved?.paperGrid?.enabled) {
            sources.push(
                makePaperGridSource({
                    width: args.canvasW,
                    height: args.canvasH,
                    ink,
                    stepFrac: args.resolved.paperGrid.stepFrac,
                    alpha: args.resolved.paperGrid.alpha,
                }),
            );
            layerM0 = appendTopOverlay(layerM0);
        }
        const file: MosaicDocument = {
            kind: "mosaic_document",
            version: 1,
            assets: args.assets as MosaicDocument["assets"],
            m0: toM0String(layerM0, `Wireframe layer ${depth}`),
            sources,
            size: { width: args.canvasW, height: args.canvasH },
            fps: args.fps,
            durationMs: LAYER_STILL_MS,
            format: { kind: "image", container: "png", pixelFormat: "rgba" },
            ...(args.bg != null ? { backgroundColor: solidBackground(args.bg as MosaicColor) } : {}),
            ...(args.backgroundImage ? { backgroundImage: args.backgroundImage } : {}),
        };
        steps.push({
            name: `layer-${depth}`,
            label: `Layer ${depth} of ${maxDepth + 1}`,
            durationMs: LAYER_STILL_MS,
            file,
        });
    }
    return { kind: "mosaic_pipeline", version: 1, emit: "multi", steps } as MosaicDocumentPipeline;
}

function clampSize(min: number, value: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Build ONE cell's inline-mask path — border ring + the centered label stack —
 * all as glyph/vector outlines authored in the cell's local pixel box. The
 * consuming `makeColorTile` paints a single flat ink color through this mask.
 *
 * A custom `label` (from the `labels` prop) bypasses the content/overflow ladder
 * and is drawn centered, shrunk to fit the tile width. Otherwise the label is
 * resolved from `content` + `overflow` and laid out as a centered vertical stack
 * (number / dimensions / aspect), mirroring the editor's FrameInfo.
 */
function buildDebugCellMaskPath(opts: {
    cellW: number;
    cellH: number;
    order: number;
    label?: string;
    content: WireframeLabelContentValue;
    overflow: WireframeLabelOverflowValue;
    /** Uniform outline thickness in output px (same for every tile). */
    borderPx: number;
    minTextSize: number;
    /**
     * When true, draw only the border ring — the label is covered by a
     * higher-z tile (overlay) so painting it would bleed through. See the
     * obstruction pass in `render`.
     */
    suppressLabel?: boolean;
}): string {
    const { cellW, cellH, order, label, content, overflow, borderPx, minTextSize, suppressLabel } = opts;
    const canvas = { width: cellW, height: cellH };
    const smallerDim = Math.min(cellW, cellH);
    const pad = Math.max(4, Math.round(smallerDim * 0.04));
    const parts: string[] = [];

    // Border ring — same ink as the text, one uniform pen width across all tiles.
    // Always drawn (it reads the structure even where the label is suppressed).
    parts.push(rectRingPath(cellW, cellH, borderPx));

    if (suppressLabel) {
        return parts.filter(Boolean).join(" ");
    }

    if (label != null) {
        // Custom label: one centered line, shrunk so it fits the padded width.
        const t = label.trim();
        if (t) {
            const availW = Math.max(1, cellW - 2 * pad);
            let size = clampSize(minTextSize, smallerDim * 0.16, 72);
            const w = measureText(t, { fontSize: size }).width;
            if (w > availW) size = Math.max(MIN_LEGIBLE_PX, Math.floor((size * availW) / w));
            parts.push(
                textToPath(t, { fontSize: size, hAlign: "center", vAlign: "middle", padding: pad }, canvas),
            );
        }
    } else {
        // Adaptive stack: pick the richest content level that fits, then center it.
        const fitted = resolveLabel(content, overflow, order, cellW, cellH, minTextSize);
        if (fitted) {
            let totalH = 0;
            fitted.lines.forEach((l, i) => {
                totalH += l.size;
                if (i > 0) totalH += fitted.gap;
            });
            let cursor = (cellH - totalH) / 2;
            for (const line of fitted.lines) {
                // vAlign "top" + padding.y = cursor places this line's top at `cursor`.
                parts.push(
                    textToPath(
                        line.text,
                        { fontSize: line.size, hAlign: "center", vAlign: "top", padding: { x: pad, y: cursor } },
                        canvas,
                    ),
                );
                cursor += line.size + fitted.gap;
            }
        }
    }

    return parts.filter(Boolean).join(" ");
}

/**
 * Resolve a stableKey-keyed labels map (Record<StableKey, M0Label>, same shape
 * as `M0cFile.labels`) to the positional `labels` array the debug labeler
 * consumes (1-based source order). REAL stableKeys require the full parse — the
 * logical frames used for rendering carry only synthetic placeholder keys — so
 * this parses with `parseM0StringComplete`. Folded in from the old
 * `@m0saic/meta/m0-snapshot` wrapper (which existed solely for this conversion).
 * Keys that don't match a frame are dropped; returns `undefined` when nothing
 * resolves, so callers fall back to the default dim/AR text.
 */
function stableKeyLabelsToPositional(
    labels: Record<string, M0Label>,
    m0: string,
    width: number,
    height: number,
): string[] | undefined {
    const result = parseM0StringComplete(m0, width, height);
    if (!result.ok) return undefined;
    const frames = (result.ir?.renderFrames ?? [])
        .slice()
        .sort((a, b) => a.logicalIndex - b.logicalIndex);
    const out = new Array<string>(frames.length).fill("");
    let anyHit = false;
    for (let i = 0; i < frames.length; i++) {
        const sk: StableKey = frames[i].meta.stableKey;
        const entry = labels[sk as string];
        if (entry && typeof entry.text === "string" && entry.text.trim() !== "") {
            out[i] = entry.text;
            anyHit = true;
        }
    }
    return anyHit ? out : undefined;
}

// ── Schema props (mirrors v1) ──

type WireframeSchemaProps = {
    M0String: string;
    labels?: string[];
    /**
     * Per-cell labels keyed by REAL stableKey (same shape as `M0cFile.labels`:
     * `Record<StableKey, {text, color?}>`). Resolved to the positional `labels`
     * array internally, so callers with a `.m0c` labels map (e.g. post-mortem's
     * candidate geometry) can label cells by stable identity instead of fragile
     * source order. Overrides positional `labels` when supplied.
     */
    labelsByStableKey?: Record<string, M0Label>;
    /**
     * Per-cell (1-based order, parallel to {@link WireframeSchemaProps.labels})
     * body fill colour. When set, cell N's BODY is painted `cellColors[N-1]` at
     * full opacity BENEATH the masked border/label ink — so the label still reads
     * on top of the fill. An empty-string entry leaves that cell's body
     * transparent (skip). The perf heatmap uses this to colour cells by render
     * cost while keeping the time label legible. Debug mode only.
     */
    cellColors?: string[];
    /** "debug" (default) renders numbers/dims/AR. "thumb" renders clean tiles. */
    mode?: "debug" | "thumb";
    /**
     * Most detail to show per tile (cumulative ladder). Default "dimensions"
     * (number + W × H); "aspect" is opt-in. A cell with a custom label shows the
     * label instead; unlabeled cells keep this ladder (see `unlabeledCells`).
     */
    labelContent?: WireframeLabelContentValue;
    /** How to back off when `labelContent` won't fit a tile. Default "degrade". */
    labelOverflow?: WireframeLabelOverflowValue;
    /**
     * What a cell WITHOUT a custom label shows once `labels` are in play:
     * "marks" (default — its number / dims / aspect per `labelContent`) or
     * "empty" (blank; labels are the only text on the board).
     */
    unlabeledCells?: WireframeUnlabeledCellsValue;
    /**
     * Canvas backing (debug mode). "white" (default) bakes an opaque white fill
     * behind everything; "transparent" leaves the canvas and null regions empty
     * so the wireframe composites over anything (trace workflows).
     * Ignored when a theme/preset supplies its own background.
     */
    background?: WireframeBackgroundValue;
    /**
     * Dev diagram knob: "show" returns an emit:multi PIPELINE — one still per
     * overlay depth, each printing that depth's cells plus its `-` holes as
     * dashed, muted cells labelled `null` + size. Default "hide" renders the
     * normal single composite (byte-identical output).
     */
    nullFrames?: WireframeNullFramesValue;
    /** Text inside a hole cell when null frames show: `null` (default) or the m0 token `-`. */
    nullLabel?: WireframeNullLabelValue;
    /**
     * Translucent rect fill (debug mode), 0..1. A body wash in the tile's ink
     * color drawn beneath the opaque border/labels — so the rects read as
     * filled regions when composited over a background image. 0 (default) keeps
     * the body transparent (lines/labels only). Ignored in thumb/themed modes.
     */
    fill?: number;
    /**
     * Image baked BENEATH the wireframe — the lines/labels render on top of it.
     * A filesystem path OR an inline base64 `data:` URI (self-contained docs).
     * The classic use is dropping a reference/source screenshot here and tracing
     * the layout over it. Sets the document's `backgroundImage`.
     */
    backgroundImage?: string;
    /** Background-image opacity, 0..1. Default 1 (fully opaque). */
    backgroundImageOpacity?: number;
    /** Background-image fit: "cover" (default, fill+crop) or "contain" (letterbox). */
    backgroundImageFit?: MosaicPlacementFit;
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
            control: { placeholder: "e.g., F, 2(1,1), 3[1,0,1]" },
            ui: { label: "Mosaic Layout String" },
        },
    },
    labels: {
        type: "string[]",
        required: false,
        description:
            "Optional labels for wireframe cells (1-based order). A labeled cell shows its label; cells without one keep their number and pixel size (see Label Content / Unlabeled Cells).",
        meta: { ui: { label: "Cell Labels" } },
    },
    unlabeledCells: {
        type: "string",
        required: false,
        description:
            'What a cell without a custom label shows once some cells are labeled: "marks" (default — its number / dims per Label Content) or "empty" (blank — labels are the only text on the board).',
        meta: {
            constraints: { oneOf: ["marks", "empty"] },
            control: {
                options: [
                    { value: "marks", label: "Keep marks" },
                    { value: "empty", label: "Leave empty" },
                ],
            },
            ui: { label: "Unlabeled Cells" },
        },
    },
    labelsByStableKey: {
        type: "group",
        required: false,
        description:
            "Per-cell labels keyed by stableKey (Record<StableKey, {text, color?}>, same shape as M0cFile.labels). Resolved to positional labels internally; overrides `labels`. Agent/programmatic prop.",
        meta: { ui: { label: "Labels by stableKey", collapsedByDefault: true, consumer: "agent" } },
    },
    cellColors: {
        type: "string[]",
        required: false,
        description:
            "Optional per-cell body fill colors (1-based order, parallel to labels). Cell N's body is painted cellColors[N-1] beneath the border/label ink; an empty string leaves it transparent. Used by the perf heatmap. Debug mode only.",
        meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Cell Colors", consumer: "agent" } },
    },
    mode: {
        type: "string",
        required: false,
        description:
            'Render mode. "debug" (default) shows numbers/dims/AR. "thumb" shows clean tiles only.',
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
    labelContent: {
        type: "string",
        required: false,
        description:
            "Most detail to show per tile (cumulative): none → number → dimensions → aspect. Default dimensions.",
        meta: {
            constraints: { oneOf: ["none", "number", "dimensions", "aspect"] },
            control: {
                options: [
                    { value: "none", label: "None" },
                    { value: "number", label: "Number" },
                    { value: "dimensions", label: "Dimensions" },
                    { value: "aspect", label: "Aspect ratio" },
                ],
            },
            ui: { label: "Label Content" },
        },
    },
    labelOverflow: {
        type: "string",
        required: false,
        description:
            "How to back off when the content won't fit a tile: hide (all-or-nothing), degrade (drop richest lines), number-floor (fall back to just the number). Default degrade.",
        meta: {
            constraints: { oneOf: ["hide", "degrade", "number-floor"] },
            control: {
                options: [
                    { value: "hide", label: "Hide" },
                    { value: "degrade", label: "Degrade" },
                    { value: "number-floor", label: "Number floor" },
                ],
            },
            ui: { label: "Label Overflow" },
        },
    },
    background: {
        type: "string",
        required: false,
        description:
            'Canvas backing: "white" (default — an opaque white fill) or "transparent" (lines/labels only, null regions empty — composites over anything). Ignored when a theme/preset sets its own background.',
        meta: {
            constraints: { oneOf: ["transparent", "white"] },
            control: {
                options: [
                    { value: "transparent", label: "Transparent" },
                    { value: "white", label: "White" },
                ],
            },
            ui: { label: "Background" },
        },
    },
    nullFrames: {
        type: "string",
        required: false,
        description:
            'Dev: "show" explodes the layout into LAYERS — one PNG per overlay depth (emit:multi), each printing that depth\'s cells plus its null (-) holes as dashed, muted cells labelled "null" + size. "hide" (default) renders the normal single composite.',
        meta: {
            constraints: { oneOf: ["hide", "show"] },
            control: {
                options: [
                    { value: "hide", label: "Hide" },
                    { value: "show", label: "Show" },
                ],
            },
            ui: { label: "Null Frames" },
        },
    },
    nullLabel: {
        type: "string",
        required: false,
        description:
            'Dev: the text drawn inside a hole cell when null frames show — the word "null" (default) or the m0 token "-".',
        meta: {
            constraints: { oneOf: ["null", "-"] },
            control: {
                options: [
                    { value: "null", label: "null" },
                    { value: "-", label: "- (m0 token)" },
                ],
            },
            ui: { label: "Null Label" },
        },
    },
    fill: {
        type: "number",
        required: false,
        description:
            "Translucent rect fill (debug mode), 0..1. Body wash beneath the borders/labels so rects read as filled regions over a traced image. 0 = lines only.",
        meta: {
            constraints: { min: 0, max: 1 },
            ui: { label: "Rect Fill" },
        },
    },
    backgroundImage: {
        type: "media",
        required: false,
        description:
            "Image baked beneath the wireframe — lines/labels render on top. A file path or an inline base64 data: URI. Drop a reference screenshot here to trace a layout over it.",
        meta: {
            control: { picker: "file", accept: ["image"] },
            ui: { label: "Background Image" },
        },
    },
    backgroundImageOpacity: {
        type: "number",
        required: false,
        description: "Background-image opacity, 0..1. Default 1 (fully opaque).",
        meta: {
            control: { placeholder: "1 (opaque)" },
            constraints: { min: 0, max: 1 },
            ui: { label: "Background Image Opacity" },
        },
    },
    backgroundImageFit: {
        type: "string",
        required: false,
        description:
            'How the background image fills the canvas: "cover" (default, fill + crop) or "contain" (letterbox, pad reveals the canvas background).',
        meta: {
            constraints: { oneOf: ["cover", "contain"] },
            control: {
                options: [
                    { value: "cover", label: "Cover" },
                    { value: "contain", label: "Contain" },
                ],
            },
            ui: { label: "Background Image Fit" },
        },
    },
    preset: {
        type: "string",
        required: false,
        description:
            "Named theme preset. Sets mode, colors, borders, and effects. Explicit mode/theme override preset values.",
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
        description:
            "Theme overrides applied on top of preset defaults. Colors, borders, rounding, shadows.",
        meta: { ui: { label: "Theme", collapsedByDefault: true } },
    },
});

// ── Template ──

export const WireframeV2: MosaicTemplate<WireframeSchemaProps> = {
    id: asTemplateId("@m0saic/wireframe/base/v2"),
    label: "Wireframe v2",
    version: 2,
    description:
        "Wireframe of any m0 layout string: every cell drawn as an outlined rectangle with its number, pixel size and aspect ratio on a white canvas. Switch the background to transparent to composite over anything or trace a reference screenshot, or pick the thumb, heatmap or paper presets for clean tiles.",
    capabilities: { tier: "core" },
    tags: ["wireframe", "docs-only", "designers", "developers", "layout", "blueprint"],
    outputHints: {
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 1000,
        note: "Wireframe for documentation (layout visualization)",
        format: { kind: "image", container: "png", pixelFormat: "rgba" },
    },
    propsSchema,
    // Explicit debug style (gate 29, founder: "we need the props to default
    // to this style of debug. other forms dont read as obvious in editor"):
    // every knob the default look depends on is spelled out so the Make
    // form shows the state it renders. Byte-identical to the implicit
    // defaults; a chosen `preset` still decides thumb-vs-debug (v1
    // resolveTheme, layer 3).
    defaultProps: {
        preset: "none",
        backgroundImageFit: "cover",
        M0String: DEFAULT_LAYOUT,
        mode: "debug",
        labelContent: "dimensions",
        labelOverflow: "degrade",
        unlabeledCells: "marks",
        background: "white",
        nullFrames: "hide",
        nullLabel: "null",
        fill: 0,
    },

    render(props: WireframeSchemaProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
        // "none" is the visible unset state of the preset picker — identical to omitting it.
        if (props.preset === "none") { const { preset: _none, ...rest } = props; props = rest; }
        const { M0String, labels, cellColors } = props;
        // stableKey-keyed labels (folded in from the old m0-snapshot wrapper)
        // resolve to the same positional array and take precedence over the
        // positional `labels` prop when supplied.
        const positionalFromStableKeys = props.labelsByStableKey
            ? stableKeyLabelsToPositional(
                  props.labelsByStableKey,
                  M0String,
                  ctx.target.width,
                  ctx.target.height,
              )
            : undefined;
        const effectiveLabels = positionalFromStableKeys ?? labels;
        const unlabeledCells: WireframeUnlabeledCellsValue = props.unlabeledCells ?? DEFAULT_UNLABELED_CELLS;
        const hasTheming = !!props.preset || !!props.theme || props.mode === "thumb";
        const resolved = hasTheming ? resolveTheme(props) : null;
        const useThumb = resolved?.useThumb ?? false;

        const frames = parseMosaicFrames(M0String, ctx);
        const sources: MosaicSource[] = [];
        // Nested child docs for heat-coloured cells (see the `cellColors` branch
        // in the debug path below). Empty unless `cellColors` is supplied — so
        // the default wireframe stays one flat single-command document.
        const childDocs: Record<string, MosaicDocument> = {};
        const useCellColors = (cellColors?.length ?? 0) > 0;

        // Paint-order (z) + global geometry per tile, so a tile whose label is
        // covered by a higher-z tile (an overlay) can suppress that label — the
        // wireframe is built from transparent-body masks, so without this a base
        // tile's glyphs bleed straight through whatever overlays it. Joined to
        // the logical frames below by logicalIndex.
        const renderFrames = parseMosaicRenderFrames(M0String, ctx);
        const zByLogical = new Map<number, number>();
        const zRects: Array<{ z: number; x: number; y: number; w: number; h: number }> = [];
        for (const rf of renderFrames) {
            const li = (rf as { logicalIndex?: number }).logicalIndex;
            if (li != null) zByLogical.set(li, rf.paintOrder);
            zRects.push({ z: rf.paintOrder, x: rf.x, y: rf.y, w: rf.width, h: rf.height });
        }
        const minTextSize = props.preset === "debug-contrast" ? 18 : 14;
        const labelContent = props.labelContent ?? DEFAULT_LABEL_CONTENT;
        const labelOverflow = props.labelOverflow ?? DEFAULT_LABEL_OVERFLOW;
        const showNullFrames = (props.nullFrames ?? DEFAULT_NULL_FRAMES) === "show";
        // Translucent rect fill (debug mode): a body wash beneath the opaque
        // border/labels so the rects read as filled regions over a traced
        // image. Clamped 0..1; 0 (default) = transparent body (lines only).
        const fillAlpha = Math.max(0, Math.min(1, props.fill ?? 0));

        // Canvas size from the frame bounds (frames tile the whole canvas), used
        // for ONE uniform debug border weight across every tile — see
        // DEBUG_BORDER_FRAC. Honour a preset/explicit borderWidthFrac only when
        // it's a sane canvas-relative value (≤ MAX_CANVAS_BORDER_FRAC); the
        // legacy 0.005 tile-relative baseline falls back to the v2 default.
        let canvasW = 0;
        let canvasH = 0;
        for (const f of frames) {
            canvasW = Math.max(canvasW, f.x + f.width);
            canvasH = Math.max(canvasH, f.y + f.height);
        }
        const themedFrac = resolved?.borderWidthFrac;
        const borderFrac =
            themedFrac != null && themedFrac <= MAX_CANVAS_BORDER_FRAC ? themedFrac : DEBUG_BORDER_FRAC;
        const uniformBorderPx = Math.max(1, Math.round(Math.min(canvasW, canvasH) * borderFrac));

        let order = 0;
        for (const frame of frames) {
            if ((frame as { nullRender?: boolean }).nullRender) continue;
            order += 1;
            const cellW = frame.width;
            const cellH = frame.height;

            if (useThumb) {
                // ── Thumb: flat color tile, border/rounding via effects. ──
                let tileColor: MosaicColor = resolved?.tileColor ?? "#141824";
                if (resolved?.heatmap?.enabled && resolved.heatmap.shades.length > 0) {
                    tileColor = resolved.heatmap.shades[
                        (order - 1) % resolved.heatmap.shades.length
                    ] as MosaicColor;
                } else if (resolved && order % 2 === 0) {
                    tileColor = resolved.tileColorAlt;
                }

                const effects: MosaicEffectProps = {
                    rounding: resolved?.rounding ?? { borderRadius: 0.04, cornerStyle: "rounded" },
                    stroke: {
                        width: resolved?.borderWidthFrac ?? 0.0015,
                        color: (resolved?.borderColor ?? "#ffffff") as MosaicColor,
                        alpha: resolved?.borderAlpha ?? 0.1,
                        position: "inner",
                    },
                };
                if (resolved?.dropShadow) effects.dropShadow = resolved.dropShadow;

                sources.push(makeColorTile(tileColor, { effects }));
            } else {
                // ── Debug: one ink tile masked to border + glyph outlines. ──
                // Every debug cell is bound to `labels[order-1]` (Make's
                // double-click → inline edit) — the same positional mapping
                // the labeler reads, so a cell with no custom label yet is
                // still a handle to ADD one. Thumb tiles carry no labels and
                // stay unbound.
                const ink: MosaicColor = (resolved?.borderColor ?? "#000000") as MosaicColor;
                const label = cellLabelFor(effectiveLabels, order, unlabeledCells);

                // Suppress this tile's label if a higher-z tile covers where the
                // label would sit — so overlaid tiles don't bleed their numbers
                // through (closer to a real composited render).
                const myZ = zByLogical.get((frame as { logicalIndex?: number }).logicalIndex ?? -1) ?? -1;
                let suppressLabel = false;
                if (myZ >= 0) {
                    const lineRects = labelLineRects({
                        cellW,
                        cellH,
                        order,
                        label,
                        content: labelContent,
                        overflow: labelOverflow,
                        minTextSize,
                    });
                    outer: for (const lr of lineRects) {
                        const gx = frame.x + lr.x;
                        const gy = frame.y + lr.y;
                        for (const r of zRects) {
                            if (r.z <= myZ) continue;
                            if (rectsIntersect(gx, gy, lr.w, lr.h, r.x, r.y, r.w, r.h)) {
                                suppressLabel = true;
                                break outer;
                            }
                        }
                    }
                }

                const localPath = buildDebugCellMaskPath({
                    cellW,
                    cellH,
                    order,
                    label,
                    content: labelContent,
                    overflow: labelOverflow,
                    borderPx: uniformBorderPx,
                    minTextSize,
                    suppressLabel,
                });
                const maskedInk = makeColorTile(ink, {
                    mask: {
                        kind: "inline-mask",
                        localPath,
                        bounds: { x: 0, y: 0, width: cellW, height: cellH },
                        // Translucent ink wash over the whole cell (the rect
                        // "fill") beneath the opaque border/labels — lets the
                        // rects read as filled regions when tracing over an
                        // image. 0 (default) keeps the body fully transparent.
                        ...(fillAlpha > 0 ? { matte: fillAlpha } : {}),
                    },
                });

                // Per-cell heat colour (perf heatmap): paint an opaque body in
                // `cellColors[order-1]` BENEATH the masked border/label ink so the
                // label reads on top of the heat colour. A flat two-tile-per-cell
                // push is impossible — the engine binds sources 1:1 with m0 leaves,
                // and alphamerge is single-colour, so one masked tile can't carry a
                // contrasting body + ink. Compose the two colours in a nested child
                // mosaic instead: `F{F}` = body tile (beneath) + masked ink tile
                // (border/label, on top). The child declares its own `size` so the
                // engine renders it at the cell resolution (exact-fit, no stretch)
                // and the inline-mask bounds line up. Absent/empty `cellColors[i]`
                // keeps the original flat single-source path (no golden regression).
                const heatColor = useCellColors ? (cellColors?.[order - 1] ?? "") : "";
                const heatHasLabel = !!(label && label.trim());
                if (heatColor && heatColor.trim() && !heatHasLabel) {
                    // Heat-only cell (colours-only mode — the flattened perf image):
                    // a single flat colour tile with the frame border as a stroke
                    // effect. NO nested child + NO inline-mask, so a ~500-cell
                    // flattened heatmap renders in ONE cheap pass instead of ~500
                    // nested mosaics (which choked the flattened image entirely).
                    sources.push(
                        bindProp(
                            makeColorTile(heatColor as MosaicColor, {
                                effects: {
                                    stroke: { width: borderFrac, color: ink, alpha: 0.5, position: "inner" },
                                },
                            }),
                            "labels",
                            order - 1,
                        ),
                    );
                } else if (heatColor && heatColor.trim()) {
                    // Body colour + label (the top perf image, few big cells): the
                    // two colours can't share one masked tile (alphamerge is
                    // single-colour), so compose them in a nested child `F{F}` =
                    // body tile (beneath) + masked border/label ink (on top). The
                    // child declares its own `size` so it renders at cell resolution
                    // (exact-fit) and the mask bounds line up.
                    const childRef = `heatcell${order}`;
                    childDocs[childRef] = {
                        kind: "mosaic_document",
                        version: 1,
                        assets: {} as MosaicDocument["assets"],
                        m0: "F{F}",
                        size: {
                            width: Math.max(1, Math.round(cellW)),
                            height: Math.max(1, Math.round(cellH)),
                        },
                        sources: [makeColorTile(heatColor as MosaicColor), maskedInk],
                        durationMs: 1000,
                    } as MosaicDocument;
                    sources.push(bindProp({ type: "mosaic", ref: childRef } as MosaicSource, "labels", order - 1));
                } else {
                    sources.push(bindProp(maskedInk, "labels", order - 1));
                }
            }
        }

        // Background resolution, in priority order:
        //   1. an explicit theme/preset backgroundColor, else
        //   2. the `background` prop: "white" (default) bakes an opaque white
        //      fill, "transparent" leaves it unfilled.
        // A transparent wireframe is just lines + labels — it composites over
        // anything and null tiles render *nothing* — but on a dark stage black
        // ink reads as an empty canvas, hence the white default (take 4).
        const background = props.background ?? DEFAULT_BACKGROUND;
        const bg = resolved?.backgroundColor ?? (background === "white" ? "#ffffff" : null);

        // Optional baked background image: register it as a file asset and point
        // the document's `backgroundImage` at it. The engine composites it once,
        // beneath every tile — so the wireframe lines/labels draw on top.
        const assets: MosaicAssetManifest = {};
        let backgroundImage: MosaicBackgroundImage | undefined;
        if (props.backgroundImage) {
            const bgAssetId = asAssetId("wireframe_background_image");
            // Accept either a filesystem path or an inline base64 `data:` URI —
            // the latter keeps the document self-contained (e.g. an agent baking
            // a reference image inline, no external file dependency).
            assets[bgAssetId] = props.backgroundImage.startsWith("data:")
                ? { kind: "data-uri", uri: props.backgroundImage, mediaType: "image" }
                : { kind: "file", path: props.backgroundImage, mediaType: "image" };
            const opacity = props.backgroundImageOpacity;
            backgroundImage = {
                assetId: bgAssetId,
                ...(opacity != null ? { opacity } : {}),
                ...(props.backgroundImageFit ? { fit: props.backgroundImageFit } : {}),
            };
        }

        // Dev diagram: layer explode — one still per overlay depth, as a
        // pipeline (founder: "layers must be emitted as separate files").
        // Falls through to the composite only if the full parse fails.
        if (showNullFrames) {
            // The composite derives its canvas from the PAINTED frames' bounds; a
            // hole on the canvas edge would shrink that (a null right column →
            // 960 wide). The explode paints holes too, so it takes the real canvas.
            const explodeW = ctx.output.width;
            const explodeH = ctx.output.height;
            const exploded = buildLayerExplode({
                m0: M0String,
                canvasW: explodeW,
                canvasH: explodeH,
                fps: ctx.output.fps,
                useThumb,
                resolved,
                labels: effectiveLabels,
                unlabeledCells,
                labelContent,
                labelOverflow,
                borderPx: Math.max(1, Math.round(Math.min(explodeW, explodeH) * borderFrac)),
                minTextSize,
                fillAlpha,
                bg,
                assets,
                backgroundImage,
                nullLabel: props.nullLabel ?? DEFAULT_NULL_LABEL,
            });
            if (exploded) return Promise.resolve(exploded);
        }

        // Paper grid (the `grid-paper` preset / `theme.paperGrid`): ONE extra
        // lattice source appended as a full-canvas TOP overlay leaf so the
        // graph-paper reads over the opaque, rounded thumb tiles. Off → the
        // m0 is the caller's string verbatim (consumers read it back).
        let finalM0 = M0String;
        if (resolved?.paperGrid?.enabled) {
            sources.push(
                makePaperGridSource({
                    width: canvasW,
                    height: canvasH,
                    ink: (resolved.borderColor ?? "#000000") as MosaicColor,
                    stepFrac: resolved.paperGrid.stepFrac,
                    alpha: resolved.paperGrid.alpha,
                }),
            );
            finalM0 = appendTopOverlay(finalM0);
        }

        const doc: MosaicDocument = {
            kind: "mosaic_document",
            version: 1,
            assets: assets as MosaicDocument["assets"],
            m0: toM0String(finalM0, "Wireframe"),
            sources,
            // Gate-26 convention: every rendered doc declares its format. A
            // wireframe is a still, alpha-carrying PNG (the transparent default
            // is the whole point) — the same values outputHints seeds.
            format: { kind: "image", container: "png", pixelFormat: "rgba" },
            // No authored durationMs: the registry stamp owns it (gate 26 —
            // authored doc durations now SURVIVE the stamp, and this 1000
            // was a stale value that had silently relied on being clobbered;
            // keeping it would pin every wireframe video render to 1s).
            ...(Object.keys(childDocs).length ? { children: childDocs } : {}),
            ...(bg != null ? { backgroundColor: solidBackground(bg) } : {}),
            ...(backgroundImage ? { backgroundImage } : {}),
        };

        return Promise.resolve(doc);
    },

};

registerTemplate(WireframeV2);
