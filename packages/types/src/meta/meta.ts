/**
 * Metadata blocks attached to Mosaic entities.
 *
 * Three distinct concepts live here:
 *
 * - {@link MosaicFileMeta} — user-authored *content* metadata
 *   (title, author, source, note). Lives on top-level `.mosaic` /
 *   `.m0v` artifacts. Structurally identical to `M0FileMeta` from
 *   `@m0saic/dsl-file-formats`; duplicated here because
 *   `@m0saic/types` cannot depend on `@m0saic/dsl-file-formats`.
 *
 * - {@link MosaicSourceEditorMeta} / {@link MosaicRenderableEditorMeta} —
 *   editor-only metadata. OPTIONAL and NON-SEMANTIC. Does not
 *   affect rendering, validation, or determinism. Exists solely
 *   for UI affordances.
 *
 * - {@link MosaicEngineMeta} — engine-facing non-fatal status block.
 *   Communicates "rendered, but with a known problem" to the UI
 *   without aborting the render. Informational only.
 */

// ─────────────────────────────────────────────────────────────
// File meta — user-authored content metadata
// ─────────────────────────────────────────────────────────────

/**
 * User-authored content metadata for a `.mosaic` / `.m0v` artifact.
 *
 * Field-aligned with `M0FileMeta` from `@m0saic/dsl-file-formats` —
 * the renderable family (`.mosaic`) and the vocabulary family
 * (`.m0v`) carry the same meta block as the authoring family
 * (`.m0` / `.m0c` / `.m0p`).
 *
 * # Two distinct concepts (don't confuse them)
 *
 * - **File-lifecycle stamps** (`created`, `app`, `appVersion`) live
 *   at the *top level* of `MosaicDocument` / `MosaicDocumentPipeline`
 *   / `M0File` / `M0cFile` / `M0pFile` / `M0vFile`. The CLI / electron
 *   writer stamps them at save time. Templates **must not** set
 *   `created` (wall-clock dependency violates determinism — see
 *   the agent contract §9).
 *
 * - **Content metadata** (this type — `title`, `author`, `source`,
 *   `note`) is user-authored. Templates may stamp `source` (the
 *   originating template id / call signature); the author or editor
 *   may stamp `title`, `author`, `note`.
 *
 * Distinct from `MosaicContainerMetadata`, which writes container
 * atoms into the *rendered* output file. This type describes the
 * *source artifact* — the `.mosaic` or `.m0v` file itself — not the
 * rendered video / image / audio.
 *
 * All fields optional. Producers may stamp any subset; readers must
 * tolerate any combination.
 */
export type MosaicFileMeta = {
  /** Human title. */
  title?: string;

  /** Author / creator. */
  author?: string;

  /**
   * Origin reference — where this artifact came from.
   * Free-form: a path, URL, template id, or template call signature.
   */
  source?: string;

  /** Free-form note. */
  note?: string;
};

// ─────────────────────────────────────────────────────────────
// Editor meta — UI-only, non-semantic
// ─────────────────────────────────────────────────────────────

/**
 * Editor metadata for a MosaicSource (slot-level).
 *
 * Describes how this source behaves inside its parent document.
 */
