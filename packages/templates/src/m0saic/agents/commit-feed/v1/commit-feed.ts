/**
 * ============================================================================
 * @m0saic/agents/commit-feed/v1 — who wrote this week's commits?
 * ============================================================================
 *
 * A commit feed that colour-codes every row by WHO authored it — a human or
 * a coding agent (Claude Code, Copilot, Cursor…) — with a share tile ("57%
 * agent-authored"), a proportion bar and a legend on top. Built for the
 * 2026 conference floor where most of the room ships with an agent in the
 * loop and wants to see that in their own repo's numbers.
 *
 * Composition, not a fork: the feed itself is `@m0saic/alpine/commit-feed/v2`
 * nested under this card's chrome (the pulse hero's move — `showHeader:false`
 * + a transparent surface), with each commit mapped onto the feed's open
 * `kind` vocabulary: `agent` / `human` colour the kind chip, the agent's
 * name rides the area chip, the human who directed or merged it is the
 * author. The chrome is the shared alpine card kit (RATIO splits, fonts
 * sized to H), so the whole thing composes at any canvas.
 *
 * Determinism: no clock, no randomness — the share is derived from the
 * `commits` prop, the default data is a fixed sample.
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource, MosaicTemplate, MosaicRenderableFile } from "@m0saic/types";
import {
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  registerTemplate,
  renderNestedTemplate,
  fitEmUnits,
  tag,
  textEmUnits,
  withLayoutContract,
  type LayoutConstraint,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { EMPTY, alpineCard, colSplit, overlay, paint, rowSplit, textCell, type Node } from "../../../alpine/_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../../alpine/_shared/alpine-theme";
import { ALPINE_ANIM_FIELDS, fEnum, revealFadeNode } from "../../../alpine/_shared/alpine-anim";

export type AgentCommit = {
  /** Commit subject. */
  title: string;
  /** The human on the commit — the author, or the person who directed / merged an agent's work. */
  author: string;
  /** The coding agent that wrote it ("Claude Code", "Copilot", "Cursor"…). Empty = human-authored. */
  agent?: string;
  /** PR number. */
  pr?: number | string;
  /** Short date label ("May 15"). */
  date?: string;
  /** Area / package touched — shown on human rows (agent rows show the agent's name there). */
  area?: string;
  /** Reviewers (discs after the author). */
  reviewers?: string[];
};

type RenderMode = "premium" | "light";
type AnimConfig = { renderMode?: RenderMode; introFrac?: number; reduceMotion?: boolean };

export type AgentCommitFeedProps = {
  title?: string;
  subtitle?: string;
  commits: AgentCommit[];
  /** Alpine theme variant (light default; "dark" = the night look). */
  preset?: AlpinePreset;
  /** Row / bar / legend colour for agent-authored commits. */
  agentColor?: MosaicColor;
  /** Row / bar / legend colour for human-authored commits. */
  humanColor?: MosaicColor;
  anim?: AnimConfig;
  /** Opt-in producer theming (shared alpine theme by default). */
  theme?: ThemeSourceConfig;
  /** Dev-only: check the layout contract. */
  debugLayout?: boolean;
};

const TEMPLATE_ID = "@m0saic/agents/commit-feed/v1";
const FEED_TEMPLATE_ID = "@m0saic/alpine/commit-feed/v2";
const MAX_COMMITS = 7;
const DEFAULT_AGENT_COLOR = "#EF7525" as MosaicColor;
const DEFAULT_HUMAN_COLOR = "#388bfd" as MosaicColor;
const DEFAULT_ANIM: Required<AnimConfig> = { renderMode: "premium", introFrac: 0.7, reduceMotion: false };

