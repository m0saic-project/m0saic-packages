/**
 * ============================================================================
 * @m0saic/meta/camera-debug/v1 — see what the camera does
 * ============================================================================
 *
 * Renders any m0 layout as gray boxes and draws the CAMERA's crop viewport
 * over it as a red rectangle, so authors can debug camera behavior without
 * rendering real content.
 *
 * THE input is the `camera` prop ({@link CameraDebugCamera}) — the rolled-up
 * value a template attaches to `effects.camera`, with each field a number, a
 * t-expression pasted verbatim, or declarative KEYFRAMES `[{t, v, ease?}]`
 * (compiled via `keyframeExpr` — the `t`s you assign ARE the settle moments;
 * eased between them, held outside them). Paste the camera your template
 * computed, put your layout skeleton behind it, and the render simulates
 * what your final output's camera will do — math verification, no content.
 * CLI debug flow: `m0saic make @m0saic/meta/camera-debug/v1
 * --props '{"M0String":"…","camera":{…}}'` (pin --durationMs to the length
 * the camera was compiled for). Rendering:
 *   - numbers/keyframes (the normal case): the FILMSTRIP — one gated-drawbox
 *     track of ring rects sampled at the output fps (midpoint-sampled,
 *     holds merged, rate degraded uniformly past the argv budget). ONLY the
 *     red rect, exactly where the camera is, panning AND resizing — no
 *     per-frame scaling, no geq. Frame-exact: the output is fps-quantized
 *     anyway, so the strip equals the compiled expressions at render time.
 *   - a pasted t-EXPRESSION focus with constant zoom: a closed ring panned
 *     by the expression itself (overlay offsets).
 *   - a pasted t-EXPRESSION zoom (animated): the one unsampleable case —
 *     falls back to four full-length guide lines whose central intersection
 *     is the viewport. Prefer keyframes to get the closed rect.
 *
 * When no `camera` is given, the follow-walk RECIPE builds one (UI-helper
 * model: knobs drive motion-kit function invocation): walk the leaves via
 * `computeTimeline` → `followCamera`, zoom from the prop or
 * `autoZoomForLegibility`. Recipe-only modes:
 *   - `smooth` (default): ONE red ring pans along the true eased camera path
 *     (`overlay.xExpr/yExpr` = the followCamera focus exprs × the pixel
 *     travel). The ring's size is the constant-zoom viewport, so it is gated
 *     OFF when the pull-back starts (an animated-zoom ring would need
 *     per-frame scaling — R10's expensive path, not worth it for a debugger).
 *   - `snap`: one enable-gated ring per settle window (a gatedBoxTrackSource)
 *     — shows WHERE the camera settles and WHEN, discrete and readable.
 *
 * In both recipe modes a full-frame ring appears when the pull-back's full
 * view ARRIVES (`resolvePullBackEnvelope().zoomEndSec`) and holds to the end;
 * the gap between the walking ring vanishing and the full-frame ring
 * appearing IS the pull-back transit. When the camera never moves (zoom ≤ 1,
 * e.g. auto-zoom on an already-legible layout), the full-frame ring is
 * static from t=0 — an honest "the camera does nothing here".
 *
 * Timeline: one step per leaf in logical order via `computeTimeline`
 * (duration-fit: a pinned render length rescales the walk uniformly, per
 * `resolvePinnedDurationMs`). Note the recipe walks LEAVES — it does not
 * model dsl-tutorial's passthrough-following walk semantics.
 * ============================================================================
 */

import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import type { M0String } from "@m0saic/dsl";
import { parseM0StringComplete } from "@m0saic/dsl";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  buildOverlayStack,
  computeTimeline,
  resolvePinnedDurationMs,
  autoZoomForLegibility,
  centerFocus,
  resolvePullBackEnvelope,
  cameraViewportRect,
  gatedBoxTrackSource,
  maskAtlasSource,
  roundedRectPathD,
  rebalanceAdditiveChains,
  keyframeExpr,
  GATED_BOX_BUDGET,
  MASK_SUBPATH_BUDGET,
  type CameraTarget,
  type FollowCameraPullBack,
  type GatedBox,
  type Keyframe,
} from "@m0saic/template-utils";

