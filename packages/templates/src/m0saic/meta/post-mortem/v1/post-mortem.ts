import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { bundledAssetPath } from "@m0saic/template-utils/dist/m0saic/assetPath";

import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicPipelineStep,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import type { StableKey } from "@m0saic/dsl";
import type { M0Label } from "@m0saic/dsl-file-formats";
import {
  addOverlayLayer,
  circleMask,
  placeRect,
  toM0String,
  weightedSplit,
} from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  multilineTextLayers,
  registerTemplate,
  renderNestedTemplate,
} from "@m0saic/template-utils";
// loadSession reads the filesystem — deep import (not re-exported from the
// barrel, which must stay web-bundleable). This template is node-only anyway.
import {
  loadSession,
  type LoadedCandidate,
  type LoadedSession,
} from "@m0saic/template-utils/dist/m0saic/loadSession";

/**
 * `post-mortem/v1` — render a sandbox session as a watchable video.
 *
 * Reading experience (Stack Overflow / Reddit thread → video):
 *   - Left half  : chat thread. Accumulates downward as the pipeline advances.
 *   - Right half : the candidate's geometry, rendered as a wireframe.
 *   - Bottom strip (deferred to v1.1): chess-style move list with score sparkline.
 *
 * v1 is **structural / placeholder visuals**. The layout split is in place,
 * the chat advances, the canvas swaps per candidate — but the styling is
 * deliberately plain. We iterate the look-and-feel against real sandbox
 * sessions (dogfooding the sandbox package itself).
 *
 * Deferred to v1.1+ (TODOs in source):
 *   - Per-party chat-bubble styling, grade/score badges, region overlays.
 *   - Game-review-board summary step (eval graph + per-party stats + per-phase chips).
 *   - Cross-fade/slide transitions between candidate steps.
 *   - Comments thread rendering.
 *   - Coach speech-bubble takeaway on the end card.
 *   - `.m0c` first-class rendering (background image + masks).
 */

export type PostMortemProps = {
  /**
   * Path to a sandbox session directory. Absolute, or relative to the
   * repo root (e.g. `"packages/sandbox/sessions/2026-06-09-bar-graph"`).
   */
  sessionPath: string;
  /** Hard cap on candidates to render. Default: render all. */
  maxCandidates?: number;
  /** Per-candidate dwell time in milliseconds. */
  msPerCandidate?: number;
  /** Title-card dwell time in milliseconds. */
  msTitleCard?: number;
  /** End-card dwell time in milliseconds. */
  msEndCard?: number;
  /**
   * Tunable split: chat-column weight (integer slots). Default 1.
   * Together with {@link canvasWeightSlots} this drives the
   * `weightedSplit([chat, canvas], "col")` for each candidate step.
   * Bump granularity (e.g. 2 + 7 → 2/9 chat) when fine-tuning the ratio.
   */
  chatWeightSlots?: number;
  /** Tunable split: canvas-column weight (integer slots). Default 3. */
  canvasWeightSlots?: number;
};

const DEFAULT_MS_PER_CANDIDATE = 4000;
const DEFAULT_MS_TITLE_CARD = 2500;
const DEFAULT_MS_END_CARD = 2500;
const DEFAULT_FPS = 30;

// Sidecar avatar assets. User-generated PNGs (via the ChatGPT prompt in
// the iter13 thread) live in this template's assets/ folder. If they're
// missing at render time, fall back to colored initial-letter text so
// the template still renders rather than hard-failing.
// Templates build to CJS, so __dirname is always available. The robot.png
// filename matches the actual subject (the agent role is rendered as a
// robot) — `agent` is a role, `robot` is what the bitmap depicts.
/**
 * Resolve a session path. Absolute paths pass through; relative paths
 * try CWD first, then walk up the ancestor chain until the path exists
 * — so the conventional repo-root-relative form
 * ("packages/sandbox/sessions/<slug>") works from the repo root, from
 * packages/cli (where the e2e suites run), or any other dir inside the
 * tree. Falls back to plain CWD resolution when nothing matches (the
 * loader then reports the missing dir with the full path).
 */
function resolveSessionPath(p: string): string {
  if (isAbsolute(p)) return p;
  let dir = process.cwd();
  for (;;) {
    const cand = resolve(dir, p);
    if (existsSync(cand)) return cand;
    const parent = dirname(dir);
    if (parent === dir) return resolve(p);
    dir = parent;
  }
}

