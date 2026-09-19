import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/fin/v1 — Weekly Pulse · Fin (closing card)
 * ============================================================================
 *
 * The closing beat: a big centered headline + subhead, a KPI strip of the week's
 * signature numbers (nested @m0saic/alpine/stat-card), and a QR to the full report
 * (nested @m0saic/media/qr/basic) with a caption — over the signature scatter, with a
 * "Built with m0saic" footer. Driven by `pulse.fin`. Aspect-adaptive (desktop 1×4
 * strip, square/mobile 2×2). Deterministic; reduceMotion → static.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
  makeErrorMosaic,
  withLayoutContract,
  type LayoutConstraint,
  } from "@m0saic/template-utils";
import { overlay, paint, type Node } from "../../../../alpine/_shared/alpine-card";
import { classify, text1, capFont, withFade, insetSafe, backdrop, unionRect, pulseTiming, buildFooter, scatterNode, chromeAssets, labelNode, type Rect, type Variant, bindNode, insetSlot } from "../../_shared/pulse-chrome";
import { pulseTheme, type PulsePreset, type PulseTheme } from "../../_shared/pulse-theme";
import { type WeeklyPulse, MOCK_FFMPEG_PULSE, kpiValue, resolvePulse, WEEKLY_PULSE_UPSTREAM_SCHEMA } from "../../_shared/pulse-data";
import { KPI_GLYPHS } from "../../_shared/pulse-glyphs";

type AnimConfig = { introFrac: number; reduceMotion: boolean };
type FinProps = { pulse: WeeklyPulse; headline?: string; subhead?: string; preset?: PulsePreset; renderMode?: "premium" | "light"; anim?: AnimConfig; animate?: boolean; debugLayout?: boolean };

const DEFAULT_PRESET: PulsePreset = "dark";
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.7, reduceMotion: false };

type Grid = { x0: number; y0: number; cols: number; cw: number; ch: number; gx: number; gy: number };
type VariantGeom = { nativeW: number; nativeH: number; margin: number; headline: Rect; subhead: Rect; strip: Grid; qr: Rect; caption: Rect; footer: Rect };
const GEOM: Record<Variant, VariantGeom> = {
  desktop: { nativeW: 1920, nativeH: 1080, margin: 140,
    headline: { x: 160, y: 168, w: 1600, h: 150 }, subhead: { x: 160, y: 338, w: 1600, h: 54 },
    strip: { x0: 348, y0: 452, cols: 4, cw: 288, ch: 240, gx: 24, gy: 0 },
    qr: { x: 870, y: 736, w: 180, h: 180 }, caption: { x: 560, y: 930, w: 800, h: 38 }, footer: { x: 140, y: 1006, w: 640, h: 50 } },
  square: { nativeW: 1080, nativeH: 1080, margin: 110,
    headline: { x: 80, y: 110, w: 920, h: 120 }, subhead: { x: 80, y: 248, w: 920, h: 46 },
    strip: { x0: 120, y0: 344, cols: 2, cw: 400, ch: 180, gx: 40, gy: 22 },
    qr: { x: 450, y: 786, w: 178, h: 178 }, caption: { x: 140, y: 984, w: 800, h: 34 }, footer: { x: 110, y: 1030, w: 540, h: 32 } },
  mobile: { nativeW: 1080, nativeH: 1920, margin: 80,
    headline: { x: 60, y: 230, w: 960, h: 150 }, subhead: { x: 60, y: 404, w: 960, h: 54 },
    strip: { x0: 80, y0: 540, cols: 2, cw: 448, ch: 300, gx: 24, gy: 24 },
    qr: { x: 400, y: 1300, w: 280, h: 280 }, caption: { x: 100, y: 1606, w: 880, h: 46 }, footer: { x: 80, y: 1800, w: 640, h: 56 } },
};

const STRIP_GLYPH: Record<string, string> = { commits: "commits", contributors: "contributors", filesChanged: "additions", additions: "additions", deletions: "deletions", stars: "stars", mergedPrs: "mergedPrs", pullRequests: "pullRequests" };

