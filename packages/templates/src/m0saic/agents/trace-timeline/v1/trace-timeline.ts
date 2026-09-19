/**
 * ============================================================================
 * @m0saic/agents/trace-timeline/v1 — what did the agent do on that run?
 * ============================================================================
 *
 * A waterfall of one agent run: every tool call is a swimlane — the tool and
 * what it touched on the left, a latency bar placed on a shared time axis on
 * the right, the tokens it cost at the bar's end. Status colours the bar
 * (ok = accent, error, retry, cached); a legend and tick labels frame it.
 * The subtitle carries the run totals. Built for the "agents in production"
 * crowd: the picture their observability vendor draws, from a JSON of spans.
 *
 * RATIO throughout (the alpine card kit): rows are equal bands, every bar is
 * a weighted column split of its lane (start · duration · rest, on a ~100
 * basis), tick labels are a column split of the axis row. No hairlines — a
 * faint lane wash reads as the grid and survives any canvas. Composes at any
 * size; fonts are sized to H and width-capped.
 *
 * Determinism: no clock, no randomness — the sample run is a fixed fixture.
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource, MosaicTemplate } from "@m0saic/types";
import {
  definePropsSchema,
  fitEmUnits,
  makeColorTile,
  makeErrorMosaic,
  registerTemplate,
  tag,
  textEmUnits,
  withLayoutContract,
  type LayoutConstraint,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { EMPTY, alpineCard, colSplit, overlay, paint, rowSplit, textCell, type Node } from "../../../alpine/_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../../alpine/_shared/alpine-theme";
import { ALPINE_ANIM_FIELDS, fEnum, revealFadeNode, revealGateNode } from "../../../alpine/_shared/alpine-anim";

export type TraceStatus = "ok" | "error" | "retry" | "cached";

export type TraceSpan = {
  /** The tool (or phase) — "read_file", "bash", "edit", "plan"… */
  tool: string;
  /** What it touched — a path, a command, a query. */
  target?: string;
  /** Start, milliseconds from the run's start. */
  startMs: number;
  /** Duration in milliseconds. */
  durMs: number;
  /** Tokens spent on this hop (prompt + completion). */
  tokens?: number;
  /** ok (default) · error · retry · cached. */
  status?: TraceStatus;
};

type RenderMode = "premium" | "light";
type AnimConfig = { renderMode?: RenderMode; introFrac?: number; reduceMotion?: boolean };

export type TraceTimelineProps = {
  title?: string;
  /** Line under the title. Empty = derived from the spans (calls · wall time · tokens). */
  subtitle?: string;
  spans: TraceSpan[];
  preset?: AlpinePreset;
  /** Bar colour for ok spans. Default the alpine primary. */
  accent?: MosaicColor;
  errorColor?: MosaicColor;
  retryColor?: MosaicColor;
  cachedColor?: MosaicColor;
  /** Print each span's token cost after its bar. Default true. */
  showTokens?: boolean;
  anim?: AnimConfig;
  theme?: ThemeSourceConfig;
  debugLayout?: boolean;
};

const TEMPLATE_ID = "@m0saic/agents/trace-timeline/v1";
const MAX_SPANS = 10;
const DEFAULT_ERROR = "#f85149" as MosaicColor;
const DEFAULT_RETRY = "#e3b341" as MosaicColor;
const DEFAULT_CACHED = "#8b949e" as MosaicColor;
const DEFAULT_ANIM: Required<AnimConfig> = { renderMode: "premium", introFrac: 0.7, reduceMotion: false };
const STATUSES: TraceStatus[] = ["ok", "error", "retry", "cached"];

/** A fixed sample run: plan → read → edit → tests fail → fix → tests pass → wrap up. 38.2 s, ~14k tokens. */
export const SAMPLE_SPANS: TraceSpan[] = [
  { tool: "plan", target: "read the failing report, pick a fix", startMs: 0, durMs: 1800, tokens: 1900 },
  { tool: "read_file", target: "package.json", startMs: 1800, durMs: 500, tokens: 400 },
  { tool: "grep", target: "renderNested", startMs: 2300, durMs: 800, tokens: 600 },
  { tool: "read_file", target: "render/renderNestedTemplate.ts", startMs: 3100, durMs: 900, tokens: 2200 },
  { tool: "edit", target: "business-card.ts", startMs: 4000, durMs: 2500, tokens: 3100 },
  { tool: "bash", target: "npm test -w templates", startMs: 6500, durMs: 12700, tokens: 900, status: "error" },
  { tool: "read_file", target: "layout.test.ts", startMs: 19200, durMs: 800, tokens: 800 },
  { tool: "edit", target: "layout.ts", startMs: 20000, durMs: 2400, tokens: 1400 },
  { tool: "bash", target: "npm test -w templates", startMs: 22400, durMs: 12200, tokens: 900, status: "retry" },
  { tool: "git", target: "diff --stat", startMs: 34600, durMs: 900, tokens: 300, status: "cached" },
];

