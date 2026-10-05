/** @m0saic/code/snippet-morph/v2 — deterministic code-state video template. */

import {
  asTemplateId,
  type MosaicDocument,
  type MosaicDocumentPipeline,
  type MosaicEngineContext,
  type MosaicSource,
  type MosaicTemplate,
  type MosaicTemplatePropDefinition,
} from "@m0saic/types";
import {
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
  resolvePinnedDurationMs,
  withLayoutContract,
  type LayoutConstraint,
  type PropBindingEntry,
} from "@m0saic/template-utils";
import { labelOf, withAddHandles } from "../../../_shared/canvas-handles";
import {
  CODE_THEME_PRESET_KEYS,
  CODE_TOKEN_KINDS,
  codeTheme,
  resolveCodeSyntaxTheme,
  type CodeTheme,
  type CodeThemePreset,
  type CodeTokenKind,
} from "../../_shared/code-theme";
import type { CodeLanguage } from "../../_shared/code-lexer";
import {
  MIN_AUTOFIT_FONT_SIZE,
  measureCodeGrid,
} from "../../_shared/code-metrics";
import {
  computeSnippetFrameGeometry,
  type SnippetFrameGeometry,
} from "../v1/internal/chrome";
import {
  buildSnippetMorphPlan,
  type SnippetMorphPlan,
} from "../v1/internal/plan";
import {
  buildSnippetPipeline,
  rawLineSpans,
  type SnippetAddEntrance,
  type SnippetCodeAlign,
  type SnippetStepVisualOptions,
} from "../v1/internal/steps";

export const SNIPPET_MORPH_V2_ID = "@m0saic/code/snippet-morph/v2";

export interface SnippetTypographyConfig {
  fontSize?: number;
  lineHeight?: number;
  tabWidth?: number;
}

export interface SnippetTimingConfig {
  morphMs?: number;
  holdMs?: number;
  leadMs?: number;
  trailMs?: number;
}

export type SnippetThemeConfig = {
  preset?: CodeThemePreset;
} & Partial<Record<CodeTokenKind, string | null>>;

export interface SnippetChromeConfig {
  show?: boolean;
  title?: string;
  trafficLights?: boolean;
  lineNumbers?: boolean;
  codeAlign?: SnippetCodeAlign;
  /** Card fills the canvas edge to edge (default). Off = framed card with a margin. */
  fullBleed?: boolean;
}

export interface SnippetAnimationConfig {
  reduceMotion?: boolean;
  addEntrance?: SnippetAddEntrance;
}

export interface SnippetMorphV2Props {
  [key: string]: unknown;
  states: string[];
  language?: CodeLanguage;
  typography?: SnippetTypographyConfig;
  timing?: SnippetTimingConfig;
  theme?: SnippetThemeConfig;
  chrome?: SnippetChromeConfig;
  animation?: SnippetAnimationConfig;
  /** Human-facing derived control; the editor syncs it to animation.reduceMotion. */
  animate?: boolean;
  debugLayout?: boolean;
}

const DEFAULT_STATE = [
  "type Launch = {",
  "  product: string;",
  "  audience: \"developers\";",
  "};",
  "",
  "const launch: Launch = {",
  "  product: \"m0saic\",",
  "  audience: \"developers\",",
  "};",
].join("\n");

// Gate 31/32 ruling class ("the default face is a real layout"): a MORPH
// template's default must show a morph, so the default carries a second
// state — two inserted fields and a new function, so lines move, lines are
// added, and the reveal reads on first open. 2 × (750 + 3000) = 7.5s.
const DEFAULT_STATE_2 = [
  "type Launch = {",
  "  product: string;",
  "  audience: \"developers\";",
  "  date?: string;",
  "};",
  "",
  "const launch: Launch = {",
  "  product: \"m0saic\",",
  "  audience: \"developers\",",
  "  date: \"2026-09\",",
  "};",
  "",
  "export function announce(l: Launch) {",
  "  console.log(l.product + \" ships \" + l.date);",
  "}",
].join("\n");

