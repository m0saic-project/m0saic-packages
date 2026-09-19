import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/timeline/v2 — Alpine Timeline (RATIO rebuild)
 * ============================================================================
 *
 * Same picture as v1 — a milestone timeline with a spine + a dot per event and
 * each event's date / title / description — but rebuilt as a RATIO layout
 * instead of absolute `placeRects`.
 *
 * v1 packed the spine segments, dots and every text line as exact-pixel rects
 * via `placeRects` on the SNAP lattice, so its precision floor tracked the
 * canvas (audit: ABSOLUTE, slope 1.04) — a nestable primitive that pins its
 * parent near its own render canvas. v2 emits nested row/col splits: the dots
 * ride one shared band (a colSplit for horizontal, a rowSplit for vertical),
 * each centered to a square via `insetNode`; spine segments overlay behind them;
 * the text blocks are a parallel split. Weights are proportions of the content
 * rect, so the m0 is resolution-invariant and it composes at any canvas.
 *
 * auto → horizontal on a wide card, vertical on square/tall. Dots/spine/text
 * cascade in (premium = alpha fade / light = enable-gate pop); reduceMotion →
 * static.
 * ============================================================================
 */

import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource, MosaicTextSource, MosaicTemplate } from "@m0saic/types";
import { definePropsSchema, registerTemplate, makeColorTile, makeErrorMosaic, fadeInExpr, withLayoutContract, textEmUnits, bindProp, bindPropPath, type EaseName, type ThemeSourceConfig } from "@m0saic/template-utils";
import {
  alpineCard, EMPTY, paint, rowSplit, colSplit, overlay, tag, fitEmUnits, resolveColor, type Node, type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type TimelineEvent = { date?: string; title: string; description?: string; color?: MosaicColor };
/** Reveal cost/quality dial. "premium" (default): dots/spine/text fade in (a geq
 *  each). "light": the same cascade via free enable-gate pops — no geq, composable. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; reduceMotion: boolean; introFrac: number; easing: EaseName };
/** "auto" → horizontal on a wide (landscape) card, vertical otherwise. */
type Orientation = "auto" | "vertical" | "horizontal";

type AlpineTimelineV2Props = {
  events: TimelineEvent[];
  title?: string;
  subtitle?: string;
  orientation?: Orientation;
  preset?: AlpinePreset;
  showDescription?: boolean;
  /** Spine + dot accent color. Defaults to the theme primary. */
  color?: MosaicColor;
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert dots equal-size + text fits its slot. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, easing: "easeOut", reduceMotion: false };
const MAX_EVENTS = 7;

// A full circle in a 24×24 viewBox (centered (12,12), r=11), for the dot mask.
const DOT_CIRCLE_PATH = "M1,12 A11,11 0 1,0 23,12 A11,11 0 1,0 1,12 Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellText(text: string, fontSize: number, color: MosaicColor, hAlign: "left" | "center" | "right" = "left"): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign, vAlign: "middle" } as any }] };
}
function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}
/** FIT-FIRST text strategy (founder ruling, gate 11): a user's text should be
 *  SHOWN, not cut — wrap at word boundaries into ≤maxLines lines; if the base
 *  font can't hold it, step down ONE notch (×0.85, floor 9); only when even
 *  that overflows, ellipsize the tail. Widths are script-aware (textEmUnits
 *  at the pack's 0.62em model). maxLines caps the vertical growth so a long
 *  paragraph never becomes an unreadable tower. */
