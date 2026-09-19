import {
  type MosaicEngineContext,
  type MosaicTemplateUpstreamData,
  type MosaicTemplateUpstreamVariables,
} from "../engine-context";
import {
  type MosaicAspectRatio,
  type MosaicPlatform,
  type MosaicChannelId,
  type MosaicVRType,
} from "../primitives";
import { type MosaicRenderableFile } from "../document";
import type { AliasId, AssetId, TemplateId } from "../identifiers";
import { type MosaicMediaKind } from "../source";
import type { MosaicRegionShapeKind } from "./region";
import type { MosaicOutputFormat } from "../output/format";
import { type MosaicTemplatePreview } from "../template-repo";

/**
 * Core types for defining m0saic templates.
 *
 * A MosaicTemplate<P> takes a strongly-typed props object and produces
 * a MosaicRenderableFile. These types describe:
 *
 * - The allowed prop types for templates (MosaicTemplatePropType)
 * - Per-prop metadata and validation (MosaicTemplatePropDefinition)
 * - The base props shape (MosaicTemplateProps)
 * - Supported target platforms for templates (MosaicPlatform)
 * - Supported VR sub-formats for VR templates (MosaicVRType)
 * - Distribution channels for templates (MosaicChannelId / KnownMosaicChannel)
 * - The full template contract (MosaicTemplate<P>)
 */

/**
 * The kinds of values that template props can describe.
 *
 * These types are used for documentation, UI generation, and
 * high-level validation of template props.
 *
 * They do NOT represent arbitrary runtime JS types.
 * Every type listed here must have a clear, generic UI representation.
 *
 * Primitive types map directly to simple UI controls.
 * Structural types ("group", "list") allow composition of primitives
 * in a way that remains fully renderable and understandable by the UI.
 *
 * Primitive types:
 * - "string"    — free-form text or identifiers
 * - "string[]"  — array of strings
 * - "number"    — numeric values (dimensions, durations, counts, etc.)
 * - "number[]"  — array of numbers
 * - "boolean"   — feature flags or toggles
 * - "media"     — reference to a single media input (path or media ID)
 * - "media[]"   — array of media references
 *
 * Structural (renderable) types:
 * - "group"     — object with a known shape, rendered as a fieldset/panel
 * - "list"      — array of renderable items (usually groups), rendered as
 *                 a repeatable or indexed UI section
 *
 * M0-family types (DSL inputs — editor surfaces them as Layout pickers):
 * - "m0"        — bare m0 DSL string (just layout geometry).
 * - "m0c"       — m0 with cell labels. Editor surfaces as a Layout
 *                 picker that supports per-cell label authoring; the
 *                 dictionary's "layout" category is the source of
 *                 saved community/brand layouts. Templates can
 *                 optionally declare a {@link MosaicPropContract} via
 *                 `meta.contract` to require specific label names.
 * - "m0p"       — m0 layout pack: a named bag of layout variants.
 *                 Two consumption modes — *enumerated* (template
 *                 iterates over all entries) or *targeted* (template
 *                 looks up specific names declared via
 *                 `meta.contract.expectedEntries`). See
 *                 {@link MosaicPropContract}.
 *
 * Handoff types:
 * - "code"      — read-only code passed FROM a template to the user.
 *                 Editors show the language plus a selectable/copyable
 *                 code window; render() may ignore the informational prop.
 */
export type MosaicCodeValue = {
  /** Language id shown by editors, e.g. "javascript", "json", "bash". */
  language: string;
  /** Complete code payload presented to the user verbatim. */
  code: string;
};

export type MosaicTemplatePropType =
  | "string"
  | "string[]"
  | "number"
  | "number[]"
  | "boolean"
  | "media"
  | "media[]"
  | "group"
  | "list"
  | "m0"
  | "m0c"
  | "m0p"
  | "code"
  /**
   * Structured JSON payload. Use for nested-config props that map to a
   * TS interface — `filter`, `sceneFilter`, `{ low, high, mode }`, etc.
   *
   * Renders as a code editor by default; if the prop also declares
   * `meta.constraints.jsonSchema`, editors that understand the schema
   * may render a structured form instead.
   *
   * The validator (`validateTemplateProps`) accepts any value when
   * `type === "json"` — render-time parsing / validation is the
   * template's job (call `JSON.parse` if the editor delivered a string,
   * then optionally validate against the schema). Pure runtime
   * permissiveness; the schema is an editor hint, not an engine gate.
   *
   * Use this in preference to JSON-string encoding (`type: "string"`
   * containing `'{"low":2}'`), which loses editor introspection.
   */
  | "json";

/** Value semantics + validation. */
export type MosaicPropConstraints = {
  // numeric constraints
  min?: number;
  max?: number;

  // array constraints
  minItems?: number;
  maxItems?: number;

  /**
   * If set, this prop's array length must match the referenced prop's array length.
   * Example: weights.length must equal queries.length
   */
  lengthOf?: string;

  /** If set, value must be one of these literal options. */
  oneOf?: string[];

  isColor?: boolean;

  /**
   * For `type: "json"` props — an optional shape hint for editors.
   *
   * Two forms:
   *   - `{ ref: "<id>" }` — a host-resolved id pointing into a shared
   *     JSON-schema registry. Useful when multiple templates share a
   *     payload shape (e.g. `{ low, high, mode }`).
   *   - inline `Record<string, unknown>` — a JSON-Schema-ish object
   *     describing the payload structure. Editors that understand it
   *     render a structured form; those that don't fall back to a
   *     code editor.
   *
   * Engine behavior: this field is **not** validated at the engine
   * boundary. Template render() functions are responsible for any
   * runtime shape checking (typically with their own validator —
   * Zod, Ajv, hand-rolled). Pairs with the `"json"` prop type.
   */
  jsonSchema?: { ref: string } | Record<string, unknown>;
};

