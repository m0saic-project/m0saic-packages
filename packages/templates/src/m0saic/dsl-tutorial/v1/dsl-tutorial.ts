/**
 * ============================================================================
 * @m0saic/dsl-tutorial/v1 — animated DSL geometry-walk tutorial (orchestrator)
 * ============================================================================
 *
 * A premium, SaaS-clean IDE/debugger that teaches how the m0 DSL parses and
 * walks geometry. The parent owns the ONE deterministic timeline (`Step[]` from
 * the DSL trace) + theme, lays the IDE shell out as a REAL m0 split (every panel
 * a concrete cell — the Rect Thesis), and fills each panel with a coordinated
 * subtemplate rendered at its exact slot size. All animation is ffmpeg
 * expressions over precomputed time windows; children inherit the parent clock,
 * so every panel stays frame-synchronized.
 *
 * Milestone M0b: IDE shell + chrome (header with the live counting Step pill +
 * status bar) wired to the real pipeline. The four content panels are labeled
 * placeholders here; M1–M4 replace each with its subtemplate.
 *
 * Gate 33 (v1 cut): the chrome rows are sized off `min(H, 0.75·W)` so a portrait
 * or square canvas keeps app-bar-sized chrome (not 9% of a 1920px height); every
 * panel width-fits its text (`_shared/text-fit`); `debugLayout` runs the
 * label-keyed layout contract THROUGH the nested panels (`textFits` on every
 * fitted string) and shows the contract wireframe; the walk's NATURAL length is
 * authored on `durationMs` and only an explicit user ask (`ctx.userIntent`)
 * pins it — the 12s output hint is a hint, never a pin.
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicEngineContext,
  MosaicDocument,
  MosaicRenderableFile,
  MosaicTemplate,
} from "@m0saic/types";
import type { M0String } from "@m0saic/dsl";
import {
  parseM0StringComplete,
  toPrettyM0String,
  getComplexityMetricsFast,
  computeFeasibility,
} from "@m0saic/dsl";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
  resolvePinnedDurationMs,
  withLayoutContract,
} from "@m0saic/template-utils";
import type { LayoutConstraint } from "@m0saic/template-utils";

import type { Node } from "./_shared/node-kit";
import {
  paint,
  rowSplit,
  colSplit,
  insetNode,
  mosaicRef,
} from "./_shared/node-kit";
import { dslTutorialTheme } from "./theme/tokens";
import type { DslTutorialPreset } from "./theme/tokens";
import { buildSteps } from "./pipeline/buildSteps";
import type { StepEventMode } from "./pipeline/buildSteps";
import type { DslCanvasTile } from "./panels/canvas/v1/dsl-canvas";
import { MAX_CHARS, MAX_FRAMES, computeTiming, resolveTier, stepNumberExpr, tierTiming } from "./pipeline/timing";
import type { PaceTier } from "./pipeline/timing";
import { buildCanvasCamera, autoCanvasZoom } from "./pipeline/camera";
import { buildInspectorProjection } from "./pipeline/inspector";
import { buildCursorRects } from "./pipeline/cursor";
import { buildDslStringProjection } from "./pipeline/dslString";
import { CAPS_EM, DIGIT_EM, PROSE_EM } from "./_shared/text-fit";

const CHROME_ID = "@m0saic/dsl-tutorial/chrome/v1";
const CANVAS_ID = "@m0saic/dsl-tutorial/canvas/v1";
const INSPECTOR_ID = "@m0saic/dsl-tutorial/inspector/v1";
const STRING_ID = "@m0saic/dsl-tutorial/string/v1";

export type DslTutorialProps = {
  M0String: M0String;
  /** Animation speed (>1 = faster). Unset = AUTO pacing by step count (1× for a
   *  lesson-sized layout, up to 15× for a huge one — see `autoSpeed`). The Speed
   *  pill always shows the EFFECTIVE speed. */
  speedMultiplier?: number;
  /** Pacing tier. "auto" (default) picks by the layout's character count: teach
   *  (≤ 400 chars: show everything, read it), summarize (≤ 8,000: the whole walk in
   *  ~30 s, light passthrough visuals), sloth (beyond: ~20 s, passthroughs not
   *  drawn). Tile labels are size-driven in every tier. Force one to preview it. */
  tier?: "auto" | PaceTier;
  preset?: DslTutorialPreset;
  title?: string;
  /** Step granularity for the walk. */
  stepEvents?: StepEventMode;
  /** Canvas camera zoom override. Omit = AUTO (zoom only when tiles are too small
   *  to label legibly). 1 = force fit-to-panel; >1 = force zoom + follow. */
  cameraZoom?: number;
  /** TARGET canvas dimensions the layout is PARSED at (default 1920×1080). The
   *  viewframe container is sized to this aspect, so a portrait/square layout
   *  previews at its true shape (letterboxed) instead of stretched to the panel.
   *  X/Y/W/H, feasibility, and the tile dims all reflect these dimensions. */
  canvasWidth?: number;
  canvasHeight?: number;
  // Panel toggles.
  showCanvas?: boolean;
  showInspector?: boolean;
  showDslString?: boolean;
  showChrome?: boolean;
  /** Dev tripwire: run the layout contract (text-fit on every fitted string,
   *  through the nested panels) and render the contract wireframe. */
  debugLayout?: boolean;
};

