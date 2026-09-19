/** @m0saic/code/snippet-morph/v1 — deterministic code-state video template. */

import {
  asTemplateId,
  type MosaicDocument,
  type MosaicDocumentPipeline,
  type MosaicEngineContext,
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
} from "@m0saic/template-utils";
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
} from "./internal/chrome";
import {
  buildSnippetMorphPlan,
  type SnippetMorphPlan,
} from "./internal/plan";
import {
  buildSnippetPipeline,
  type SnippetAddEntrance,
  type SnippetCodeAlign,
  type SnippetStepVisualOptions,
} from "./internal/steps";

export const SNIPPET_MORPH_V1_ID = "@m0saic/code/snippet-morph/v1";

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

export interface SnippetMorphV1Props {
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

function fBool(
  label: string,
  description: string,
  consumer?: "human" | "agent",
): MosaicTemplatePropDefinition {
  return {
    type: "boolean",
    required: false,
    description,
    meta: { ui: { label, ...(consumer ? { consumer } : {}) } },
  };
}

function fNum(
  label: string,
  description: string,
  min: number,
  max: number,
  step: number,
  unit?: "px" | "ms",
): MosaicTemplatePropDefinition {
  return {
    type: "number",
    required: false,
    description,
    meta: {
      constraints: { min, max },
      control: { flavor: "slider", step, ...(unit ? { unit } : {}) },
      ui: { label },
    },
  };
}

function fEnum(
  label: string,
  options: ReadonlyArray<string>,
  description: string,
): MosaicTemplatePropDefinition {
  return {
    type: "string",
    required: false,
    description,
    meta: { constraints: { oneOf: [...options] }, ui: { label } },
  };
}

function fColor(
  label: string,
  description: string,
  placeholder?: string,
): MosaicTemplatePropDefinition {
  return {
    type: "string",
    required: false,
    description,
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, ...(placeholder ? { placeholder } : {}) },
      ui: { label },
    },
  };
}