/** How a value is entered or constrained (input/control; not layout). */
export type MosaicPropControl = {
  /**
   * Layout-class declaration for m0-family props (`type: "m0"` / `"m0c"`) —
   * the template says HOW MUCH layout information it wants, and the editor
   * control skins/behaves accordingly. Three classes, in ascending
   * information order:
   *
   * - `"bare"`    — just the string: generic layout data, no canvas
   *                 opinion. The default for `type: "m0"`.
   * - `"sized"`   — the layout is meant as a SPECIFIC rectangle set:
   *                 m0 + canvas W×H (the unambiguous triplet). The
   *                 control emphasizes the canvas choice; the template
   *                 reads the canvas from its usual inputs (ctx.target
   *                 or dedicated dims props).
   * - `"context"` — the full handshake: m0c with labels / background /
   *                 masks etc., authored for a template ↔ consumer
   *                 (human or agent) contract. Implied by `type: "m0c"`.
   *
   * Ingest coercion follows the DECLARED type, not the pasted payload:
   * an m0c dropped on a `type: "m0"` prop coerces DOWN to its inner m0
   * (its declared size still feeds the control's canvas); a `type:
   * "m0c"` prop accepts both flavors and keeps m0c payloads whole.
   */
  layoutClass?: "bare" | "sized" | "context";
  // media-specific
  accept?: MosaicMediaKind[];
  /**
   * File-EXTENSION filter for `picker: "file"` props (lowercase, no dot:
   * `["srt", "txt"]`). Finer-grained than {@link accept}'s media kinds —
   * the OS dialog filters to exactly these, so a template taking a
   * sidecar/text file (a `.mmd` diagram, an `.srt` track, a data `.csv`)
   * declares what it can actually read. Omitted = unfiltered dialog.
   */
  extensions?: string[];
  /**
   * Picker control kind.
   *
   * - `"file"` / `"folder"` — desktop OS pickers (for `type: "media"` props).
   * - `"time-range"` — paired number-prop picker that surfaces a video
   *   scrubber with start/end handles. Declared on BOTH halves of a
   *   `<thing>StartMs` / `<thing>EndMs` pair; the form dispatch matches
   *   the pair by name suffix and renders the picker once. Rendered by
   *   the multi-range Clip-Range Studio in SINGLE mode (maxRanges 1) —
   *   the wire shape stays the flat ms pair.
   *
   *   When `picker === "time-range"`, the control SHOULD also set
   *   {@link videoFromProp} (which sibling prop holds the video path)
   *   and MAY set {@link targetDurationMsFromProp} (which sibling prop
   *   holds the intended render duration, for a "target band" overlay).
   *
   * - `"time-ranges"` — multi-range clip picker, declared on a SINGLE
   *   `type: "json"` prop whose value is `Array<MosaicTimeRangeMs>`
   *   (`{ startMs, endMs, label? }`, integer ms, source-relative, sorted
   *   ascending; overlaps allowed; empty array = no selection). Unlike
   *   `"time-range"` there is no prop pairing — the editor reads and
   *   writes the whole array through this one prop, in one write.
   *
   *   When `picker === "time-ranges"`, the control SHOULD also set
   *   {@link videoFromProp}. {@link targetDurationMsFromProp} and
   *   {@link markersProvider} MAY be layered on by the dispatch later.
   *
   * - `"cards"` — for connection-bound multi-selects (`string[]` props
   *   with {@link optionsFromConnection}): the expanded picker modal
   *   renders each option as an image card (profile picture + name);
   *   falls back to the text list when the options carry no images. The
   *   inline sidebar control stays a compact text list with an expand
   *   button regardless.
   *
   * - `"regions"` — draw-on-canvas region picker, declared on a SINGLE
   *   `type: "json"` prop whose value is a `MosaicRegionsValue`
   *   (`{ canvas?: {w,h}, regions: [{kind?,x,y,w,h}…] }`, integer px in
   *   the authored canvas; missing `kind` = rect; empty array = no
   *   selection). Like `"time-ranges"` there is no prop pairing — the
   *   editor reads and writes the whole value through this one prop, in
   *   one write. Editors with a live canvas (Make) render a draw surface
   *   over the preview; editors without one (Compose, Jobs) degrade to a
   *   numeric row editor. Cardinality and allowed shapes come from the
   *   {@link regions} control block.
   *
   * - `"cue-track"` — ordered timed-text picker, declared on a SINGLE
   *   `type: "json"` prop whose value is an ordered `Array<MosaicTimedCue>`
   *   (`{ text, startMs?, endMs? }`, integer ms on the OUTPUT timeline;
   *   order = entity order, index = identity; `startMs` absent = UNTIMED —
   *   the unresolved state the timing editor exists to fix; `endMs` absent
   *   = runs to the next timed cue's start; empty array = no cues yet).
   *   Like `"time-ranges"` there is no prop pairing — the editor reads and
   *   writes the whole array through this one prop, in one write. Editors
   *   that can resolve a playable media path (via the {@link cueTrack}
   *   block's `mediaFromProp`) open the Cue Timing Studio (play the media,
   *   tap to stamp each cue's start, then nudge); editors without one
   *   degrade to a line-list editor (paste text, per-line ms fields).
   */
  picker?: "file" | "folder" | "time-range" | "time-ranges" | "cards" | "regions" | "cue-track";
  /**
   * Preferred image-card shape for `picker: "cards"` option grids.
   * The option artwork's natural orientation is a property of the
   * CONNECTION KIND the template queries (performer portraits vs
   * studio/tag banners), so the template declares it.
   *
   *  - "tall"   — portrait cards (≈2:3). Today's behavior; the default.
   *  - "wide"   — landscape cards (≈16:9). Logos, banners, screenshots.
   *  - "square" — 1:1. Album-art-style artwork.
   */
  cardAspect?: "tall" | "wide" | "square";
  /**
   * How option artwork fills its `picker: "cards"` box (CSS `object-fit`).
   * Like {@link cardAspect}, this is a property of the CONNECTION KIND the
   * template queries, so the template declares it.
   *
   *  - "cover"   — fill the box, cropping overflow. Today's behavior; the
   *    default. Best for photos / headshots where edge crop is harmless.
   *  - "contain" — fit the WHOLE image inside the box, letterboxing any
   *    leftover space. Best for logos / banners that must not be cropped.
   */
  cardFit?: "cover" | "contain";
  /**
   * For `picker: "time-range"` / `"time-ranges"` (and any future
   * control kind that needs a video source path): names the sibling
   * prop whose value is the absolute path to the video being scrubbed.
   *
   * Example: subtitle-burn declares `clipStartMs` / `clipEndMs` with
   * `videoFromProp: "sourceId"`, so the picker resolves the path from
   * the current `sourceId` prop value.
   */
  videoFromProp?: string;
  /**
   * For `picker: "time-range"`: names a sibling prop whose value is
   * the intended render duration in ms. When set, the picker overlays
   * a "target band" of that width anchored at `startMs` so the user
   * can compare their selection against the render envelope, and
   * warns when the picked segment length diverges.
   *
   * When omitted, the picker falls back to whatever duration the
   * editor's render context exposes (typically `ctx.target.durationMs`).
   */
  targetDurationMsFromProp?: string;
  /**
   * For `picker: "time-range"`: declares a "marker provider" that
   * supplies tick marks rendered above the scrubber. Useful for
   * surfacing semantic landmarks on the timeline so users can aim
   * their range at meaningful content rather than blindly scrubbing.
   *
   * The dispatch layer is responsible for fulfilling the provider
   * (e.g. probing subtitle cues, scene boundaries, or chapter
   * markers) and feeding the resolved markers to the picker.
   *
   * Currently only `kind: "subtitles"` is wired. Future kinds
   * ("scene-cuts", "audio-peaks", "chapters") would extend the union.
   *
   * Example — subtitle-burn surfaces cue markers on the clip picker:
   * ```
   * markersProvider: {
   *   kind: "subtitles",
   *   videoFromProp: "sourceId",
   *   languageFromProp: "languageCode",
   *   trackIndexFromProp: "trackIndex",
   * }
   * ```
   */
  markersProvider?: {
    kind: "subtitles";
    /** Sibling prop holding the absolute path to the source video. */
    videoFromProp: string;
    /** Sibling prop holding a language code (e.g. "eng", "spa"). Optional. */
    languageFromProp?: string;
    /** Sibling prop holding an explicit subtitle track index. Optional. */
    trackIndexFromProp?: string;
  };
  multiple?: boolean; // mostly relevant to picker-driven inputs

  /**
   * Light-gray hint text shown when the input is empty.
   * Purely presentational; never a value or default.
   */
  placeholder?: string;

  /**
   * The value holds line breaks — code, a paragraph, a lyric block. Editors
   * render a textarea (grows with the content) instead of a single-line
   * input, whose browser semantics STRIP every newline on the first
   * keystroke and keep a typed `
` as two literal characters (the
   * snippet-morph "code states lose their escapes" report, 2026-09-16).
   * Applies to `string` and `string[]` (one textarea per row). Editors
   * that don't recognize it fall back to the single-line input.
   */
  multiline?: boolean;

  /**
   * Monospace face for the input — code, ids, commands. Presentation only;
   * pairs naturally with {@link multiline}.
   */
  mono?: boolean;

  /**
   * If present, render as a select/dropdown with these options.
   *
   * When {@link optionsFrom} is also set, this list acts as the
   * **fallback**: the editor uses it when the dynamic fetch fails,
   * the publisher alias is not present in the project, or the
   * resolved option array is empty. Authors are encouraged to
   * provide at least a sentinel option (e.g. a "no data" placeholder)
   * so the editor stays usable in degraded states.
   *
   * - `value` — the value bound to the prop (must satisfy the prop's
   *   `constraints.oneOf` if set).
   * - `label` — human-readable display text.
   * - `image` — optional thumbnail; renders the option as a visual
   *   button instead of a plain row. Resolved through the host's
   *   {@link AssetId} → URL pipeline at design time.
   * - `description` — optional secondary text (tooltip / caption).
   */
  options?: {
    value: string;
    label?: string;
    image?: AssetId;
    description?: string;
  }[];

  /**
   * Bind the option list dynamically to an upstream-published
   * {@link MosaicDataSource}. The editor reads
   * `ctx.upstreamData[data]` at design time (the publishing template
   * must have run first; capability-tier publishers are authorized
   * by the host) and projects each item into an option record.
   *
   * Resolution order at design time:
   *   1. Resolve `optionsFrom` — if it produces a non-empty array,
   *      use it as the option list.
   *   2. Otherwise fall back to the static {@link options} list
   *      (which may itself be empty — that's the "no data" path).
   *
   * The fallback contract is why both fields can coexist on the
   * same prop: dynamic options when available, static when not.
   */
  optionsFrom?: {
    /**
     * Alias declared by an upstream {@link MosaicDataSource}. The
     * editor resolves this against the project's publisher graph.
     */
    data: AliasId;

    /**
     * Path within the data block (dot-separated, simple object
     * navigation only) to the option array. Default: the data
     * block itself is treated as the option array.
     */
    arrayPath?: string;

    /** Field on each item to use as the prop value. */
    valueKey: string;

    /** Field for the display label. Falls back to {@link valueKey}. */
    labelKey?: string;

    /** Field for the option image ({@link AssetId}). */
    imageKey?: string;

    /** Field for the option description (tooltip / caption). */
    descriptionKey?: string;
  };

  /**
   * Dynamic options fetched at edit time from a host connection.
   *
   * Use this when a closed-set prop's valid values aren't known at
   * publish time — e.g. "pick a Notion
   * database", "pick a Slack channel" — but only become knowable once
   * the user has configured a connection in Mosaic Settings.
   *
   * The editor resolves this by:
   *   1. Reading the connection id from {@link connectionFromProp}
   *      (or treating the prop bag itself as the connection container
   *      if absent — rare).
   *   2. Calling the host's `connections:fetchOptions` IPC with
   *      `{ kind, connectionId }`.
   *   3. The IPC dispatches to a fetcher the publisher registered via
   *      `registerConnectionOptionsFetcher(kind, fn)` in
   *      `@m0saic/template-utils`. That fetcher receives the
   *      connection's non-secret field values + the secret resolver
   *      and returns `[{ value, label, description? }, ...]`.
   *
   * Pairs naturally with closed-set string / string[] props. For
   * `string[]`, the editor renders a multi-select against the fetched
   * options. For `string`, the standard {@link options} rendering
   * applies (segmented pill ≤5, dropdown otherwise).
   *
   * `optionsFromConnection` takes precedence over both {@link options}
   * and {@link optionsFrom} when set. Falls back to {@link options}
   * if the fetcher fails (network down, connection unconfigured, etc.)
   * — the static list acts as a degraded-state placeholder.
   */
  optionsFromConnection?: {
    /**
     * Fetcher kind. Templates from a publisher register one or more
     * named fetchers; this string selects which one runs. E.g. the
     * example-dev publisher exposes `"saved-filters"`, `"tags"`,
     * `"athletes"` — each a distinct fetcher.
     */
    kind: string;

    /**
     * Name of the sibling prop holding the connection id (e.g.
     * `"connectionId"`). When omitted, the editor falls back to the
     * publisher's default connection (the one minted by
     * `registerHostConnection` for that publisher).
     */
    connectionFromProp?: string;
  };

  /** UI hint: render a color picker (expects MosaicColor-compatible values). */
  colorPicker?: boolean;

  /**
   * For a `colorPicker` prop that resolves to a theme/derived color when left
   * unset (e.g. `accent → theme.primary`): the effective default hex, shown as a
   * FADED "ghost" swatch + a greyed placeholder while the prop is empty — so the
   * field communicates its default without pinning the value (which would break
   * theming). Typically the light-preset resolved value.
   */
  defaultColor?: string;

  /**
   * Canonical unit for a numeric prop. The value the engine receives
   * is always in this unit — storage is fixed. The editor uses this
   * hint to:
   *   - render a unit chip in the input,
   *   - choose a sensible default step size, and
   *   - (for unit families like time / angle) offer a chip-cycle that
   *     converts on display only, never touching the stored value.
   *
   * Time:    "ms" | "s" | "min" | "hour" | "frames"
   * Length:  "px" | "pct"
   * Angle:   "deg" | "rad"
   *
   * `"seconds"` is the legacy alias for `"s"` — editors should treat
   * them as equivalent. New templates should prefer the short form.
   */
  unit?:
    | "ms"
    | "s"
    | "seconds"
    | "min"
    | "hour"
    | "frames"
    | "px"
    | "pct"
    | "deg"
    | "rad";

  /**
   * Optional default display unit for the editor. When present, the
   * field initially renders the value converted to this unit (e.g.
   * `unit: "s", displayUnit: "ms"` shows `200` for a stored `0.2`).
   * Users can still cycle the display unit via the chip; the stored
   * value remains in {@link unit}.
   *
   * Must belong to the same unit family as {@link unit}.
   */
  /**
   * Lock the display unit so the user can't cycle it via the chip.
   * Useful when the template's UX assumes a specific scale —
   * e.g. a "1-second clip duration" prop where letting the user flip
   * the chip to "hour" would silently rescale a small step into a
   * giant value. The unit chip still renders (so the user can see
   * what unit they're entering) but is non-interactive.
   *
   * Defaults to false. Templates handling time-critical values where
   * a unit swap could meaningfully change behavior should set it.
   */
  lockDisplayUnit?: boolean;

  /**
   * Explicit arrow-button step for the number input, in the canonical
   * {@link unit}. When omitted, the editor picks a magnitude-aware
   * default (≈ value/10, snapped to a 1/2/5 ladder). Set this when the
   * template's semantics make a specific step size obvious — e.g.
   * "increment scene-clip duration by 1 second per click".
   */
  step?: number;

  displayUnit?:
    | "ms"
    | "s"
    | "min"
    | "hour"
    | "frames"
    | "px"
    | "pct"
    | "deg"
    | "rad";

  /**
   * Semantic flavor of a string prop — hints the editor to render a
   * richer input than a plain `<input type="text">`. Engine treats the
   * value as a regular `string`; flavor is editor-side metadata only.
   *
   * - `"url"` — render a URL field with scheme validation, an open-
   *   in-browser button, and paste auto-prefixing. Pairs naturally
   *   with templates that consume a URL (QR encoders, link cards,
   *   share-graphs).
   * - `"slider"` — render a numeric prop as a range slider (with a
   *   live value readout) instead of a number box. Best for bounded,
   *   continuously-tuned values (e.g. a 0..0.1 gutter ratio) where
   *   dragging beats typing. Pairs with `meta.constraints.min/max`
   *   and `meta.control.step`.
   * - `"numberList"` — render a flat numeric-array `json` prop (e.g.
   *   chart `xValues`) as the collapsible row-list editor (one row per
   *   number, + Add) instead of a raw JSON box.
   * - `"numberSeries"` — render a `number[] | number[][]` `json` prop
   *   (e.g. chart `values`) as a tabbed multi-series editor: one tab
   *   per series (+ to add, × to remove), each tab a row list. Single
   *   series round-trips as `number[]`; multiple as `number[][]`.
   * - `"objectRows"` — render an array-of-objects prop (e.g. a donut
   *   chart's `segments`: `{ label, value, color? }[]`) as a collapsible
   *   repeating-row editor (one row per object, + Add, × to remove).
   *   Each row's cells come from `columns`; new rows seed colors from
   *   `palette`.
   *
   * - `"cardList"` — array-of-objects prop → a repeating **card** editor
   *   (a richer `objectRows`): add / remove / reorder cards, each card
   *   rendering the cells named by `columns`. Beyond the plain
   *   `text`/`number`/`color` cells, `cardList` cells may be composite —
   *   `connectionMultiSelect` (chips + a grouped picker modal) and
   *   `weights` (an auto-balancing slider group). Pairs with
   *   {@link interWeightProp} to also weigh the cards against each other.
   *
   * More flavors may land later (`"email"`, `"hex-color"` if the
   * existing `colorPicker` becomes unwieldy, etc.). Editors that don't
   * recognize a flavor fall back to the default input for the type.
   */
  flavor?:
    | "url"
    | "slider"
    | "numberList"
    | "numberSeries"
    | "objectRows"
    | "cardList"
    | "weights"
    | "range"
    | "criteriaFilter"
    /**
     * A complex array/object prop (e.g. a feed of commit rows) whose shape is too
     * rich for a clean inline form. Renders a compact summary + an "Edit JSON"
     * button that opens a full modal editor (format + validate on save) — a good
     * developer-experience escape for opaque structured data. Falls back to the
     * inline JSON textarea on hosts that don't recognize the flavor.
     */
    | "jsonModal";

  /**
   * For `flavor: "weights"` (a `number[]` prop): an auto-balancing weight
   * distribution rendered over a FIXED, schema-declared item set. The value
   * is one weight per label, in the same order, relative — the control keeps
   * them summing to 100. This is the static-list sibling of
   * {@link weightsProp} (which weights a dynamic multi-select's selection)
   * and of {@link interWeightProp} (which weights `cardList` cards): same
   * interaction, three bindings. The value the render reads is the raw
   * `number[]`; the labels are editor-only.
   *
   * Example: `mediaWeights` with `labels: ["Videos", "Images"]` stores
   * `[videos, images]`.
   */
  weights?: { labels: string[] };

  /**
   * For `flavor: "criteriaFilter"` (a `json` prop): the criteria CATALOG.
   *
   * A criteriaFilter prop is a flat set of independently-typed criteria
   * that all AND together — no nesting, no OR, no groups. This catalog
   * declares which criteria exist, what kind each is, which modifiers it
   * allows, and (for id sets) where its options come from. The editor
   * renders entries by `kind` only — keys/labels are opaque strings, so
   * the control works for ANY template that declares a catalog.
   *
   * The prop VALUE is a flat object with one entry per criterion the
   * user has set (absent key == unset; never write empty placeholders):
   *
   *  - `search`  → `string`
   *  - `text`    → `{ modifier, value: string }`
   *  - `number`  → `{ modifier, value: number, value2?: number }`
   *  - `date`    → `{ modifier, value: "YYYY-MM-DD", value2?: string }`
   *  - `idSet`   → `{ modifier, value: string[], excludes?: string[], depth?: number }`
   *  - `boolean` → `boolean`
   *
   * `IS_NULL` / `NOT_NULL` modifiers carry no value (`{ modifier }`);
   * `value2` only rides `BETWEEN` / `NOT_BETWEEN`; `depth` (hierarchical
   * id sets) is an integer ≥ -1 where -1 = all descendants. Editors that
   * don't know the flavor fall back to the raw `json` editor.
   */
  criteria?: Array<{
    /** Opaque criterion id — the key written into the prop value. */
    key: string;
    /** Human-readable row label. */
    label: string;
    /** Selects the editor: search box, text, number, date, id picker, bool. */
    kind: "search" | "text" | "number" | "date" | "idSet" | "boolean";
    /**
     * Allowed modifier ids, in display order. Vocabulary: EQUALS,
     * NOT_EQUALS, GREATER_THAN, LESS_THAN, BETWEEN, NOT_BETWEEN, INCLUDES,
     * INCLUDES_ALL, EXCLUDES, MATCHES_REGEX, NOT_MATCHES_REGEX, IS_NULL,
     * NOT_NULL.
     */
    modifiers?: string[];
    /** kind "number": numeric bounds for the value input(s). */
    min?: number;
    max?: number;
    /** kind "idSet": render the include-sub-items depth toggle. */
    hierarchical?: boolean;
    /**
     * kind "idSet": host-connection options fetcher — same shape and
     * resolution as {@link optionsFromConnection} on the control itself.
     */
    optionsFromConnection?: { kind: string; connectionFromProp: string };
  }>;

  /**
   * For `flavor: "range"`: a numeric value that MAY optionally be a range.
   * Value contract — fully generic, no domain fields. Three user intents:
   *  - **flat** → a plain `number` ("use exactly this value");
   *  - **range** → `{ low: number, high: number }` ("sample fresh per use");
   *  - **range, picked once** → `{ low, high, once: true }` ("sample ONE
   *    value in the range, then reuse it"). The `once` key is omitted
   *    entirely when off — `once: false` is never written. What a "use" is
   *    belongs to the consumer; the control only records the intent.
   *
   * `collapsible: true` renders the flat/range segmented toggle; omitted /
   * false means the prop is always a range. `allowOnce: true` renders a
   * subordinate pick-once toggle inside the range pane, labeled by
   * `onceLabel` (generic default: "Pick once"). Slider bounds come from
   * `min`/`max` here, falling back to `constraints.min`/`max`, then to a
   * soft max that grows with typed values. The editor never interprets what
   * a spread *means* — the prop's `description` / `onceLabel` carry that;
   * the template maps the shape to its own semantics.
   */
  range?: {
    collapsible?: boolean;
    allowOnce?: boolean;
    onceLabel?: string;
    min?: number;
    max?: number;
  };

  /**
   * For `picker: "regions"`: cardinality and allowed shapes.
   *
   * - `min` / `max` — how many regions the template accepts. A
   *   single-region template sets `max: 1` (the draw surface REPLACES
   *   the existing region on a new draw) and reads `regions[0]`.
   *   Omitted bounds mean "no limit".
   * - `shapes` — which drawing tools the editor offers. Only `"rect"`
   *   exists today; the union grows with `MosaicRegionShapeKind`
   *   (polygon, ellipse, …). Omitted means all shapes the editor knows.
   */
  regions?: {
    min?: number;
    max?: number;
    shapes?: MosaicRegionShapeKind[];
  };

  /**
   * For `picker: "cue-track"`: media binding and cardinality.
   *
   * - `mediaFromProp` — names the sibling prop whose value is the path of
   *   the media the cues are timed against (typically an audio file; any
   *   playable media works). Resolution follows the same first-entry rule
   *   as {@link videoFromProp} (a `media` string, or a `media[]`'s first
   *   entry). New picker kinds use this accurately-named field;
   *   `videoFromProp` stays as-is for the time-range family.
   * - `maxCues` — cap on the cue list length. Editors truncate on paste /
   *   add with a notice; templates fail fast past it. Omitted = the
   *   editor default (400).
   */
  cueTrack?: {
    mediaFromProp?: string;
    maxCues?: number;
    /**
     * Opt-in to WORD-LEVEL timing (karaoke depth): the timing studio adds
     * a word pass (hold Space over a looping line to span each word) and
     * cues may carry the `words` deepening. Omitted/false = lines only.
     */
    wordTiming?: boolean;
    /**
     * The words the editor speaks for THIS prop. The control is generic
     * (a cue is anything that happens at a time — a lyric line, a wheel
     * spin, a chapter, a caption), so the template names its things;
     * every field is optional and the defaults are neutral.
     *
     * - `item` — singular noun for one cue ("line", "spin", "chapter").
     *   Default `"cue"`. Drives counts ("12 spins · 8 timed"), row
     *   labels ("Spin 3"), and the studio's tap card ("spin 3 of 12").
     * - `items` — plural of `item`. Default `item + "s"`.
     * - `collection` — what the whole track is called when it differs
     *   from `items` ("lyrics" over "lines"). Default `items`. Drives
     *   the empty state ("No lyrics yet"), the paste affordances, and
     *   the dialog title fallback when `ui.label` is absent.
     * - `media` — what the cues are timed against ("song", "video",
     *   "footage"). Default `"media file"`. Drives the studio's loading /
     *   error copy and the locked-studio hint ("Pick a song first…").
     * - `pasteHint` — full placeholder for the paste box (both the
     *   field's seeder and the studio's paste panel) when the derived
     *   "one line per {item}" copy isn't specific enough — e.g. a
     *   spin-wheel: "One winner per line — the option label, or ? for
     *   random." SRT auto-detect still applies whatever the hint says.
     * - `beatLabel` — text of the cue the studio's "labeled beat"
     *   button inserts. Default `"[Break]"`; a lyric video wants
     *   `"[Instrumental]"`.
     */
    vocabulary?: {
      item?: string;
      items?: string;
      collection?: string;
      media?: string;
      pasteHint?: string;
      beatLabel?: string;
    };
  };

  /**
   * For the `"cardList"` flavor: names a SIBLING prop (a `number[]`) that
   * stores the INTER-card weights — one entry per card, normalized to sum
   * 100. The editor renders a compact "summary strip" of weight sliders
   * (the same auto-balancing control used by a `weights` cell) above the
   * card list, bound to this prop. Omit to hide the inter-card strip.
   */
  interWeightProp?: string;

  /**
   * Opt-in for a connection-bound `string[]` multi-select (a prop with
   * {@link optionsFromConnection}): names a SIBLING prop (a `number[]`)
   * that stores one weight per selected id — pick order, normalized to
   * sum 100. When set, the editor renders the same auto-balancing weight
   * strip used by the `cardList` bucket weights below the selection, so
   * each selected option becomes a weightable element. The strip is
   * hidden while fewer than two options are selected (a lone pick is
   * trivially 100%). Omit for a plain, unweighted multi-select.
   */
  weightsProp?: string;

  /**
   * For a `consumer: "human"` control (see {@link MosaicPropUI.consumer}) — the
   * canonical (agent) prop(s) this friendly control DRIVES. The control is a
   * derived view: the editor positions it by reading the bound prop(s) (inverse
   * map) and writes them back on change (forward map). The human key itself is
   * never sent to `render()`.
   *
   * `prop` is a dot-path into the rendered props (e.g. `"anim.durationSec"`).
   * One human control may bind several (a single "speed" slider can drive both
   * `anim.durationSec` and `anim.staggerSec`).
   */
  syncsTo?: Array<{
    /** Dot-path into the canonical props (e.g. `"anim.durationSec"`). */
    prop: string;
    /**
     * Map between the human control's value and the canonical prop's value:
     *  - `linear` — linearly interpolate the control's `[humanMin, humanMax]`
     *    onto the prop's `[propMin, propMax]` (ranges may invert, e.g. a higher
     *    "speed" → a lower `durationSec`).
     *  - `boolInvert` — boolean negation (e.g. `animate` ⇄ `reduceMotion`).
     *  - `identity` — pass the value through unchanged (bool→bool, number→number).
     *  - `lookup` — the human value is a NAME keyed into `table`; the canonical
     *    prop receives `table[name]` (forward), and the control selects the name
     *    whose table value equals the prop (inverse). An unmatched prop value —
     *    e.g. a bespoke agent-written raw string — shows as no selection, and
     *    clearing the control clears the prop. The friendly-knob pattern for
     *    raw agent props (an `icon` name driving an `iconPath` SVG string).
     */
    map:
      | { kind: "linear"; humanMin: number; humanMax: number; propMin: number; propMax: number }
      | { kind: "boolInvert" }
      | { kind: "identity" }
      | { kind: "lookup"; table: Record<string, string | number> };
  }>;

  /**
   * Column descriptor for the `"objectRows"` and `"cardList"` flavors:
   * one entry per editable cell of each row / card. See
   * {@link MosaicPropColumn}. Ignored by other flavors.
   */
  columns?: MosaicPropColumn[];

  /**
   * Seed colors for the `"objectRows"` / `"cardList"` flavors: new rows
   * cycle through this palette for their color cell (matching a
   * template's own color ramp so the editor swatch == the rendered
   * slice). Ignored otherwise.
   */
  palette?: string[];
};

