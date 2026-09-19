import { asTemplateId } from "@m0saic/types";
import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource, MosaicTemplate } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { definePropsSchema, registerTemplate, makeErrorMosaic } from "@m0saic/template-utils";
import type { LogoProps } from "./logo";

// Import your v2 builders (or copy minimal internal helpers into this file).
// If TheMosaicMV2 is in another file, import it and call its render() twice.
import { TheMosaicMV3Base } from "./logo"; // <-- adjust path/name
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  onboardingFrame,
  onboardingOverlay,
  onboardingSolid,
  onboardingSplit,
} from "../../../_shared/onboarding-cover";

const HERO_ORANGE = "#f97316";


type LogoRunnerProps = {
    color?: MosaicColor;

    /**
     * Which dictionary entry to use.
     * - undefined / "composite": bitmap+rects composite (default runner behavior)
     * - "m-33": standalone m-33 entry with masks
     * - "64" / "256" / "rects": standalone single-layer
     */
    size?: "m-33" | "m0" | "m0saic-pattern" | "m-33_bitmap" | "composite";

    /**
     * Drives what each child uses.
     * Start simple: just support loading_ui_v2 since that’s your current default.
     */
    animation?: "loading_ui_v2" | "logo_loop" | "progress_fill" | "loading_shimmer";

    // Global blend: rects fade in over bitmap
    blendInSec?: number; // e.g. 0.8
    blendDelaySec?: number; // e.g. 0.15
    blendFeather?: number; // tiny bias to avoid 0-alpha at t=0 if you want

    // forward common knobs to children
    feather?: number;
    shimmerSec?: number;
    shimmerWidth?: number;

    // progress_fill
    progress?: number;
    progressSec?: number;
    oneShot?: boolean;

    /** Reveal order for m0 / m-33 / m0saic-pattern: diag (default) /
     *  cascade (top-down rows) / radial (center-out). Forwarded to the base. */
    rankSet?: "diag" | "cascade" | "radial";

    // logo_loop
    loopSec?: number;
    inEnd?: number;
    outStart?: number;
    startDelay?: number;
    endDelay?: number;
    easing?: "linear" | "smoothstep";
};

const propsSchema = definePropsSchema<LogoRunnerProps>({
    color: {
        type: "string",
        required: false,
        meta: { ui: { label: "Color" }, constraints: { isColor: true }, control: { colorPicker: true, placeholder: HERO_ORANGE } },
    },
    size: {
        type: "string",
        required: false,
        description:
            "m-33 (default): the fast rect M at its official 544² canvas. " +
            "composite: m-33_bitmap base + rect M overlaid with an animated blend — the HEAVY render (minutes, not seconds). " +
            "Also: m0 (logotype, 384×512), m0saic-pattern (4354×2016), m-33_bitmap.",
        meta: { ui: { label: "Brand entry" }, constraints: { oneOf: ["composite", "m-33", "m0", "m0saic-pattern", "m-33_bitmap"] } },
    },
    animation: {
        type: "string",
        required: false,
        meta: { ui: { label: "Animation" }, constraints: { oneOf: ["loading_ui_v2", "logo_loop", "progress_fill", "loading_shimmer"] } },
    },

    blendInSec: { type: "number", required: false, meta: { ui: { label: "Blend-in (s)" }, constraints: { min: 0.01, max: 10 } } },
    blendDelaySec: { type: "number", required: false, meta: { ui: { label: "Blend delay (s)" }, constraints: { min: 0, max: 10 } } },
    blendFeather: { type: "number", required: false, meta: { ui: { label: "Blend feather" }, constraints: { min: 0, max: 0.1 } } },

    feather: { type: "number", required: false, meta: { ui: { label: "Feather" }, constraints: { min: 0, max: 0.2 } } },
    shimmerSec: { type: "number", required: false, meta: { ui: { label: "Shimmer sweep (s)" }, constraints: { min: 0.1, max: 60 } } },
    shimmerWidth: { type: "number", required: false, meta: { ui: { label: "Shimmer width" }, constraints: { min: 0.01, max: 1 } } },

    progress: { type: "number", required: false, meta: { ui: { label: "Progress" }, control: { placeholder: "auto (animated)" }, constraints: { min: 0, max: 1 } } },
    progressSec: { type: "number", required: false, meta: { ui: { label: "Progress duration (s)" }, constraints: { min: 0.1, max: 60 } } },
    oneShot: { type: "boolean", required: false , meta: { ui: { label: "Play once" } } },

    rankSet: {
        type: "string",
        required: false,
        description: "Reveal order over the mark's tiles: diag (top-left → bottom-right), cascade (row-by-row), radial (center → edges).",
        meta: { constraints: { oneOf: ["diag", "cascade", "radial"] }, ui: { label: "Reveal order" } },
    },
    loopSec: { type: "number", required: false, meta: { ui: { label: "Loop length (s)" }, constraints: { min: 0.1, max: 60 } } },
    inEnd: { type: "number", required: false, meta: { ui: { label: "Reveal-in end" }, constraints: { min: 0.0001, max: 1 } } },
    outStart: { type: "number", required: false, meta: { ui: { label: "Reveal-out start" }, constraints: { min: 0, max: 0.9999 } } },
    startDelay: { type: "number", required: false, meta: { ui: { label: "Start hold" }, constraints: { min: 0, max: 0.9 } } },
    endDelay: { type: "number", required: false, meta: { ui: { label: "End hold" }, constraints: { min: 0, max: 0.9 } } },
    easing: { type: "string", required: false, meta: { ui: { label: "Easing" }, constraints: { oneOf: ["linear", "smoothstep"] } } },
});