export type MosaicSourceEditorMeta = {
  /**
   * Who owns this slot in the editor.
   *
   * - "template": locked; structure/placement not editable
   * - "user": editable by the user
   */
  owner?: "template" | "user";

  /**
   * Optional friendly label shown in the editor UI.
   */
  label?: string;

  /**
   * Optional binding from this slot back to the template prop this rect
   * DISPLAYS — the Make page's double-click → inline-edit target (and the
   * reverse "hover the prop → outline its rects" link).
   *
   * - `propKey` is the dotted path exactly as `propsSchema` nests it
   *   (`"label"`, `"titles.title"`).
   * - For `string[]` / `number[]` props, `propKey` names the LIST and `index`
   *   the element this rect shows — never `"labels.3"`.
   * - One binding per source; a multi-layer text source binds its primary
   *   layer. Only free-text string / number props (or one element of a list
   *   of those) are editable — everything else is ignored by editors.
   *
   * - Structured props (`json` / `list` / `array`): `path` is the route from
   *   the prop's value to the leaf this rect shows (`["rows", 2, "title"]`
   *   minus the prop itself → `[2, "title"]`), and `kind` declares the
   *   leaf's value type — required, so an EMPTY leaf is still an "add"
   *   handle without guessing. `index` is shorthand for a leading numeric
   *   path segment.
   *
   * - `onClear` says what an EMPTY commit on this binding means. Absent =
   *   the default (numbers / colors reject an empty commit; strings write
   *   `""`). `"remove-element"` splices the element at the leading numeric
   *   path segment (the whole row) out of its array — needs an `index` or a
   *   numeric first `path` segment. `"unset-leaf"` deletes the leaf key from
   *   its object (or unsets the basic prop so its default shows) — not for
   *   array-element leaves, which have no key.
   *
   * - `seedDraft` prefills the editor when the bound leaf is EMPTY / absent
   *   (an "add" handle) with context the template derives from the rect —
   *   the clicked date, a slot number. A draft only: shown pre-selected,
   *   written on commit like any typed value, never applied by itself, and
   *   ignored when the leaf already has a value. Ignored on `media` and
   *   `rect` leaves (a seeded path makes no sense).
   *
   * - Media: a `media` prop (no index / path), ONE element of a `media[]`
   *   prop (`index` required — the list itself is never bindable), or a
   *   structured leaf holding a path with an explicit `kind: "media"`. Make
   *   turns the rect into a DROP target (a file dragged onto the cell writes
   *   the prop's path) with a picture-glyph handle that opens the OS picker.
   *   The prop's `meta.control.accept` / `extensions` gate what lands.
   *
   * - `companion` marks a seeded leaf that belongs to the tile's MEDIA drop:
   *   when a file lands, every EMPTY seeded sibling is written with its seed
   *   (the clicked date, the slot number), and a companion is one that ONLY
   *   the drop should fill — it never shows in the text form (where a
   *   blur-commit would write its seed on an unrelated edit) and never earns
   *   a badge. Needs a `seedDraft`; not for `media` / `rect` leaves.
   *
   * Authored via `bindProp()` / `bindPropPath()` in `@m0saic/template-utils`;
   * resolved per render (sources are positional, so no migration on re-keying).
   */
  binding?: {
    propKey: string;
    index?: number;
    path?: Array<string | number>;
    kind?: "string" | "number" | "color" | "rect" | "media";
    /** Which text layer of this source shows the leaf (multi-layer text). */
    layer?: number;
    /** What an EMPTY commit means: splice the row / unset the leaf. Absent =
     *  numbers and colors reject empty, strings write `""`. */
    onClear?: "remove-element" | "unset-leaf";
    /** Initial DRAFT when the leaf is empty / absent (an add handle) —
     *  pre-selected, written only on commit; ignored on a leaf with a value. */
    seedDraft?: string;
    /** A seeded leaf ONLY the tile's media drop fills (a slot number) — kept
     *  out of the text form and the badge row. Needs `seedDraft`. */
    companion?: boolean;
    /**
     * Character span `[start, end)` of the STRING leaf this rect edits — one
     * line of a multi-line prop (a code state, a lyric block). The editor
     * shows and writes only this slice; the rest of the leaf is untouched.
     * String leaves only; ignored on number / color leaves.
     */
    range?: { start: number; end: number };
    /**
     * Sub-span of `range` the rect itself shows (the clicked token). The
     * editor pre-selects it and aligns its box so the line reads in place.
     * Must lie inside `range`; ignored without one.
     */
    focus?: { start: number; end: number };
  };

  /**
   * Several leaves in ONE source — a multi-layer text (title over subtitle)
   * binds one entry per layer. Editors open such a rect as a small stacked
   * form. Takes precedence over `binding` when present.
   */
  bindings?: Array<{
    propKey: string;
    index?: number;
    path?: Array<string | number>;
    kind?: "string" | "number" | "color" | "rect" | "media";
    layer?: number;
    onClear?: "remove-element" | "unset-leaf";
    seedDraft?: string;
    companion?: boolean;
    range?: { start: number; end: number };
    focus?: { start: number; end: number };
  }>;
};