// asar-translated: `__dirname` sits inside `app.asar` in a packaged Electron
// app and ffmpeg can't read an archive. The existsSync probes below must test
// the SAME translated path, since existsSync succeeds on the in-asar one.
const ASSET_AGENT_PNG = bundledAssetPath(resolve(__dirname, "assets"), "robot.png");
const ASSET_HUMAN_PNG = bundledAssetPath(resolve(__dirname, "assets"), "human.png");
const HAS_AGENT_AVATAR = existsSync(ASSET_AGENT_PNG);
const HAS_HUMAN_AVATAR = existsSync(ASSET_HUMAN_PNG);

// Layout split default: 40% chat, 60% canvas (2:3 slot ratio). Tunable
// at render time via chatWeightSlots / canvasWeightSlots props. Bumped
// from 2:5 (28.6%) per user feedback — the chat needs room for bubble
// layout with sender attribution; agent and human bubbles have to be
// legible side-by-side.
const DEFAULT_CHAT_WEIGHT_SLOTS = 2;
const DEFAULT_CANVAS_WEIGHT_SLOTS = 3;

const propsSchema = definePropsSchema<PostMortemProps>({
  sessionPath: {
    type: "string",
    required: true,
    description: "Path to a sandbox session directory (absolute or repo-root-relative).",
    meta: {
      control: { placeholder: "packages/sandbox/sessions/2026-06-09-bar-graph" },
      ui: { label: "Session path" },
    },
  },
  maxCandidates: {
    type: "number",
    required: false,
    description: "Hard cap on candidates rendered. Default: all.",
    meta: { control: { placeholder: "all" }, ui: { label: "Max candidates" } },
  },
  msPerCandidate: {
    type: "number",
    required: false,
    description: "Per-candidate dwell time in milliseconds.",
    meta: { ui: { label: "ms per candidate" } },
  },
  msTitleCard: {
    type: "number",
    required: false,
    description: "Title card dwell time in milliseconds.",
    meta: { ui: { label: "ms title card" } },
  },
  msEndCard: {
    type: "number",
    required: false,
    description: "End card dwell time in milliseconds.",
    meta: { ui: { label: "ms end card" } },
  },
  chatWeightSlots: {
    type: "number",
    required: false,
    description: "Chat-column weight in integer slots (default 1, paired with canvasWeightSlots=3 for a 25/75 split).",
    meta: { ui: { label: "Chat weight (slots)" } },
  },
  canvasWeightSlots: {
    type: "number",
    required: false,
    description: "Canvas-column weight in integer slots (default 3, paired with chatWeightSlots=1 for a 25/75 split).",
    meta: { ui: { label: "Canvas weight (slots)" } },
  },
});

// ── Pipeline build ──────────────────────────────────────────────────────────