function buildRectFadeAlphaExpr(opts: {
    fps: number;
    delaySec: number;   // time at 0 before fade starts (each loop)
    inSec: number;      // time to go 0->1 (half-cycle)
    feather: number;
}): string {
    const { fps, delaySec, inSec, feather } = opts;

    const startGate = `gte(t,1/${fps})`;

    // period = delay + up + down  (down == up for symmetry)
    const period = `(${delaySec}+2*${inSec})`;
    const p = `mod(t,${period})`; // [0..period)

    // u ramps 0->1 over inSec, then 1->0 over inSec, after delay
    // uRaw:
    //   0                           if p < delay
    //   (p-delay)/inSec             if delay <= p < delay+inSec
    //   1 - (p-(delay+inSec))/inSec if delay+inSec <= p < delay+2*inSec
    const uUp = `((${p}-${delaySec})/${inSec})`;
    const uDown = `(1-((${p}-(${delaySec}+${inSec}))/${inSec}))`;
    const u = `if(lt(${p},${delaySec}),0, if(lt(${p},${delaySec}+${inSec}), ${uUp}, ${uDown}))`;

    // clamp then smoothstep
    const a = `min(max(${u},0),1)`;
    const s = `(${a})*(${a})*(3-2*(${a}))`;

    // remap to a stable breathing range (rects never fully disappear)
    // feels better for loading UI than full 0↔1 swapping
    const minA = 0.35;
    const maxA = 0.85;
    const remapped = `(${minA}) + (${maxA}-${minA})*(${s})`;

    const out = `max(min((${remapped})+${feather},1),0)`;
    return `${startGate}*(${out})`;
}