/**
 * Integer pixel rect in DOCUMENT OUTPUT coordinates (the doc's stamped
 * `size`, not on-screen preview px).
 */
export type MosaicGeometryEditRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * How a human geometry edit moved a node.
 *
 * - `"move_subtree"` — the node AND everything inside it (its whole
 *   subtree, including an attached overlay chain) moved to the new rect.
 *   The default grab. (V1 "Safe" mode: additive null + re-place.)
 * - `"move_rect_only"` — only the node's own rendered leaf moved; its
 *   overlay children stayed behind at the origin ("float"/detach).
 *   (V1 "Safe" mode.)
 * - `"rebuild"` — V2 "Rebuild" mode: the ENTIRE flat document was
 *   regenerated from its rendered leaves at exact output pixels (resize /
 *   z-order / group move, proportional descendant scaling). The m0 string
 *   is opaque to a diff — read the record's `nodes[]` + `z` as INTENT.
 *   Presence of a `"rebuild"` record marks the doc resolution-committed at
 *   `record.canvas`.
 */
export type MosaicGeometryEditKind = "move_subtree" | "move_rect_only" | "rebuild";

/**
 * One committed human geometry edit on a FLAT document (post-render
 * output geometry). Produced by the Make-page Edit mode; consumed by
 * agents as INTENT — the rough rect the human wanted — to be re-encoded
 * into template math, never replayed verbatim.
 *
 * Editor-side data: non-semantic, ignored by the engine, no effect on
 * rendering or determinism.
 */
export type MosaicGeometryEditRecord = {
  kind: MosaicGeometryEditKind;

  /** StableKey of the grabbed node in the PRE-edit flat m0. */
  fromKey: string;

  /** StableKey of the placed node's root in the POST-edit flat m0. */
  toKey: string;

  /** The node's rect before the edit. */
  prevRect: MosaicGeometryEditRect;

  /** The rect the human dropped it at. */
  nextRect: MosaicGeometryEditRect;

  /** Document output dims the rects are expressed in. */
  canvas: { w: number; h: number };

  /** How many renderable sources moved with the node. */
  movedSourceCount: number;

  /** ISO timestamp, stamped by the editor at commit time. */
  at?: string;

  // ── V2 "rebuild" fields (all optional; V1 records never set them) ──

  /**
   * Whether the rebuild moved the node's whole subtree (descendant leaves
   * scale proportionally into the new node rect) or only the node's own
   * rendered leaf. `"rect_only"` is disabled for groups. Absent on V1
   * records and on pure z-order rebuilds where no rect changed.
   */
  scope?: "subtree" | "rect_only";

  /**
   * The z-order operation this rebuild applied, with the node block's paint
   * index before and after (render-walk order). Present only for rebuild
   * commits that changed stacking.
   */
  z?: {
    op: "front" | "back" | "forward" | "backward";
    prevPaintIndex: number;
    nextPaintIndex: number;
  };

  /**
   * Per-descendant old → new mapping for a rebuild, capturing the full
   * structural intent even though the regenerated m0 string is opaque to a
   * diff. `fromKey`/`toKey` live in the record's own pre/post keyspace;
   * `prevRect`/`nextRect` are equal for a pure z op. For the grabbed node
   * itself the top-level `fromKey`/`toKey`/`prevRect`/`nextRect` apply; this
   * array covers the leaves that traveled inside it.
   */
  nodes?: Array<{
    fromKey: string;
    toKey: string;
    prevRect: MosaicGeometryEditRect;
    nextRect: MosaicGeometryEditRect;
  }>;
};

// ─────────────────────────────────────────────────────────────
// Geometry contract — intent-vs-realized stamp (Debug builds)
// ─────────────────────────────────────────────────────────────