export const PostMortem: MosaicTemplate<PostMortemProps> = {
  id: asTemplateId("@m0saic/meta/post-mortem/v1"),
  label: "Post-Mortem (Session Replay)",
  version: 1,
  description:
    "Renders a sandbox session as a watchable video — chat thread on the left, wireframe on the right.",
  capabilities: { tier: "core" },
  // Dev tool for this repo's agent/sandbox workflow — keep off the shelves.
  internal: true,
  tags: ["developer", "meta", "session", "post-mortem", "sandbox"],
  outputHints: {
    width: 1920,
    height: 1080,
    fps: DEFAULT_FPS,
    durationMs: 10_000,
    note: "Variable duration — sums per-candidate steps plus title + end cards.",
  },
  propsSchema,
  defaultProps: {
    canvasWeightSlots: 3,
    chatWeightSlots: 2,
    msEndCard: 2500,
    msTitleCard: 2500,
    msPerCandidate: 4000,
    sessionPath: "packages/sandbox/sessions",
  },

  async render(
    props: PostMortemProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocumentPipeline> {
    let msPerCandidate = props.msPerCandidate ?? DEFAULT_MS_PER_CANDIDATE;
    let msTitle = props.msTitleCard ?? DEFAULT_MS_TITLE_CARD;
    let msEnd = props.msEndCard ?? DEFAULT_MS_END_CARD;
    const chatSlots = props.chatWeightSlots ?? DEFAULT_CHAT_WEIGHT_SLOTS;
    const canvasSlots = props.canvasWeightSlots ?? DEFAULT_CANVAS_WEIGHT_SLOTS;

    // Resolve session path (allow repo-root-relative for convenience).
    // A relative path is tried against CWD, then each ancestor — so
    // "packages/sandbox/sessions/<slug>" works whether the render runs
    // from the repo root, packages/cli (the e2e suites), or anywhere
    // else inside the tree.
    const sessionAbsPath = resolveSessionPath(props.sessionPath);
    const loaded = loadSession(sessionAbsPath);
    const candidates =
      props.maxCandidates != null
        ? loaded.candidates.slice(0, props.maxCandidates)
        : loaded.candidates;

    // Honor ctx.target.durationMs (the engine's expected total) by
    // scaling per-step durations proportionally. Without this, calling
    // post-mortem from a .mosaicx that declares its own durationMs
    // throws "steps must sum to ctx.target.durationMs". Better UX:
    // adapt the pacing to fit the target window. When no target is
    // set, use natural pacing from the props.
    const naturalTotalMs =
      msTitle + candidates.length * msPerCandidate + msEnd;
    const targetTotalMs = ctx.target.durationMs ?? naturalTotalMs;
    if (
      naturalTotalMs > 0 &&
      Math.abs(targetTotalMs - naturalTotalMs) > 1
    ) {
      const scale = targetTotalMs / naturalTotalMs;
      msTitle = Math.max(100, Math.round(msTitle * scale));
      msPerCandidate = Math.max(100, Math.round(msPerCandidate * scale));
      msEnd = Math.max(100, Math.round(msEnd * scale));
    }

    const steps: MosaicPipelineStep[] = [];

    // ── Title card ──────────────────────────────────────────────────────────
    steps.push({
      durationMs: msTitle,
      file: buildTitleCard(loaded, candidates.length),
    });

    // ── Per-candidate steps ─────────────────────────────────────────────────
    // The chat accumulates: each step rebuilds with all moments so far.
    const chatLines: ChatLine[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      pushCandidateMoments(chatLines, c);
      steps.push({
        durationMs: msPerCandidate,
        file: await buildCandidateStep(
          loaded, candidates, i, chatLines, ctx,
          chatSlots, canvasSlots,
        ),
      });
    }

    // ── End card ────────────────────────────────────────────────────────────
    steps.push({
      durationMs: msEnd,
      file: buildEndCard(loaded, candidates.length),
    });

    // Reconcile rounding drift: after proportional scaling, the sum of
    // per-step durations may be off by a few ms from targetTotalMs.
    // The engine's timing invariant requires exact match, so push any
    // residual onto the last step (always non-empty since we have at
    // least title + end card).
    const summedMs = steps.reduce((sum, s) => sum + s.durationMs, 0);
    const drift = targetTotalMs - summedMs;
    if (drift !== 0 && steps.length > 0) {
      const last = steps[steps.length - 1];
      steps[steps.length - 1] = {
        ...last,
        durationMs: Math.max(100, last.durationMs + drift),
      };
    }
    const finalTotalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);

    return {
      kind: "mosaic_pipeline",
      version: 1,
      fps: ctx.target.fps ?? DEFAULT_FPS,
      durationMs: finalTotalMs,
      defaultTransition: { type: "cut" },
      backgroundColor: "#0f1116",
      steps,
    };
  },
};

registerTemplate(PostMortem);

// ── Internals ───────────────────────────────────────────────────────────────

type ChatLine = {
  /** "agent" or "human" — drives styling later (deferred). */
  speaker: "agent" | "human" | "system";
  /** One line of prose. Long messages get split into multiple ChatLines. */
  text: string;
};

/**
 * Append the conversation moments contributed by one candidate to the
 * running chat-line list. v1 captures question (agent) + response body
 * (human) + a short evaluation line when present. Comments deferred to v1.1.
 */
function pushCandidateMoments(into: ChatLine[], c: LoadedCandidate): void {
  const num = c.ref.number;
  into.push({ speaker: "system", text: `── candidate-${num} ──` });
  if (c.agent?.note) {
    into.push({ speaker: "agent", text: `note: ${c.agent.note}` });
  }
  if (c.agent?.question) {
    into.push({ speaker: "agent", text: `Q: ${c.agent.question}` });
  }
  if (c.agent?.response?.body) {
    const from = c.agent.response.from ?? "human";
    into.push({ speaker: "human", text: `${from}: ${c.agent.response.body}` });
  }
  const evalGrade = c.context?.evaluation?.grade;
  if (evalGrade) {
    const src = c.context?.evaluation?.source ?? "human";
    into.push({ speaker: "system", text: `▶ grade: ${evalGrade} (${src})` });
  }
}