/**
 * One editable cell of an `"objectRows"` row or a `"cardList"` card.
 * `kind` selects the input:
 *  - `text` / `number` / `color` — scalar cells (used by both flavors).
 *  - `connectionMultiSelect` — `"cardList"`-only: a set of ids picked from
 *    a host connection via a grouped picker modal. Stored at `key` as an
 *    `{ id, weight }[]` array (weight defaults even; a sibling `weights`
 *    cell edits it).
 *  - `weights` — `"cardList"`-only: an auto-balancing slider group that
 *    distributes weight across the `{ id, weight }[]` array named by
 *    {@link MosaicPropColumn.weightsFor} (defaults to this column's `key`).
 */
export type MosaicPropColumn = {
  key: string;
  kind: "text" | "number" | "color" | "connectionMultiSelect" | "weights";
  label?: string;
  placeholder?: string;

  /**
   * `kind: "connectionMultiSelect"` — where this cell's options come from.
   * Same shape as {@link MosaicPropControl.optionsFromConnection}: the cell
   * resolves the connection id from `connectionFromProp` (a sibling prop,
   * default `"connectionId"`) and fetches via the host IPC.
   */
  optionsFromConnection?: { kind: string; connectionFromProp?: string };

  /**
   * `kind: "connectionMultiSelect"` — option field to GROUP the picker
   * modal by (e.g. `"group"` == a saved query preset's mode). Options
   * missing the key fall into an "Other" section.
   */
  groupByKey?: string;

  /**
   * `kind: "weights"` — the column key holding the `{ id, weight }[]` array
   * this cell distributes weight across. Defaults to this column's own
   * `key` (the common case where a `connectionMultiSelect` column and a
   * `weights` column share a key — two cells, one array).
   */
  weightsFor?: string;
};

