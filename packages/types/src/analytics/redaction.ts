/**
 * Per-field redaction treatments. Each field in the rich telemetry
 * stream maps to one of a handful of treatments here.
 *
 * The values are deliberately small enums (`"send" | "scramble" |
 * "drop"`, etc.) rather than booleans so the consent UI can offer
 * graduated trust levels — `"scramble"` is more informative than
 * `"drop"` and less revealing than `"send"`.
 *
 * Treatments resolve in the redactor; this struct is the data the
 * redactor consults.
 */
export type MosaicAnalyticsRedactionConfig = {
  /**
   * How to handle `TemplateId` values in analytics events.
   *
   * - `"send"` — raw template id sent ("@my-org/foo/v3"). Reveals
   *   strategy / org structure; not the default.
   * - `"scramble"` — deterministically hashed via the scrambler.
   *   Preserves distinct-template-count semantics without revealing
   *   identity. The default.
   * - `"drop"` — no template id sent at all. The analytics event
   *   loses per-template granularity entirely.
   */
  templateIds: "send" | "scramble" | "drop";

  /**
   * How to handle file paths (asset paths, output paths, workspace
   * paths).
   *
   * - `"scramble"` — deterministically hashed. Preserves "same
   *   path across renders" semantics for de-duplication.
   * - `"drop"` — no file path information sent. The default.
   *
   * Note: there is no `"send"` option. Raw file paths are never
   * transmitted regardless of consent — the type system forbids it
   * at the {@link MosaicAnalyticsEvent} level (no `path` fields
   * exist on any variant).
   */
  filePaths: "scramble" | "drop";

  /**
   * How to handle free-form error message strings from template
   * exceptions or plan-build failures.
   *
   * - `"send-sanitized"` — message sent after path-stripping and
   *   length truncation. Still a free string — users with sensitive
   *   data in messages should pick `"drop"`.
   * - `"drop"` — no message sent; only the error class enum
   *   reaches the analytics event. The default.
   *
   * Stack traces are handled separately via the `stackHash` field
   * on `error_report` — only a hash of frame names ever travels,
   * never the frames themselves.
   */
  errorMessages: "send-sanitized" | "drop";

  /**
   * How to handle ffmpeg argv reconstructions.
   *
   * - `"send-sanitized"` — args sent with file paths stripped /
   *   substituted with placeholders. Lets the operator see codec
   *   / preset patterns without seeing what was rendered.
   * - `"drop"` — no argv transmitted. The default.
   *
   * Analytics events do not carry argv even when `"send-sanitized"`
   * is selected at Phase 1 — the field is forward-compatible and
   * activates only when a future event variant adds an opt-in slot.
   */
  ffmpegArgs: "send-sanitized" | "drop";

  /**
   * How to handle ffmpeg stderr line samples.
   *
   * - `"send-sanitized"` — first N lines sent after path-stripping.
   *   Useful for the operator diagnosing codec / muxer regressions.
   * - `"drop"` — no stderr transmitted. The default.
   *
   * Same forward-compatibility note as `ffmpegArgs` — the slot is
   * defined here for the consent UI but not yet wired into any
   * analytics event variant.
   */
  stderrLines: "send-sanitized" | "drop";
};

/**
 * Deterministic scrambler. Given a raw identifier, returns a stable
 * scrambled form keyed by the install's salt (typically
 * `installId`).
 *
 * Contract:
 *
 *  - Same `raw` + same scrambler instance → same output, always.
 *  - Different installs scrambling the same `raw` → different
 *    outputs (no cross-install correlation).
 *  - Output is opaque — not reversible by the operator.
 *
 * Phase 1 ships the type only. Phase 2 ships a concrete
 * implementation (likely sha256(installId + ":" + raw) truncated
 * to the first 12 hex chars, namespaced by the input field).
 */
export type MosaicAnalyticsScrambler = {
  /** Scramble a value with a field-namespace prefix. */
  scramble(raw: string, namespace: MosaicScramblerNamespace): string;
};

/**
 * Namespace marker for scrambler inputs. Distinct namespaces
 * prevent collisions across input types — a template id named
 * `"foo"` and an asset id named `"foo"` scramble to different
 * outputs even when their string values match.
 */
export type MosaicScramblerNamespace =
  | "template_id"
  | "file_path"
  | "asset_id"
  | "output_key";