// Bare group-field builders: what each value IS. Its label and hint live in
// snippet-morph.catalog.json beside this file (0.3.1).
function bBool(consumer?: "human" | "agent"): MosaicTemplatePropDefinition {
  return { type: "boolean", required: false, ...(consumer ? { meta: { ui: { consumer } } } : {}) };
}

function bNum(min: number, max: number, step: number, unit?: "px" | "ms"): MosaicTemplatePropDefinition {
  return {
    type: "number",
    required: false,
    meta: {
      constraints: { min, max },
      control: { flavor: "slider", step, ...(unit ? { unit } : {}) },
    },
  };
}

function bEnum(options: ReadonlyArray<string>): MosaicTemplatePropDefinition {
  return { type: "string", required: false, meta: { constraints: { oneOf: [...options] } } };
}

function bColor(): MosaicTemplatePropDefinition {
  return { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true } } };
}

const propsSchema = definePropsSchema<SnippetMorphV2Props>({
  states: {
    type: "string[]",
    required: true,
    meta: {
      constraints: { minItems: 1 },
      // Each state is a whole source file: line breaks are the value. A
      // single-line input strips them on the first keystroke (2026-09-16).
      control: { multiline: true, mono: true },
    },
  },
  language: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["ts", "js"] },
    },
  },
  typography: {
    type: "group" as never,
    required: false,
    fields: {
      fontSize: bNum(10, 48, 1, "px"),
      lineHeight: bNum(1.35, 2, 0.05),
      tabWidth: bNum(1, 8, 1),
    },
  } as never,
  timing: {
    type: "group" as never,
    required: false,
    fields: {
      morphMs: bNum(100, 2000, 50, "ms"),
      holdMs: bNum(500, 10000, 100, "ms"),
      leadMs: bNum(0, 10000, 100, "ms"),
      trailMs: bNum(0, 10000, 100, "ms"),
    },
  } as never,
  theme: {
    type: "group" as never,
    required: false,
    fields: {
      preset: bEnum(CODE_THEME_PRESET_KEYS),
      keyword: bColor(),
      string: bColor(),
      comment: bColor(),
      number: bColor(),
      fnCall: bColor(),
      ident: bColor(),
      operator: bColor(),
      punct: bColor(),
      plain: bColor(),
    },
  } as never,
  chrome: {
    type: "group" as never,
    required: false,
    fields: {
      show: bBool(),
      title: {
        type: "string",
        required: false,
      },
      trafficLights: bBool(),
      lineNumbers: bBool(),
      codeAlign: bEnum(["left", "center"]),
      fullBleed: bBool(),
    },
  } as never,
  animation: {
    type: "group" as never,
    required: false,
    fields: {
      reduceMotion: bBool("agent"),
      addEntrance: bEnum(["fade", "rise"]),
    },
  } as never,
  animate: {
    type: "boolean",
    required: false,
    meta: {
      control: {
        syncsTo: [
          { prop: "animation.reduceMotion", map: { kind: "boolInvert" } },
        ],
      },
      ui: { consumer: "human" },
    },
  },
  debugLayout: {
    type: "boolean",
    required: false,
  },
});

function dimensions(ctx: MosaicEngineContext): {
  width: number;
  height: number;
  fps: number;
} {
  return {
    width: Math.max(1, Math.round(ctx.target.width)),
    height: Math.max(1, Math.round(ctx.target.height)),
    fps: Math.max(1, Math.round(ctx.target.fps ?? 30)),
  };
}

function visualOptions(props: SnippetMorphV2Props): SnippetStepVisualOptions {
  const typography = props.typography ?? {};
  const chrome = props.chrome ?? {};
  return {
    fontSize: typography.fontSize ?? 16,
    lineHeight: typography.lineHeight ?? 1.5,
    fontFamily: "JetBrains Mono",
    fontWeight: "normal",
    fontStyle: "normal",
    title: chrome.title ?? "snippet.ts",
    showChrome: chrome.show ?? true,
    trafficLights: chrome.trafficLights ?? true,
    lineNumbers: chrome.lineNumbers ?? true,
    codeAlign: chrome.codeAlign ?? "left",
    // Gate 32 (founder): the card takes the whole canvas by default; the
    // framed look with a margin is one toggle away.
    fullBleed: chrome.fullBleed ?? true,
  };
}