/** How a prop is presented in editors (not value semantics). */
export type MosaicPropUI = {
  label?: string;
  order?: number;
  // NOTE (2026-07-21): `section` was removed. Grouping like controls is done
  // ONE way, in every editor: a `type: "group"` prop with `fields` — it folds
  // in the Make panel AND the Compose schema form. `section` was a second,
  // Compose-only visual grouping for flat props doing the same job.
  collapsedByDefault?: boolean;

  /**
   * Pin an OPTIONAL prop into the editor's primary (top) prop group, alongside
   * required props, instead of burying it under the collapsed "Optional" fold.
   * For knobs that are technically optional (the template has a sensible
   * default) but important enough that the user shouldn't have to dig — e.g. a
   * chart's `labels`. Does NOT change validation; the prop stays optional.
   */
  primary?: boolean;

  /**
   * Hide this prop from editor forms (e.g. the Make panel). The value still
   * exists and is honored at render time via the template's default — use for
   * knobs that are irrelevant to the user at authoring time (e.g. an internal
   * layer-packing strategy) but must stay in the schema for the render path.
   */
  hidden?: boolean;

  /**
   * Dual-prop audience. OPTIONAL props can carry complementary forms for the
   * two template consumers:
   *
   *  - `"human"` — a friendly control (slider / checkbox / ratio) that does NOT
   *    feed `render()` directly. It's a DERIVED VIEW of one or more canonical
   *    (agent) props, declared via {@link MosaicPropControl.syncsTo}: the editor
   *    reads the canonical value(s) to position the control and writes them back
   *    on change. The "human" prop key never enters the rendered props.
   *  - `"agent"` — the canonical hard form (absolute numbers, durationMs, raw
   *    JSON group). What `render()` actually reads. Surfaced under an "Agent
   *    props" escape in the editor.
   *
   * Undefined ⇒ shown to everyone (today's behavior). REQUIRED props ignore this
   * tag — they're always shown and never duplicated.
   */
  consumer?: "human" | "agent";

  /**
   * Conditional visibility: skip rendering this prop in editor forms while a
   * SIBLING prop's value doesn't match. Both surfaces (Make panel + source
   * editor) hide (not disable) the prop when `siblingValues[prop] !== equals`.
   * The prop still exists and renders/validates normally when shown — this is
   * cosmetic decluttering, not a validation gate. Example: a videos/images
   * weight strip that's only meaningful when `mediaType === "BOTH"`.
   */
  visibleWhen?: { prop: string; equals: string };

  // structural meaning
  indexedBy?: "m0saic_leaf_index";
};