function wrapToWidth(text: string, font: number, maxW: number, maxLines: number): { text: string; font: number; lineCount: number } {
  const attempt = (f: number, force: boolean): string[] | null => {
    const maxUnits = Math.max(2, maxW / (f * 0.62));
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const cand = cur ? `${cur} ${w}` : w;
      if (textEmUnits(cand) <= maxUnits) { cur = cand; continue; }
      if (!cur) {
        if (!force) return null; // a single word wider than the line — font too big
        cur = fitEmUnits(w, maxUnits);
        continue;
      }
      lines.push(cur);
      if (lines.length === maxLines) {
        if (!force) return null;
        const rest = [w, ...words.slice(i + 1)].join(" ");
        lines[maxLines - 1] = fitEmUnits(`${lines[maxLines - 1]} ${rest}`, maxUnits);
        return lines;
      }
      cur = textEmUnits(w) <= maxUnits ? w : (force ? fitEmUnits(w, maxUnits) : "");
      if (!cur && !force) return null;
    }
    if (cur) lines.push(cur);
    return lines.length <= maxLines || force ? lines.slice(0, maxLines) : null;
  };
  const small = Math.max(9, Math.round(font * 0.85));
  const atBase = attempt(font, false);
  if (atBase) return { text: atBase.join("\n"), font, lineCount: atBase.length };
  const atSmall = attempt(small, false);
  if (atSmall) return { text: atSmall.join("\n"), font: small, lineCount: atSmall.length };
  const forced = attempt(small, true)!;
  return { text: forced.join("\n"), font: small, lineCount: forced.length };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineTimelineV2Props>({
  events: { type: "array" as any, required: true, description: "Timeline events (top→bottom). Each: an optional date, a title, an optional description + color.", meta: { control: { flavor: "objectRows", columns: [{ label: "Date", key: "date", kind: "text", placeholder: "Jan 2024" }, { label: "Title", key: "title", kind: "text", placeholder: "Milestone" }, { label: "Description", key: "description", kind: "text", placeholder: "What happened" }, { label: "Color", key: "color", kind: "color" }] }, ui: { label: "Events", order: 1 } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., MILESTONES" }, ui: { label: "Title", order: 2 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  orientation: { type: "string", required: false, description: "Layout direction. auto → horizontal on a wide card, vertical on square/tall.", meta: { constraints: { oneOf: ["auto", "vertical", "horizontal"] }, ui: { label: "Orientation", order: 4 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 5 } } },
  showDescription: { type: "boolean", required: false, description: "Show each event's description line.", meta: { ui: { label: "Show description", order: 6 } } },
  color: { type: "string", required: false, description: "Spine + dot accent color. Defaults to the theme primary.", meta: { constraints: { isColor: true }, control: { placeholder: "theme primary", colorPicker: true, defaultColor: "#2563EB" }, ui: { label: "Accent color", order: 7 } } },

  anim: {
    type: "group" as any, required: false, description: "Reveal mode + spine-draw cascade intro.",
    meta: { ui: { label: "Animation", order: 8, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): dots/spine/text fade in — a geq each. \"light\": the same cascade via free enable-gate pops — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      easing: ALPINE_ANIM_FIELDS.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 9, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,
  debugLayout: { type: "boolean", required: false, description: "Dev-only: draw the layout contract (dots equal-size, event text fits its slot) instead of the card.", meta: { ui: { label: "Debug layout", order: 10 } } },
});

export const AlpineTimelineV2: MosaicTemplate<AlpineTimelineV2Props> = {
  id: asTemplateId("@m0saic/alpine/timeline/v2"),
  label: "Alpine Timeline",
  version: 2,
  description: "Alpine timeline — friendly mobile-marketing card: a milestone timeline with a spine + dots that draw down/across, each event a date + title + description. Standalone Alpine brand flavor. v2 rebuilds the geometry as a RATIO layout (nested proportional splits with insetNode-centered dots) so it composes at any canvas without the absolute-placement precision blowup.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "timeline", "milestones", "animated", "analysts", "marketers", "roadmap"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    debugLayout: false,
    theme: { forceFetch: false },
    events: [
      { date: "Jan 2024", title: "Kickoff", description: "First commit landed" },
      { date: "Apr 2024", title: "Beta launch", description: "500 early users" },
      { date: "Aug 2024", title: "Series A", description: "$12M raised" },
      { date: "Dec 2024", title: "10k customers", description: "Five figures crossed" },
    ],
    title: "MILESTONES",
    subtitle: "Our journey so far",
    preset: DEFAULT_PRESET,
    orientation: "auto",
    showDescription: true,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineTimelineV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    // Keep each drawn event's ORIGINAL index into props.events: the leaf
    // bindings (Make's double-click edit of events[i].date / title /
    // description) must address the prop value, not the filtered / truncated
    // draw order.
    const eventEntries = (props.events ?? [])
      .map((e, srcIndex) => ({ e, srcIndex }))
      .filter(({ e }) => e && typeof e.title === "string" && e.title.trim())
      .slice(0, MAX_EVENTS);
    const events = eventEntries.map((x) => x.e);
    if (events.length === 0) {
      return makeErrorMosaic("events[] must have at least one event with a title", { title: `${this.id} props`, width: W, height: H });
    }
    const N = events.length;

    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    const showDescription = props.showDescription ?? true;
    const accent = resolveColor(props.color, theme.primary);
    const dotColor = (i: number): MosaicColor => resolveColor(events[i].color, accent);

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    // Fonts (sized to H — the ratio convention).
    const titleFont = Math.max(13, Math.round(H * 0.03));
    const dateFont = Math.max(10, Math.round(H * 0.021));
    const descFont = Math.max(10, Math.round(H * 0.022));

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const introDelay = Math.min(0.12, introT * 0.06);
    const CASCADE = 0.6;
    const eventDur = Math.max(0.05, (introT - introDelay) / (1 + CASCADE * Math.max(0, N - 1)));
    const eventStagger = CASCADE * eventDur;
    const startAt = (i: number) => (animate ? introDelay + i * eventStagger : 0);

    // Mode-aware reveal (premium fades = geq; light enable-gates = no geq; static otherwise).
    const revealSrc = <T extends MosaicSource>(src: T, s: number): T =>
      !animate ? src : light ? revealGate(src, s) : fadeIn(src, s, eventDur, true);
    const revealNode = (node: Node, s: number): Node =>
      !animate ? node : { ...node, sources: node.sources.map((x) => revealSrc(x, s)) };

    // A tile (dot / spine segment), carved to its target box by a SYMMETRIC
    // placement.inset instead of insetNode px margins. insetNode's real-split
    // margins minted 74/77-way canonical splits here (px weights, gcd 1) —
    // sub-pixel cells at common canvases made the engine fold paint slots away
    // and refuse the doc (m0 22 slots vs 26 sources; gate-11 battery: 15/84
    // canvases failed). Placement insets add NO split cells, and the engine
    // applies them BEFORE the mask scales — so the inset also squares the
    // dot's box (the circle mask STRETCHES post-r2; a non-square box would
    // draw an ellipse). Dots: crisp vector circle via a cell-local
    // inline-mask. Spine: a rounded-rect theme-grid rule.
    const inFrac = (span: number, keep: number): number =>
      Math.max(0, Math.min(0.49, (span - keep) / (2 * span)));
    // "dot" tag = the layout contract's join key (equal-size relation).
    // Color handle: a dot painted with the event's OWN color binds that leaf
    // (events[ri].color, ORIGINAL index) INSTEAD of the shared accent; every
    // other dot shows `color` and binds it (1:N). Mirrors resolveColor's
    // blank / "none" fallback so the handle always names the paint that shows.
    // The spine is theme-grid (not the accent) → never bound.
    const hasOwnColor = (i: number): boolean => {
      const v = String(events[i].color ?? "").trim();
      return !!v && v.toLowerCase() !== "none";
    };
    const dotTile = (i: number, cellW: number, cellH: number, diam: number): MosaicSource => {
      const t = tag(makeColorTile(dotColor(i), {
        mask: { kind: "inline-mask", localPath: DOT_CIRCLE_PATH, bounds: { x: 0, y: 0, width: 24, height: 24 } },
        placement: { inset: { x: inFrac(cellW, diam), y: inFrac(cellH, diam) } },
      }) as MosaicSource, "dot");
      return hasOwnColor(i) ? bindPropPath(t, "events", [eventEntries[i].srcIndex, "color"], "color") : bindProp(t, "color");
    };
    const spineTile = (cellW: number, cellH: number, keepW: number, keepH: number): MosaicSource =>
      makeColorTile(theme.grid, {
        effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.5 } },
        placement: { inset: { x: inFrac(cellW, keepW), y: inFrac(cellH, keepH) } },
      }) as MosaicSource;

    type EventField = "date" | "title" | "description";
    type Line = { text: string; font: number; color: MosaicColor; kind: string; field: EventField; lineCount: number };
    const eventLines = (i: number, maxW: number): Line[] => {
      const lines: Line[] = [];
      // Dates stay one line (they're labels); title/description wrap to ≤2.
      if (events[i].date && events[i].date!.trim()) {
        const d = wrapToWidth(events[i].date!, dateFont, maxW, 1);
        lines.push({ text: d.text, font: d.font, color: theme.muted, kind: "event-date", field: "date", lineCount: d.lineCount });
      }
      const t = wrapToWidth(events[i].title, titleFont, maxW, 2);
      lines.push({ text: t.text, font: t.font, color: theme.title, kind: "event-title", field: "title", lineCount: t.lineCount });
      if (showDescription && events[i].description && events[i].description!.trim()) {
        const dd = wrapToWidth(events[i].description!, descFont, maxW, 2);
        lines.push({ text: dd.text, font: dd.font, color: theme.subtitle, kind: "event-desc", field: "description", lineCount: dd.lineCount });
      }
      return lines;
    };
    let hasDates = false, hasDescs = false;
    // A vertical stack of text lines (proportional heights), reveal-wrapped.
    // Line weights snap to a SMALL basis (font/8): raw px-ish weights (gcd 1)
    // canonicalized to ~90-way splits — sub-pixel cells at small canvases.
    const textStack = (i: number, maxW: number, hAlign: "left" | "center"): Node => {
      const lines = eventLines(i, maxW);
      for (const ln of lines) { if (ln.kind === "event-date") hasDates = true; if (ln.kind === "event-desc") hasDescs = true; }
      // Each line is its own rect showing ONE leaf of events[ri] — bound at the
      // event's ORIGINAL index so Make edits the prop value, not the draw order.
      const ri = eventEntries[i].srcIndex;
      const bands: Band[] = lines.map((ln) => ({ weight: Math.max(2, Math.round((ln.font * 1.4 * ln.lineCount) / 8)), node: paint(bindPropPath(tag(cellText(ln.text, ln.font, ln.color, hAlign), ln.kind), "events", [ri, ln.field], "string")) }));
      return revealNode(rowSplit(bands), startAt(i) + eventDur * 0.25);
    };

    const orientation: "vertical" | "horizontal" =
      props.orientation === "vertical" || props.orientation === "horizontal"
        ? props.orientation
        : W / H >= 1.25 ? "horizontal" : "vertical";

    let body: Node;
    if (orientation === "vertical") {
      // ── Vertical: [rail | gap | text column]; dots share the rail's x, spread down. ──
      const railWpx = Math.round(cr.w * 0.06);
      const gapWpx = Math.round(cr.w * 0.03);
      const textWpx = Math.max(1, cr.w - railWpx - gapWpx);
      const rowHpx = cr.h / N;
      const dotDiam = Math.max(6, Math.round(Math.min(railWpx, rowHpx) * 0.5));

      // Dots column: one EQUAL band per row, the dot carved to a centered
      // square by its own placement inset (no split cells).
      const dotsCol = rowSplit(
        Array.from({ length: N }, (_, i): Band => ({
          weight: 1,
          node: revealNode(paint(dotTile(i, railWpx, rowHpx, dotDiam)), startAt(i)),
        })),
      );
      // Spine: thin vertical segments between consecutive dot centers (behind
      // the dots) — each a full [1,2,1]-band cell, slimmed by placement inset.
      const spineW = Math.max(2, Math.round(dotDiam * 0.16));
      const segCellH = cr.h / N; // one pitch (2 units of the [1,2…2,1] split)
      const seg = (i: number): Node =>
        revealNode(paint(spineTile(railWpx, segCellH, spineW, segCellH)), startAt(i));
      const spineCol = N > 1
        ? rowSplit([
            { weight: 1, node: EMPTY },
            ...Array.from({ length: N - 1 }, (_, k): Band => ({ weight: 2, node: seg(k + 1) })),
            { weight: 1, node: EMPTY },
          ])
        : EMPTY;
      const railCol = overlay([spineCol, dotsCol]);

      // Text column: one left-aligned stack per row (shares the row banding with the rail).
      const textMaxW = Math.max(dotDiam * 4, Math.round(textWpx * 0.96));
      const textColNode = rowSplit(Array.from({ length: N }, (_, i): Band => ({ weight: 100, node: textStack(i, textMaxW, "left") })));

      body = colSplit([
        { weight: Math.round((railWpx / cr.w) * 100), node: railCol },
        { weight: Math.round((gapWpx / cr.w) * 100), node: EMPTY },
        { weight: Math.max(1, 100 - Math.round((railWpx / cr.w) * 100) - Math.round((gapWpx / cr.w) * 100)), node: textColNode },
      ]);
    } else {
      // ── Horizontal: [top text · spine row · bottom text]; dots share the spine's y,
      //    spread across x. Even events sit above the spine, odd events below. ──
      const colWpx = cr.w / N;
      const spineBandHpx = Math.round(cr.h * 0.14);
      const dotDiam = Math.max(6, Math.round(Math.min(spineBandHpx, colWpx) * 0.42));
      const textMaxW = Math.round(colWpx * 0.92);
      const halfHpx = Math.round((cr.h - spineBandHpx) / 2);

      // Dots row: one EQUAL band per column, the dot carved to a centered
      // square by its own placement inset (no split cells).
      const dotsRow = colSplit(
        Array.from({ length: N }, (_, i): Band => ({
          weight: 1,
          node: revealNode(paint(dotTile(i, colWpx, spineBandHpx, dotDiam)), startAt(i)),
        })),
      );
      // Spine: thin horizontal segments between consecutive dot centers (behind
      // the dots) — each a full [1,2,1]-band cell, slimmed by placement inset.
      const spineH = Math.max(2, Math.round(dotDiam * 0.16));
      const segCellW = cr.w / N; // one pitch (2 units of the [1,2…2,1] split)
      const seg = (i: number): Node =>
        revealNode(paint(spineTile(segCellW, spineBandHpx, segCellW, spineH)), startAt(i));
      const spineLine = N > 1
        ? colSplit([
            { weight: 1, node: EMPTY },
            ...Array.from({ length: N - 1 }, (_, k): Band => ({ weight: 2, node: seg(k + 1) })),
            { weight: 1, node: EMPTY },
          ])
        : EMPTY;
      const spineRow = overlay([spineLine, dotsRow]);

      // Text rows: even events above (bottom-anchored toward the spine), odd below (top).
      const topRow = colSplit(Array.from({ length: N }, (_, i): Band => ({ weight: 100, node: i % 2 === 0 ? textStack(i, textMaxW, "center") : EMPTY })));
      const botRow = colSplit(Array.from({ length: N }, (_, i): Band => ({ weight: 100, node: i % 2 === 1 ? textStack(i, textMaxW, "center") : EMPTY })));

      body = rowSplit([
        { weight: Math.round((halfHpx / cr.h) * 100), node: topRow },
        { weight: Math.round((spineBandHpx / cr.h) * 100), node: spineRow },
        { weight: Math.max(1, 100 - Math.round((halfHpx / cr.h) * 100) - Math.round((spineBandHpx / cr.h) * 100)), node: botRow },
      ]);
    }

    const root = card.compose(body);

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire: every dot paints the same size (the carved-inset promise —
    // this is the check that would have caught the insetNode remainder drift),
    // and every event text line FITS its slot at the CLI's metrics. No expr
    // text in this template, so text-fit runs on every config. Falsy
    // debugLayout (default) returns the doc untouched at zero cost.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/timeline/v2",
        relations: N >= 2 ? [{ label: "dot", equal: "size", tolerance: 0.02, tolerancePx: 1 }] : [],
        constraints: [
          ...card.constraints,
          { label: "event-title", textFits: { charWidthEm: 0.62 } },
          ...(hasDates ? [{ label: "event-date", textFits: { charWidthEm: 0.62 } }] : []),
          ...(hasDescs ? [{ label: "event-desc", textFits: { charWidthEm: 0.62 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineTimelineV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineTimelineV2.render(
      {
        ...(AlpineTimelineV2.defaultProps as AlpineTimelineV2Props),
        anim: { ...DEFAULT_ANIM, reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Timeline",
        title: "A timeline.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(AlpineTimelineV2);