function planFor(props: SnippetMorphV2Props, targetDurationMs?: number) {
  const typography = props.typography ?? {};
  const timing = props.timing ?? {};
  return buildSnippetMorphPlan({
    states: props.states,
    language: props.language ?? "ts",
    tabWidth: typography.tabWidth ?? 2,
    timing: {
      morphMs: timing.morphMs,
      holdMs: timing.holdMs,
      leadMs: timing.leadMs,
      trailMs: timing.trailMs,
    },
    targetDurationMs,
  });
}

function resolvedTheme(props: SnippetMorphV2Props): CodeTheme {
  const config = props.theme ?? {};
  const base = codeTheme(config.preset);
  const overrides = Object.fromEntries(
    CODE_TOKEN_KINDS.map((kind) => [kind, config[kind]]),
  ) as Partial<Record<CodeTokenKind, string | null | undefined>>;
  return {
    ...base,
    syntax: resolveCodeSyntaxTheme(base, overrides),
  };
}

export interface SnippetResolvedVisualLayout {
  visual: SnippetStepVisualOptions;
  geometry: SnippetFrameGeometry;
  fits: boolean;
  overflowX: boolean;
  overflowY: boolean;
}

/** Resolve one shared integer font size against the worst state at this canvas. */
export function resolveSnippetVisualLayout(
  states: SnippetMorphPlan["states"],
  target: { width: number; height: number },
  preferredVisual: SnippetStepVisualOptions,
): SnippetResolvedVisualLayout {
  const preferredFontSize = Math.max(
    MIN_AUTOFIT_FONT_SIZE,
    Math.floor(preferredVisual.fontSize),
  );
  let floorResult: SnippetResolvedVisualLayout | undefined;

  for (
    let fontSize = preferredFontSize;
    fontSize >= MIN_AUTOFIT_FONT_SIZE;
    fontSize -= 1
  ) {
    const visual = { ...preferredVisual, fontSize };
    const geometry = computeSnippetFrameGeometry({
      width: target.width,
      height: target.height,
      fontSize,
      showChrome: visual.showChrome,
      lineNumbers: visual.lineNumbers,
      fullBleed: visual.fullBleed ?? false,
    });
    const metrics = states.map((state) =>
      measureCodeGrid(state.lines, {
        fontSize,
        lineHeight: visual.lineHeight,
      }),
    );
    const overflowX = metrics.some(
      (stateMetrics) => stateMetrics.width > geometry.codeArea.w,
    );
    const overflowY = metrics.some(
      (stateMetrics) => stateMetrics.height > geometry.codeArea.h,
    );
    const result = {
      visual,
      geometry,
      fits: !overflowX && !overflowY,
      overflowX,
      overflowY,
    };
    if (result.fits) return result;
    if (fontSize === MIN_AUTOFIT_FONT_SIZE) floorResult = result;
  }

  if (floorResult) return floorResult;
  throw new Error("resolveSnippetVisualLayout: autofit search produced no result");
}

function snippetLayoutConstraints(
  visual: SnippetStepVisualOptions,
): LayoutConstraint[] {
  const constraints: LayoutConstraint[] = [
    {
      label: "card",
      minWidthFrac: 0.65,
      // 1.0 = the full-bleed default (the card IS the canvas); the framed
      // card sits at ~0.86 × 0.84.
      maxWidthFrac: 1,
      minHeightFrac: 0.65,
      maxHeightFrac: 1,
      within: { xFrac: [0, 1], yFrac: [0, 1] },
    },
    {
      label: "code-area",
      minWidthFrac: 0.4,
      minHeightFrac: 0.45,
      within: { xFrac: [0, 1], yFrac: [0, 1] },
    },
  ];
  if (visual.lineNumbers) {
    constraints.push({
      label: "gutter",
      maxWidthFrac: 0.2,
      minHeightFrac: 0.45,
      within: { xFrac: [0, 1], yFrac: [0, 1] },
    });
  }
  if (visual.showChrome) {
    constraints.push({
      label: "title",
      minWidthFrac: 0.2,
      maxHeightFrac: 0.15,
      within: { xFrac: [0, 1], yFrac: [0, 1] },
    });
  }
  return constraints;
}