/** A fixed sample week: four agent-authored commits, three human. */
export const SAMPLE_COMMITS: AgentCommit[] = [
  { title: "dsl: snapGrid builder — zero-distortion guttered grids", author: "Quentin S", agent: "Claude Code", pr: 412, date: "Sep 8", reviewers: ["Ada L"] },
  { title: "release: dsl-stdlib v2.0.0", author: "Quentin S", pr: 415, date: "Sep 9", area: "release" },
  { title: "tests: goldens for placeRects at the 7-canvas sweep", author: "Ada L", agent: "Copilot", pr: 418, date: "Sep 10", reviewers: ["Quentin S"] },
  { title: "fix: overlay alpha lost under alphamerge", author: "Quentin S", agent: "Claude Code", pr: 421, date: "Sep 11", reviewers: ["Ada L", "Sam K"] },
  { title: "docs: handbook — feasibility vs precision", author: "Sam K", pr: 423, date: "Sep 11", area: "handbook" },
  { title: "perf: cache mask rasters by content hash", author: "Ada L", agent: "Cursor", pr: 426, date: "Sep 12", reviewers: ["Quentin S"] },
  { title: "ci: pin the darwin golden toolchain", author: "Sam K", pr: 428, date: "Sep 12", area: "ci", reviewers: ["Ada L"] },
];

const propsSchema = definePropsSchema<AgentCommitFeedProps>({
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "none" }, ui: { label: "Title", order: 1, primary: true } } },
  subtitle: { type: "string", required: false, description: "Line under the title — the repo and window.", meta: { control: { placeholder: "none" }, ui: { label: "Subtitle", order: 2 } } },
  commits: {
    type: "list",
    required: true,
    description: 'Commits, newest last. `agent` names the coding agent that wrote it ("Claude Code", "Copilot", "Cursor"); leave it empty for a human-authored commit. `author` is the human on the commit. Up to 7 are drawn.',
    meta: { ui: { label: "Commits", order: 3, primary: true }, list: { max: 24 } },
    itemSchema: {
      title: { type: "string", required: true, description: "Commit subject.", meta: { ui: { label: "Title" } } },
      author: { type: "string", required: true, description: "The human on the commit.", meta: { ui: { label: "Author" } } },
      agent: { type: "string", required: false, description: "The coding agent that wrote it; empty = human.", meta: { control: { placeholder: "human" }, ui: { label: "Agent" } } },
      pr: { type: "string", required: false, description: "PR number.", meta: { control: { placeholder: "none" }, ui: { label: "PR" } } },
      date: { type: "string", required: false, description: "Short date.", meta: { control: { placeholder: "none" }, ui: { label: "Date" } } },
      area: { type: "string", required: false, description: "Area touched (human rows).", meta: { control: { placeholder: "none" }, ui: { label: "Area" } } },
      reviewers: { type: "list", required: false, description: "Reviewer names.", meta: { ui: { label: "Reviewers" } }, itemSchema: { type: "string" } },
    },
  } as never,
  preset: { type: "string", required: false, description: 'Alpine theme: "light" (default) or "dark".', meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 4 } } },
  agentColor: { type: "string", required: false, description: "Colour for agent-authored commits (chip, bar, legend).", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Agent colour", order: 5 } } },
  humanColor: { type: "string", required: false, description: "Colour for human-authored commits (chip, bar, legend).", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Human colour", order: 6 } } },
  anim: {
    type: "group",
    required: false,
    description: "Reveal: the feed's rows cascade in; the share band fades. reduceMotion renders the final frame.",
    meta: { ui: { label: "Animation", order: 7, collapsedByDefault: true } },
    fields: {
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      renderMode: fEnum("Render mode", ["premium", "light"], "premium = alpha-fade cascade; light = enable-gate pops (cheaper when nested)."),
    },
  } as never,
  theme: { type: "json", required: false, description: "Opt-in producer theme tokens.", meta: { ui: { label: "Theme", order: 8, collapsedByDefault: true, consumer: "agent" } } } as never,
  debugLayout: { type: "boolean", required: false, description: "Dev-only: overlay the layout contract.", meta: { ui: { label: "Debug layout", order: 9 } } },
});

