/**
 * Sidecar value shapes and the step-output token grammar.
 *
 * A template declares sidecars on its returned document
 * ({@link MosaicDocument.sidecars}); the engine writes them to disk
 * next to the render output after a successful render. Two value
 * shapes exist:
 *
 *  - **JSON sidecar** (default): any plain-JSON value, written as
 *    `{output-basename}.{key}.json` via `JSON.stringify`.
 *  - **Text sidecar** ({@link MosaicTextSidecar}): raw text written
 *    verbatim with a caller-chosen extension, e.g. a WebVTT storyboard
 *    as `{output-basename}.{key}.vtt`.
 *
 * # Step-output tokens
 *
 * Sidecar content sometimes needs to reference the **final on-disk
 * filename of a sibling pipeline step's deliverable** (e.g. a WebVTT
 * cue pointing at a sprite-sheet image emitted by another step). Final
 * names are minted by the host at write time (`--output-pattern`,
 * collision renames, per-host conventions) — a template can never
 * predict them. Instead the template embeds a token built with
 * {@link stepOutputToken}; the engine's sidecar writer substitutes each
 * token with the referenced step's final output **basename** once the
 * destinations are known. Unresolvable tokens are left literal and
 * reported, never fatal.
 */

/**
 * A sidecar value written as raw text instead of JSON.
 *
 * Recognized structurally by the engine's sidecar writer via
 * {@link isMosaicTextSidecar}; any other value shape falls through to
 * the JSON path.
 */
export type MosaicTextSidecar = {
  kind: "text";
  /**
   * File extension WITHOUT the leading dot (e.g. `"vtt"`, `"srt"`).
   * Must match {@link SIDECAR_EXT_PATTERN}; invalid extensions are
   * skipped and reported by the writer.
   */
  ext: string;
  /** Raw file content, written verbatim as utf8. */
  content: string;
};

/**
 * Safe sidecar file extension — 1–8 alphanumerics, no dots, slashes,
 * or specials. Deliberately narrow: the extension becomes the final
 * filename component and must never introduce path traversal or
 * double-extension ambiguity.
 */
export const SIDECAR_EXT_PATTERN = /^[a-zA-Z0-9]{1,8}$/;

/** Runtime predicate: is `ext` a valid sidecar file extension? */
export const isValidSidecarExt = (ext: unknown): ext is string =>
  typeof ext === "string" && SIDECAR_EXT_PATTERN.test(ext);

/** Runtime predicate: is `v` a {@link MosaicTextSidecar}? Structural —
 * validates the discriminant and field types, NOT the ext pattern
 * (the writer checks {@link isValidSidecarExt} separately so it can
 * report a bad ext rather than silently JSON-serializing the value). */
export const isMosaicTextSidecar = (v: unknown): v is MosaicTextSidecar => {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === "text" &&
    typeof c.ext === "string" &&
    typeof c.content === "string"
  );
};

/**
 * Matches step-output tokens in sidecar content:
 * `{{stepOutput:<stepName>}}`. Capture group 1 is the step name.
 *
 * The step-name charset is the FRIENDLY_SLUG tier (leading
 * alphanumeric/underscore, then alphanumerics/underscore/dot/hyphen) —
 * step names come from `buildStepNames` / `slugifyAssetKeyFromPath`,
 * which preserve dots and hyphens from input filenames.
 *
 * NOTE: carries the `g` flag for `String.replace` / `matchAll`
 * substitution passes — do not use bare `.test()` on this shared
 * instance (global regexes are stateful via `lastIndex`); use
 * `matchAll` or a fresh copy instead.
 */
export const STEP_OUTPUT_TOKEN_RE =
  /\{\{stepOutput:([A-Za-z0-9_][A-Za-z0-9_.\-]*)\}\}/g;

/**
 * Build a step-output token for embedding in sidecar content.
 *
 * Fails fast on a step name the token grammar cannot round-trip
 * (FRIENDLY_SLUG charset: `[A-Za-z0-9_][A-Za-z0-9_.\-]*`) — a silent
 * mismatch would leave an unresolvable literal token in the shipped
 * sidecar.
 */
export const stepOutputToken = (stepName: string): string => {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/.test(stepName)) {
    throw new TypeError(
      `stepOutputToken: step name ${JSON.stringify(stepName)} must match [A-Za-z0-9_][A-Za-z0-9_.\\-]*`,
    );
  }
  return `{{stepOutput:${stepName}}}`;
};