const propsSchema = definePropsSchema<DslTutorialProps>({
  M0String: {
    type: "m0",
    required: true,
    description: "The m0 layout whose parse + geometry walk is taught (up to 16,000 characters and 6,000 frames — a layout past either is refused at any output size; open it in Layout instead).",
    meta: { ui: { label: "m0 layout" } },
  },
  speedMultiplier: {
    type: "number",
    required: false,
    description: "Animation speed (>1 = faster). Unset = auto by pace tier: teach runs the natural length (up to 2× for bigger lessons), summarize fits the whole walk in ~30 s, sloth in ~20 s. The Speed pill always shows the effective speed.",
    meta: { constraints: { min: 0.1, max: 32 }, control: { placeholder: "auto (by tier)" }, ui: { label: "Speed" } },
  },
  tier: {
    type: "string",
    required: false,
    description: "Pacing tier. auto = by the layout's character count: teach (≤ 400 chars — show everything, read it at 1×), summarize (≤ 8,000 — the whole walk in ~30 s, passthrough visuals light, camera on the full layout), sloth (beyond, up to the 16,000-char ceiling — ~20 s, passthroughs not drawn). Tile labels are size-driven in every tier: the frame number wherever it fits, dims when they fit too. Force one to preview it.",
    meta: { constraints: { oneOf: ["auto", "teach", "summarize", "sloth"] }, ui: { label: "Pace tier" } },
  },
  preset: {
    type: "string",
    required: false,
    description: "Theme preset.",
    meta: {
      constraints: { oneOf: ["light", "dark"] },
      control: { options: [{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }] },
      ui: { label: "Preset" },
    },
  },
  title: { type: "string", required: false, description: "Header title text.", meta: { ui: { label: "Title" }, control: { placeholder: "DSL Tutorial" } } },
  stepEvents: {
    type: "string",
    required: false,
    description: 'Step granularity. "enter+leaf" (default, ~one per node) or "all" (includes exits).',
    meta: { constraints: { oneOf: ["enter+leaf", "all"] }, ui: { label: "Step granularity" } },
  },
  cameraZoom: {
    type: "number",
    required: false,
    description: "Camera zoom override. Leave empty for AUTO (zoom only when tiles are too small to label). 1 = fit-to-panel; >1 = manual zoom + follow.",
    meta: { constraints: { min: 1, max: 4 }, control: { placeholder: "auto" }, ui: { label: "Camera zoom" } },
  },
  canvasWidth: {
    type: "number",
    required: false,
    description: "Target width the layout is PARSED at (default 1920). Sets the canvas aspect so vertical/square layouts preview un-stretched.",
    meta: { constraints: { min: 1, max: 16384 }, control: { placeholder: "1920" }, ui: { label: "Canvas width" } },
  },
  canvasHeight: {
    type: "number",
    required: false,
    description: "Target height the layout is PARSED at (default 1080). With canvas width, sets the canvas aspect.",
    meta: { constraints: { min: 1, max: 16384 }, control: { placeholder: "1080" }, ui: { label: "Canvas height" } },
  },
  showCanvas: { type: "boolean", required: false, description: "Show the canvas panel." , meta: { ui: { label: "Show canvas" } } },
  showInspector: { type: "boolean", required: false, description: "Show the inspector panel." , meta: { ui: { label: "Show inspector" } } },
  showDslString: { type: "boolean", required: false, description: "Show the DSL string panel." , meta: { ui: { label: "Show DSL string" } } },
  showChrome: { type: "boolean", required: false, description: "Show the IDE chrome." , meta: { ui: { label: "Show chrome" } } },
  debugLayout: {
    type: "boolean",
    required: false,
    description:
      "Debug: check the layout contract (every fitted string must fit its cell under the CLI width model, through the nested panels) and render the contract wireframe instead of the tutorial.",
    meta: { ui: { label: "Debug layout", collapsedByDefault: true } },
  },
});

/** Chrome row heights as fractions of the chrome unit (see {@link chromeUnitPx}). */
const HEADER_FRAC = 0.09;
const STRIP_FRAC = 0.09;
const NARRATION_FRAC = 0.06;
const STATUS_FRAC = 0.06;
/** The chrome unit: the canvas height, capped to 3/4 of its width — so a portrait
 *  or square canvas sizes its bars like a landscape one of the same width (a
 *  9%-of-1920px header is a 173px slab; 9% of 810 is an app bar). Landscape
 *  canvases are unchanged (`H ≤ 0.75·W`). */
export function chromeUnitPx(W: number, H: number): number {
  return Math.min(H, W * 0.75);
}
/** Inspector slot narrower than this (canvases under 700px wide) can't hold a
 *  legible field grid — captions and chips would sit at the 7px floor, and its
 *  3px cells were the 480×270 source-count crash. The panel auto-hides and the
 *  canvas takes the body width. */
const INSPECTOR_MIN_SLOT_PX = 140;

/** The `debugLayout` contract: every fitted string, keyed by the label its panel
 *  tags it with, must fit its cell under the SAME em model its fit used. Only the
 *  visible panels' labels are listed (a hidden panel's labels never land). */
