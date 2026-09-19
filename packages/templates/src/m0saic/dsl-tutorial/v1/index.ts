export { DslTutorial } from "./dsl-tutorial";
export type { DslTutorialProps } from "./dsl-tutorial";
export { DslChrome } from "./panels/chrome/v1/dsl-chrome";
export type { DslChromeProps } from "./panels/chrome/v1/dsl-chrome";
export { DslCanvas } from "./panels/canvas/v1/dsl-canvas";
export type { DslCanvasProps, DslCanvasTile } from "./panels/canvas/v1/dsl-canvas";
export { DslInspector } from "./panels/inspector/v1/dsl-inspector";
export type { DslInspectorProps } from "./panels/inspector/v1/dsl-inspector";
export { DslString } from "./panels/dsl-string/v1/dsl-string";
export type { DslStringProps } from "./panels/dsl-string/v1/dsl-string";
export { buildInspectorProjection } from "./pipeline/inspector";
export type { InspectorProjection, InspectorFieldExpr, ChipVariant } from "./pipeline/inspector";
export { buildDslStringProjection, classifyGlyphs } from "./pipeline/dslString";
export type { DslStringProjection, Glyph, SyntaxType } from "./pipeline/dslString";

// Pipeline + theme are exported for tests and downstream panel subtemplates.
export { buildSteps, countTokens } from "./pipeline/buildSteps";
export type { Step, FieldDiff, BuildStepsResult, StepEventMode } from "./pipeline/buildSteps";
export { computeTiming, stepNumberExpr } from "./pipeline/timing";
export type { Timing } from "./pipeline/timing";
export { buildCanvasCamera, focusExpr, autoCanvasZoom } from "./pipeline/camera";
export type { CameraSpec } from "./pipeline/camera";
export { buildCursorRects } from "./pipeline/cursor";
export type { CursorRect } from "./pipeline/cursor";
export { dslTutorialTheme, DSL_TUTORIAL_PRESETS, resolveColor } from "./theme/tokens";
export type { DslTutorialTheme, DslTutorialPreset } from "./theme/tokens";