const propsSchema = definePropsSchema<TraceTimelineProps>({
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "none" }, ui: { label: "Title", order: 1, primary: true } } },
  subtitle: { type: "string", required: false, description: "Line under the title. Empty = the run totals (calls · wall time · tokens).", meta: { control: { placeholder: "run totals" }, ui: { label: "Subtitle", order: 2 } } },
  spans: {
    type: "list",
    required: true,
    description: "The run's tool calls in order: tool, what it touched, start and duration in ms, tokens, status (ok · error · retry · cached). Up to 10 are drawn.",
    meta: { ui: { label: "Spans", order: 3, primary: true }, list: { max: 40 } },
    itemSchema: {
      tool: { type: "string", required: true, description: "Tool or phase.", meta: { ui: { label: "Tool" } } },
      target: { type: "string", required: false, description: "What it touched.", meta: { control: { placeholder: "none" }, ui: { label: "Target" } } },
      startMs: { type: "number", required: true, description: "Start (ms from run start).", meta: { ui: { label: "Start ms" } } },
      durMs: { type: "number", required: true, description: "Duration (ms).", meta: { ui: { label: "Duration ms" } } },
      tokens: { type: "number", required: false, description: "Tokens on this hop.", meta: { control: { placeholder: "none" }, ui: { label: "Tokens" } } },
      status: { type: "string", required: false, description: "ok · error · retry · cached.", meta: { constraints: { oneOf: STATUSES }, control: { placeholder: "ok" }, ui: { label: "Status" } } },
    },
  } as never,
  preset: { type: "string", required: false, description: 'Alpine theme: "light" (default) or "dark".', meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 4 } } },
  accent: { type: "string", required: false, description: "Bar colour for ok spans.", meta: { constraints: { isColor: true }, control: { colorPicker: true, placeholder: "theme primary" }, ui: { label: "Accent", order: 5 } } },
  errorColor: { type: "string", required: false, description: "Bar colour for error spans.", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Error colour", order: 6 } } },
  retryColor: { type: "string", required: false, description: "Bar colour for retried spans.", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Retry colour", order: 7 } } },
  cachedColor: { type: "string", required: false, description: "Bar colour for cached spans.", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Cached colour", order: 8 } } },
  showTokens: { type: "boolean", required: false, description: "Print each span's token cost after its bar.", meta: { ui: { label: "Show tokens", order: 9 } } },
  anim: {
    type: "group",
    required: false,
    description: "Reveal: lanes appear in run order over the intro. reduceMotion renders the final frame.",
    meta: { ui: { label: "Animation", order: 10, collapsedByDefault: true } },
    fields: {
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      renderMode: fEnum("Render mode", ["premium", "light"], "premium = alpha-fade; light = enable-gate pops (cheaper when nested)."),
    },
  } as never,
  theme: { type: "json", required: false, description: "Opt-in producer theme tokens.", meta: { ui: { label: "Theme", order: 11, collapsedByDefault: true, consumer: "agent" } } } as never,
  debugLayout: { type: "boolean", required: false, description: "Dev-only: overlay the layout contract.", meta: { ui: { label: "Debug layout", order: 12 } } },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const color = (v: string | undefined, fallback: MosaicColor): MosaicColor => (v && v.trim() ? (v as MosaicColor) : fallback);

/** "1.2k" / "38.2 s" — compact labels, ASCII only. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
export function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  return s >= 100 ? `${Math.round(s)}s` : s >= 10 ? `${s.toFixed(1)}s` : `${s.toFixed(2)}s`;
}
/** Axis tick label: whole seconds when the step allows ("10s"), else the compact form. */
export function fmtTick(ms: number, stepMs: number): string {
  if (ms === 0) return "0";
  if (stepMs >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  if (stepMs < 1000) return `${ms}ms`;
  return fmtSeconds(ms);
}

/** Tick interval: the smallest 1·2·5·10 step that keeps the axis to at most 7 ticks (so 4–7 over `totalMs`). */
export function tickStepMs(totalMs: number): number {
  const target = totalMs / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, target))));
  for (const m of [1, 2, 5, 10]) if (m * pow >= target) return m * pow;
  return 10 * pow;
}