export function dslTutorialLayoutConstraints(show: {
  chrome: boolean;
  dslString: boolean;
  inspector: boolean;
}): LayoutConstraint[] {
  // padPx 0: the fits already leave FIT_SLACK + FIT_QUANT_PX inside every cell.
  const fits = (label: string, em: number): LayoutConstraint => ({ label, textFits: { charWidthEm: em, padPx: 0 } });
  const out: LayoutConstraint[] = [];
  if (show.chrome) {
    out.push(fits("header-title", PROSE_EM), fits("header-pill", PROSE_EM), fits("status-label", PROSE_EM));
    out.push(fits("metric-label", PROSE_EM), fits("metric-value", DIGIT_EM));
  }
  if (show.dslString) out.push(fits("narration", PROSE_EM));
  if (show.inspector) {
    out.push(fits("inspector-title", CAPS_EM), fits("chip", PROSE_EM), fits("field-label", CAPS_EM));
    out.push(fits("field-value", DIGIT_EM), fits("section-title", CAPS_EM));
  }
  return out;
}

/** The taught layout's feasibility floor (`computeFeasibility` — exact, no probing). */
type FeasibilityFloor = { minWidthPx: number; minHeightPx: number };

/** The tutorial's density CEILING (founder direction, 2026-09-05).
 *
 *  The canvas child re-parses the taught layout at its own PANEL size (fit-to-
 *  panel), so the layout must be feasible in the panel, not just at its parse
 *  dims: a 1080-row split fits a 1920×1080 parse at 1px a row and is a 0-size
 *  frame in the 756px-tall panel. Until now the only message was the raw parser
 *  refusal ("Split produced a 0-size frame" — the 52k-char dictionary pick at
 *  precision 1080, which reads as a syntax error).
 *
 *  The tutorial teaches layouts that fit its canvas. Past the floor it REFUSES in
 *  its own words — it does not chase the layout with a bigger canvas (a denser
 *  layout just moves the wall; Layout is the tool for those). Returns the refusal
 *  (ASCII — `makeErrorMosaic` draws it with drawtext, which turns `×`/`—` into
 *  `?`), or null when the layout fits. Four walls, checked in order: the
 *  ABSOLUTE size ({@link MAX_CHARS} — output-independent, so the wall can't be
 *  chased with a bigger canvas: the 52k pick that 1080p refused rendered at 4K in
 *  93 minutes, founder 2026-09-06), the ABSOLUTE frame count ({@link MAX_FRAMES} —
 *  the reveal-curtain budget), the parse dims (`canvasWidth`/`canvasHeight`
 *  — the caller's own knobs, fixable) and the canvas panel (omit `panel` when the
 *  canvas is hidden — the string + inspector still teach a layout the panel can't
 *  draw). */
export function dslTutorialCeiling(args: {
  /** Character count of the PRETTY string (the tiers' own measure). */
  chars: number;
  /** Frame (tile) count — `getComplexityMetricsFast(...).frameCount`. */
  frames: number;
  feas: FeasibilityFloor;
  parse: { width: number; height: number };
  panel?: { width: number; height: number };
  output: { width: number; height: number };
}): string | null {
  const { chars, frames, feas, parse, panel, output } = args;
  if (chars > MAX_CHARS) {
    return (
      `dsl-tutorial: this layout is ${chars.toLocaleString("en-US")} characters; the tutorial teaches layouts up to ` +
      `${MAX_CHARS.toLocaleString("en-US")} (a layout this size takes the better part of an hour to walk at any output size, ` +
      `and is not what this template is for). Open it in Layout instead.`
    );
  }
  if (frames > MAX_FRAMES) {
    return (
      `dsl-tutorial: this layout has ${frames.toLocaleString("en-US")} frames; the tutorial teaches layouts up to ` +
      `${MAX_FRAMES.toLocaleString("en-US")} (past that the tiles cannot be revealed one by one, which is the lesson). ` +
      `Open it in Layout instead.`
    );
  }
  const floor = `${feas.minWidthPx} x ${feas.minHeightPx} px`;
  if (feas.minWidthPx > parse.width || feas.minHeightPx > parse.height) {
    return (
      `dsl-tutorial: this layout needs at least ${floor} to parse (its feasibility floor), ` +
      `but it is parsed at ${parse.width} x ${parse.height} (canvasWidth x canvasHeight).`
    );
  }
  if (panel && (feas.minWidthPx > panel.width || feas.minHeightPx > panel.height)) {
    return (
      `dsl-tutorial: this layout is too fine for the tutorial canvas - it needs at least ${floor} to draw ` +
      `(its feasibility floor), but the canvas panel is ${panel.width} x ${panel.height} px at a ` +
      `${output.width} x ${output.height} output. The tutorial teaches layouts that fit its canvas; ` +
      `open a layout this dense in Layout instead.`
    );
  }
  return null;
}

/** Format the speed multiplier as a pill label (e.g. 1 → "1x", 1.25 → "1.25x"). */
function speedLabel(speed: number): string {
  // Always one decimal so it reads as a ratio: 1.0x (recommended), 5.3x (rendered
  // shorter → faster), 0.5x (rendered longer → slower).
  return `${(Math.round(speed * 10) / 10).toFixed(1)}x`;
}