function buildTitleCard(loaded: LoadedSession, candidateCount: number): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as never,
    m0: toM0String("F", "PostMortem/card"),
    sources: [
      {
        type: "text",
        placement: { hAlign: "center", vAlign: "middle" },
        style: { fontSize: 48, fontColor: "#ffffff" },
        visual: { backgroundColor: "#0f1116" },
        layers: [
          {
            content: { kind: "literal", text: loaded.session.slug },
            placement: {
              hAlign: "center",
              vAlign: "middle",
              yExpr: "(h-text_h)/2 - text_h*0.8",
            },
            style: { fontSize: 64, fontColor: "#ffffff" },
          },
          {
            content: {
              kind: "literal",
              text: `${candidateCount} candidate${candidateCount === 1 ? "" : "s"}`,
            },
            placement: {
              hAlign: "center",
              vAlign: "middle",
              yExpr: "(h-text_h)/2 + text_h*0.8",
            },
            style: { fontSize: 32, fontColor: "#9aa0a6" },
          },
        ],
      },
    ],
  };
}

function buildEndCard(loaded: LoadedSession, candidateCount: number): MosaicDocument {
  // TODO v1.1: coach speech-bubble takeaway derived from SessionSummary.
  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as never,
    m0: toM0String("F", "PostMortem/card"),
    sources: [
      {
        type: "text",
        placement: { hAlign: "center", vAlign: "middle" },
        style: { fontSize: 40, fontColor: "#ffffff" },
        visual: { backgroundColor: "#0f1116" },
        layers: [
          {
            content: { kind: "literal", text: "End of session" },
            placement: {
              hAlign: "center",
              vAlign: "middle",
              yExpr: "(h-text_h)/2 - text_h*0.8",
            },
            style: { fontSize: 56, fontColor: "#ffffff" },
          },
          {
            content: {
              kind: "literal",
              text: `${loaded.session.slug} · ${candidateCount} candidate${candidateCount === 1 ? "" : "s"}`,
            },
            placement: {
              hAlign: "center",
              vAlign: "middle",
              yExpr: "(h-text_h)/2 + text_h*0.8",
            },
            style: { fontSize: 28, fontColor: "#9aa0a6" },
          },
        ],
      },
    ],
  };
}

/**
 * One step in the per-candidate sequence. Left column holds the chat
 * accumulated through this candidate; right column holds the candidate's
 * geometry wireframe.
 */
async function buildCandidateStep(
  loaded: LoadedSession,
  candidates: LoadedCandidate[],
  index: number,
  chatLines: ChatLine[],
  ctx: MosaicEngineContext,
  chatSlots: number,
  canvasSlots: number,
): Promise<MosaicDocument> {
  const c = candidates[index];

  // Two-column split: chat on left, canvas on right.
  const m0 = weightedSplit([chatSlots, canvasSlots], "col");

  // Per-column pixel dimensions (needed to build the chat-stream's
  // placeRects geometry — placeRects works in pixel units).
  const totalSlots = chatSlots + canvasSlots;
  const chatColW = Math.max(
    1,
    Math.floor((ctx.target.width * chatSlots) / totalSlots),
  );
  const chatColH = Math.max(1, ctx.target.height);

  // ── Right column: candidate geometry as a labeled wireframe ──────
  // Forwards .m0c labels (real stableKey-keyed) so labeled candidates
  // show their region names on the hero. .m0 candidates fall back to
  // default dim/AR text. `debug-contrast` matches the old m0-snapshot
  // default (numbers/dims/AR + white canvas).
  const canvasSnapshot = await renderNestedTemplate(
    "@m0saic/wireframe/base/v2",
    {
      M0String: c.file.m0,
      preset: "debug-contrast",
      ...(c.labels ? { labelsByStableKey: c.labels } : {}),
    },
    ctx,
  );

  // ── Left column: chat-stream via placeRects + labels ─────────────
  // Each chat moment becomes a dummy bubble rectangle positioned via
  // placeRects (agent left, human right, system center), built directly
  // as a text-source mosaic (see buildChatStream).
  // (This is structural placeholder visuals; real bubble styling
  // lands in a follow-up iteration once the column-width feel is
  // dialed in.)
  const chatStream = await buildChatStream(chatLines, chatColW, chatColH, ctx);

  const children: Record<string, MosaicRenderableFile> = {
    canvas: canvasSnapshot,
    "chat-stream": chatStream,
  };

  const sources: MosaicSource[] = [
    { type: "mosaic", ref: "chat-stream" },
    { type: "mosaic", ref: "canvas" },
  ];

  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as never,
    m0,
    sources,
    backgroundColor: "#0f1116",
    children,
  };
}

