export { Highlights, resolveHighlightsKnobs, MAX_RANGES, type HighlightsV1Props } from "./highlights";
// NOTE: `evenRound` stays un-re-exported — trickplay's barrel already
// exports one and both feed the media pack's star exports.
export {
  defaultRangeLabel,
  fmtRangeSeconds,
  inputLabel,
  rangeStepName,
  sanitizeLabel,
  scaleToMaxWidth,
  type HighlightsKnobs,
  type HighlightsOutputFormat,
} from "./plan";
export { buildHighlightSteps, ERROR_STEP_MS } from "./pipeline";