/**
 * The kinds of geometry-contract violation an intent-vs-realized check can
 * report. The canonical producer is `@m0saic/template-utils`'
 * `checkDocGeometry`; this type lives in `@m0saic/types` so private consumers
 * (the Make editor) can read a stamped result without importing the public
 * template layer.
 */
export type MosaicGeometryViolationKind =
  | "missing-frame"
  | "position"
  | "size"
  | "min-size"
  | "aspect"
  | "inset-recovery"
  | "mask-scale";

/**
 * Pixel rect in the geometry contract's `{x,y,w,h}` convention (deliberately
 * NOT `M0Rect`'s `{x,y,width,height}` — expectations are authored in `w`/`h`).
 */
export type MosaicGeometryRect = { x: number; y: number; w: number; h: number };

/**
 * One intent-vs-realized discrepancy for a placed element, ready to render into
 * an error-mosaic line. `intended` is the JS-pixel-math truth the author
 * computed; `realized` is what the parsed m0 (post-inset-recovery) actually
 * paints (absent for `missing-frame`).
 */
export type MosaicGeometryViolation = {
  /** Index into the checked expectation list. */
  index: number;
  /** Human name for readouts ("value-band", "chip"). */
  name?: string;
  kind: MosaicGeometryViolationKind;
  /** The axis the discrepancy is on, when axis-specific. */
  axis?: "x" | "y";
  intended: MosaicGeometryRect;
  realized?: MosaicGeometryRect;
  /** Signed px the realized edge/size deviated (for the readout). */
  deltaPx?: number;
  /**
   * StableKey of the matched render frame — the most reliable identity (the
   * deterministic structural path; the same key the editor's geometryEdits
   * use). Resolved by the checker's parse; absent on `missing-frame`.
   */
  stableKey?: string;
  /**
   * The matched frame's `logicalIndex` — its index into the document's
   * `sources[]` (the engine binds `sources[frame.logicalIndex]`, NOT by paint
   * order). This is the bridge from a geometry node back to its tagged source.
   * Absent on `missing-frame`.
   */
  sourceIndex?: number;
  /** One human line, ready for the error mosaic. */
  detail: string;
};

/**
 * Per-expectation resolved identity — emitted for EVERY checked expectation
 * (pass or fail), from the checker's single parse. Ties together the three ways
 * to name one geometry node: the `stableKey` (structural identity), the
 * `sourceIndex` (= the frame's `logicalIndex`, its index into `sources[]` — how
 * the engine binds a source to a cell), and the `label` (the human tag read off
 * `sources[sourceIndex].editor.label`). So external tools map every piece by
 * identity, by source, or by name without re-parsing. Fields absent when the
 * expectation matched no frame.
 */
export type MosaicGeometryContractMatch = {
  index: number;
  name?: string;
  stableKey?: string;
  /** The matched frame's `logicalIndex` = its index into `sources[]`. */
  sourceIndex?: number;
  /** Human tag from `sources[sourceIndex].editor.label`, if present. */
  label?: string;
};

/** `evaluateM0` floors captured alongside a geometry-contract result. */
export type MosaicGeometryContractFloors = {
  feasible: boolean;
  meetsPrecision: boolean;
  maxSpreadPx: number;
};

/**
 * The stamp `withGeometryContract` (`@m0saic/template-utils`) writes onto
 * `editor.geometryContract` when a template's debug gate is on — pass OR fail.
 * External tools (the geometry matrix, the proof runner, the sandbox loop, the
 * Make preview) read this instead of re-deriving expectations or double-parsing
 * the doc. Absent entirely when the debug gate is off (the zero-cost rule).
 */
export type MosaicGeometryContractStamp = {
  ok: boolean;
  violations: MosaicGeometryViolation[];
  floors: MosaicGeometryContractFloors;
  /**
   * Per-expectation resolved identity (stableKey ↔ paintIndex/sources index),
   * one entry per expectation in order. The reliable map external tools use to
   * locate every piece — resolved from the checker's single parse.
   */
  matched: MosaicGeometryContractMatch[];
  /** How many expectations were checked. */
  expectationCount: number;
  /** The canvas the check ran at. */
  canvas: { w: number; h: number };
  /** The template that declared the contract. */
  templateId: string;
};