/**
 * Build the chat-stream column for one step. Lays out each chat moment
 * as a bubble rectangle via `placeRects`, built directly as a mosaic of
 * per-bubble text sources so each bubble shows its sender + content text.
 *
 * Empty chat → renders a blank column (no placeRects call; that builder
 * errors on empty rects). Otherwise positions:
 *   - agent  → left-aligned (inset 20px from left)
 *   - human  → right-aligned (inset 20px from right)
 *   - system → centered, narrower
 *
 * v1 caps the visible bubbles to the most-recent N that fit in the
 * column height; older messages scroll off. No real bubble styling
 * (background per speaker, rounded corners, etc.) — those land once
 * the column-width feel is dialed in.
 */
async function buildChatStream(
  chatLines: ChatLine[],
  colW: number,
  colH: number,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile> {
  // Layout (locked in via dogfooding through candidate-001..010 in
  // packages/sandbox/sessions/2026-06-09-post-mortem-visuals). All dims
  // snap to a 20px grid so user-drawn Draw Mode additions align cleanly.
  //
  // Per row:
  //   agent  → [avatar 40×40, x=20]  [body 600×100, x=80]
  //   human  → [body  600×100, x=80] [avatar 40×40, x=700]
  //   system → [bar (colW-40)×40, x=20]                  (full-width separator)
  //
  // Avatar rects get a circle mask (via the circleMask helper). Each rect
  // gets a label whose `color` is the chat-bubble fill — surfaced by the
  // editor's "Label colors" toggle (turn on Rects + Masks + Label colors
  // to see the prototyped palette in the editor; the renderer here uses
  // those colors directly via per-source visual.backgroundColor below).
  //
  // Composition: placeRect + addOverlayLayer chain — one rendered frame
  // per layer so input-rect → stableKey mapping holds 1:1. Trade-off is
  // longer m0; the user accepted this for correctness during prototyping.
  // Packing optimization (placeRects on non-overlapping rows) is a follow-up.
  const PAD_X = 20;
  const PAD_TOP = 40;
  const ROW_GAP = 20;
  const BUBBLE_H = 100;
  const SYSTEM_H = 24;          // thin separator — text-only, no fill
  const AVATAR_SIZE = 40;
  const AVATAR_GAP = 20;
  // Avatar sits vertically centered against the body (off the 20-grid by
  // 10px for the avatar's y only — accepted exception so the avatar
  // visually aligns with its prompt rather than top-pinning).
  const AVATAR_Y_OFFSET = Math.floor((BUBBLE_H - AVATAR_SIZE) / 2); // 30
  const BODY_X_LEFT = PAD_X + AVATAR_SIZE + AVATAR_GAP; // 80
  const BODY_W = Math.max(
    AVATAR_SIZE,
    snapDown(colW - PAD_X - AVATAR_SIZE - AVATAR_GAP - BODY_X_LEFT, 20),
  );
  const AVATAR_X_RIGHT = snapDown(colW - PAD_X - AVATAR_SIZE, 20);
  const SYSTEM_W = colW - PAD_X * 2;

  // Anchor newest at the bottom — fit from the end backwards until the
  // running height plus PAD_TOP would exceed colH, then drop older lines.
  const stride = (line: ChatLine) =>
    (line.speaker === "system" ? SYSTEM_H : BUBBLE_H) + ROW_GAP;
  const visible: ChatLine[] = [];
  let usedH = 0;
  for (let i = chatLines.length - 1; i >= 0; i--) {
    const s = stride(chatLines[i]);
    if (usedH + s + PAD_TOP > colH) break;
    visible.unshift(chatLines[i]);
    usedH += s;
  }

  if (visible.length === 0) {
    return blankChatColumn(colW, colH, ctx);
  }

  // Bottom-anchor the stack: start y so the last row ends at colH - PAD_TOP.
  let y = colH - PAD_TOP - usedH + ROW_GAP;

  type Slot = {
    kind: "agent-avatar" | "agent-body" | "human-avatar" | "human-body" | "system";
    rect: { x: number; y: number; w: number; h: number };
    text: string;
  };
  const slots: Slot[] = [];

  for (const line of visible) {
    if (line.speaker === "system") {
      slots.push({
        kind: "system",
        rect: { x: PAD_X, y, w: SYSTEM_W, h: SYSTEM_H },
        text: line.text,
      });
      y += SYSTEM_H + ROW_GAP;
      continue;
    }
    if (line.speaker === "agent") {
      slots.push({
        kind: "agent-avatar",
        rect: { x: PAD_X, y: y + AVATAR_Y_OFFSET, w: AVATAR_SIZE, h: AVATAR_SIZE },
        text: "🤖",
      });
      slots.push({
        kind: "agent-body",
        rect: { x: BODY_X_LEFT, y, w: BODY_W, h: BUBBLE_H },
        text: line.text,
      });
      y += BUBBLE_H + ROW_GAP;
      continue;
    }
    // human
    slots.push({
      kind: "human-body",
      rect: { x: BODY_X_LEFT, y, w: BODY_W, h: BUBBLE_H },
      text: line.text,
    });
    slots.push({
      kind: "human-avatar",
      rect: { x: AVATAR_X_RIGHT, y: y + AVATAR_Y_OFFSET, w: AVATAR_SIZE, h: AVATAR_SIZE },
      text: "👤",
    });
    y += BUBBLE_H + ROW_GAP;
  }

  // Compose via placeRect + addOverlayLayer — one rect per layer, safe.
  // `addOverlayLayer` returns a plain string; re-brand via toM0String at
  // the end so the final `MosaicDocument.m0` is the branded type.
  let m0Str: string = placeRect({
    rootW: colW,
    rootH: colH,
    rectW: slots[0].rect.w,
    rectH: slots[0].rect.h,
    x: slots[0].rect.x,
    y: slots[0].rect.y,
  }).m0;
  for (let i = 1; i < slots.length; i++) {
    const r = slots[i].rect;
    m0Str = addOverlayLayer(
      m0Str,
      placeRect({ rootW: colW, rootH: colH, rectW: r.w, rectH: r.h, x: r.x, y: r.y }).m0,
    );
  }
  const m0 = toM0String(m0Str, "PostMortem/chat-stream");

  // Emit a MosaicDocument directly — one source per rect, with
  // visual.backgroundColor for the bubble fill, text layers for the
  // chat content, and inline masks for the circular avatars. This is
  // the same shape the editor previewed via "Rects + Masks + Label
  // colors" in iter10 — now rendered for real, not just inspected.
  const SLOT_COLOR: Record<Slot["kind"], MosaicColor> = {
    "agent-avatar": "#a8bdcb",
    "agent-body":   "#23262f",
    "human-avatar": "#b3531b",
    "human-body":   "#d96b22",
    "system":       "#3a414a",
  };
  // Body text needs contrast against fill. Dark bodies → light text;
  // bright/orange bodies → dark text (Momo convention).
  const TEXT_COLOR_ON_FILL: Record<Slot["kind"], MosaicColor> = {
    "agent-avatar": "#1a1a1a",
    "agent-body":   "#e5e7eb",
    "human-avatar": "#ffffff",
    "human-body":   "#1a1a1a",
    "system":       "#9aa0a6",
  };

  // Body bubbles need real wrapping (MosaicTextSource has no soft-wrap).
  // Approximate chars per line from rect width + font size — coarse but
  // close enough for the ~600px bubbles. Tune the divisor if a font swap
  // breaks the feel.
  const BODY_FONT_SIZE = 18;
  const CHAR_WIDTH_PX = 10; // rough average for the default sans at 18px
  const bodyMaxCharsPerLine = Math.max(
    8,
    Math.floor((BODY_W - 24 /* padding */) / CHAR_WIDTH_PX),
  );

  // Avatar assets — bundled at template build time. When present, the
  // avatar rect becomes a `MosaicMediaSource` with a circle mask;
  // otherwise we fall back to a single-letter text initial on a
  // colored circle so the layout still reads.
  const assetIdAgent = asAssetId("post_mortem_avatar_agent");
  const assetIdHuman = asAssetId("post_mortem_avatar_human");
  const assets: MosaicAssetManifest = {};
  if (HAS_AGENT_AVATAR) {
    assets[assetIdAgent] = {
      kind: "file",
      path: ASSET_AGENT_PNG,
      mediaType: "image",
    };
  }
  if (HAS_HUMAN_AVATAR) {
    assets[assetIdHuman] = {
      kind: "file",
      path: ASSET_HUMAN_PNG,
      mediaType: "image",
    };
  }

  const sources: MosaicSource[] = slots.map((slot) => {
    const isSystem = slot.kind === "system";

    // ── Avatar slots ────────────────────────────────────────────────
    if (slot.kind === "agent-avatar" || slot.kind === "human-avatar") {
      const hasImage =
        slot.kind === "agent-avatar" ? HAS_AGENT_AVATAR : HAS_HUMAN_AVATAR;
      const assetId =
        slot.kind === "agent-avatar" ? assetIdAgent : assetIdHuman;
      const mask = {
        kind: "inline-mask" as const,
        ...circleMask(AVATAR_SIZE),
      };
      if (hasImage) {
        return {
          type: "media",
          mediaType: "image",
          assetId,
          placement: { fit: "cover" },
          mask,
        };
      }
      // Fallback: colored circle with single initial. Better than the
      // emoji approach (FFmpeg drawtext silently drops emoji glyphs).
      return {
        type: "text",
        style: { fontSize: 22, fontColor: TEXT_COLOR_ON_FILL[slot.kind] },
        placement: { hAlign: "center", vAlign: "middle" },
        visual: { backgroundColor: SLOT_COLOR[slot.kind] },
        layers: [
          {
            content: {
              kind: "literal",
              text: slot.kind === "agent-avatar" ? "A" : "H",
            },
            placement: { hAlign: "center", vAlign: "middle" },
          },
        ],
        mask,
      };
    }

    // ── Body bubbles (wrapped) ──────────────────────────────────────
    if (slot.kind === "agent-body" || slot.kind === "human-body") {
      const layers = multilineTextLayers({
        text: slot.text,
        maxCharsPerLine: bodyMaxCharsPerLine,
        fontSize: BODY_FONT_SIZE,
        hAlign: "center",
      });
      return {
        type: "text",
        style: { fontSize: BODY_FONT_SIZE, fontColor: TEXT_COLOR_ON_FILL[slot.kind] },
        placement: { hAlign: "center", vAlign: "middle" },
        visual: { backgroundColor: SLOT_COLOR[slot.kind] },
        layers,
      };
    }

    // ── System dividers (single line, transparent) ──────────────────
    return {
      type: "text",
      style: { fontSize: 13, fontColor: TEXT_COLOR_ON_FILL[slot.kind] },
      placement: { hAlign: "center", vAlign: "middle" },
      ...(isSystem ? {} : { visual: { backgroundColor: SLOT_COLOR[slot.kind] } }),
      layers: [
        {
          content: { kind: "literal", text: slot.text.slice(0, 120) },
          placement: { hAlign: "center", vAlign: "middle" },
        },
      ],
    };
  });

  return {
    kind: "mosaic_document",
    version: 1,
    assets,
    m0,
    sources,
    backgroundColor: "#14151b",
  };
}

/** Snap a value down to the nearest multiple of `grid`. */
function snapDown(value: number, grid: number): number {
  return Math.floor(value / grid) * grid;
}

/** Blank chat column placeholder for empty chat or fallback. */
async function blankChatColumn(
  _colW: number,
  _colH: number,
  ctx: MosaicEngineContext,
): Promise<MosaicRenderableFile> {
  return await renderNestedTemplate(
    "@m0saic/wireframe/base/v2",
    { M0String: "F", preset: "thumb-dark" },
    ctx,
  );
}

function chatColor(speaker: ChatLine["speaker"]): MosaicColor {
  switch (speaker) {
    case "agent":
      return "#7ec5ff";
    case "human":
      return "#c8e6c9";
    case "system":
      return "#9aa0a6";
  }
}