const pct = (n: number, d: number): number => (d > 0 ? Math.round((100 * n) / d) : 0);
const isAgent = (c: AgentCommit): boolean => typeof c.agent === "string" && c.agent.trim().length > 0;

function roundTile(color: MosaicColor, radius: number): MosaicSource {
  return makeColorTile(color, { effects: { rounding: { cornerStyle: "rounded", borderRadius: radius } } }) as MosaicSource;
}

/** The share tile: a big percentage over a small label, on the theme's grid surface. */
function shareTile(share: number, label: string, theme: { grid: MosaicColor; title: MosaicColor; muted: MosaicColor }, w: number, h: number): Node {
  // Fonts from the tile's height, capped by its width (0.72 em/char, 0.94 budget).
  const cap = (px: number, text: string, min: number) => Math.max(min, Math.min(px, Math.floor((w * 0.94 - 2) / (Math.max(1, textEmUnits(text)) * 0.72))));
  const big = cap(Math.round(h * 0.42), `${share}%`, 14);
  const small = cap(Math.round(h * 0.15), label, 9);
  const stack = rowSplit([
    { weight: 8, node: EMPTY },
    { weight: 52, node: paint(tag(textCell(`${share}%`, big, theme.title, "center", "bottom"), "share-value")) },
    { weight: 24, node: paint(tag(textCell(label, small, theme.muted, "center", "top"), "share-label")) },
    { weight: 16, node: EMPTY },
  ]);
  return overlay([paint(tag(roundTile(theme.grid, 0.12), "share-tile")), stack]);
}

/** The proportion bar: agent share vs human share, rounded ends. */
function shareBar(agent: number, human: number, agentColor: MosaicColor, humanColor: MosaicColor): Node {
  // Weights on a ~100 basis so the 1-unit gap stays a hairline, whatever the counts.
  const total = Math.max(1, agent + human);
  const a = Math.max(1, Math.round((agent / total) * 100));
  const b = Math.max(1, 100 - a);
  return colSplit([
    { weight: a, node: paint(tag(roundTile(agentColor, 0.5), "bar-agent")) },
    { weight: 1, node: EMPTY },
    { weight: b, node: paint(tag(roundTile(humanColor, 0.5), "bar-human")) },
  ]);
}

/**
 * One legend entry: a square dot (pixel-derived, so it stays round at any
 * aspect), then the label — font capped to the box at the rasterizer's
 * conservative 0.72 em/char, then ellipsized if it still would not fit.
 */
function legendEntry(color: MosaicColor, text: string, maxFont: number, ink: MosaicColor, label: string, entryW: number, rowH: number): Node {
  const dot = Math.max(6, Math.round(rowH * 0.42));
  const gap = Math.round(dot * 0.6);
  const textW = Math.max(8, entryW - dot - gap);
  // Budget = 0.94 × cell − 2 px (quantization takes a few px per split level).
  const budget = Math.max(4, textW * 0.94 - 2);
  const units = Math.max(1, textEmUnits(text));
  const font = Math.max(10, Math.min(maxFont, Math.floor(budget / (units * 0.72))));
  const fitted = fitEmUnits(text, Math.floor(budget / (font * 0.72)));
  const w = (px: number) => Math.max(1, Math.round((px / entryW) * 100));
  const vPad = Math.max(0, Math.round((rowH - dot) / 2));
  const dotNode = rowSplit([
    { weight: Math.max(1, vPad), node: EMPTY },
    { weight: Math.max(1, dot), node: paint(tag(roundTile(color, 1), `${label}-dot`)) },
    { weight: Math.max(1, rowH - dot - vPad), node: EMPTY },
  ]);
  return colSplit([
    { weight: w(dot), node: dotNode },
    { weight: w(gap), node: EMPTY },
    { weight: w(textW), node: paint(tag(textCell(fitted, font, ink, "left", "middle"), `${label}-text`)) },
  ]);
}