// ─────────────────────────────────────────────────────────────
// Layout contract — LABEL-keyed, ratio-based design invariants
// ─────────────────────────────────────────────────────────────

/**
 * A ratio-invariant rule. Because m0 is disposable (a template re-addresses its
 * whole geometry tree on any change), authored intent keys off a stable `label`
 * and is enforced as a canvas-INDEPENDENT ratio — never a pixel or a stableKey.
 */
export type MosaicLayoutViolationRule =
  // ── per-element (one labeled node) ──
  | "aspect"
  | "min-width-frac"
  | "max-width-frac"
  | "min-height-frac"
  | "max-height-frac"
  | "within-x"
  | "within-y"
  | "x-center"
  | "y-center"
  | "center-count"
  | "text-fit"
  | "missing-label"
  // ── relational (across a set of labeled nodes) ──
  | "equal-width"
  | "equal-height"
  | "equal-aspect"
  | "gutter-uniform"
  | "gutter-target"
  | "lattice-gutter"
  | "coverage"
  | "too-few";

/**
 * One violated ratio invariant, for a specific labeled node in THIS m0. The
 * `label` is the authored identity; `stableKey`/`sourceIndex` are the per-m0
 * resolution (which node the label landed on this render — for tooling/readouts).
 */
export type MosaicLayoutViolation = {
  /** The authored label the constraint targeted. */
  label: string;
  rule: MosaicLayoutViolationRule;
  /** The declared bound (a ratio, or a "[lo,hi]" range string for `within-*`). */
  expected: number | string;
  /** The realized ratio/fraction. */
  actual: number;
  /** Per-m0 resolution: the node the label landed on this render. */
  stableKey?: string;
  sourceIndex?: number;
  /** The realized box (px, for reference). */
  realized?: MosaicGeometryRect;
  /** One human line, ready for the error mosaic. */
  detail: string;
};

/**
 * The stamp `withLayoutContract` writes onto `editor.layoutContract` when the
 * debug gate is on. External tools (the layout-envelope sweep, Make) read it to
 * see which labeled invariants held at this canvas.
 */
export type MosaicLayoutContractStamp = {
  ok: boolean;
  violations: MosaicLayoutViolation[];
  /** How many constraints were checked. */
  constraintCount: number;
  /** The canvas the check ran at. */
  canvas: { w: number; h: number };
  /** The template that declared the contract. */
  templateId: string;
};

/**
 * Editor metadata for renderable files
 * (MosaicDocument / MosaicDocumentPipeline).
 *
 * Describes ownership and provenance of the renderable itself,
 * independent of how it is slotted into a parent.
 */