/**
 * The camera to verify. A superset of the engine's `MosaicCamera`: each
 * field is a number (static), a t-expression string (paste a computed
 * camera verbatim), or — the friendly authoring form — DECLARATIVE
 * KEYFRAMES `[{t, v, ease?}]` compiled with `keyframeExpr`. The `t`s you
 * write ARE the settle moments; between them the value eases (default
 * smoothstep), before/after them it holds.
 */
export type CameraDebugCamera = {
  /** Magnification. 1 = full frame; keyframes with varying values = an
   *  animated zoom (renders as guide lines). */
  zoom?: number | string | Keyframe[];
  /** Horizontal crop center, 0..1 (0 = left edge, 0.5 = centered). */
  focusX?: number | string | Keyframe[];
  /** Vertical crop center, 0..1. */
  focusY?: number | string | Keyframe[];
};

export type CameraDebugProps = {
  /** The layout to debug the camera over. */
  M0String: M0String;
  /**
   * RAW camera to verify (see {@link CameraDebugCamera} — every real
   * `MosaicCamera` is valid here verbatim). When set, it WINS: the
   * walk-recipe knobs below are ignored and the render simulates exactly
   * this camera over the layout skeleton.
   */
  camera?: CameraDebugCamera;
  /** Walk speed (>1 = faster). Same semantics as dsl-tutorial. Default 1. */
  speedMultiplier?: number;
  /**
   * Camera zoom for the walk recipe. Omit → AUTO (legibility-driven,
   * `autoZoomForLegibility`); 1 forces full view (static camera); >1 forces.
   */
  zoom?: number;
  /** `smooth` = eased panning ring (the real camera path); `snap` = one ring
   *  per settle window. Default `smooth`. Walk recipe only. */
  mode?: "smooth" | "snap";
};

const BG_COLOR = "#0E1220";
const TILE_COLOR = "#2A3140";
const TILE_BORDER_COLOR = "#4E5B76";
const VIEWPORT_COLOR = "#FF3B30";

const propsSchema = definePropsSchema<CameraDebugProps>({
  M0String: {
    type: "m0",
    required: true,
    description: "The layout to debug the camera over.",
    meta: {
      control: { placeholder: 'e.g. "2(2[1,1],2[1,1])"' },
      ui: { label: "Layout (m0 string)" },
    },
  },
  camera: {
    type: "json",
    required: false,
    description:
      'Raw camera to verify ({zoom, focusX, focusY}) — each field a number, a t-expression, or keyframes [{t, v, ease?}] (eased between the moments you assign; holds outside them). Wins over the walk-recipe knobs. Example: {"zoom":2,"focusX":[{"t":1,"v":0},{"t":2,"v":1}],"focusY":0.5} pans left→right across 1s..2s.',
    meta: { ui: { label: "Raw camera", collapsedByDefault: true } },
  },
  speedMultiplier: {
    type: "number",
    required: false,
    description: "Walk speed multiplier (>1 = faster).",
    meta: {
      constraints: { min: 0.1, max: 8 },
      control: { flavor: "slider", step: 0.1 },
      ui: { label: "Speed" },
    },
  },
  zoom: {
    type: "number",
    required: false,
    description: "Camera zoom. Omit = auto (legibility-driven); 1 = fixed full view.",
    meta: {
      constraints: { min: 1, max: 8 },
      control: { placeholder: "from camera", flavor: "slider", step: 0.25 },
      ui: { label: "Zoom" },
    },
  },
  mode: {
    type: "string",
    required: false,
    description: "Viewport visualization: smooth eased pan, or snap-per-settle rings.",
    meta: {
      constraints: { oneOf: ["smooth", "snap"] },
      control: {
        options: [
          { value: "smooth", label: "Smooth pan" },
          { value: "snap", label: "Snap rings" },
        ],
      },
      ui: { label: "Mode" },
    },
  },
});