function withSnippetLayoutContract(
  doc: MosaicDocument,
  ctx: MosaicEngineContext,
  visual: SnippetStepVisualOptions,
  debug: boolean,
  durationMs?: number,
): MosaicDocument {
  const stepCtx = durationMs == null
    ? ctx
    : {
        ...ctx,
        target: { ...ctx.target, durationMs },
      };
  return withLayoutContract(doc, stepCtx, {
    templateId: SNIPPET_MORPH_V2_ID,
    constraints: snippetLayoutConstraints(visual),
    flatten: false,
    debug,
  });
}

type SnippetRenderPreparation =
  | {
      ok: true;
      plan: SnippetMorphPlan;
      layout: SnippetResolvedVisualLayout;
    }
  | { ok: false; error: MosaicDocument };

function prepareSnippetRender(
  props: SnippetMorphV2Props,
  ctx: MosaicEngineContext,
  target: { width: number; height: number },
): SnippetRenderPreparation {
  try {
    const plan = planFor(props, resolvePinnedDurationMs(ctx));
    const layout = resolveSnippetVisualLayout(
      plan.states,
      target,
      visualOptions(props),
    );
    if (layout.overflowY) {
      throw new Error(
        `Code exceeds the ${layout.geometry.codeArea.h}px code-area height at the ${MIN_AUTOFIT_FONT_SIZE}px autofit floor; use fewer lines`,
      );
    }
    return { ok: true, plan, layout };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: makeErrorMosaic(message, {
        width: target.width,
        height: target.height,
        title: "Code Snippet Morph",
        errorCode: "SNIPPET_MORPH_INVALID_INPUT",
      }),
    };
  }
}

type BoundSource = MosaicSource & {
  editor?: { binding?: PropBindingEntry; bindings?: PropBindingEntry[] };
};

/** The token kinds a code line actually paints, per `[state][raw line]`. */
function tokenKindsByLine(plan: SnippetMorphPlan): CodeTokenKind[][][] {
  return plan.states.map((state) =>
    state.lines.map((line) => {
      const present = new Set<CodeTokenKind>();
      for (const token of line.tokens) {
        if (/\S/u.test(token.text)) present.add(token.kind);
      }
      return CODE_TOKEN_KINDS.filter((kind) => present.has(kind));
    }),
  );
}

/**
 * v2: more handles on the rects v1 already builds (its line text and title
 * keep their bindings). Edits in place, never touches paint.
 *
 *  - a code line also carries the colours of the token kinds IT paints
 *    (click `const x = 1` → its text, then Keywords / Identifiers / …);
 *  - the code area carries the type — size, line height, tab width — and
 *    every token colour with no token in this state (nothing of its own to
 *    ride yet, so it rides the surface the code sits on).
 */
function bindSnippetHandles(
  doc: MosaicDocument,
  kinds: CodeTokenKind[][][],
  rawStates: ReadonlyArray<string>,
): void {
  const painted = new Set<CodeTokenKind>();
  const spans = new Map<number, ReturnType<typeof rawLineSpans>>();
  let area: MosaicSource | undefined;
  for (const source of doc.sources as MosaicSource[]) {
    if (labelOf(source) === "code-area") {
      area = source;
      continue;
    }
    const editor = (source as BoundSource).editor;
    const own = editor?.bindings?.[0] ?? editor?.binding;
    if (own?.propKey !== "states" || own.index == null) continue;
    const range = (own as { range?: { start: number } }).range;
    if (range == null) continue; // a whole-state binding names no single line
    if (!spans.has(own.index)) spans.set(own.index, rawLineSpans(rawStates[own.index] ?? ""));
    const lineIndex = spans.get(own.index)!.findIndex((span) => span.start === range.start);
    const lineKinds = kinds[own.index]?.[lineIndex] ?? [];
    for (const kind of lineKinds) painted.add(kind);
    withAddHandles(source, lineKinds.map((kind) => ({ propKey: `theme.${kind}` })));
  }
  if (area == null) return;
  withAddHandles(area, [
    { propKey: "typography.fontSize" },
    { propKey: "typography.lineHeight" },
    { propKey: "typography.tabWidth" },
    ...CODE_TOKEN_KINDS.filter((kind) => !painted.has(kind)).map((kind) => ({ propKey: `theme.${kind}` })),
  ]);
}