/**
 * Contract a template declares for a structured M0-family prop
 * (`"m0c"` or `"m0p"`).
 *
 * Distinguishes two usage modes:
 *
 *  - **Enumerated mode** — absent contract (or empty
 *    `expectedEntries`). The template iterates over all entries in
 *    the user's input without caring about names. Canonical for
 *    "render each variant the user provided" templates.
 *
 *  - **Targeted mode** — `expectedEntries` declares the specific
 *    names the template looks up. The template's behavior is keyed
 *    on those names (e.g., uses `"desktop"` for the desktop render,
 *    `"mobile"` for mobile). The editor surfaces a labeled form
 *    with one slot per expected entry.
 *
 * Same shape applies to both prop kinds:
 *  - On `"m0c"` props: entries are **cell-label names**
 *    (`hero`, `cta`, `footnote`, …).
 *  - On `"m0p"` props: entries are **variant names**
 *    (`desktop`, `mobile`, `square`, …).
 *
 * Engine-time validation (deferred wiring) emits:
 *  - `M0C_LABEL_MISSING` / `M0P_VARIANT_MISSING` when a
 *    `required: true` entry is absent from the input.
 *  - `M0C_LABEL_UNEXPECTED` / `M0P_VARIANT_UNEXPECTED` when
 *    {@link strict} is true and the input has entries not in
 *    `expectedEntries`.
 */
export type MosaicPropContract = {
  /**
   * Named entries the template uses.
   *
   * Absent or empty → enumerated mode (template iterates over
   * whatever the user provides). Present → targeted mode (template
   * looks up these specific names).
   */
  expectedEntries?: Record<string, {
    description?: string;
    /**
     * When `true`, the engine warns if the entry is missing from
     * the input. Default `false` — entry may be omitted (template
     * handles absence in its render logic).
     */
    required?: boolean;
  }>;

  /**
   * When `true`, the engine warns if the input has entries NOT in
   * {@link expectedEntries}. Use when the template's behavior is
   * sensitive to unexpected entries.
   *
   * Default `false` — extras are tolerated (template silently
   * ignores them).
   */
  strict?: boolean;
};

/** Unified "hints/meta" attached to a template prop definition. */
export type MosaicTemplatePropMeta<K extends string = string> = {
  /** Value semantics + validation. */
  constraints?: MosaicPropConstraints;

  /** Input affordances (picker, accepted media kinds, etc.). */
  control?: MosaicPropControl;

  /** Editor presentation. */
  ui?: MosaicPropUI;

  /**
   * Structured-input contract — applies to props with `type: "m0c"`
   * or `type: "m0p"`. Declares the named entries the template
   * expects (targeted mode) or signals that the template just
   * enumerates whatever's there (absent/empty contract).
   *
   * Ignored on other prop types. See {@link MosaicPropContract}.
   */
  contract?: MosaicPropContract;
};

/**
 * Metadata and validation rules for a single template prop.
 *
 * This definition describes:
 * - how the prop is validated (constraints)
 * - how it is entered (control)
 * - how it is presented in editors (ui)
 *
 * This metadata is consumed by editors and the engine
 * before calling the template's render() function.
 */
export type MosaicTemplatePropDefinition = {
  /**
   * The high-level category of this prop's value.
   */
  type: MosaicTemplatePropType;

  /**
   * Whether this prop is required for the template to render correctly.
   * If not required, defaultProps will be used.
   */
  required: boolean;

  /**
   * Human-readable description of the prop, including meaning, units,
   * and any default behavior. Shown in docs and editors.
   */
  description?: string;

  /**
   * Metadata describing validation rules and editor behavior
   * for this prop.
   */
  meta?: MosaicTemplatePropMeta;

  /**
   * Sub-field schema for `type: "group"` — keyed by the group object's keys.
   * Editors render a group as a small collapsible panel of these sub-controls;
   * each entry is a full {@link MosaicTemplatePropDefinition} (so a group is
   * just a way to bundle related primitive props). Absent for non-group props.
   */
  fields?: Record<string, MosaicTemplatePropDefinition>;
};

/**
 * Base shape for template props.
 *
 * Each template defines its own interface that extends this type,
 * e.g.:
 *
 *   interface CalendarProps extends MosaicTemplateProps {
 *     year: number;
 *     month: number;
 *   }
 *
 * The exact keys and types are template-specific, but this alias
 * makes it easy to refer to “some props object” generically.
 */
export type MosaicTemplateProps = Record<string, unknown>;

/**
 * Base shape for the typed `variables` payload a template
 * publishes (the `O` generic on {@link MosaicTemplate}).
 *
 * Templates that want to declare a typed output contract extend
 * this:
 *
 *   interface DashboardOutputs extends MosaicTemplateOutputs {
 *     topContributor: string;
 *     commitsToday: number;
 *   }
 *
 * The file-format side (`MosaicDocument.variables` /
 * `MosaicDataSource.variables`) stays opaque
 * `Record<string, unknown>` — these typed shapes are template-tier
 * contracts only.
 */
export type MosaicTemplateOutputs = Record<string, unknown>;

/**
 * Base shape for the typed `sidecars` payload a template publishes
 * (the `S` generic on {@link MosaicTemplate}).
 *
 * Sidecars are **structured data delivered to the end user**
 * alongside the rendered output — distinct from `variables`, which
 * flow between templates / pipeline steps via the engine context.
 * Canonical use case: a forensic watermark template's embedding
 * record, written as `{output-basename}.watermark.json` alongside
 * the watermarked video for later verification.
 *
 * Templates that want to declare a typed sidecar contract extend
 * this:
 *
 *   interface WatermarkSidecars extends MosaicTemplateSidecars {
 *     watermark: {
 *       algorithm: "lsb" | "dct";
 *       seed: string;
 *       embeddedAt: ReadonlyArray<...>;
 *     };
 *   }
 *
 * The file-format side (`MosaicDocument.sidecars`) stays opaque
 * `Record<string, unknown>` — these typed shapes are template-tier
 * contracts only.
 */
export type MosaicTemplateSidecars = Record<string, unknown>;

/**
 * High-level category of a `variables` value.
 *
 * Distinct from {@link MosaicTemplatePropType} (which models UI
 * affordances like "media" / "group" / "list" / "m0"). Variables
 * are pure data, so the type set is the JSON-shaped subset.
 *
 * Use `"any"` as the explicit escape hatch when a value's shape
 * isn't known up front but you still want to claim the key in the
 * schema.
 */
export type MosaicTemplateVariableType =
  | "string"
  | "string[]"
  | "number"
  | "number[]"
  | "boolean"
  | "boolean[]"
  | "object"
  | "any";

/**
 * Per-variable schema entry.
 *
 * Used by templates to declare:
 *  - what variables they publish ({@link MosaicTemplate.outputsSchema}).
 *  - what variables they consume via the flat union
 *    ({@link MosaicTemplate.upstreamVariablesSchema}).
 *  - what variables they consume via aliased data-blocks
 *    ({@link MosaicTemplate.upstreamDataSchema}).
 *
 * The engine validates runtime payloads against these schemas at
 * render boundaries and emits `VARIABLES_SCHEMA_MISMATCH` warnings
 * for drift (deferred wiring).
 */
export type MosaicTemplateVariableDefinition = {
  /** Value category for documentation, UI introspection, and validation. */
  type: MosaicTemplateVariableType;

  /**
   * Whether the consumer hard-requires this key. On the producer
   * side, `required: true` means "the engine should warn if I
   * don't publish this." On the consumer side, `required: true`
   * means "the engine should warn if back-edge collection doesn't
   * provide this."
   */
  required: boolean;

  /** Human-readable description for docs / editor tooltips. */
  description?: string;

  /**
   * Narrow value constraints. Distinct from
   * {@link MosaicPropConstraints} — no UI hints, just data
   * validity rules.
   */
  constraints?: {
    min?: number;
    max?: number;
    oneOf?: string[];
  };
};

/**
 * Declares the execution tier and requested capabilities of a template.
 *
 * REQUIRED: explicit security contract between template and host.
 * Templates do not automatically receive access to any side-effecting APIs.
 *
 * The host uses this declaration to:
 * - Decide whether the template may run in a given environment
 * - Construct a restricted MosaicEngineContext (default-deny)
 * - Enforce determinism and reproducibility policies
 *
 * Tiers:
 *
 * - { tier: "core" }
 *   - Capability-free: no filesystem/network/process access.
 *   - Fully deterministic and side-effect free.
 *   - Must not depend on wall-clock time or non-seeded randomness.
 *   - Safe to run anywhere without sandboxing.
 *
 * - { tier: "capability", caps: { ... } }
 *   - Requires explicit capabilities (fs/network/process).
 *   - caps explicitly declares requested capabilities.
 *   - Host may grant/restrict/deny capabilities (default-deny).
 *   - Only granted capabilities are exposed on the engine context.
 */