export const CameraDebug: MosaicTemplate<CameraDebugProps> = {
  id: asTemplateId("@m0saic/meta/camera-debug/v1"),
  label: "Camera Debugger",
  version: 1,
  description:
    "Gray-box wireframe of any layout with the camera's crop viewport drawn as a red rectangle — debug follow-camera motion without rendering real content.",
  capabilities: { tier: "core" },
  // Dev/debug tool — keep off the shelves.
  internal: true,
  tags: ["developer", "meta", "camera", "debug"],
  outputHints: {
    width: 1280,
    height: 720,
    fps: 30,
    durationMs: 5000,
    note: "Camera viewport visualized over a gray-box layout walk.",
  },
  propsSchema,
  defaultProps: {
    mode: "smooth",
    speedMultiplier: 1,
    M0String: "2(2[1,1],2[1,1])" as M0String,
    // Default demo: a four-corner X tour (TL → BR → BL → TR) at zoom 2 —
    // the rect visibly pans corner to corner then holds. Clear the Raw
    // camera field to fall back to the walk recipe (auto zoom).
    camera: {
      zoom: 2,
      focusX: [
        { t: 0.5, v: 0 },
        { t: 1.5, v: 1 },
        { t: 2.5, v: 0 },
        { t: 3.5, v: 1 },
      ],
      focusY: [
        { t: 0.5, v: 0 },
        { t: 1.5, v: 1 },
        { t: 2.5, v: 1 },
        { t: 3.5, v: 0 },
      ],
    },
  },

  render(props: CameraDebugProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = ctx.target.width;
    const H = ctx.target.height;
    const m0 = String(props.M0String);

    const parsed = parseM0StringComplete(m0, W, H);
    if (!parsed.ok) {
      throw new Error(`camera-debug: m0 parse failed — ${parsed.error?.message ?? "unknown"}`);
    }
    const rects = parsed.ir.renderFrames.slice().sort((a, b) => a.logicalIndex - b.logicalIndex);

    const timeline = computeTimeline({
      stepCount: rects.length,
      speedMultiplier: props.speedMultiplier ?? 1,
      targetDurationMs: resolvePinnedDurationMs(ctx),
    });
    const endSec = timeline.durationMs / 1000;
    const settle = (i: number) => timeline.stepStartSec(i) + timeline.stepDurSec / 2;

    const zoom =
      props.zoom != null
        ? props.zoom
        : autoZoomForLegibility(
            rects.map((r) => ({ width: r.width, height: r.height })),
            W,
            H,
            W,
            H,
          );

    const ringT = Math.max(2, Math.round(Math.min(W, H) * 0.005));
    const sources: MosaicSource[] = [];

    // ── Gray tiles with DISTINCT BORDERS, still O(1) sources at any tile
    // count (the dsl-canvas two-atlas idiom): a border-colored silhouette
    // underneath + the fill silhouette inset by a hairline (radius reduced
    // to stay concentric), so the underlayer reads as an inner stroke and
    // the geometry outline is visible. Combined subpaths across both
    // atlases ride ONE resolver arg → borders drop first past budget, then
    // the masked fill degrades to a flat fill. ──
    const N = rects.length;
    const drawBorders = N > 0 && 2 * N <= MASK_SUBPATH_BUDGET;
    const drawTiles = N > 0 && N <= MASK_SUBPATH_BUDGET;
    const tileRadius = (w: number, h: number) => Math.max(0, Math.floor(Math.min(w, h) * 0.04));
    if (drawTiles) {
      if (drawBorders) {
        const borderPaths = rects.map((r) => {
          const w = Math.round(r.width);
          const h = Math.round(r.height);
          if (w <= 0 || h <= 0) return "";
          return roundedRectPathD(Math.round(r.x), Math.round(r.y), w, h, tileRadius(w, h));
        });
        sources.push(maskAtlasSource(borderPaths, TILE_BORDER_COLOR, { width: W, height: H }));
      }
      const fillPaths = rects.map((r) => {
        const iw = Math.round(r.width);
        const ih = Math.round(r.height);
        if (iw <= 0 || ih <= 0) return "";
        const outerR = tileRadius(iw, ih);
        const bw = drawBorders ? Math.max(1, Math.floor(0.004 * Math.min(iw, ih))) : 0;
        const w = iw - 2 * bw;
        const h = ih - 2 * bw;
        if (w <= 0 || h <= 0) return "";
        const r2 = drawBorders ? Math.max(outerR - bw, 0) : outerR;
        return roundedRectPathD(Math.round(r.x) + bw, Math.round(r.y) + bw, w, h, r2);
      });
      sources.push(maskAtlasSource(fillPaths, TILE_COLOR, { width: W, height: H }));
    } else if (N > 0) {
      sources.push(makeColorTile(TILE_COLOR));
    }

    // Normalize a camera field (number | expr | keyframes | absent) to ONE
    // expr string. Keyframes are the friendly form: the template compiles
    // them with keyframeExpr (the .m0t-shaped declarative input).
    const fieldExpr = (v: number | string | Keyframe[] | undefined, fallback: string): string =>
      Array.isArray(v)
        ? v.length > 0
          ? keyframeExpr(v)
          : fallback
        : v == null
          ? fallback
          : typeof v === "number"
            ? v.toFixed(5)
            : String(v);

    // Keyframed zoom that never changes value is CONSTANT (→ the closed
    // ring); varying values compile to an animated-zoom expr (→ guides).
    const zoomOf = (
      z: number | string | Keyframe[] | undefined,
    ): number | string | undefined =>
      Array.isArray(z)
        ? z.length === 0
          ? undefined
          : z.every((k) => k.v === z[0].v)
            ? z[0].v
            : keyframeExpr(z)
        : z;

    // The closed viewport ring at a CONSTANT zoom: a full-canvas tile whose
    // mask is a viewport-sized hollow rect at the canvas top-left (outer CW +
    // inner CCW cuts the hole under both fill rules), panned by offset exprs.
    // Overlay x/y exprs are NOT auto-rebalanced by the engine funnels (only
    // enable/alpha/camera are) — rebalance here or dense walks hit the ~100-
    // term parse cliff.
    const pushViewportRing = (z: number, fxExpr: string, fyExpr: string, enable?: string) => {
      const vw = Math.max(2 * ringT, Math.round(W / z));
      const vh = Math.max(2 * ringT, Math.round(H / z));
      const travelX = W - W / z;
      const travelY = H - H / z;
      const outer = `M0 0 H${vw} V${vh} H0 Z`;
      const inner = `M${ringT} ${ringT} V${vh - ringT} H${vw - ringT} V${ringT} Z`;
      sources.push(
        makeColorTile(VIEWPORT_COLOR, {
          mask: {
            kind: "inline-mask",
            localPath: `${outer} ${inner}`,
            bounds: { x: 0, y: 0, width: W, height: H },
          },
          overlay: {
            xExpr: rebalanceAdditiveChains(`(${travelX.toFixed(4)})*(${fxExpr})`),
            yExpr: rebalanceAdditiveChains(`(${travelY.toFixed(4)})*(${fyExpr})`),
            ...(enable ? { enable } : {}),
          },
        }),
      );
    };

    // Camera never moves → an honest static full-frame viewport ring.
    const pushStaticRing = () => {
      sources.push(
        gatedBoxTrackSource([{ x: 0, y: 0, w: W, h: H, thicknessPx: ringT }], {
          color: VIEWPORT_COLOR,
        }),
      );
    };

    // ── JS-side keyframe sampling (mirrors keyframeExpr semantics: hold
    // before first / after last, per-key ease shapes the segment LEAVING the
    // key, 1e-4 duration floor). Sampling lets the debugger draw the ONE
    // thing a constant-size source can't: a closed rect that RESIZES. ──
    const easeU = (ease: string | undefined, u: number): number =>
      ease === "linear"
        ? u
        : ease === "easeOut"
          ? 1 - (1 - u) * (1 - u)
          : u * u * (3 - 2 * u); // smoothstep / easeInOut / default
    const sampleKeys = (keys: Keyframe[], t: number): number => {
      if (t < keys[0].t || keys.length === 1) return keys[0].v;
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        if (t >= a.t && t < b.t) {
          const dur = Math.max(1e-4, b.t - a.t);
          const u = Math.min(1, Math.max(0, (t - a.t) / dur));
          return a.v + (b.v - a.v) * easeU(a.ease, u);
        }
      }
      return keys[keys.length - 1].v;
    };
    // A camera field is SAMPLEABLE when it's a number or keyframes; a pasted
    // expression string is opaque to JS (no evaluator) → null.
    const samplerOf = (
      v: number | string | Keyframe[] | undefined,
      fallback: number,
    ): ((t: number) => number) | null =>
      v == null
        ? () => fallback
        : typeof v === "number"
          ? () => v
          : Array.isArray(v)
            ? v.length > 0
              ? (t: number) => sampleKeys(v, t)
              : () => fallback
            : null;

    // ── The FILMSTRIP: the whole camera as ONE gated drawbox track — a ring
    // per frame-slice at the exact sampled viewport rect (midpoint-sampled),
    // consecutive identical rects merged (holds cost one box). This is what
    // the render shows anyway (the output is fps-quantized), so the strip is
    // frame-exact, and the rect both PANS and RESIZES — no guides, no grid.
    // Slice rate = output fps, degraded uniformly past the argv budget. ──
    const pushFilmstrip = (
      zoomAt: (t: number) => number,
      fxAt: (t: number) => number,
      fyAt: (t: number) => number,
      durSec: number,
    ) => {
      const fps = ctx.target.fps > 0 ? ctx.target.fps : 30;
      const rate = Math.ceil(durSec * fps) > GATED_BOX_BUDGET ? GATED_BOX_BUDGET / durSec : fps;
      const n = Math.max(1, Math.ceil(durSec * rate));
      const boxes: GatedBox[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * durSec;
        const t1 = ((i + 1) / n) * durSec;
        const tm = (t0 + t1) / 2;
        const z = Math.max(1, zoomAt(tm));
        const vp = cameraViewportRect(fxAt(tm), fyAt(tm), z, W, H);
        const x = Math.round(vp.x);
        const y = Math.round(vp.y);
        const w = Math.max(2 * ringT, Math.round(vp.width));
        const h = Math.max(2 * ringT, Math.round(vp.height));
        const prev = boxes[boxes.length - 1];
        if (prev && prev.x === x && prev.y === y && prev.w === w && prev.h === h) {
          prev.toSec = t1; // hold → extend the previous ring's window
        } else {
          boxes.push({ x, y, w, h, fromSec: t0, toSec: t1, thicknessPx: ringT });
        }
      }
      // The last ring holds to the end of the clip (gte-only gate).
      if (boxes.length > 0) delete boxes[boxes.length - 1].toSec;
      sources.push(gatedBoxTrackSource(boxes, { color: VIEWPORT_COLOR }));
    };

    // ── The viewport ──
    const raw = props.camera;
    if (raw) {
      // RAW mode: simulate exactly the supplied camera, full duration. The
      // recipe knobs (zoom/speed/mode) are ignored — the math to verify is
      // already rolled up inside the camera value.
      const zAt = samplerOf(raw.zoom, 1);
      const xAt = samplerOf(raw.focusX, 0.5);
      const yAt = samplerOf(raw.focusY, 0.5);
      if (zAt && xAt && yAt) {
        // Numbers/keyframes → the filmstrip: ONLY the red rect, exactly
        // where the camera is, panning AND resizing. A static camera merges
        // down to a single always-on ring.
        pushFilmstrip(zAt, xAt, yAt, endSec);
      } else {
        // Some field is a pasted EXPRESSION STRING — opaque to JS, so the
        // filmstrip can't sample it.
        const fx = fieldExpr(raw.focusX, "0.5");
        const fy = fieldExpr(raw.focusY, "0.5");
        const rawZoom = zoomOf(raw.zoom);
        if (typeof rawZoom === "string") {
          // Animated expression zoom: the window resizes but its size can't
          // be sampled OR carried by a constant-size ring — the one case
          // that falls back to four guide lines (their central intersection
          // IS the viewport). Prefer keyframes to get the closed rect.
          const zE = `(${rawZoom})`;
          const xL = `(${fx})*(${W}-${W}/${zE})`;
          const yT = `(${fy})*(${H}-${H}/${zE})`;
          const vStripe = `M0 0 H${ringT} V${H} H0 Z`;
          const hStripe = `M0 0 H${W} V${ringT} H0 Z`;
          const guide = (stripe: string, ov: { xExpr?: string; yExpr?: string }) =>
            makeColorTile(VIEWPORT_COLOR, {
              mask: {
                kind: "inline-mask",
                localPath: stripe,
                bounds: { x: 0, y: 0, width: W, height: H },
              },
              overlay: {
                ...(ov.xExpr ? { xExpr: rebalanceAdditiveChains(ov.xExpr) } : {}),
                ...(ov.yExpr ? { yExpr: rebalanceAdditiveChains(ov.yExpr) } : {}),
              },
            });
          sources.push(guide(vStripe, { xExpr: xL }));
          sources.push(guide(vStripe, { xExpr: `${xL}+${W}/${zE}-${ringT}` }));
          sources.push(guide(hStripe, { yExpr: yT }));
          sources.push(guide(hStripe, { yExpr: `${yT}+${H}/${zE}-${ringT}` }));
        } else if (rawZoom != null && rawZoom > 1) {
          // Constant zoom: the closed ring pans on the raw focus exprs.
          pushViewportRing(rawZoom, fx, fy);
        } else {
          // zoom absent / ≤ 1 → the camera is a no-op by contract.
          pushStaticRing();
        }
      }
    } else if (zoom > 1 && rects.length > 0) {
      const targets: CameraTarget[] = rects.map((r, i) => ({
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        atSec: settle(i + 1),
      }));
      const pullBack: FollowCameraPullBack = {
        endSec,
        earliestStartSec: timeline.stepStartSec(targets.length),
        settleOutSec: Math.min(settle(targets.length) + timeline.stepDurSec / 2, endSec),
      };
      const env = resolvePullBackEnvelope(pullBack);

      if ((props.mode ?? "smooth") === "snap") {
        const boxes: GatedBox[] = [];
        for (let i = 0; i < targets.length; i++) {
          const tg = targets[i];
          const fx = centerFocus((tg.rect.x + tg.rect.width / 2) / W, zoom);
          const fy = centerFocus((tg.rect.y + tg.rect.height / 2) / H, zoom);
          const vp = cameraViewportRect(fx, fy, zoom, W, H);
          const from = timeline.stepStartSec(i + 1);
          const to =
            i + 1 < targets.length
              ? timeline.stepStartSec(i + 2)
              : env.active
                ? env.outStartSec
                : endSec;
          boxes.push({
            x: Math.round(vp.x),
            y: Math.round(vp.y),
            w: Math.max(2 * ringT, Math.round(vp.width)),
            h: Math.max(2 * ringT, Math.round(vp.height)),
            fromSec: from,
            toSec: to,
            thicknessPx: ringT,
          });
        }
        // Full view ARRIVES: a full-frame ring holds from zoomEnd to the
        // end. The gap after the last settle ring is the pull-back transit.
        if (env.active) {
          boxes.push({ x: 0, y: 0, w: W, h: H, fromSec: env.zoomEndSec, thicknessPx: ringT });
        }
        if (boxes.length > 0) {
          sources.push(gatedBoxTrackSource(boxes, { color: VIEWPORT_COLOR }));
        }
      } else {
        // Smooth mode = the filmstrip over the SAME keys the follow camera
        // compiles: settle keyframes per target, then a clean pull-back
        // envelope (hold the last focus until the pull-back starts, ease to
        // center + zoom 1 by zoomEnd, hold full frame to the end). The rect
        // follows the walk AND grows during the pull-back — no transit gap.
        // (On squeezed tails the ENGINE's envelope emits overlapping gates —
        // the characterized F2 quirk; the filmstrip shows the intended path.)
        const xs: Keyframe[] = targets.map((tg) => ({
          t: tg.atSec,
          v: centerFocus((tg.rect.x + tg.rect.width / 2) / W, zoom),
        }));
        const ys: Keyframe[] = targets.map((tg) => ({
          t: tg.atSec,
          v: centerFocus((tg.rect.y + tg.rect.height / 2) / H, zoom),
        }));
        let zoomKeys: Keyframe[] = [{ t: 0, v: zoom }];
        if (env.active) {
          const pbStart = Math.min(endSec, Math.max(env.outStartSec, xs[xs.length - 1].t));
          const pbEnd = Math.min(endSec, Math.max(env.zoomEndSec, pbStart + 0.3));
          if (pbEnd > pbStart) {
            xs.push({ t: pbStart, v: xs[xs.length - 1].v }, { t: pbEnd, v: 0.5 });
            ys.push({ t: pbStart, v: ys[ys.length - 1].v }, { t: pbEnd, v: 0.5 });
            zoomKeys = [
              { t: pbStart, v: zoom },
              { t: pbEnd, v: 1 },
            ];
          }
        }
        pushFilmstrip(
          (t) => sampleKeys(zoomKeys, t),
          (t) => sampleKeys(xs, t),
          (t) => sampleKeys(ys, t),
          endSec,
        );
      }
    } else {
      // Camera never moves (zoom ≤ 1): static full-frame viewport ring.
      pushStaticRing();
    }

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: buildOverlayStack(sources.length),
      sources,
      backgroundColor: BG_COLOR,
      durationMs: timeline.durationMs,
    });
  },
};

registerTemplate(CameraDebug);