export const SnippetMorphV2: MosaicTemplate<SnippetMorphV2Props> = {
  id: asTemplateId(SNIPPET_MORPH_V2_ID),
  version: 2,
  // Core tier since the svg-text promotion (09-05): every code line is a
  // native svg text source the ENGINE rasterizes (one coloured RGBA image per
  // line) — no template-side sharp, no workspace files, no renderLite. The
  // document Make previews is the document ffmpeg renders.
  capabilities: { tier: "core" },
  outputHints: {
    width: 1280,
    height: 720,
    fps: 30,
    // The natural length of the 2-state default (2 × (morph 750 + hold 3000)).
    // A HINT only: the plan authors its own length from states × timing, and
    // an explicit --durationMs / form duration pins it (resolvePinnedDurationMs).
    durationMs: 7500,
    format: { kind: "video", container: "mp4" },
    // State 1 at rest, after its reveal (morph 750) — the poster shows code.
    posterTimeMs: 2000,
  },
  propsSchema,
  // The editor card IS the subject, and full-bleed (the default) runs it to
  // the canvas edge; v1's frozen builder also lays the page colour under it as
  // a tile (the framed look's margin). Both stay for paint parity.
  canvas: {
    baseRect: "the editor card is the subject — full-bleed by default it runs to the canvas edge, over the page tile the framed look shows as its margin",
  },
  bindings: {
    unbound: {
      "timing.morphMs": "timing",
      "timing.holdMs": "timing",
      "timing.leadMs": "timing",
      "timing.trailMs": "timing",
    },
  },
  defaultProps: {
    states: [DEFAULT_STATE, DEFAULT_STATE_2],
    language: "ts",
    typography: {
      fontSize: 16,
      lineHeight: 1.5,
      tabWidth: 2,
    },
    timing: {
      morphMs: 750,
      holdMs: 3000,
      leadMs: 0,
      trailMs: 0,
    },
    theme: { preset: "dark" },
    chrome: {
      show: true,
      title: "snippet.ts",
      trafficLights: true,
      lineNumbers: true,
      codeAlign: "left",
      fullBleed: true,
    },
    animation: {
      reduceMotion: false,
      addEntrance: "rise",
    },
    debugLayout: false,
  },

  async render(
    props: SnippetMorphV2Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument | MosaicDocumentPipeline> {
    const target = dimensions(ctx);
    const prepared = prepareSnippetRender(props, ctx, target);
    if (!prepared.ok) return prepared.error;
    const { plan, layout: { visual, geometry } } = prepared;
    const theme = resolvedTheme(props);
    const animation = props.animation ?? {};
    // One doc per state, each carrying the morph INTO it (lines slide from
    // their old row, adds fade + rise, removals fade out). Every code line is
    // one svg text source with a layer per token run; core rasterizes it to a
    // coloured image. Pure: the same pipeline serves an explicit make and
    // Make's live preview (no renderLite).
    const pipeline = buildSnippetPipeline({
      plan,
      // Raw states → each code line binds ITS line of its state (Make ranged
      // inline edit: double-click a line, Enter splices just that line back).
      rawStates: props.states,
      tabWidth: props.typography?.tabWidth ?? 2,
      geometry,
      theme,
      visual,
      width: target.width,
      height: target.height,
      fps: target.fps,
      motion: {
        reduceMotion: animation.reduceMotion ?? false,
        addEntrance: animation.addEntrance ?? "rise",
      },
    });
    const debugLayout = props.debugLayout ?? false;
    const kinds = tokenKindsByLine(plan);
    return {
      ...pipeline,
      steps: pipeline.steps.map((step) => {
        if (!("file" in step) || step.file == null) return step;
        bindSnippetHandles(step.file, kinds, props.states);
        return {
          ...step,
          file: withSnippetLayoutContract(
            step.file,
            ctx,
            visual,
            debugLayout,
            step.durationMs,
          ),
        };
      }),
    };
  },
};

registerTemplate(SnippetMorphV2);
