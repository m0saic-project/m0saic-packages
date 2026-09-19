/**
 * Shared types for dictionary generators.
 *
 * A generator is a parameterized layout producer that emits canonical DSL.
 * Each generator has a descriptor (for UI discovery) and a build function.
 */

/** Parameter type for generator descriptors. */
export type GeneratorParamType = "int" | "float" | "bool" | "enum" | "string";

/** A single option for an "enum" parameter. */
export type GeneratorEnumOption = {
  value: string;
  label: string;
  /** Optional one-line tooltip describing what this option does. Shown in
   *  the dropdown's selected-option subtext and on hover for each option. */
  description?: string;
};

/** A single parameter descriptor. */
export type GeneratorParamDescriptor = {
  key: string;
  title: string;
  type: GeneratorParamType;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  /** Enum options. Required when type is "enum". */
  options?: GeneratorEnumOption[];
  /** Placeholder hint for "string" inputs. Ignored for other types. */
  placeholder?: string;
  /** Optional short help text shown via an info icon next to the param's
   *  title. Use to clarify mode-driven UIs (e.g. what the search range
   *  controls in each mode), units, or non-obvious defaults. */
  description?: string;
  /**
   * Conditional visibility based on other param values.
   *
   * Keys are param keys, values are the required values (or arrays of
   * acceptable values). The param is visible only when ALL conditions
   * are met.
   *
   * @example
   * // Visible only when preset is "custom"
   * visibleWhen: { preset: "custom" }
   *
   * @example
   * // Visible when preset is "custom" AND inputMode is "ratio"
   * visibleWhen: { preset: "custom", inputMode: "ratio" }
   */
  visibleWhen?: Record<
    string,
    string | number | boolean | (string | number | boolean)[]
  >;
  /**
   * When `true`, this param is a computed display field — the UI renders
   * it as a non-editable label. The current value comes from the
   * generator's `GeneratorResult.displayFields[<key>]` (not from user
   * input), so the descriptor's `default` is only used as the empty-state
   * placeholder. Combine with `visibleWhen` to show only when the
   * computed value is meaningful.
   */
  readOnly?: boolean;
  /**
   * When `true`, this param has no meaningful default — a caller (or an
   * agent routing English onto this descriptor) must supply a value, and
   * should ask for clarification rather than guess when it can't. The
   * `default` field still provides the empty-state placeholder. Used by
   * operation descriptors (e.g. `edit` needs a target frame label);
   * generators don't set it — their defaults are always applicable.
   */
  required?: boolean;
};

/** Generator descriptor — everything a UI needs to render controls. */
export type GeneratorDescriptor = {
  id: string;
  title: string;
  description: string;
  category: string;
  /** UI grouping label. Generators with the same group are displayed together. */
  group: string;
  params: GeneratorParamDescriptor[];
};

/** Result from calling a generator's build function. */
export type GeneratorResult = {
  /** Canonical m0 string. */
  m0: string;
  /** Number of rendered source tiles in the output. */
  sourceCount: number;
  /**
   * Computed display values for `readOnly` descriptor params, keyed by
   * the param's `key`. Used to surface intermediate / derived state in
   * the UI (e.g. the QR generator echoes the canonical text that the
   * structured payload helpers produced so users can see what's actually
   * being encoded). Optional — only set by generators that have a
   * matching `readOnly` param.
   */
  displayFields?: Record<string, string>;
  /**
   * Optional full `.m0c` file string (canonical JSON). Lets generators
   * carry richer-than-DSL state — labels, derive-image hints, and most
   * importantly the per-leaf masks (`Record<StableKey, M0cMaskEntry>`)
   * that turn each frame into an arbitrary silhouette at render time.
   *
   * When set, downstream consumers (panel preview, "Use Layout" handoff)
   * should parse this blob and route its extras to the canvas's
   * mask/label pipeline; when absent, the generator output is plain DSL
   * only and the panel falls back to the unmasked render of `m0`.
   *
   * The `m0` field is still authoritative for the DSL — callers may treat
   * this as derived ("here is the m0 you'd get if you parsed the m0c").
   */
  m0c?: string;
  /**
   * Canvas dimensions the generator's DSL is *designed* for. Set by
   * generators whose flow searches for a canvas (e.g. `safe-canvas`)
   * rather than fitting into a given canvas (e.g. `snap-grid`).
   *
   * When present, consumers should:
   *   1. Render previews at this aspect ratio (or upscale to fit), since
   *      rendering the bare DSL at any other size re-introduces the
   *      quantization the generator was designed to eliminate.
   *   2. Surface these dims to the user — the DSL alone is incomplete
   *      without them.
   *
   * When absent, the DSL is canvas-agnostic (or self-contained via an
   * outer `placeRect`), so any canvas works.
   */
  idealCanvas?: { width: number; height: number };
  /**
   * Short label for the primary `m0` when surfacing it in a multi-variant
   * toggle UI. When `alternates` is present, consumers should use this
   * label for the "primary" toggle button. When absent, falls back to
   * "Default".
   *
   * Example: `aspectSafeGrid` sets `primaryLabel: "Landscape"` so the
   * toggle reads `[Landscape] [Portrait]` rather than `[Default] [Portrait]`.
   */
  primaryLabel?: string;
  /**
   * Coordinated alternate variants of the layout — additional DSL
   * strings, each with its own design canvas and a label, that should
   * be presented as interchangeable choices alongside the primary `m0`.
   *
   * Set by generators that emit a *family* of related DSLs from one set
   * of inputs — e.g. `aspectSafeGrid` returns the row/column-transposed
   * portrait DSL as a one-element `alternates` array, but a future
   * generator could return many sizes (`[{ "Mobile" }, { "Tablet" },
   * { "Desktop" }]`) or breakpoints from a single search.
   *
   * Consumers (the dictionary panel) should render a toggle that swaps
   * which DSL is active for: preview, badges, ideal-canvas pill, DSL
   * output text, drag chip, and "Use Layout" handler. The full set of
   * choices is `[primary] + alternates` in order.
   *
   * Order matters — the array is rendered left-to-right in the toggle.
   * Place the most likely "second choice" first.
   */
  alternates?: Array<{
    m0: string;
    idealCanvas?: { width: number; height: number };
    label: string;
  }>;
};