export const AgentCommitFeedV1: MosaicTemplate<AgentCommitFeedProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: "Agent Commit Feed",
  version: 1,
  description:
    "Who wrote this week's commits — a commit feed colour-coded by author (human vs coding agent), with the agent-authored share, a proportion bar and a legend. The alpine commit feed nested under its own card; composes at any canvas.",
  capabilities: { tier: "core" },
  tags: ["github", "commits", "agents", "ai", "developers", "devrel", "engineering-leaders", "alpine", "animated"],
  aspectRatio: { ideal: 16 / 10, min: 1, max: 2.2, mode: "warn" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 3000 },
  propsSchema,
  defaultProps: {
    title: "Who wrote this week's commits?",
    subtitle: "m0saic-dsl/m0 · Sep 8–12",
    commits: SAMPLE_COMMITS,
    preset: "light",
    agentColor: DEFAULT_AGENT_COLOR,
    humanColor: DEFAULT_HUMAN_COLOR,
    anim: { ...DEFAULT_ANIM },
    debugLayout: false,
  },

  async render(props: AgentCommitFeedProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const fail = (message: string): MosaicDocument => makeErrorMosaic(message, { title: "Agent Commit Feed", width: W, height: H });

    const commits = (props.commits ?? []).filter((c) => c && typeof c.title === "string" && c.title.trim()).slice(0, MAX_COMMITS);
    if (commits.length === 0) return fail("agent-commit-feed needs commits[]");

    const theme = await resolveAlpineTheme(props.preset ?? "light", ctx, props.theme);
    const agentColor = (props.agentColor && props.agentColor.trim()) ? props.agentColor : DEFAULT_AGENT_COLOR;
    const humanColor = (props.humanColor && props.humanColor.trim()) ? props.humanColor : DEFAULT_HUMAN_COLOR;
    const anim: Required<AnimConfig> = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 3000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);

    const agentCount = commits.filter(isAgent).length;
    const humanCount = commits.length - agentCount;
    const share = pct(agentCount, commits.length);
    const agents = [...new Set(commits.filter(isAgent).map((c) => c.agent!.trim()))];

    // ── chrome ──
    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const content = card.contentRect;
    const bandTop = Math.round(content.h * 0.03);
    const bandH = Math.round(content.h * 0.22);
    const bandGap = Math.round(content.h * 0.05);
    const feedH = Math.max(1, content.h - bandTop - bandH - bandGap);
    const wOf = (px: number, ref: number) => Math.max(1, Math.round((px / ref) * 100));

    // ── the share band: tile · [bar / legend] ──
    const tileW = Math.round(content.w * 0.2);
    const bandGapX = Math.round(content.w * 0.03);
    const legendFont = Math.max(10, Math.round(H * 0.024));
    const agentLegend = `${agentCount} by ${agents.length ? agents.join(", ") : "agents"}`;
    const humanLegend = `${humanCount} by ${humanCount === 1 ? "a human" : "humans"}`;
    const rightW = content.w - tileW - bandGapX;
    const legendRowH = Math.round(bandH * 0.3);
    const legendGapW = Math.round(rightW * 0.04);
    const legendEntryW = Math.round((rightW - legendGapW) / 2);
    const right = rowSplit([
      { weight: 18, node: EMPTY },
      { weight: 22, node: shareBar(agentCount, humanCount, agentColor, humanColor) },
      { weight: 16, node: EMPTY },
      {
        weight: 30,
        node: colSplit([
          { weight: 48, node: legendEntry(agentColor, agentLegend, legendFont, theme.label, "legend-agent", legendEntryW, legendRowH) },
          { weight: 4, node: EMPTY },
          { weight: 48, node: legendEntry(humanColor, humanLegend, legendFont, theme.label, "legend-human", legendEntryW, legendRowH) },
        ]),
      },
      { weight: 14, node: EMPTY },
    ]);
    const band = colSplit([
      { weight: wOf(tileW, content.w), node: shareTile(share, "agent-authored", theme, tileW, bandH) },
      { weight: wOf(bandGapX, content.w), node: EMPTY },
      { weight: wOf(content.w - tileW - bandGapX, content.w), node: right },
    ]);

    // ── the feed: the alpine commit feed, nested at the cell, colour-coded by author kind ──
    const feedW = content.w;
    const rows = commits.map((c) => {
      const agent = isAgent(c);
      return {
        kind: agent ? "agent" : "human",
        title: c.title,
        author: c.author,
        area: agent ? c.agent!.trim() : c.area,
        ...(c.pr != null && c.pr !== "" ? { pr: c.pr } : {}),
        ...(c.date ? { date: c.date } : {}),
        ...(c.reviewers?.length ? { reviewers: c.reviewers } : {}),
        signal: "neutral",
      };
    });
    const feedCtx = { ...ctx, target: { width: feedW, height: feedH, fps: ctx.target.fps, durationMs: ctx.target.durationMs }, output: { ...ctx.output, width: feedW, height: feedH } } as MosaicEngineContext;
    let feed: MosaicRenderableFile;
    try {
      feed = await renderNestedTemplate(
        FEED_TEMPLATE_ID,
        {
          rows,
          preset: props.preset ?? "light",
          showHeader: false,
          // The card colour, not a transparent surface: a nested child comes
          // back through an opaque intermediate under an opaque root, so
          // "black@0" renders black. Same colour as our card = seamless.
          backgroundColor: theme.card,
          washColor: theme.card,
          accent: agentColor,
          kindColors: { agent: agentColor, human: humanColor },
          kindGlyphs: { agent: "blocks", human: "dot" },
          anim: { renderMode: anim.renderMode, introFrac: anim.introFrac, reduceMotion: anim.reduceMotion },
        } as never,
        feedCtx,
        { slot: { width: feedW, height: feedH, fps: ctx.target.fps, durationMs: ctx.target.durationMs } },
      );
    } catch (err) {
      return fail(`the nested commit feed failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (feed.kind !== "mosaic_document") return fail(`the nested commit feed rendered a ${feed.kind}`);

    const feedNode = paint(tag({ type: "mosaic", ref: "feed", placement: { fit: "contain" } } as unknown as MosaicSource, "feed"));
    const bandNode = animate ? revealFadeNode(band, 0, Math.max(0.1, introSec * 0.35)) : band;
    const body = rowSplit([
      { weight: wOf(bandTop, content.h), node: EMPTY },
      { weight: wOf(bandH, content.h), node: bandNode },
      { weight: wOf(bandGap, content.h), node: EMPTY },
      { weight: wOf(feedH, content.h), node: feedNode },
    ]);
    const root = card.compose(body);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {},
      m0: toM0String(root.m0, "AgentCommitFeedV1"),
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
      children: { feed },
      editor: { label: `Agent Commit Feed · ${share}% agent-authored` },
    } as MosaicDocument;

    const constraints: LayoutConstraint[] = [
      ...card.constraints,
      { label: "share-value", textFits: {} },
      { label: "share-label", textFits: {} },
      { label: "legend-agent-text", textFits: {} },
      { label: "legend-human-text", textFits: {} },
      { label: "legend-agent-dot", aspect: 1, aspectTolerance: 0.2 },
      { label: "legend-human-dot", aspect: 1, aspectTolerance: 0.2 },
      { label: "feed", minHeightFrac: 0.4 },
    ];
    return withLayoutContract(doc, ctx, { templateId: TEMPLATE_ID, constraints, relations: [], flatten: false, debug: props.debugLayout === true });
  },
};

registerTemplate(AgentCommitFeedV1);
export default AgentCommitFeedV1;