function roundTile(c: MosaicColor, radius: number): MosaicSource {
  return makeColorTile(c, { effects: { rounding: { cornerStyle: "rounded", borderRadius: radius } } }) as MosaicSource;
}

/** Width-capped font: `px` unless `text` would overflow `boxPx` at the rasterizer's 0.72 em/char. */
function capFont(px: number, text: string, boxPx: number, min: number): number {
  return Math.max(min, Math.min(px, Math.floor((boxPx * 0.94 - 2) / (Math.max(1, textEmUnits(text)) * 0.72))));
}
function fitText(text: string, font: number, boxPx: number): string {
  return fitEmUnits(text, Math.floor((boxPx * 0.94 - 2) / (font * 0.72)));
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const TraceTimelineV1: MosaicTemplate<TraceTimelineProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: "Agent Trace Timeline",
  version: 1,
  description:
    "What the agent did on a run — a waterfall of tool calls: the tool and its target per lane, a latency bar on a shared time axis, tokens per hop, and status colours for errors, retries and cache hits. Alpine card, composes at any canvas.",
  capabilities: { tier: "core" },
  tags: ["agents", "trace", "timeline", "waterfall", "observability", "latency", "tokens", "developers", "sre", "alpine", "animated"],
  aspectRatio: { ideal: 16 / 10, min: 1, max: 2.2, mode: "warn" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 3000 },
  propsSchema,
  defaultProps: {
    title: "One agent run, end to end",
    spans: SAMPLE_SPANS,
    preset: "light",
    errorColor: DEFAULT_ERROR,
    retryColor: DEFAULT_RETRY,
    cachedColor: DEFAULT_CACHED,
    showTokens: true,
    anim: { ...DEFAULT_ANIM },
    debugLayout: false,
  },

  async render(props: TraceTimelineProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const fail = (message: string): MosaicDocument => makeErrorMosaic(message, { title: "Agent Trace Timeline", width: W, height: H });

    const spans = (props.spans ?? [])
      .filter((s) => s && typeof s.tool === "string" && s.tool.trim() && Number.isFinite(s.startMs) && Number.isFinite(s.durMs) && s.durMs >= 0 && s.startMs >= 0)
      .slice(0, MAX_SPANS);
    if (spans.length === 0) return fail("trace-timeline needs spans[] with tool, startMs and durMs");

    const theme = await resolveAlpineTheme(props.preset ?? "light", ctx, props.theme);
    const okColor = color(props.accent, theme.primary);
    const statusColor: Record<TraceStatus, MosaicColor> = {
      ok: okColor,
      error: color(props.errorColor, DEFAULT_ERROR),
      retry: color(props.retryColor, DEFAULT_RETRY),
      cached: color(props.cachedColor, DEFAULT_CACHED),
    };
    const showTokens = props.showTokens !== false;
    const anim: Required<AnimConfig> = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = anim.renderMode === "light";
    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 3000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);

    // ── run totals ──
    const totalMs = Math.max(1, ...spans.map((s) => s.startMs + s.durMs));
    const totalTokens = spans.reduce((a, s) => a + (s.tokens ?? 0), 0);
    const subtitle = (props.subtitle ?? "").trim() || `${spans.length} tool calls · ${fmtSeconds(totalMs)} wall time${totalTokens > 0 ? ` · ${fmtTokens(totalTokens)} tokens` : ""}`;

    // ── chrome ──
    const card = alpineCard({ theme, W, H, title: props.title, subtitle });
    const content = card.contentRect;
    const wOf = (px: number, ref: number) => Math.max(1, Math.round((px / ref) * 100));

    // ── geometry (px → proportions) ──
    const N = spans.length;
    const axisH = Math.round(content.h * 0.07);
    const legendH = Math.round(content.h * 0.08);
    const gapAxis = Math.round(content.h * 0.02);
    const gapLegend = Math.round(content.h * 0.04);
    const lanesH = Math.max(1, content.h - axisH - gapAxis - legendH - gapLegend);
    const pitch = Math.max(1, Math.floor(lanesH / N));
    const laneGap = Math.max(2, Math.round(pitch * 0.18));
    const laneH = Math.max(1, pitch - laneGap);
    const labelW = Math.round(content.w * 0.28);
    const gapLabel = Math.round(content.w * 0.02);
    const trackW = Math.max(1, content.w - labelW - gapLabel);
    const tokenW = showTokens ? Math.round(content.w * 0.06) : 0;

    const labelFont = Math.max(10, Math.round(H * 0.024));
    const targetFont = Math.max(9, Math.round(H * 0.018));
    const tickFont = Math.max(9, Math.round(H * 0.018));
    const tokenFont = Math.max(9, Math.round(H * 0.017));
    const legendFont = Math.max(10, Math.round(H * 0.02));

    // Reveal: lanes in run order across the intro (premium = fade, light = gate).
    const laneDur = Math.max(0.05, introSec / (1 + 0.5 * Math.max(0, N - 1)));
    const reveal = (node: Node, i: number): Node => {
      if (!animate) return node;
      const at = (introSec * i) / Math.max(1, N);
      return light ? revealGateNode(node, at) : revealFadeNode(node, at, laneDur);
    };

    // ── the axis: tick labels at nice intervals, as a column split of the track ──
    const step = tickStepMs(totalMs);
    const ticks: number[] = [];
    for (let t = 0; t <= totalMs; t += step) ticks.push(t);
    const axisBands = ticks.map((t, i) => {
      const next = ticks[i + 1] ?? totalMs;
      const spanPx = Math.max(1, Math.round(((next - t) / totalMs) * trackW));
      const label = fmtTick(t, step);
      return { weight: wOf(spanPx, trackW), node: paint(tag(textCell(label, capFont(tickFont, label, spanPx, 8), theme.muted, "left", "bottom"), "axis-tick")) };
    });
    const axisRow = colSplit([
      { weight: wOf(labelW + gapLabel, content.w), node: EMPTY },
      { weight: wOf(trackW, content.w), node: colSplit(axisBands) },
    ]);

    // ── the lanes ──
    const laneNode = (s: TraceSpan, i: number): Node => {
      const status: TraceStatus = STATUSES.includes(s.status as TraceStatus) ? (s.status as TraceStatus) : "ok";
      const barColor = statusColor[status];
      const tool = s.tool.trim();
      const target = (s.target ?? "").trim();

      // Label column: tool (bold-ish, the lane's name) over its target.
      const toolFont = capFont(labelFont, tool, labelW, 9);
      const label = target
        ? rowSplit([
            { weight: 55, node: paint(tag(textCell(fitText(tool, toolFont, labelW), toolFont, theme.title, "left", "bottom"), "span-tool")) },
            { weight: 45, node: paint(tag(textCell(fitText(target, targetFont, labelW), capFont(targetFont, fitText(target, targetFont, labelW), labelW, 8), theme.muted, "left", "top"), "span-target")) },
          ])
        : paint(tag(textCell(fitText(tool, toolFont, labelW), toolFont, theme.title, "left", "middle"), "span-tool"));

      // Track: start · bar · (tokens) · rest, as proportions of the track width.
      const startPx = Math.round((Math.min(s.startMs, totalMs) / totalMs) * trackW);
      const barPx = Math.max(Math.round(laneH * 0.35), Math.round((s.durMs / totalMs) * trackW));
      const afterPx = Math.max(0, trackW - startPx - barPx);
      const tokenLabel = showTokens && s.tokens != null && s.tokens > 0 ? fmtTokens(s.tokens) : "";
      const tokenPx = tokenLabel ? Math.min(afterPx, tokenW) : 0;
      const restPx = Math.max(0, afterPx - tokenPx);
      const barNode = rowSplit([
        { weight: 20, node: EMPTY },
        { weight: 60, node: paint(tag(roundTile(barColor, 0.5), `span-bar-${status}`)) },
        { weight: 20, node: EMPTY },
      ]);
      const trackBands: Array<{ weight: number; node: Node }> = [];
      if (startPx > 0) trackBands.push({ weight: wOf(startPx, trackW), node: EMPTY });
      trackBands.push({ weight: wOf(barPx, trackW), node: barNode });
      if (tokenPx > 0) {
        // `padding` is a FRACTION of the box (MosaicBoxFrac) — a small left
        // margin so the label does not kiss the bar.
        trackBands.push({ weight: wOf(tokenPx, trackW), node: paint(tag(textCell(tokenLabel, capFont(tokenFont, tokenLabel, tokenPx * 0.86, 8), theme.muted, "left", "middle", { left: 0.14 }), "span-tokens")) });
      }
      if (restPx > 0) trackBands.push({ weight: wOf(restPx, trackW), node: EMPTY });
      // A faint lane wash under the track — the "grid" without hairlines.
      const track = overlay([paint(tag(roundTile(theme.grid, 0.3), "lane-wash")), colSplit(trackBands)]);

      const lane = colSplit([
        { weight: wOf(labelW, content.w), node: label },
        { weight: wOf(gapLabel, content.w), node: EMPTY },
        { weight: wOf(trackW, content.w), node: track },
      ]);
      return reveal(lane, i);
    };
    const laneBands: Array<{ weight: number; node: Node }> = [];
    spans.forEach((s, i) => {
      if (i > 0) laneBands.push({ weight: laneGap, node: EMPTY });
      laneBands.push({ weight: laneH, node: laneNode(s, i) });
    });
    const lanes = rowSplit(laneBands);

    // ── the legend: one entry per status that appears (ok always) ──
    const present = STATUSES.filter((st) => st === "ok" || spans.some((s) => s.status === st));
    // Entries are laid out at 20% of the TRACK (the legend hangs under the bars).
    const legendEntryW = Math.round(trackW * 0.2);
    const legendEntry = (st: TraceStatus): Node => {
      // A bigger dot and a text budget with slack: these are 15–20 px marks
      // three splits deep, where the card's coarse inset basis can shave a
      // few px off either axis.
      const dot = Math.max(8, Math.round(legendH * 0.5));
      const gap = Math.round(dot * 0.5);
      const textPx = legendEntryW - dot - gap;
      const text = st === "ok" ? "ok" : st;
      const vPad = Math.max(1, Math.round((legendH - dot) / 2));
      return colSplit([
        { weight: wOf(dot, legendEntryW), node: rowSplit([{ weight: vPad, node: EMPTY }, { weight: dot, node: paint(tag(roundTile(statusColor[st], 1), `legend-${st}-dot`)) }, { weight: Math.max(1, legendH - dot - vPad), node: EMPTY }]) },
        { weight: wOf(gap, legendEntryW), node: EMPTY },
        { weight: wOf(textPx, legendEntryW), node: paint(tag(textCell(text, capFont(legendFont, text, textPx * 0.8, 8), theme.label, "left", "middle"), `legend-${st}-text`)) },
      ]);
    };
    const legendBands: Array<{ weight: number; node: Node }> = [];
    present.forEach((st, i) => {
      if (i > 0) legendBands.push({ weight: 2, node: EMPTY });
      legendBands.push({ weight: 20, node: legendEntry(st) });
    });
    const legendRow = colSplit([
      { weight: wOf(labelW + gapLabel, content.w), node: EMPTY },
      { weight: wOf(trackW, content.w), node: colSplit([...legendBands, { weight: Math.max(1, 100 - present.length * 22), node: EMPTY }]) },
    ]);

    const body = rowSplit([
      { weight: wOf(axisH, content.h), node: axisRow },
      { weight: wOf(gapAxis, content.h), node: EMPTY },
      { weight: wOf(lanesH, content.h), node: lanes },
      { weight: wOf(gapLegend, content.h), node: EMPTY },
      { weight: wOf(legendH, content.h), node: legendRow },
    ]);
    const root = card.compose(body);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {},
      m0: toM0String(root.m0, "TraceTimelineV1"),
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
      editor: { label: `Agent Trace Timeline · ${spans.length} calls · ${fmtSeconds(totalMs)}` },
    } as MosaicDocument;

    const constraints: LayoutConstraint[] = [
      ...card.constraints,
      { label: "span-tool", textFits: {} },
      { label: "axis-tick", textFits: {} },
      { label: "lane-wash", minWidthFrac: 0.5 },
      ...present.flatMap((st): LayoutConstraint[] => [
        // A rounded mark three splits under the card's coarse inset basis: it may
        // come out a short pill at some canvases (45×33 at 1080²) — still a
        // legend swatch, so the aspect tolerance is loose; the text is the gate.
        { label: `legend-${st}-dot`, aspect: 1, aspectTolerance: 0.5 },
        { label: `legend-${st}-text`, textFits: {} },
      ]),
    ];
    return withLayoutContract(doc, ctx, { templateId: TEMPLATE_ID, constraints, relations: [], debug: props.debugLayout === true });
  },
};

registerTemplate(TraceTimelineV1);
export default TraceTimelineV1;