const propsSchema = definePropsSchema<FinProps>({
  pulse: { type: "group" as any, required: false, description: "Weekly Pulse data sheet (fin drives the headline, KPI strip + QR).", meta: { ui: { label: "Pulse data", order: 1, consumer: "agent" } } },
  headline: { type: "string", required: false, description: "Closing headline.", meta: { control: { placeholder: "THANK YOU!" }, ui: { label: "Headline", order: 1 } } },
  subhead: { type: "string", required: false, description: "Closing subhead.", meta: { ui: { label: "Subhead", order: 2 } } },
  preset: { type: "string", required: false, description: "Pulse theme variant.", meta: { constraints: { oneOf: ["dark"] }, ui: { label: "Preset", order: 10 } } },
  renderMode: { type: "string", required: false, description: "Render weight for this beat's nested cards. \"premium\" (default): alpha-fade reveals — the softer look; the engine's enable-gating makes the per-pixel geq nearly free. \"light\": geq-free enable-gate pops — cheapest, most composable when nested many-deep. Set by the runner.", meta: { constraints: { oneOf: ["light", "premium"] }, ui: { label: "Render mode", order: 11 } } },
  anim: { type: "group" as any, required: false, description: "Intro: introFrac, reduceMotion.", meta: { ui: { label: "Animation", collapsedByDefault: true, consumer: "agent" } } },
  animate: { type: "boolean", required: false, description: "Animate the closing intro.", meta: { ui: { label: "Animate", consumer: "human", order: 1 }, control: { syncsTo: [{ prop: "anim.reduceMotion", map: { kind: "boolInvert" } }] } } },
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract: assert the centered content panel + the footer hold their canvas-fraction zones at any resolution/aspect; on violation render a LAYOUT_CONTRACT error mosaic + stamp editor.layoutContract. Default false; production never sets it. Swept by audit:layout-envelope.", meta: { ui: { label: "Debug layout", order: 20, collapsedByDefault: true } } },
});