const propsSchema = definePropsSchema<SnippetMorphV1Props>({
  states: {
    type: "string[]",
    required: true,
    description: "Ordered TypeScript/JavaScript source states.",
    meta: {
      constraints: { minItems: 1 },
      // Each state is a whole source file: line breaks are the value. A
      // single-line input strips them on the first keystroke (2026-09-16).
      control: { placeholder: "const answer = 42;", multiline: true, mono: true },
      ui: { label: "Code states", order: 1 },
    },
  },
  language: {
    type: "string",
    required: false,
    description: "Syntax lexer.",
    meta: {
      constraints: { oneOf: ["ts", "js"] },
      ui: { label: "Language", order: 2 },
    },
  },
  typography: {
    type: "group" as never,
    required: false,
    description: "JetBrains Mono sizing and source normalization.",
    meta: { ui: { label: "Typography", order: 3, collapsedByDefault: true } },
    fields: {
      fontSize: fNum(
        "Font size",
        "Preferred font size; auto-fits down to 8px.",
        10,
        48,
        1,
        "px",
      ),
      lineHeight: fNum(
        "Line height",
        // Floor 1.35: the line box must contain the mono font's ink height
        // (JetBrains Mono ≈ 1.32em) or block PNGs stop tiling seamlessly.
        "Code line-height multiplier.",
        1.35,
        2,
        0.05,
      ),
      tabWidth: fNum("Tab width", "Spaces used to expand each tab.", 1, 8, 1),
    },
  } as never,
  timing: {
    type: "group" as never,
    required: false,
    description: "Per-state morph, hold, lead, and trail timing.",
    meta: { ui: { label: "Timing", order: 4, collapsedByDefault: true } },
    fields: {
      morphMs: fNum(
        "Morph",
        "Morph window per state.",
        100,
        2000,
        50,
        "ms",
      ),
      holdMs: fNum(
        "Hold",
        "Rest window per state.",
        500,
        10000,
        100,
        "ms",
      ),
      leadMs: fNum(
        "Lead",
        "Lead-in before the first reveal.",
        0,
        10000,
        100,
        "ms",
      ),
      trailMs: fNum(
        "Trail",
        "Trail after the final hold.",
        0,
        10000,
        100,
        "ms",
      ),
    },
  } as never,
  theme: {
    type: "group" as never,
    required: false,
    description: "Editor preset plus optional syntax-token overrides.",
    meta: { ui: { label: "Theme", order: 5, collapsedByDefault: true } },
    fields: {
      preset: fEnum(
        "Preset",
        CODE_THEME_PRESET_KEYS,
        "Built-in editor colorway.",
      ),
      keyword: fColor(
        "Keywords",
        "Override keyword tokens; clear to use the preset.",
        "preset palette",
      ),
      string: fColor(
        "Strings",
        "Override string tokens; clear to use the preset.",
        "preset palette",
      ),
      comment: fColor(
        "Comments",
        "Override comment tokens; clear to use the preset.",
        "preset palette",
      ),
      number: fColor(
        "Numbers",
        "Override numeric tokens; clear to use the preset.",
        "preset palette",
      ),
      fnCall: fColor(
        "Function calls",
        "Override function-call tokens; clear to use the preset.",
        "preset palette",
      ),
      ident: fColor(
        "Identifiers",
        "Override identifier tokens; clear to use the preset.",
        "preset palette",
      ),
      operator: fColor(
        "Operators",
        "Override operator tokens; clear to use the preset.",
        "preset palette",
      ),
      punct: fColor(
        "Punctuation",
        "Override punctuation tokens; clear to use the preset.",
        "preset palette",
      ),
      plain: fColor(
        "Plain text",
        "Override plain tokens; clear to use the preset.",
        "preset palette",
      ),
    },
  } as never,
  chrome: {
    type: "group" as never,
    required: false,
    description: "Editor card, title bar, controls, gutter, and code alignment.",
    meta: { ui: { label: "Chrome", order: 6, collapsedByDefault: true } },
    fields: {
      show: fBool("Show", "Show editor chrome."),
      title: {
        type: "string",
        required: false,
        description: "Filename shown in the editor title bar.",
        meta: { ui: { label: "Title" } },
      },
      trafficLights: fBool(
        "Traffic lights",
        "Show the three editor window controls.",
      ),
      lineNumbers: fBool("Line numbers", "Show a line-number gutter."),
      codeAlign: fEnum(
        "Code alignment",
        ["left", "center"],
        "Horizontal alignment inside the code area.",
      ),
      fullBleed: fBool(
        "Full bleed",
        "Fill the canvas edge to edge (default). Off restores the framed card with a margin around it.",
      ),
    },
  } as never,
  animation: {
    type: "group" as never,
    required: false,
    description: "Motion accessibility and addition entrance.",
    meta: { ui: { label: "Animation", order: 7, collapsedByDefault: true } },
    fields: {
      reduceMotion: fBool(
        "Reduce motion",
        "Use hard cuts with every code state at rest.",
        "agent",
      ),
      addEntrance: fEnum(
        "Added code entrance",
        ["fade", "rise"],
        "How newly added code enters during each morph.",
      ),
    },
  } as never,
  animate: {
    type: "boolean",
    required: false,
    description: "Animate code changes.",
    meta: {
      control: {
        syncsTo: [
          { prop: "animation.reduceMotion", map: { kind: "boolInvert" } },
        ],
      },
      ui: { label: "Animate", order: 8, consumer: "human", primary: true },
    },
  },
  debugLayout: {
    type: "boolean",
    required: false,
    description: "Assert the card/code-area/gutter/title layout contract.",
    meta: { ui: { label: "Debug layout", order: 9, collapsedByDefault: true } },
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

function visualOptions(props: SnippetMorphV1Props): SnippetStepVisualOptions {
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

function planFor(props: SnippetMorphV1Props, targetDurationMs?: number) {
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

function resolvedTheme(props: SnippetMorphV1Props): CodeTheme {
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
    templateId: SNIPPET_MORPH_V1_ID,
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
  props: SnippetMorphV1Props,
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

export const SnippetMorphV1: MosaicTemplate<SnippetMorphV1Props> = {
  id: asTemplateId(SNIPPET_MORPH_V1_ID),
  label: "Code Snippet Morph",
  description:
    "Morphs ordered TypeScript/JavaScript code states into a deterministic editor-frame video with moving, added, and removed lines.",
  version: 1,
  // Core tier since the svg-text promotion (09-05): every code line is a
  // native svg text source the ENGINE rasterizes (one coloured RGBA image per
  // line) — no template-side sharp, no workspace files, no renderLite. The
  // document Make previews is the document ffmpeg renders.
  capabilities: { tier: "core" },
  tags: ["developer", "code", "snippet", "animated", "developers", "diff", "tutorial"],
  outputHints: {
    width: 1280,
    height: 720,
    fps: 30,
    // The natural length of the 2-state default (2 × (morph 750 + hold 3000)).
    // A HINT only: the plan authors its own length from states × timing, and
    // an explicit --durationMs / form duration pins it (resolvePinnedDurationMs).
    durationMs: 7500,
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
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
    props: SnippetMorphV1Props,
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
    return {
      ...pipeline,
      steps: pipeline.steps.map((step) => {
        if (!("file" in step) || step.file == null) return step;
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

registerTemplate(SnippetMorphV1);