export type MosaicTemplateCapabilities =
  | { tier: "core" }
  | {
    tier: "capability";
    caps: MosaicTemplateCapabilityCaps;
  };

/** The capability flags requested by a "capability"-tier template. */
export type MosaicTemplateCapabilityCaps = {
  /** Filesystem access requirements. */
  fs?: {
    read?: boolean; // read existing files
    list?: boolean; // list directory contents
    write?: boolean; // write files or caches
    temp?: boolean; // use host-provided temp directories
  };

  /** Network access requirements. */
  net?: {
    fetch?: boolean; // perform HTTP(S) requests
  };

  /** Process execution requirements. */
  exec?: {
    spawn?: boolean; // spawn external processes
  };
};

/**
 * Suggested output settings for a template.
 *
 * These hints describe how the template is *intended* to be rendered
 * when the user does not explicitly choose output settings.
 *
 * They are NOT enforced and may be ignored or overridden by the host.
 * Templates must always read timing and resolution from `ctx.output`
 * and must stamp the resolved values into the returned MosaicDocument
 * for portability and correct nesting behavior.
 */
export type MosaicTemplateOutputHints = {
  /** Suggested output width in pixels (editor/UI hint only). */
  width?: number;

  /** Suggested output height in pixels (editor/UI hint only). */
  height?: number;

  /** Suggested frames per second (editor/UI hint only). */
  fps?: number;

  /** Suggested output duration in milliseconds (editor/UI hint only). */
  durationMs?: number;

  /** Optional human hint shown in UI */
  note?: string;

  /**
   * Representative "poster" frame, in milliseconds. Editor previews that
   * default to t=0 (e.g. the Make-page scrubber) start here instead, so a
   * spawn-in / fade-in template shows its settled content while the user
   * edits rather than an empty first frame. Does NOT affect the render
   * (which always starts at 0); scrubbing back to 0 still shows the intro.
   */
  posterTimeMs?: number;

  /**
   * Optional output format intent.
   * - Treated as a recommendation only
   * - User overrides take precedence
   * - Engine defaults apply last
   *
   * For the canonical output declaration, templates should set
   * `outputs.default` on their returned MosaicDocument instead of
   * relying on this hint. `outputHints` is retained for editor UIs
   * that pre-fill render controls before the template has been
   * invoked.
   */
  format?: MosaicOutputFormat;
};

/**
 * Closed list of recognized template roles.
 *
 * A `role` describes what *kind of work* a template performs — orthogonal
 * to its capability tier (`core` / `capability`) and its visibility
 * (`internal: boolean`). Setting a role is **opt-in**: templates without
 * a role keep working unchanged and are treated as plain renderables by
 * filters and pickers.
 *
 * When a role IS set, the template registry validates the template's
 * id against {@link TEMPLATE_ROLE_ID_HINTS} for that role and emits a
 * `TEMPLATE_ROLE_NAMING_MISMATCH` warning on drift. The warning never
 * blocks rendering — it's an authoring nudge, not an invariant.
 *
 * Roles:
 *  - `renderable` — produces pixels for end users (the implicit default).
 *  - `data-fetcher` — produces {@link MosaicDataSource}(s) only, no pixels.
 *  - `adapter` — reads upstream data, transforms it, and re-publishes it
 *    under a new alias — no pixels, no fetch. Bridges producer/consumer
 *    packs that don't agree on a variable naming convention.
 *  - `building-block` — internal helper consumed via `renderNestedTemplate`.
 *  - `orchestrator` — composes other templates into a pipeline.
 *  - `harness` — diagnostic / scaffolding renderer (wireframes, dev tools).
 *
 * Adding a role is a minor-version bump in `@m0saic/types` and forces
 * the audit conversation. Custom downstream concepts use `tags[]`.
 */
export const TEMPLATE_ROLES = [
  "renderable",
  "data-fetcher",
  "adapter",
  "building-block",
  "orchestrator",
  "harness",
] as const;

/** Union of every value in {@link TEMPLATE_ROLES}. */
export type TemplateRole = (typeof TEMPLATE_ROLES)[number];

/**
 * Runtime predicate: true iff `v` is a member of the closed
 * {@link TEMPLATE_ROLES} union. Use at JSON parse boundaries and
 * template-registry load to validate author-supplied role values.
 */
export const isTemplateRole = (v: unknown): v is TemplateRole =>
  typeof v === "string" && (TEMPLATE_ROLES as readonly string[]).includes(v);

/**
 * Per-role id-naming hint regex.
 *
 * Consulted by the template registry: when a template declares a
 * `role` and its `id` does NOT match the hint regex for that role,
 * the registry emits `TEMPLATE_ROLE_NAMING_MISMATCH` (warning
 * severity). The hint is permissive — multiple synonyms per role are
 * allowed so authors can pick names that read well alongside the rest
 * of the pack (cheeky variants welcome).
 *
 * Each non-renderable hint matches its keyword as a word boundary —
 * preceded by `/` or `-` (or start) and followed by `/` or `-` (or
 * end) — so both the segment form (`/intel/`) and the suffix /
 * prefix form (`playlist-fetcher`, `wireframe-cell`) are accepted.
 *
 *  - `renderable`: `/.*\/` — no constraint (matches the implicit default
 *    for every existing template).
 *  - `data-fetcher`: id contains `fetcher` | `intel` | `prologue` at a
 *    word boundary (cheeky variants for narrative-pipeline step 0).
 *  - `adapter`: id contains `adapter` | `bridge` at a word boundary.
 *  - `building-block`: id contains `internal` | `building-block` | `block`
 *    at a word boundary (matches the existing `internal/` folder convention).
 *  - `orchestrator`: id contains `pipeline` | `orchestrator` | `flow`
 *    at a word boundary.
 *  - `harness`: id contains `harness` | `wireframe` | `scaffold` at a
 *    word boundary.
 */
export const TEMPLATE_ROLE_ID_HINTS: Record<TemplateRole, RegExp> = {
  "renderable": /.*/,
  "data-fetcher": /(^|[\/-])(fetcher|intel|prologue)([\/-]|$)/,
  "adapter": /(^|[\/-])(adapter|bridge)([\/-]|$)/,
  "building-block": /(^|[\/-])(internal|building-block|block)([\/-]|$)/,
  "orchestrator": /(^|[\/-])(pipeline|orchestrator|flow)([\/-]|$)/,
  "harness": /(^|[\/-])(harness|wireframe|scaffold)([\/-]|$)/,
};

/**
 * A reusable template that turns props into a MosaicDocument.
 *
 * Templates are the main extension point in m0saic. Each template:
 *
 * - Declares a globally unique `id`
 * - Exposes a typed props interface `P`
 * - Documents and validates its props via `propsSchema`
 * - Provides canonical `defaultProps`
 * - Implements `render(props)` to produce a MosaicDocument
 *
 * Templates can be registered in the template registry and consumed
 * by the CLI, UIs, or other templates (via nested rendering).
 */
export interface MosaicTemplate<
  P extends MosaicTemplateProps = MosaicTemplateProps,
  O extends MosaicTemplateOutputs = MosaicTemplateOutputs,
  U extends MosaicTemplateUpstreamVariables = MosaicTemplateUpstreamVariables,
  D extends MosaicTemplateUpstreamData = MosaicTemplateUpstreamData,
  S extends MosaicTemplateSidecars = MosaicTemplateSidecars,