export const DslTutorial: MosaicTemplate<DslTutorialProps> = {
  id: asTemplateId("@m0saic/dsl-tutorial/v1"),
  label: "DSL Tutorial",
  version: 1,
  description:
    "Animated, IDE/debugger-style tutorial that walks the m0 DSL parse + geometry step by step — animated canvas, an inspector showing the live rect (X/Y/W/H/Z) over the hidden engine state (split arity, quantization remainder, passthrough carry), and a live DSL string. Light/dark, speed-controlled.",
  capabilities: { tier: "core" },
  tags: ["dsl-tutorial", "tutorial", "wireframe", "docs", "animated", "developers", "onboarding"],
  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 12000,
    note: "A hint only: the walk authors its NATURAL length (scales with the layout's step count, ~0.9s per character at 1×; an unset speed auto-paces — 1× for small layouts, up to 15× for huge ones). An explicit duration ask (CLI --durationMs, the Make Duration field) is fit exactly — the walk speeds up/stretches to fill it.",
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  // COMPLETE defaults (founder ruling 09-05, gate 33): every optional knob
  // carries the value the render would fall back to, so the Make panel shows
  // what the render does — no "title empty / showCanvas OFF while the canvas is
  // on" (those fallbacks used to live only inside render()). `cameraZoom`
  // stays unset on purpose: unset = AUTO, and its control.placeholder says so —
  // and so does `speedMultiplier` (unset = auto pacing by step count, 2026-09-05).
  defaultProps: {
    M0String: "4[4(F,F,F,F),4(>,F,>,F),3(2[F,F],3[F,F,F],2[F,F]),4(F,F,F,F)]" as M0String,
    tier: "auto",
    preset: "light",
    title: "DSL Tutorial",
    stepEvents: "enter+leaf",
    canvasWidth: 1920,
    canvasHeight: 1080,
    showCanvas: true,
    showInspector: true,
    showDslString: true,
    showChrome: true,
    debugLayout: false,
  },

  async render(props: DslTutorialProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const theme = dslTutorialTheme(props.preset);
    const W = ctx.target.width;
    const H = ctx.target.height;

    // TARGET canvas dimensions the LAYOUT is parsed at (default 1920×1080). The shell
    // + panels still lay out at the output W×H; only the taught layout — its geometry
    // walk, tile dims, feasibility, and the viewframe container's aspect — uses these.
    // So parsing at 1080×1920 previews a vertical layout at its true shape.
    const canvasW = Math.max(1, Math.round(props.canvasWidth ?? 1920));
    const canvasH = Math.max(1, Math.round(props.canvasHeight ?? 1080));

    // ── The deterministic pipeline ──
    // Normalize ANY input to pretty form (1→F, 0→>) up front, so the parse, the
    // canvas, the inspector and the DSL strip all read the same canonical-pretty
    // string — the tutorial always teaches in `F`/`>`, whatever the caller wrote.
    const m0Pretty = toPrettyM0String(String(props.M0String)) as M0String;
    // The density ceiling (`dslTutorialCeiling`): the layout's exact feasibility
    // floor, checked against the parse dims here and against the canvas PANEL once
    // the shell is laid out — so a layout past the floor is refused in the
    // template's words, never by a raw parser line. An invalid string still fails
    // the way it always has (the validator's message under the parse-failed prefix).
    let feas: FeasibilityFloor;
    try {
      feas = computeFeasibility(String(m0Pretty));
    } catch (e) {
      throw new Error(`dsl-tutorial: m0 parse failed - ${e instanceof Error ? e.message : String(e)}`);
    }
    const chars = String(m0Pretty).length;
    // Static DSL metrics — the frame count feeds the ceiling, the rest the status bar.
    const cx = getComplexityMetricsFast(String(m0Pretty));
    const parseCeiling = dslTutorialCeiling({ chars, frames: cx.frameCount, feas, parse: { width: canvasW, height: canvasH }, output: { width: W, height: H } });
    if (parseCeiling) throw new Error(parseCeiling);
    const { m0: parseString, steps } = buildSteps(m0Pretty, canvasW, canvasH, {
      stepEvents: props.stepEvents,
    });

    // Pacing TIER (founder direction 2026-09-05), by the pretty string's character
    // count: teach (≤ 400 — the hero: show everything, read it), summarize (≤ 8,000
    // — watch the renderer paint the whole thing in ~30 s), sloth (beyond — ~20 s,
    // passthroughs not drawn). A pin or an explicit speed still wins.
    const tier: PaceTier = resolveTier(chars, props.tier);

    // Status info bar metrics (all derived from the layout).
    const statusMetrics = {
      canvas: `${canvasW}×${canvasH}`,
      chars,
      frames: cx.frameCount,
      passthroughs: cx.passthroughCount,
      nulls: cx.nullCount,
      groups: cx.groupCount,
      precision: `${cx.precision.maxSplitX}×${cx.precision.maxSplitY}`,
      minFeasible: `${feas.minWidthPx}×${feas.minHeightPx} px`,
    };

    // ── Duration model ──────────────────────────────────────────────────────
    // The animation FITS the output length. We RECOMMEND a duration from how
    // many tiles must paint (more tiles → longer), but if the render pins an
    // explicit duration we scale the whole walk to fill it exactly — so a dense
    // layout never gets truncated mid-walk for being given "only 30s".
    //
    // Q1 law (userIntent-only pins): ONLY an explicit user ask pins the length —
    // CLI `--durationMs`, the Make Duration field. The host-seeded
    // `ctx.output.durationMs` echoes the 12s outputHint and is a default, never a
    // pin (reading it as one crammed every walk into 12s — the 61-step gallery
    // preview ran at 4.7×). Unpinned, the walk AUTHORS its natural length on
    // `durationMs`, which out-ranks the hint at plan time (gate-26 stamp law).
    const fps = ctx.target.fps;
    const pinnedMs = resolvePinnedDurationMs(ctx);
    const timing = tierTiming({
      stepCount: steps.length,
      tier,
      fps,
      speedMultiplier: props.speedMultiplier,
      pinnedMs: pinnedMs ?? undefined,
    });

    // Effective playback speed for the Speed pill: how compressed the final
    // timeline is vs the COMFORTABLE recommended pace (speedMultiplier=1, no pin).
    // 1.0× = rendered at the recommended length; a shorter render reads >1.0×
    // (we had to run the walk faster to fit), a longer one <1.0× (slower). This
    // folds BOTH the speedMultiplier prop and any pinned duration into one honest
    // number the viewer can read.
    const baselineMs = computeTiming(steps.length, 1, undefined, fps).durationMs;
    const effectiveSpeed = timing.durationMs > 0 ? baselineMs / timing.durationMs : 1;

    // Canvas source. The camera (effects.camera) is attached AFTER the shell is
    // parsed, since the auto-zoom needs the canvas panel's pixel size. Effects
    // don't change geometry, so attaching them later is safe.
    const canvasSource = mosaicRef("canvas");

    // ── Panel visibility. Undefined = shown (all default true); only an explicit
    //    `false` hides. A hidden panel keeps its cell (stable geometry + leaf
    //    indices) but renders a cheap single-PNG stub instead of a full-duration
    //    nested-video child — so toggling a panel OFF actually skips its render
    //    cost. (Each visible panel is a separate full-duration .mov intermediate;
    //    that fan-out is the dominant render cost, so the toggles are the lever.)
    const show = {
      chrome: props.showChrome !== false,
      canvas: props.showCanvas !== false,
      inspector: props.showInspector !== false,
      dslString: props.showDslString !== false,
    };
    // Legibility floor: an inspector slot under INSPECTOR_MIN_SLOT_PX can't hold
    // the field grid (3px cells at 480×270 — and a quantized 0-size frame that
    // refused the whole render). Auto-hide it; the canvas takes the body width.
    if (show.inspector && show.canvas && W * 0.2 < INSPECTOR_MIN_SLOT_PX) show.inspector = false;

    // ── IDE shell as a real m0 split (full canvas). Each panel = ONE leaf so
    //    shell leaf indices are predictable: header0 · dslStrip1 · narration2 ·
    //    canvas3 · inspector4 · status5. Every node below is exactly one painted
    //    leaf (paint(...) or panelStub(...)), so indices are stable regardless of
    //    which panels are toggled on. ──
    // The DSL strip + narration/explanation span the FULL width (the ruler reads
    // across the whole frame). Below them the body is the canvas HERO (wide) and a
    // tightened inspector flush with the canvas top — output rect (X/Y/W/H/Z) over
    // a divided ENGINE STATE section (N/R/C). No separate debugger panel; the
    // hidden state it would have shown lives in the inspector now.
    const inspectorSource = mosaicRef("inspector");
    // The IDE shell is built from ONLY the visible panels, so a hidden panel
    // reserves NO space — its weight folds into the canvas+inspector body and the
    // hero grows to fill. Hidden ROW panels (chrome header/status, DSL strip +
    // narration) donate their vertical weight to the body; a hidden inspector
    // gives the canvas the full body width. Leaf (DFS) indices vary with the
    // visible set, so they're derived dynamically (`leafKeys`) — never hardcoded.
    // Row heights in PX off the chrome unit (min(H, 0.75·W)): landscape canvases
    // keep the 9/9/6/70/6 split of the height; portrait/square canvases get
    // app-bar-sized chrome and hand the rest to the body.
    // Weights are hundredths of the unit, so a landscape canvas (unit = H) keeps
    // the exact 9/9/6/70/6 split it always had.
    const unit = chromeUnitPx(W, H);
    const headerW = show.chrome ? HEADER_FRAC * 100 : 0;
    const stripW = show.dslString ? STRIP_FRAC * 100 : 0;
    const narrationW = show.dslString ? NARRATION_FRAC * 100 : 0;
    const statusW = show.chrome ? STATUS_FRAC * 100 : 0;
    const bodyW = Math.max(1, (H / unit) * 100 - headerW - stripW - narrationW - statusW);
    const buildShell = (cNode: Node) => {
      const bodyCols: { weight: number; node: Node }[] = [];
      if (show.canvas) bodyCols.push({ weight: 80, node: cNode });
      if (show.inspector) bodyCols.push({ weight: 20, node: paint(inspectorSource) });
      const rows: { weight: number; node: Node }[] = [];
      if (show.chrome) rows.push({ weight: headerW, node: paint(mosaicRef("chrome-header")) });
      if (show.dslString) {
        rows.push({ weight: stripW, node: paint(mosaicRef("dsl-string")) });
        rows.push({ weight: narrationW, node: paint(mosaicRef("dsl-narration")) });
      }
      if (bodyCols.length > 0) {
        rows.push({ weight: bodyW, node: bodyCols.length === 1 ? bodyCols[0].node : colSplit(bodyCols) });
      }
      if (show.chrome) rows.push({ weight: statusW, node: paint(mosaicRef("chrome-status")) });
      // canvas defaults on, so `rows` is never empty in practice; guard anyway.
      return rows.length > 0 ? rowSplit(rows) : paint(canvasSource);
    };
    // DFS leaf order of the visible panels — mirrors buildShell's node order, so
    // frames[leafIdx(key)] is that panel's rect whatever the visible set.
    const leafKeys: string[] = [];
    if (show.chrome) leafKeys.push("header");
    if (show.dslString) { leafKeys.push("dslStrip"); leafKeys.push("narration"); }
    if (show.canvas) leafKeys.push("canvas");
    if (show.inspector) leafKeys.push("inspector");
    if (show.chrome) leafKeys.push("status");
    const leafIdx = (k: string) => leafKeys.indexOf(k);

    const parseShell = (s: string) => {
      const p = parseM0StringComplete(s, W, H);
      if (!p.ok) throw new Error(`dsl-tutorial: shell m0 invalid — ${p.error?.message ?? "unknown"}`);
      return p.ir.renderFrames.slice().sort((a, b) => a.logicalIndex - b.logicalIndex);
    };

    // First parse with the canvas filling its cell → learn the cell's exact pixels.
    let shell = buildShell(paint(canvasSource));
    let frames = parseShell(shell.m0);

    // GEOMETRY letterbox: size the canvas cell to the TARGET aspect via real m0 cells
    // (NULL side/top bars — no distortion, no extra render leaves), so a portrait/
    // square layout keeps its true shape. The parent hands the canvas child exactly
    // this container to target; nothing inside stretches.
    if (show.canvas) {
      const cellRect = frames[leafIdx("canvas")];
      const canvasAR = canvasW / canvasH;
      const cellAR = cellRect.width / cellRect.height;
      const containerW = canvasAR >= cellAR ? cellRect.width : cellRect.height * canvasAR;
      const containerH = canvasAR >= cellAR ? cellRect.width / canvasAR : cellRect.height;
      const barLR = Math.max(0, (cellRect.width - containerW) / 2);
      const barTB = Math.max(0, (cellRect.height - containerH) / 2);
      if (barLR > 0.5 || barTB > 0.5) {
        shell = buildShell(insetNode(paint(canvasSource), barTB, barLR, barTB, barLR, cellRect.width, cellRect.height));
        frames = parseShell(shell.m0); // re-derive: the canvas leaf is now the container
      }
    }

    // Rects by dynamic leaf index — each is only READ under its panel's `show` gate.
    const headerRect = frames[leafIdx("header")];
    const dslStripRect = frames[leafIdx("dslStrip")];
    const narrationRect = frames[leafIdx("narration")];
    const canvasRect = frames[leafIdx("canvas")]; // the letterboxed container (or full cell when aspects match)
    const inspectorRect = frames[leafIdx("inspector")];
    const statusRect = frames[leafIdx("status")];

    // The canvas PANEL wall of the density ceiling: the child re-parses the layout
    // at exactly this slot, so it must be feasible here — refuse now, in the
    // template's words, before any panel renders.
    if (show.canvas) {
      const panelCeiling = dslTutorialCeiling({
        chars,
        frames: cx.frameCount,
        feas,
        parse: { width: canvasW, height: canvasH },
        panel: { width: Math.round(canvasRect.width), height: Math.round(canvasRect.height) },
        output: { width: W, height: H },
      });
      if (panelCeiling) throw new Error(panelCeiling);
    }

    // ── Canvas camera (attached now that we know the canvas panel size). Zoom is
    //    AUTO by default: 1 (fit-to-panel) when every tile already paints its
    //    number + dims legibly, otherwise the minimum zoom that makes the
    //    smallest tile legible — and the engine eases focusX/focusY to follow the
    //    active tile. `cameraZoom` overrides: 1 forces fit-to-panel, >1 forces a
    //    manual zoom. Effects don't affect geometry, so frames above are intact. ──
    if (show.canvas) {
      // Camera follows the active tile: zoom is AUTO — 1 (fit-to-panel) when every
      // tile already paints its number + dims legibly, otherwise the minimum zoom
      // that makes the smallest tile legible, with the focus easing to follow the
      // walk. (The engine `applyCamera` was fixed to use a static even-dimension
      // scale for a constant zoom, so the crop no longer fails to (re)configure on a
      // zoomed/dense canvas.) `cameraZoom` overrides: 1 forces fit-to-panel.
      // Summarize / sloth watch the WHOLE layout assemble: fit-to-panel, no chase.
      const zoom =
        props.cameraZoom != null
          ? props.cameraZoom
          : tier === "teach"
            ? autoCanvasZoom(steps, canvasW, canvasH, canvasRect.width, canvasRect.height)
            : 1;
      const camera = zoom > 1 ? buildCanvasCamera(steps, timing, canvasW, canvasH, zoom) : undefined;
      if (camera) (canvasSource as { effects?: unknown }).effects = { camera };
    }

    // Per-leaf timing for the canvas, in logical (leafIndex) order. True dims
    // come from the Step[] (parsed at the real output size — honest geometry).
    const tiles: DslCanvasTile[] = steps
      .filter((s) => s.eventType === "emitLeaf" && s.leafIndex != null)
      .sort((a, b) => (a.leafIndex! - b.leafIndex!))
      .map((s) => {
        const start = timing.stepStartSec(s.index);
        return {
          order: s.leafIndex! + 1,
          w: s.rect.width,
          h: s.rect.height,
          revealAtSec: start,
          activeStartSec: start,
          activeEndSec: start + timing.stepDurSec,
        };
      });

    // Only render the children for VISIBLE panels — a hidden panel's cell already
    // holds a cheap stub, so skipping its child render is what makes the toggle a
    // real perf lever (no wasted full-duration video intermediate).
    const children: Record<string, MosaicRenderableFile> = {};

    // Each split closes (its region fully claimed) at its matching `exit` step —
    // keyed by stableKey, which the enter + exit of the same node share. The dashed
    // subdivision is scaffolding: it clears once every cell in the region is painted.
    const closeSecByKey = new Map<string, number>();
    for (const s of steps) {
      if (s.eventType === "exit" && s.stableKey) {
        closeSecByKey.set(s.stableKey, timing.stepStartSec(s.index));
      }
    }

    // Per-leaf emit geometry + time — used to clear each interior divider as soon as
    // the tile spanning it is painted (not when the whole split closes).
    const leafEmits = steps
      .filter((s) => s.eventType === "emitLeaf")
      .map((s) => ({ rect: s.rect, sec: timing.stepStartSec(s.index) }));

    /** When the divider at `frac` of `region` (along `axis`) clears: the LATEST emit
     *  among the tiles whose rect spans that line — a passthrough-merged tile spans
     *  the boundary inside it, so it clears on THAT tile's claim — capped at close. */
    const dividerClearSec = (
      region: { x: number; y: number; width: number; height: number },
      axis: "row" | "col",
      frac: number,
      closeSec: number,
    ): number => {
      const pos = axis === "col" ? region.x + frac * region.width : region.y + frac * region.height;
      const regCrossLo = axis === "col" ? region.y : region.x;
      const regCrossHi = regCrossLo + (axis === "col" ? region.height : region.width);
      let latest = -1;
      for (const e of leafEmits) {
        const r = e.rect;
        const axLo = axis === "col" ? r.x : r.y;
        const axHi = axLo + (axis === "col" ? r.width : r.height);
        const crossLo = axis === "col" ? r.y : r.x;
        const crossHi = crossLo + (axis === "col" ? r.height : r.width);
        const inCross = crossLo >= regCrossLo - 2 && crossHi <= regCrossHi + 2;
        const spans = axLo <= pos + 1 && pos - 1 <= axHi;
        if (inCross && spans && e.sec > latest) latest = e.sec;
      }
      return latest < 0 ? closeSec : Math.min(closeSec, latest + timing.transitionSec);
    };

    /** Painted tiles that span the divider at `frac`: each cover is the tile's extent
     *  ALONG the divider (canvas px) + its paint time, flagged `interior` when the
     *  divider runs THROUGH the tile (a passthrough-absorbed boundary) rather than
     *  along its edge. The canvas clears every dash on its own cover, so a stroke
     *  that absorbed six rows loses the row lines inside it the moment it paints,
     *  while a boundary dash waits for both neighbours (brand M, 2026-09-05). */
    const dividerCovers = (
      region: { x: number; y: number; width: number; height: number },
      axis: "row" | "col",
      frac: number,
    ): { lo: number; hi: number; sec: number; interior: boolean }[] => {
      const pos = axis === "col" ? region.x + frac * region.width : region.y + frac * region.height;
      const regCrossLo = axis === "col" ? region.y : region.x;
      const regCrossHi = regCrossLo + (axis === "col" ? region.height : region.width);
      const out: { lo: number; hi: number; sec: number; interior: boolean }[] = [];
      for (const e of leafEmits) {
        const r = e.rect;
        const axLo = axis === "col" ? r.x : r.y;
        const axHi = axLo + (axis === "col" ? r.width : r.height);
        const crossLo = axis === "col" ? r.y : r.x;
        const crossHi = crossLo + (axis === "col" ? r.height : r.width);
        const inCross = crossLo >= regCrossLo - 2 && crossHi <= regCrossHi + 2;
        const spans = axLo <= pos + 1 && pos - 1 <= axHi;
        if (!inCross || !spans) continue;
        out.push({ lo: crossLo, hi: crossHi, sec: e.sec + timing.transitionSec, interior: axLo + 1 < pos && pos < axHi - 1 });
      }
      return out;
    };

    // Split (enter) steps → dotted subdivisions on the canvas, so entering a split
    // visibly draws the columns/rows it creates BEFORE the cells paint. Each interior
    // divider then clears on its OWN tile's claim; the region outline clears at close.
    const splits = steps
      .filter((s) => s.eventType === "enter" && s.split && s.splitRegion && s.split.dividers.length > 0)
      .map((s) => {
        const region = s.splitRegion!;
        const axis = s.split!.axis;
        const closeSec = closeSecByKey.get(s.stableKey) ?? timing.durationMs / 1000;
        return {
          // The REGION being split (parent), not the cursor (its first child).
          // Fractions of the CANVAS (parse dims), so they're aspect-independent.
          xFrac: region.x / canvasW,
          yFrac: region.y / canvasH,
          wFrac: region.width / canvasW,
          hFrac: region.height / canvasH,
          axis,
          dividers: s.split!.dividers.map((frac) => ({
            frac,
            clearSec: dividerClearSec(region, axis, frac, closeSec),
            covers: dividerCovers(region, axis, frac),
          })),
          activeStartSec: timing.stepStartSec(s.index),
          clearAtSec: closeSec,
        };
      });

    // The orange geometry cursor — one enable-gated ring per step (it snaps to
    // each new bound as the parse advances), so it leads the parse at the live
    // bounds. Baked rects, not a per-frame geq (cheap, deterministic).
    // Sloth: the cursor hops between the steps that change geometry or paint —
    // passthrough / null slots are not drawn at all.
    const cursorRects = buildCursorRects(
      tier === "sloth" ? steps.filter((s) => s.eventType !== "passthrough" && s.eventType !== "null") : steps,
      timing,
      canvasW,
      canvasH,
    );

    // Every panel is a full-length nested VIDEO child: it must carry the walk's
    // authored length (`slot.durationMs`), not the parent's `ctx.target.durationMs`
    // — unpinned, that is the host-seeded 12s output HINT, and a 12s child under a
    // 15.8s parent loops: the last frames of every natural-length render showed
    // "Step 4 / 16" (2026-09-05). A pin made both equal, which is why the gate-33
    // renders (all `--durationMs`-pinned to their natural length) never showed it.

    if (show.canvas) {
      children["canvas"] = await renderNestedTemplate(
        CANVAS_ID,
        {
          M0String: props.M0String,
          preset: props.preset,
          tiles,
          introSec: 0.3,
          // Sloth draws no passthrough scaffolding at all; summarize draws it light.
          splits: tier === "sloth" ? [] : splits,
          cursorRects,
          tier,
        },
        ctx,
        // The canvas cell IS the letterboxed container now (real geometry), so the
        // child renders at exactly this size — no aspect inference, no stretch.
        { slot: { width: Math.round(canvasRect.width), height: Math.round(canvasRect.height), durationMs: timing.durationMs } },
      );
    }

    if (show.inspector) {
      const projection = buildInspectorProjection(steps, timing);
      children["inspector"] = await renderNestedTemplate(
        INSPECTOR_ID,
        { preset: props.preset, ...projection },
        ctx,
        { slot: { width: Math.round(inspectorRect.width), height: Math.round(inspectorRect.height), durationMs: timing.durationMs } },
      );
    }

    // DSL-string panel — the syntax-highlighted strip + stepping caret (leaf 1)
    // and the narration banner (leaf 2). Both read the same projection (glyphs,
    // per-glyph caret enables, narration variants) off the global clock.
    if (show.dslString) {
      const stringProjection = buildDslStringProjection(steps, timing, parseString);
      children["dsl-string"] = await renderNestedTemplate(
        STRING_ID,
        {
          part: "strip",
          preset: props.preset,
          glyphs: stringProjection.glyphs,
          caretEnable: stringProjection.caretEnable,
          caretSteps: stringProjection.caretSteps,
        },
        ctx,
        { slot: { width: Math.round(dslStripRect.width), height: Math.round(dslStripRect.height), durationMs: timing.durationMs } },
      );
      children["dsl-narration"] = await renderNestedTemplate(
        STRING_ID,
        { part: "narration", preset: props.preset, narration: stringProjection.narration },
        ctx,
        { slot: { width: Math.round(narrationRect.width), height: Math.round(narrationRect.height), durationMs: timing.durationMs } },
      );
    }

    if (show.chrome) {
      children["chrome-header"] = await renderNestedTemplate(
        CHROME_ID,
        {
          part: "header",
          preset: props.preset,
          title: props.title ?? "DSL Tutorial",
          speedLabel: speedLabel(effectiveSpeed),
          stepExpr: stepNumberExpr(timing), // bare number; the chrome adds the wording
          stepTotal: timing.stepCount,
          // When the DSL strip below the header is hidden, the header needs its own
          // divider so it doesn't blend into the canvas beneath it.
          divider: !show.dslString,
        },
        ctx,
        { slot: { width: Math.round(headerRect.width), height: Math.round(headerRect.height), durationMs: timing.durationMs } },
      );

      children["chrome-status"] = await renderNestedTemplate(
        CHROME_ID,
        {
          part: "status",
          preset: props.preset,
          statusLabel: "Parsing",
          metrics: statusMetrics,
        },
        ctx,
        { slot: { width: Math.round(statusRect.width), height: Math.round(statusRect.height), durationMs: timing.durationMs } },
      );
    }

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: toM0String(shell.m0, "DslTutorial"),
      sources: shell.sources,
      backgroundColor: theme.canvas,
      // Authored: the walk's own length (L1 — out-ranks the hint-seeded target).
      durationMs: timing.durationMs,
      // Gate-26 convention: every rendered doc declares its format. A silent
      // video deliverable — never mux a placeholder audio track.
      format: { kind: "video", container: "mp4" },
      audio: { mode: "off" },
      children,
    };
    // Dev tripwire (debug-only, founder ruling 08-22): the contract checks every
    // fitted string THROUGH the nested panels (checkLayout flattens the children)
    // and, when on, shows the contract wireframe. Zero cost when off.
    return withLayoutContract(doc, { ...ctx, target: { ...ctx.target, durationMs: timing.durationMs } }, {
      templateId: String(DslTutorial.id),
      constraints: dslTutorialLayoutConstraints(show),
      debug: props.debugLayout,
    });
  },
};

registerTemplate(DslTutorial);