export const TheMosaicMV3: MosaicTemplate<LogoRunnerProps> = {
    id: asTemplateId("@m0saic/brand/logo/v3"),
    label: "M0saic Brand Marks",
    version: 3,
    // BITMAP drafting mode (handbook §3c): the split counts ARE the canonical M bitmap —
    // never live-composed, so the latticeSmooth convention does not apply.
    lattice: { mode: "bitmap" },
    description:
      "Renders any m0saic brand mark — the M (as rects or bitmap), the m0 logotype, or the m0saic pattern — with an animated reveal, each at its official dictionary resolution. Default 'm-33' is the fast rect M; 'composite' (bitmap + rects blend) is the deliberate heavy render. Supersedes the v1/v2 M-logo templates.",
    capabilities: { tier: "core" },
    tags: ["brand", "logo", "marks", "animated"],
    outputHints: { format: { kind: "video", container: "mp4" }, fps: 30, durationMs: 3200, width: 1080, height: 1080 },
    propsSchema,
    defaultProps: {
        rankSet: "diag",
        color: HERO_ORANGE,
        size: "m-33",
        animation: "loading_ui_v2",

        blendDelaySec: 0.15,
        blendInSec: 1.2,
        blendFeather: 0.0,

        // forward defaults similar to v2
        feather: 0.02,
        shimmerSec: 1.2,
        shimmerWidth: 0.18,

        progressSec: 2.0,
        oneShot: false,

        loopSec: 3.2,
        inEnd: 0.25,
        outStart: 0.75,
        startDelay: 0.1,
        endDelay: 0.2,
        easing: "smoothstep",
    },

    async render(props: LogoRunnerProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
        const finalColor = props.color ?? this.defaultProps!.color!;
        const anim = props.animation ?? this.defaultProps!.animation!;
        // Default m-33 (founder ruling, gate 28): the fast rect mark — near-
        // identical look to the composite in seconds, not the 10–30min
        // bitmap render. `composite` is the deliberate opt-in.
        const size = props.size ?? "m-33";

        // Direct passthrough for standalone sizes (no composite). The base
        // authors the doc's `size` at the mark's dictionary-locked official
        // resolution — hosts render at it by default (gate-28 canvas law);
        // explicit user dims always win.
        if (size === "m-33" || size === "m0" || size === "m0saic-pattern" || size === "m-33_bitmap") {
            return TheMosaicMV3Base.render(
                { ...props, color: finalColor, size, animation: anim },
                ctx
            ) as Promise<MosaicDocument>;
        }

        // Blend controls
        const blendDelaySec = props.blendDelaySec ?? this.defaultProps!.blendDelaySec!;
        const blendInSec = props.blendInSec ?? this.defaultProps!.blendInSec!;
        const blendFeather = props.blendFeather ?? this.defaultProps!.blendFeather!;

        if (!(blendInSec > 0)) {
            return makeErrorMosaic(`blendInSec must be > 0 (got ${blendInSec})`, {
                title: `${this.id} props`,
                width: ctx.output.width,
                height: ctx.output.height,
            });
        }

        const bitmapDocProps: LogoProps = {
            ...props,
            color: finalColor,
            size: "m-33_bitmap",
            animation: anim,
        }

        // Build child docs by delegating to the base template twice.
        // Bitmap child: the 272x272 m-33_bitmap entry (substantially more
        // frames than the rect entries — this drives the heavy composite).
        const bitmapDoc = await TheMosaicMV3Base.render(
            bitmapDocProps,
            ctx
        );

        const rectsDocProps: LogoProps = {
            ...props,
            color: finalColor,
            size: "m-33",
            animation: anim,
        }
        // Rects child: m-33's 33 rect frames (with cutout masks) overlaid
        // on top of the bitmap base.
        const rectsDoc = await TheMosaicMV3Base.render(
            rectsDocProps,
            ctx
        );

        const rectsAlpha = buildRectFadeAlphaExpr({
            fps: ctx.output.fps,
            delaySec: blendDelaySec,
            inSec: blendInSec,
            feather: blendFeather,
        });

        // Runner: base is bitmap, overlay is rects
        const doc: MosaicDocument = {
            kind: "mosaic_document",
            version: 1,
            assets: {} as MosaicDocument["assets"],
            m0: toM0String("F{F}", "LogoRunner"),
            children: {
                bitmap: bitmapDoc,
                rects: rectsDoc,
            },
            sources: [
                    { type: "mosaic", ref: "bitmap" },
                    { type: "mosaic", ref: "rects", overlay: { alpha: rectsAlpha } },
                ],
            // Official canvas (founder ruling, gate 28): the composite IS the
            // M — it renders at the m-33 mark's dictionary-locked resolution
            // (the children declare the same size; child-declare-size law).
            size: bitmapDoc.size ?? rectsDoc.size,
            // Output conventions (gate 28): animated brand loop = VIDEO, no
            // soundtrack (without the flag the plan muxes anullsrc silence).
            format: { kind: "video", container: "mp4" },
            audio: { mode: "off" },
        };

        return doc;
    },

    // Editor-only first-open cover — the mosaic-branding BAND. Frame 0 of
    // every animation mode is gated to alpha 0 (`gte(t,1/fps)` start gate),
    // so the default open is a black square; the hero is the STATIC rect M
    // (the base's __static path — full-alpha tiles with cutout masks),
    // rendered SQUARE at the hero box's short side and centered with real
    // pads (the mark's m0 is canvas-aspect — inlining it un-padded onto the
    // wide band hero would stretch the M; the retired glyph-aspect class).
    async renderCover(
        _props: LogoRunnerProps,
        ctx: MosaicEngineContext,
    ): Promise<MosaicDocument> {
        const heroBox = brandedCoverHeroBox(ctx, "band");
        const side = Math.max(2, Math.round(Math.min(heroBox.width, heroBox.height) * 0.86));
        const sq = { width: side, height: side, fps: ctx.target.fps, durationMs: ctx.target.durationMs };
        const staticM = (await TheMosaicMV3Base.render(
            { color: HERO_ORANGE, size: "m-33", __static: true } as LogoProps,
            { ...ctx, target: sq, output: { ...ctx.output, width: side, height: side } } as MosaicEngineContext,
        )) as MosaicDocument;
        const mark = { m0: String(staticM.m0), sources: (staticM.sources ?? []) as MosaicSource[] };
        // px/4 weights (the logo-animate lesson): raw px weights expand the
        // split into per-unit slots — /4 keeps the lattice small at ≤4px
        // centering error.
        const u = (px: number) => Math.max(1, Math.round(px / 4));
        const padW = Math.max(1, Math.round((heroBox.width - side) / 2));
        const padH = Math.max(1, Math.round((heroBox.height - side) / 2));
        const centered = onboardingSplit(
            "row",
            [u(padH), u(side), u(padH)],
            [null, onboardingSplit("col", [u(padW), u(side), u(padW)], [null, mark, null]), null],
        );
        return buildBrandedCover({
            ctx,
            variant: "band",
            copy: { productName: "Brand Marks", title: "The m0saic brand marks." },
            hero: (theme) =>
                onboardingFrame(
                    onboardingOverlay(onboardingSolid("#12111F" as MosaicColor), centered),
                    theme.borderStrong,
                ),
        });
    },
};

registerTemplate(TheMosaicMV3);