export const FfmpegPulseFin: MosaicTemplate<FinProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/fin/v1"),
  label: "Weekly Pulse · Fin",
  version: 1,
  description: "FFmpeg Weekly Pulse — Fin (closing card). Centered headline + subhead, a KPI strip of the week's signature numbers, and a QR to the full report, over the signature scatter. Aspect-adaptive.",
  capabilities: { tier: "core" },
  internal: true,
  tags: ["hero", "ffmpeg-pulse", "fin", "beat"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 6000 },
  upstreamDataSchema: WEEKLY_PULSE_UPSTREAM_SCHEMA,
  propsSchema,

  defaultProps: {
    debugLayout: false,
    pulse: MOCK_FFMPEG_PULSE,
    headline: "THANK YOU!",
    subhead: "ANOTHER WEEK OF PROGRESS.",
    preset: DEFAULT_PRESET,
    renderMode: "premium",
    anim: DEFAULT_ANIM,
  },

  async render(props: FinProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const theme: PulseTheme = pulseTheme(props.preset ?? DEFAULT_PRESET);
    const pulse = resolvePulse(props.pulse, ctx);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const reduceMotion = anim.reduceMotion;
    const renderMode: "premium" | "light" = props.renderMode === "light" ? "light" : "premium";
    const durationMs = ctx.target.durationMs ?? 6000;
    const fin = pulse.fin;
    if (!fin) return makeErrorMosaic("fin: pulse has no fin", { title: `${this.id}`, width: W, height: H });

    const variant = classify(W, H);
    const gm = GEOM[variant];
    const sx = W / gm.nativeW, sy = H / gm.nativeH;
    const scale = (r: Rect): Rect => ({ x: Math.round(r.x * sx), y: Math.round(r.y * sy), w: Math.round(r.w * sx), h: Math.round(r.h * sy) });

    const strip = (fin.kpiStrip ?? []).slice(0, 4);
    const rg = gm.strip;
    const stripCells: Rect[] = strip.map((_, i) => {
      const row = Math.floor(i / rg.cols), col = i % rg.cols;
      return scale({ x: rg.x0 + col * (rg.cw + rg.gx), y: rg.y0 + row * (rg.ch + rg.gy), w: rg.cw, h: rg.ch });
    });
    // Every card renders at the CELL its inset will produce, nudged 5-smooth
    // (insetSlot, pulse-chrome): exact fit, no inherited rough factor.
    const stripSlots = stripCells.map((r) => insetSlot(r, W, H));
    stripCells.forEach((_, i) => { stripCells[i] = stripSlots[i].rect; });
    const qrR = scale(gm.qr);

    // ── Nested: KPI strip cards + QR ──
    const introMs = reduceMotion ? 0 : Math.max(500, Math.round(durationMs * anim.introFrac));
    const stripChildren: MosaicRenderableFile[] = await Promise.all(
      strip.map((k, i) =>
        renderNestedTemplate(
          "@m0saic/alpine/stat-card/v1",
          {
            label: k.label, value: kpiValue(k), delta: "", direction: "flat", sublabel: k.sublabel ?? "",
            accent: theme.primaryBright, iconPath: STRIP_GLYPH[k.key] ? KPI_GLYPHS[STRIP_GLYPH[k.key]] : undefined,
            renderMode, // runner-controlled render weight (light = geq-free; premium = alpha-fade)
            preset: "dark", // hero keeps its dark KPI look (stat-card now light by default)
            backgroundColor: theme.card,
            anim: { countUp: !reduceMotion, fade: false, introMs, reduceMotion },
          } as never,
          ctx,
          { slot: { width: stripSlots[i].slot.width, height: stripSlots[i].slot.height, durationMs } },
        ),
      ),
    );
    // Premium QR is BAKED (chromeAssets.qrFin → qr-fin.mp4): green QR Code with the
    // FFmpeg logo carved in + pixelate assemble, pre-rendered to a flat video. Baking
    // keeps fin cheap — no live per-module tile generation — and the assemble is a
    // one-shot anyway. Re-bake via tools/bake-fin-qr.sh if the URL/logo/color changes.

    // ── Timing ──
    const t = pulseTiming(durationMs, reduceMotion);
    const { bgFinishT, chromeFadeDur, cardStagger, cardsStart, animOn } = t;

    const children: Record<string, MosaicRenderableFile> = {};
    const stripNodes: Node[] = stripChildren.map((c, i) => {
      const ref = `kpi${i}`;
      children[ref] = c;
      return insetSafe(withFade(paint({ type: "mosaic", ref } as unknown as MosaicSource), cardsStart + i * cardStagger, cardStagger, animOn), stripCells[i], W, H);
    });
    // Baked QR (media asset), placed at the QR rect.
    const qrNode = insetSafe(withFade(paint({ type: "media", mediaType: "video", assetId: "qrFin", placement: { fit: "contain" } } as unknown as MosaicSource), cardsStart + strip.length * cardStagger, chromeFadeDur, animOn), qrR, W, H);

    // ── Headline / subhead / caption / footer ──
    const headR = scale(gm.headline), subR = scale(gm.subhead), capR = scale(gm.caption), footR = scale(gm.footer);
    const headline = props.headline ?? fin.headline ?? "THANK YOU!";
    const subhead = props.subhead ?? fin.subhead ?? "";
    const headNode = bindNode(insetSafe(withFade(paint(text1(headline, capFont(headR.h * 0.86, headline, headR.w, 24, 0.6), theme.primaryBright, "center")), bgFinishT, chromeFadeDur, animOn), headR, W, H), "headline");
    const subNode = bindNode(insetSafe(withFade(paint(text1(subhead, capFont(subR.h * 0.78, subhead, subR.w, 12, 0.5), theme.subtitle, "center")), bgFinishT + chromeFadeDur * 0.4, chromeFadeDur, animOn), subR, W, H), "subhead");
    const capText = fin.qr?.caption ?? "";
    const capNode = insetSafe(withFade(paint(text1(capText, capFont(capR.h * 0.7, capText, capR.w, 10, 0.5), theme.label, "center")), cardsStart + (strip.length + 1) * cardStagger, chromeFadeDur, animOn), capR, W, H);
    const footNode = buildFooter(footR, theme, fin.footer ?? "Built with m0saic", t, W, H);
    // Subtle m0saic attribution bottom-right (visible, not overbearing — FFmpeg is the subject).
    const wmW = Math.round(240 * sx);
    const wmR = { x: Math.max(0, W - Math.round(gm.margin * sx) - wmW), y: footR.y, w: wmW, h: footR.h };
    const wmNode = insetSafe(withFade(paint(text1("m0saic.io", capFont(wmR.h * 0.5, "m0saic.io", wmR.w, 11, 0.5), theme.label, "right")), bgFinishT, chromeFadeDur, animOn), wmR, W, H);

    // ── Backdrop behind the centered content (headline + strip) for legibility ──
    const pad = Math.round(Math.min(W, H) * 0.02);
    const stripBbox = unionRect(stripCells, 0, W, H);
    const contentBbox = unionRect([headR, subR, stripBbox, qrR, capR], pad, W, H);
    const bg = labelNode(backdrop(theme.card, contentBbox, W, H, bgFinishT, chromeFadeDur, animOn), "content-panel");

    const root = overlay([scatterNode(), bg, ...stripNodes, qrNode, headNode, subNode, capNode, footNode, wmNode]);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: { ...chromeAssets(variant) } as any,
      m0: root.m0 as any,
      sources: root.sources,
      children,
      backgroundColor: theme.canvas,
      fps: ctx.target.fps,
      durationMs,
      size: { width: W, height: H },
    } as MosaicDocument;

    // Layout contract (dev tripwire; flatten:false → judge only fin's own top-level
    // content panel + footer, not the nested KPI cards). Fin has no header cluster.
    const constraints: LayoutConstraint[] = [
      { label: "content-panel", within: { yFrac: [0.04, 0.98] } },
      { label: "footer", within: { yFrac: [0.84, 1.0] } },
    ];
    return withLayoutContract(doc, ctx, { templateId: "@m0saic/hero/ffmpeg-pulse/fin/v1", constraints, flatten: false, debug: props.debugLayout === true });
  },
};

registerTemplate(FfmpegPulseFin);