> {
  /**
   * Globally unique template id.
   *
   * Official templates follow:
   *   @m0saic/<pack>/<name>/v<major>
   *
   * Community templates follow:
   *   @community/<name>/v<major>
   *
   * Branded as {@link TemplateId} — values must match
   * {@link NAMESPACED_ID_PATTERN}. Construct via the platform-layer
   * helpers or {@link asTemplateId} at JSON parse boundaries.
   */
  id: TemplateId;

  /**
   * Human-friendly name used in pickers, lists, and docs.
   */
  label: string;

  /**
   * @deprecated since 2026-09-06 — the template id IS the version. A
   * template is immutable under its id (`…/vN`); a contract change means a
   * new `vN`, never a bump of this counter. Carrying a second version was
   * ambiguous and nothing keys on it (the only reader is the `.mosaicx`
   * resolver's advisory `templateVersion` mismatch warning, itself
   * deprecated). Kept required for now so existing templates compile; the
   * field and its readers are removed in the pre-launch deprecation sweep.
   */
  version: number;

  /**
   * Declares the template's tier and requested capabilities.
   *
   * REQUIRED. The host uses this to decide what powers to grant via ctx.
   * Default-deny: only explicitly granted capabilities are available.
   */
  capabilities: MosaicTemplateCapabilities;

  /**
   * Optional functional role.
   *
   * Opt-in classification: declares what *kind of work* the template
   * performs (renderable, data-fetcher, building-block, orchestrator,
   * harness). When set, the template registry validates the template's
   * {@link id} against {@link TEMPLATE_ROLE_ID_HINTS} for that role and
   * emits `TEMPLATE_ROLE_NAMING_MISMATCH` (warning) on mismatch. When
   * unset, no constraint is applied — existing templates keep working
   * unchanged.
   *
   * Orthogonal to {@link capabilities} (a data-fetcher may be
   * `core`-tier if pure-derivation, or `capability`-tier if it hits
   * a network) and to {@link internal} (role implies a *default* for
   * visibility, but `internal` stays as an explicit override).
   */
  role?: TemplateRole;

  /**
   * Short description of what the template does and when to use it.
   */
  description?: string;

  /**
   * Optional tags for search, filtering, or categorization.
   */
  tags?: string[];

  /**
   * Preferred aspect ratio for the output, e.g. "16:9" or "9:16".
   * This is a hint for UIs and does not strictly enforce dimensions.
   */
  aspectRatio?: MosaicAspectRatio;

  /**
   * Platforms this template is designed for, such as "desktop",
   * "tablet" or "mobile". Used by UIs to highlight or filter
   * templates by context.
   */
  platforms?: MosaicPlatform[];

  /**
   * Distribution channels this template is tuned for, such as
   * "tiktok" or "youtube".
   *
   * Values are free-form channel IDs (MosaicChannelId). Official
   * templates typically use KnownMosaicChannel values drawn from
   * KNOWN_MOSAIC_CHANNELS, but community templates may use any
   * identifier.
   */
  channels?: MosaicChannelId[];

  /**
   * Specific VR output format for this template.
   *
   * When present, this template is expected to target a VR headset
   * style output. UIs can use this together with `platforms` to
   * group or filter VR templates (e.g. SBS vs 360).
   *
   * Convention:
   * - If `vrType` is set, `platforms` should usually include "virtual-reality".
   * - Non-VR templates should leave this undefined.
   */
  vrType?: MosaicVRType;

  /**
   * Optional output hints suggested by the template.
   *
   * These values represent **recommended defaults**, not requirements.
   * The host (CLI / Desktop / Web) resolves the final output settings using:
   *
   *   user override > template outputHints > engine defaults
   *
   * Output hints are used to:
   * - Pre-fill editor controls (width, height, fps, duration)
   * - Reduce friction for one-click renders
   * - Communicate the "intended" presentation of the template
   *
   * Templates MUST NOT rely on these values being honored.
   * The authoritative values are always provided via `ctx.output`.
   *
   * if width/height omitted, UI may derive from aspectRatio and a default long side (e.g. 1080).
   */
  outputHints?: MosaicTemplateOutputHints;

  /**
   * Prop-aware output hints — the contract for a template whose canvas (or
   * fps / duration / format) is a KNOB: a creator template's `platform`
   * picks 1920×1080 or 1080×1920, a packaging template's dieline picks its
   * own sheet. Hosts call this with the CURRENT props BEFORE rendering and
   * seed the render target from the result (merged over the static
   * `outputHints`), so the CLI plans at the right canvas, Make's Device
   * anchor follows the knob the moment it changes, and the feasibility
   * guard measures the right size — no letterboxing, no post-render
   * re-anchoring. Precedence is unchanged: an explicit user ask (`-w/-h`,
   * the unlocked Device box) still wins over anything returned here.
   *
   * Rules (enforced by `defineMosaicTemplate` as the `outputHintsResolve`
   * convention):
   * - PURE and cheap: props in, hints out. No ctx, no media, no I/O, no
   *   randomness — hosts call it on every prop edit.
   * - At `defaultProps` it must AGREE with the static `outputHints` for
   *   every field it returns (the static hints stay the browse-time truth
   *   for manifests and cards).
   * - Return only what the props decide; omitted fields fall back to
   *   `outputHints`. Never throw — an unknown prop value resolves to the
   *   default, not to a failure.
   *
   * Hosts that predate this field ignore it and render at their own
   * target; a template must still lay out correctly at ANY `ctx.target`
   * (the same rule as before — the resolver decides the canvas, `render`
   * reads it back from ctx like every other template).
   */
  resolveOutputHints?: (props: P) => Partial<MosaicTemplateOutputHints>;

  /**
 * Optional preview assets for gallery/listing UIs.
 *
 * NOTE:
 * - Prefer providing previews via template-manifest.json for zero-exec listing.
 * - This field exists for convenience and parity; hosts may ignore it.
 */
  preview?: MosaicTemplatePreview;

  /**
   * Whether this template should be included in public template listings.
   *
   * When `internal: true`, the template is excluded from public registries
   * and template pickers (by default), but remains available for nested rendering via
   * `renderNestedTemplate()`. This is useful for building-block templates
   * that are only meant to be used by other templates, not directly by users.
   *
   * Default: `false` (template is public and appears in listings).
   */
  internal?: boolean;

  /**
   * Marks a **foundational building block** — a base template that many other
   * templates compose / rely on (charts composed by dashboards, a grid layout
   * reused across templates, etc.).
   *
   * This is an **informational** marker (discovery UIs render a "PRIMITIVE"
   * badge), NOT a visibility gate: a primitive is still a perfectly good
   * standalone pick (e.g. a donut or stat-card renders fine on its own).
   *
   * # Orthogonal to {@link internal}
   *
   * The two answer different questions and compose freely:
   *
   * | `primitive` | `internal` | Meaning                                                        |
   * |-------------|------------|----------------------------------------------------------------|
   * | `false`     | `false`    | A finished, top-level template (a hero, a report).             |
   * | `true`      | `false`    | A reusable base others build on, AND a public top-level pick.  |
   * | `false`     | `true`     | A one-off sub-part owned by a single parent (an internal leaf).|
   * | `true`      | `true`     | A shared building block that is ALSO not offered top-level.    |
   *
   * `primitive` answers "is this a base others build on?"; `internal` answers
   * "is this intended as a top-level selection?" (see the `internal` JSDoc above —
   * it is a visibility/intent gate, and does NOT encode whether the template can
   * render standalone: some internal templates render fine on their own, e.g. the
   * ffmpeg-pulse pieces; others expect parent-injected context, e.g. bar-cell).
   * A template may be either, both, or neither.
   *
   * Default: `false`.
   */
  primitive?: boolean;

  /**
   * Lattice declarations for the `latticeSmooth` template convention.
   *
   * Every split count above 12 in a rendered layout must be **5-smooth**
   * (2ᵃ·3ᵇ·5ᶜ): every canvas m0saic delivers to is 5-smooth and the modern
   * family's per-axis gcd is 120, so a 5-smooth basis is pixel-exact and
   * composes — inlining one template into another costs the LCM of their
   * split counts, and a single rough factor (7, 11, 121 = 11², …) multiplies
   * the whole composition. Handbook: `composition-arithmetic.md` §1–§2; the
   * gate runs `latticeReport` (`@m0saic/template-utils`) over the render.
   *
   * Two declared exceptions, both visible in the gate's report:
   *
   *  - `mode: "bitmap"` — the template is a baked raster (a QR or barcode
   *    module grid, a traced logo): its counts ARE the raster and it is never
   *    live-composed (handbook §3c BITMAP), so the rule is skipped and noted.
   *  - `allow` — split counts above 12 that are content cardinality rather
   *    than construction (one column per ISO week = 53), each with the reason
   *    a reviewer reads. Counts ≤ 12 with a rough factor (seven weekday
   *    columns) never need declaring — they are small-basis ratio fill.
   *  - `canvas: "physical"` — the hinted canvas is a PHYSICAL size (a print
   *    trim in inches × DPI) the template cannot move onto the lattice: the
   *    rough-canvas finding is skipped, and split counts the canvas explains
   *    (its divisors) are charged to it, not to the construction. Counts the
   *    canvas does not explain are still reported.
   *
   * Leave unset for the common case: weighted bands capped with
   * `weightedSplit(…, { precision: 120 })` and rect soups placed with
   * `placeInsetPieces` / `placeOptimizedPieces` are on the lattice by
   * construction.
   */
  lattice?: {
    /** A baked raster whose split counts are the module grid — exempt. */
    mode?: "bitmap";
    /** Content-cardinality counts above 12, each with its reason. */
    allow?: Array<{ count: number; reason: string }>;
    /** The hinted canvas is a physical size (print) that cannot be 5-smooth. */
    canvas?: "physical";
  };

  /**
   * Soft-deprecation marker. When set, this template is treated as
   * superseded by a newer surface — discovery UIs hide it from default
   * listings, but the template is otherwise fully callable (registry
   * lookups, nested rendering, programmatic invocation all still work).
   *
   * Deprecation is a **UX hint, not a load-time gate**. It exists for the
   * case where a template was the right shape at one point but a later
   * iteration produces better results for the same use-case — the old
   * one keeps working for back-compat / reference, but users picking from
   * the panel shouldn't see it as a primary choice.
   *
   * # Orthogonal to {@link internal}
   *
   * The two flags compose freely:
   *
   * | `internal` | `deprecated` | Tier               | Meaning                                                   |
   * |------------|--------------|--------------------|-----------------------------------------------------------|
   * | `false`    | `undefined`  | **Promoted**       | Default. User-facing, surfaced in panels.                 |
   * | `false`    | set          | **Deprecated**     | Old user-facing surface; hidden by default with a toggle. |
   * | `true`     | `undefined`  | **Internal**       | Engine-consumed only; never in user listings.             |
   * | `true`     | set          | **Internal+old**   | Engine-consumed AND scheduled for removal.                |
   *
   * Setting `deprecated` does NOT imply `internal: true`. A deprecated
   * template still appears in lookups by ID and via the "Show deprecated"
   * toggle — `internal: true` is the stronger flag that removes it from
   * all user discovery surfaces.
   */
  deprecated?: {
    /** Why this template is no longer the recommended pick. */
    reason?: string;
    /**
     * Suggested replacement template ID. UIs can render this as a
     * "use X instead" pointer next to the deprecation banner.
     */
    replacement?: TemplateId;
    /**
     * ISO date (YYYY-MM-DD) when deprecation was declared.
     * Useful for sweeping aged-out deprecations during periodic cleanups.
     */
    since?: string;
  };

  /**
   * Default options applied when finalizeRenderable is run automatically
   * (e.g. by defineMosaicTemplate or by the CLI after template.render()).
   * When omitted, defaults to { defaultRenderableOwner: "user", defaultSourceOwner: "user" }.
   */
  defaultFinalizeOpts?: {
    defaultRenderableOwner?: "template" | "user";
    defaultSourceOwner?: "template" | "user";
  };

  /**
   * Opt this template out of the automatic lossless compaction that
   * `template-utils` applies to render output (pure-null-layer removal +
   * split-count reduction to minimum representation).
   *
   * Set this only when the template returns DELIBERATE geometry whose
   * exact m0 structure must survive verbatim (intentional null layers,
   * load-bearing literal split counts). Most templates leave it unset:
   * the framework then guarantees a minimal, render-faithful m0 without
   * the author having to compact by hand.
   *
   * For a single render, a document can also opt out via
   * `doc.engine.skipAutoCompact`. Effective skip = either is true.
   */
  skipAutoCompact?: boolean;

  /**
   * Metadata and validation rules for each prop in P.
   * Keys must correspond to fields on the props interface.
   *
   * NOTE: This schema describes top-level props only.
   * Nested fields inside "group"/"list" are described by the template itself
   * (or future schema extensions).
   */
  propsSchema: Partial<
    Record<Extract<keyof P, string>, MosaicTemplatePropDefinition>
  >;

  /**
   * Canonical default props for this template.
   * Used when props are omitted or partially specified.
   */
  defaultProps: P;

  /**
   * Optional schema for the `variables` payload this template
   * publishes onto its returned MosaicDocument (`doc.variables`
   * and/or {@link MosaicDataSource.variables} on any data-source
   * cells it emits). Parallels {@link propsSchema} but for
   * *outgoing* structured data.
   *
   * Keyed by `keyof O` so type-level introspection stays accurate.
   *
   * Used by:
   *  - Editor UIs (Make, Compose) to render "variables published"
   *    pills and wire producer → consumer lines visually.
   *  - The engine (deferred wiring) to validate runtime payloads
   *    against the declared shape and emit
   *    `VARIABLES_SCHEMA_MISMATCH` warnings for drift.
   *
   * In v1, runtime TS cannot statically prove the returned
   * document's `variables` shape matches `O` — the renderable
   * file is a generic union. The schema is a documentation +
   * editor-introspection contract; engine-side warnings land with
   * the wiring follow-up PR.
   */
  outputsSchema?: Partial<Record<keyof O, MosaicTemplateVariableDefinition>>;

  /**
   * Optional schema for the variables this template *consumes* via
   * the flat union {@link MosaicEngineContext.upstreamVariables}.
   *
   * Documents the inbound contract; future engine warns if a
   * `required: true` key is missing from back-edge collection at
   * render time, or if a typed key carries the wrong runtime type.
   */
  upstreamVariablesSchema?: Partial<
    Record<keyof U, MosaicTemplateVariableDefinition>
  >;

  /**
   * Optional schema for the aliased data-blocks this template
   * consumes via {@link MosaicEngineContext.upstreamData}.
   *
   * Keys are aliases declared on upstream {@link MosaicDataSource}s
   * (`MosaicDataSource.alias`). Each alias declares the per-key
   * shape its data block is expected to expose.
   *
   * Example:
   *
   *   upstreamDataSchema: {
   *     templateContext: {
   *       description: "Season-data block published by step 0",
   *       variables: {
   *         team:   { type: "string", required: true },
   *         season: { type: "number", required: true },
   *       },
   *     },
   *   }
   */
  upstreamDataSchema?: Partial<
    Record<
      keyof D,
      {
        description?: string;
        variables: Partial<
          Record<string, MosaicTemplateVariableDefinition>
        >;
      }
    >
  >;

  /**
   * Optional schema for the **sidecars** this template delivers to
   * the end user — structured-data files persisted on disk
   * alongside the rendered output.
   *
   * Keyed by `keyof S`. The engine writes each declared sidecar as
   * a JSON file next to the primary render output, named
   * `{output-basename}.{sidecar-key}.json`. Example: a render
   * `forensic-hero.mp4` with `doc.sidecars = { watermark: {...} }`
   * produces `forensic-hero.watermark.json` alongside it.
   *
   * Distinct from {@link outputsSchema} and the variables family:
   *
   *  - `outputsSchema` / `variables`: in-memory data for *other
   *    templates* via back-edge collection (the engine context).
   *  - `sidecarsSchema` / `sidecars`: on-disk data for the
   *    *end-user / caller*, persisted alongside the output file.
   *
   * Canonical use case: a forensic watermark template that embeds
   * imperceptible patterns and publishes the embedding record
   * (algorithm, seed, embedded positions, recovery key) so a later
   * verification pass can detect the watermark.
   *
   * Engine wiring is live — `@m0saic/core`'s `writeSidecars` emits
   * one `<output-basename>.<key>.json` file per entry next to the
   * primary render output. Schema mismatches at render boundaries
   * emit `SIDECAR_SCHEMA_MISMATCH` once validation is wired (deferred).
   */
  sidecarsSchema?: Partial<
    Record<keyof S, MosaicTemplateVariableDefinition>
  >;

  /**
   * Optional canonical-shape outputs.
   *
   * Documents the expected publishing shape for testing /
   * documentation purposes; the engine does NOT thread this back
   * into running renders. Useful for unit tests that want a known
   * `variables` baseline to compare against.
   */
  defaultOutputs?: O;

  /**
   * Render the template with the given props into a MosaicDocument.
   * Callers are expected to validate or fill defaults before calling.
   *
   * The `ctx` is parameterized on the template's declared `U`
   * (flat upstream-variables) and `D` (namespaced upstream-data)
   * shapes, so `ctx.upstreamVariables` and `ctx.upstreamData` type
   * correctly inside the body.
   */
  render: (
    props: P,
    ctx: MosaicEngineContext<U, D>,
  ) => Promise<MosaicRenderableFile>;

  /**
   * Optional cheap, side-effect-free stand-in shown on **preview / design
   * hot paths** — e.g. when a template is merely selected or its props change
   * in the editor, before the user has committed to a render.
   *
   * Hosts that render for preview (the editor's live preview, template
   * selection) MUST call `renderLite` instead of `render` when it is present;
   * `render` runs only for an explicit, user-initiated make. When `renderLite`
   * is absent, hosts fall back to `render` (the historical behavior).
   *
   * Why this exists: a `tier: "capability"` template whose `render` performs
   * real side effects (spawns processes, writes files, fetches the network)
   * would otherwise run that heavy work just from being selected in the UI.
   * `renderLite` lets such a template return a lightweight instructional card
   * (e.g. via `makeStubMosaic`) so the editor shows *feedback*, not a 30-minute
   * job. It MUST NOT perform the side effects of `render`.
   *
   * It is invoked with `ctx.mode === "design"`. Core-tier (deterministic)
   * templates rarely need this — their `render` is already cheap.
   */
  renderLite?: (
    props: P,
    ctx: MosaicEngineContext<U, D>,
  ) => Promise<MosaicRenderableFile> | MosaicRenderableFile;

  /**
   * Optional polished one-page **cover** shown when the template is first
   * opened in an editor with pure default props — before the user has touched
   * anything. It welcomes the user and says what to supply.
   *
   * Why this exists: a template that fails fast on missing required media
   * (the correct `render` contract) makes the editor's very first frame an
   * error card, which reads as "broken" when the template merely wants a
   * video. `renderCover` gives the template a friendly first impression
   * without weakening `render`'s fail-fast behavior.
   *
   * Lifecycle (host contract):
   * - Shown ONLY on a pure-default open with no caller-supplied props (an
   *   `--props` open skips it entirely).
   * - The first user prop edit dismisses it, and the host then falls back to
   *   the normal preview path (`renderLite` if present, else `render`). That
   *   dismissal is NOT one-way: hosts may offer an affordance to bring the
   *   cover back (the Make page gives it its own pill beside the tutorial's
   *   "?"), so write a cover that reads well on a return visit, not only as
   *   a first impression.
   * - **Opt-in only.** Hosts NEVER synthesize a fallback cover for templates
   *   that don't declare one — absence means "behave exactly as before".
   *
   * Constraints: side-effect-free and deterministic (same as `renderLite`).
   * Invoked with `ctx.mode === "design"`. MUST NOT depend on `ctx.media`
   * (hosts pass an empty registry — the cover is self-contained, so no probe
   * runs) nor on node-only APIs when the template ships in a web build.
   * `ctx.target` carries the editor's canvas dimensions — size to it.
   */
  renderCover?: (
    props: P,
    ctx: MosaicEngineContext<U, D>,
  ) => Promise<MosaicRenderableFile> | MosaicRenderableFile;

  /**
   * Optional self-documenting **tutorial** — a renderable (typically a
   * pipeline of still pages) that demonstrates how to use the template: what
   * the required props mean, an example layout, what the output looks like.
   * Hosts surface it behind an explicit affordance (the Make page's "?" pill)
   * and the user WATCHES / scrubs it in place; it is never rendered to a file.
   *
   * Invoked with the template's OWN `defaultProps` — never the user's working
   * props — so the walkthrough is stable regardless of editor state.
   *
   * **Opt-in only**, like `renderCover`: hosts gate the affordance on the
   * template declaring one and never synthesize a generic walkthrough.
   *
   * Constraints: side-effect-free, deterministic, browser-safe, and no
   * `ctx.media` (same as `renderCover`). Invoked with `ctx.mode === "design"`.
   *
   * Timing: a tutorial declares its OWN per-step `durationMs` and MUST NOT
   * derive length from `ctx.target.durationMs` — the host passes no form
   * duration, so the natural step durations are what drive scrubbing.
   */
  renderTutorial?: (
    props: P,
    ctx: MosaicEngineContext<U, D>,
  ) => Promise<MosaicRenderableFile> | MosaicRenderableFile;
}