export type MosaicRenderableEditorMeta = {
  /**
   * Who owns this renderable when opened directly.
   *
   * - "template": view-only
   * - "user": editable
   */
  owner?: "template" | "user";

  /**
   * Optional friendly label shown in editor UI.
   */
  label?: string;

  /**
   * Provenance describing how this renderable was produced.
   * Used to surface nested template props in the editor and to let
   * the render hero correlate sub-renders back to their authoring
   * source. Discriminated union — narrow on `kind`:
   *
   * - `"template_call"` — legacy: stamped when a template was
   *   evaluated at AUTHOR TIME (e.g., Compose's old eager-render
   *   path) and its result was embedded as a child doc. Carries
   *   the templateId + props that produced the result.
   *
   * - `"template_invocation"` — stamped by `resolveMosaicx` when a
   *   `template_invocation` source is materialized into a child doc.
   *   Includes an `invocationId` so the render hero can link
   *   sub-render progress events back to the original source path,
   *   and an optional `sourcePath` (dotted path into the mosaicx)
   *   for editor "go to source" affordances.
   */
  provenance?:
    | {
        kind: "template_call";
        templateId: string;
        templateVersion?: number;
        props: unknown;
      }
    | {
        kind: "template_invocation";
        templateId: string;
        templateVersion?: number;
        props: unknown;
        /** Resolver-stamped, stable per invocation; correlates sub-render events. */
        invocationId: string;
        /** Dotted path into the source `.mosaicx` (e.g. `"sources[2]"`). */
        sourcePath?: string;
      };

  /**
   * Human geometry edits committed against this FLAT document by the
   * Make-page Edit mode, in commit order. Each record is the human's
   * rough intent (old rect → new rect per stableKey); agents read these
   * to re-encode the intent into template math. Non-semantic: the
   * engine renders the document's m0/sources as-is and ignores this.
   */
  geometryEdits?: MosaicGeometryEditRecord[];

  /**
   * Intent-vs-realized geometry-contract result, stamped by
   * `withGeometryContract` (`@m0saic/template-utils`) when a template's debug
   * gate is on — pass OR fail. Non-semantic: the engine ignores it; the
   * geometry matrix / proof runner / Make preview read it. Absent when the
   * debug gate is off (the zero-cost rule).
   */
  geometryContract?: MosaicGeometryContractStamp;

  /**
   * Label-keyed ratio-invariant result, stamped by `withLayoutContract`
   * (`@m0saic/template-utils`) when a template's debug gate is on. Non-semantic;
   * the layout-envelope sweep / Make read it. Absent when the gate is off.
   */
  layoutContract?: MosaicLayoutContractStamp;
};

// ─────────────────────────────────────────────────────────────
// Engine meta — non-fatal render status
// ─────────────────────────────────────────────────────────────

/**
 * Engine-facing metadata.
 *
 * This metadata does NOT affect render control flow.
 * The engine will continue rendering even when an entity
 * is marked as "error".
 *
 * Its purpose is:
 * - to communicate non-fatal failures to the UI
 * - to allow diagnostics, warnings, and call-to-action indicators
 *
 * Example:
 * - A media file fails to load, but the template returns
 *   a fallback / error mosaic instead.
 * - Rendering proceeds, but the UI should show ⚠️ on that node.
 */
export type MosaicEngineMeta = {
  /**
   * This DOCUMENT is a baked raster — a QR / barcode module grid, a bitmap
   * trace — whose split counts ARE the raster: never live-composed, so the
   * `latticeSmooth` template convention skips it (and everything nested
   * under it). The per-document form of `MosaicTemplate.lattice.mode`: set it
   * on a child document a template assembles from a code generator
   * (`qrToRenderable`, `barcodeToRenderable`) inside an otherwise ratio layout.
   */
  lattice?: { mode: "bitmap" };

  /**
   * Declares the semantic render status of this entity.
   *
   * - "ok": rendered as intended
   * - "error": rendered, but with a known problem
   *
   * This flag must NOT abort a render. The engine keeps going, the
   * document still renders, and the file is still written — that is the
   * whole point of an error mosaic: you get a picture that TELLS you what
   * broke.
   *
   * It is not, however, invisible to callers. After the render completes,
   * the CLI reports the marker: exit code 3 (RENDER DEGRADED — distinct
   * from 1, because a valid file WAS produced) plus `renderStatus` /
   * `renderErrorCodes` in the `--report` sidecar. The desktop UI uses the
   * same marker to disable Make. Abort: never. Report: always.
   */
  renderStatus?: "ok" | "error";

  /**
   * Optional human-readable error details.
   * Used for UI display and debugging.
   */
  renderError?: {
    message: string;
    code?: string;
  };

  /**
   * Opt this document out of the automatic lossless compaction that
   * `template-utils` applies to template render output (pure-null-layer
   * removal + split-count reduction).
   *
   * Set this when the document returns DELIBERATE geometry whose exact
   * structure must survive verbatim — e.g. a layout authored with
   * intentional null layers, or splits whose literal counts are
   * load-bearing for downstream addressing. Most templates leave it
   * unset and let the framework guarantee a minimal m0.
   *
   * Per-render override; the template-level `skipAutoCompact` flag opts
   * out every render. Effective skip = either is true.
   */
  skipAutoCompact?: boolean;
};
