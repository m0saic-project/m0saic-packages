/**
 * Layout constraints — the LABEL-keyed, ratio-based design contract.
 *
 * The m0 a template returns is exact but DISPOSABLE: it re-addresses its whole
 * geometry tree on any change of canvas or props, so stableKeys and tile order
 * are per-string and can't carry authored intent. The one thing that survives
 * every regeneration is the **label** the author stamps on a source
 * (`source.editor.label`). A `LayoutConstraint` targets that label and asserts a
 * canvas-INDEPENDENT ratio invariant against wherever the label lands.
 *
 * `checkLayout` is a PURE evaluator — a template (or an agent driving one) calls
 * it in a layout-search loop: try a packing via the DSL builders, evaluate, keep
 * trying until the labeled invariants hold. `withLayoutContract` is the debug
 * tripwire; the matrix/proof sweep it into a per-canvas feasibility envelope.
 *
 * A label may match MANY frames (every grid cell tagged `"cell"`) — the
 * constraint applies to each, so you constrain a KIND, not a node.
 */

import type {
  MosaicDocument,
  MosaicLayoutViolation,
  MosaicLayoutViolationRule,
} from "@m0saic/types";
import { flattenMosaicDocument } from "@m0saic/platform";
import { resolveDocFrames } from "./frameResolution";
import { engineRecover } from "./checkDocGeometry";
import { checkLatticeGutter, checkCoverage } from "./latticeRelations";
import type { LatticeGutterSpec, CoverageSpec } from "./latticeRelations";

/** Re-exported from `@m0saic/types` (the canonical cross-package home). */
export type LayoutViolation = MosaicLayoutViolation;

/**
 * Collapse a `MosaicBoxFrac` (scalar | `{x,y}` shorthand | per-side, per-side
 * wins) to per-edge fractions — the same collapse the engine performs before
 * `applyInsetToRect` (mirrors platform's `bakeDocumentInsets.resolveBoxFrac`).
 * Returns null when there's no effective inset.
 *
 * Feeding the shorthand forms to `engineRecover` raw left every edge
 * `undefined` → NaN boxes → every relation compared false and passed
 * VACUOUSLY (caught 2026-08-20 by the alpine bar-graph `debugLayout` demo:
 * a deliberately doubled middle bar sailed through equal-height).
 */
function resolveInsetFrac(v: unknown): { top: number; right: number; bottom: number; left: number } | null {
  if (v == null) return null;
  if (typeof v === "number") return v ? { top: v, right: v, bottom: v, left: v } : null;
  if (typeof v !== "object") return null;
  const o = v as { x?: number; y?: number; top?: number; right?: number; bottom?: number; left?: number };
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const box = { top: o.top ?? y, right: o.right ?? x, bottom: o.bottom ?? y, left: o.left ?? x };
  return box.top || box.right || box.bottom || box.left ? box : null;
}

/**
 * A ratio invariant, authored against a `label` — survives every m0 the template
 * regenerates. All enforcement is canvas-independent (ratios / fractions), so
 * one declaration holds at any canvas.
 */
/**
 * Script-aware text length in "Latin char units" (multiples of the base
 * charWidthEm). MEASURED against the CLI rasterizer (fontSize 40, 10-char
 * runs, 2026-08-22): Latin lowercase 0.495 em/char, Latin caps 0.647,
 * Cyrillic 0.945-0.965 (the fallback face draws it nearly monospace-wide),
 * CJK 0.980. A flat `.length` under-measures wide scripts ~1.5× and lets
 * real clips pass ("620 из 1000 клиентов"). Shared by the text-fit checker
 * AND template font caps so both sides model width identically (ASCII →
 * exactly `.length`, keeping Latin behavior byte-identical).
 */
export function textEmUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x2e80 || (cp >= 0x1100 && cp <= 0x11ff)) units += 1.6; // CJK / fullwidth / Hangul (~0.99em)
    else if (cp >= 0x0400 && cp <= 0x052f) units += 1.55; // Cyrillic (~0.96em, measured)
    else units += 1;
  }
  return units;
}

/** Ellipsize `text` to at most `maxUnits` script-aware em-units (textEmUnits'
 *  model). Reserves one unit for the ellipsis; returns the string unchanged
 *  when it already fits. Flat-char truncation under-cuts wide scripts ~1.5×
 *  and still clips. */
export function fitEmUnits(text: string, maxUnits: number): string {
  if (textEmUnits(text) <= maxUnits) return text;
  let out = "";
  let used = 1; // the ellipsis
  for (const ch of text) {
    const u = textEmUnits(ch);
    if (used + u > maxUnits) break;
    out += ch;
    used += u;
  }
  return `${out}…`;
}

/** Tag a source with the layout contract's join key (`editor.label`). Returns
 *  the same source, so painted leaves read `paint(tag(textCell(...), "name"))`. */
export function tag<T extends { editor?: { label?: string } }>(src: T, label: string): T {
  src.editor = { ...src.editor, label };
  return src;
}

/** Bind a source's rect to the template prop it DISPLAYS (`editor.binding`) —
 *  the Make page's double-click → inline-edit target. Sibling of {@link tag};
 *  composes either way round: `paint(bindProp(tag(textCell(...), "cat-label"), "labels", i))`.
 *
 *  - `propKey` is the dotted path exactly as `propsSchema` nests it
 *    (`"label"`, `"titles.title"`). For list props (`string[]`, `number[]`,
 *    `media[]`) `propKey` names the LIST and `index` the element — never
 *    `"labels.3"`. A `media` prop (or one `media[]` element) makes the rect a
 *    DROP target in Make: drag a file onto the cell to set the path.
 *  - One binding per source (a multi-layer text source binds its primary layer).
 *  - Bind the rect that shows the prop, not derived text (ticks, formatted
 *    totals). Bind even when the value is empty so the rect is a handle to ADD.
 *  - The per-render `stableKey` is OUTPUT — see `resolvePropBindings`. */
export function bindProp<T extends { editor?: { binding?: { propKey: string; index?: number } } }>(
  src: T,
  propKey: string,
  index?: number,
): T {
  if (!propKey) throw new Error("bindProp: propKey must be a non-empty dotted path");
  if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
    throw new Error(`bindProp: index must be a non-negative integer (got ${String(index)})`);
  }
  src.editor = { ...src.editor, binding: index === undefined ? { propKey } : { propKey, index } };
  return src;
}

/** Bind a source's rect to ONE LINE (character span) of a string prop — a
 *  code state, a lyric block: `bindPropRange(run, "states", i, {start, end},
 *  {start: tokStart, end: tokEnd})`. `range` is the `[start, end)` span of
 *  `states[i]` the rect EDITS (the whole line); `focus` is the sub-span the
 *  rect SHOWS (the clicked token) — Make pre-selects it and aligns the edit
 *  box so the line reads in place. Offsets index the RAW prop string (not a
 *  tab-expanded or normalized copy). Sibling of {@link bindProp}. */
export function bindPropRange<
  T extends { editor?: { binding?: { propKey: string; index?: number; range?: { start: number; end: number }; focus?: { start: number; end: number } } } },
>(
  src: T,
  propKey: string,
  index: number | undefined,
  range: { start: number; end: number },
  focus?: { start: number; end: number },
): T {
  if (!propKey) throw new Error("bindPropRange: propKey must be a non-empty dotted path");
  if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
    throw new Error(`bindPropRange: index must be a non-negative integer (got ${String(index)})`);
  }
  const span = (s: { start: number; end: number }, what: string) => {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end < s.start) {
      throw new Error(`bindPropRange: ${what} must be integers with 0 <= start <= end (got ${s.start}..${s.end})`);
    }
  };
  span(range, "range");
  if (focus) {
    span(focus, "focus");
    if (focus.start < range.start || focus.end > range.end) {
      throw new Error(`bindPropRange: focus ${focus.start}..${focus.end} must lie inside range ${range.start}..${range.end}`);
    }
  }
  src.editor = {
    ...src.editor,
    binding: {
      propKey,
      ...(index !== undefined ? { index } : {}),
      range: { start: range.start, end: range.end },
      ...(focus ? { focus: { start: focus.start, end: focus.end } } : {}),
    },
  };
  return src;
}

/** Bind a source's rect to a LEAF of a structured prop (`json` / `list` /
 *  `array` — rows of objects, nested records): `bindPropPath(cell, "rows",
 *  [i, "title"], "string")`. `path` routes from the prop's value to the leaf
 *  this rect displays; `kind` is the leaf's value type — "string", "number",
 *  "color" (a color string; Make shows a picker) or "media" (a file path; Make
 *  makes the rect a drop target) — and is REQUIRED (the schema
 *  has no per-leaf type, and an empty leaf must still be an "add" handle). Use the ORIGINAL index into the prop — never a filtered /
 *  truncated position. `opts.onClear` makes an empty commit remove the row
 *  (`"remove-element"`) or unset the leaf (`"unset-leaf"`); `opts.seedDraft`
 *  prefills an EMPTY leaf's editor from the rect's context. Sibling of
 *  {@link bindProp}. */
/** What an EMPTY commit on a binding means — see {@link PropBindingEntry.onClear}. */
export type PropBindingClearAction = "remove-element" | "unset-leaf";

/** One entry of {@link bindProps}. */
export type PropBindingEntry = {
  propKey: string;
  index?: number;
  path?: ReadonlyArray<string | number>;
  /** Leaf value type — required on structured leaves. `"media"` is a leaf
   *  holding a file path: Make makes the rect a DROP target + picker handle.
   *  Basic `media` / `media[]` props need no kind (the schema says). */
  kind?: "string" | "number" | "color" | "rect" | "media";
  /** Which text layer of the source shows this leaf. */
  layer?: number;
  /** What an EMPTY commit on this leaf means. Absent = the default (numbers /
   *  colors reject an empty commit, strings write `""`). `"remove-element"`
   *  splices the element at the leading numeric path segment (the whole row)
   *  out of its array — needs `index` or a numeric first `path` segment.
   *  `"unset-leaf"` deletes the leaf key from its object (or unsets a basic
   *  prop so its default shows) — not for array-element leaves (no key). */
  onClear?: PropBindingClearAction;
  /** Initial DRAFT for the editor when the bound leaf is EMPTY / absent (an
   *  add handle) — context the template knows from the rect: the clicked
   *  date (`String(day)`), a slot number. Shown pre-selected so Enter alone
   *  accepts it; written only on commit, like a typed value; ignored when
   *  the leaf already has a value. A `kind: "number"` seed must read as a
   *  number; `rect` and `media` leaves take no seed. */
  seedDraft?: string;
  /** A seeded leaf ONLY the tile's media drop fills (the slot number a
   *  dropped file takes): kept out of the text form (a blur-commit there
   *  would write the seed on an unrelated edit) and the badge row. Needs
   *  `seedDraft`; not for `media` / `rect` leaves. */
  companion?: boolean;
};

/** Author-time check of `companion` (throws with `what` as the prefix).
 *  Mirrors `bindingCompanion` in `@m0saic/platform`. */
function checkCompanion(what: string, companion: unknown, seedDraft: unknown, kind: unknown): void {
  if (companion === undefined) return;
  if (companion !== true) throw new Error(`${what}: companion must be true when set (got ${String(companion)})`);
  if (seedDraft === undefined) throw new Error(`${what}: a companion needs a seedDraft — it is the value the media drop writes`);
  if (kind === "media" || kind === "rect") throw new Error(`${what}: a "${kind}" leaf cannot be a companion (it is the drop / the move itself)`);
}

/** Author-time check of a `seedDraft` (throws with `what` as the prefix).
 *  Mirrors `bindingSeedDraft` in `@m0saic/platform`, which silently drops
 *  what this refuses. */
function checkSeedDraft(what: string, seedDraft: unknown, kind: unknown): void {
  if (seedDraft === undefined) return;
  if (typeof seedDraft !== "string" || seedDraft.trim() === "") {
    throw new Error(`${what}: seedDraft must be a non-blank string (got ${JSON.stringify(seedDraft)})`);
  }
  if (kind === "number" && !Number.isFinite(Number(seedDraft.trim()))) {
    throw new Error(`${what}: seedDraft ${JSON.stringify(seedDraft)} is not a number (kind "number")`);
  }
  if (kind === "rect" || kind === "media") {
    throw new Error(`${what}: seedDraft has no meaning on a "${kind}" leaf (a rect / a file path is never typed)`);
  }
}

/** Author-time check of an `onClear` against the leaf it sits on (throws with
 *  `what` as the prefix). Mirrors `bindingOnClear` in `@m0saic/platform`, which
 *  silently drops what this refuses — a template test should never reach that. */
function checkOnClear(
  what: string,
  onClear: unknown,
  full: ReadonlyArray<string | number>,
): void {
  if (onClear === undefined) return;
  if (onClear !== "remove-element" && onClear !== "unset-leaf") {
    throw new Error(`${what}: onClear must be "remove-element" | "unset-leaf" (got ${String(onClear)})`);
  }
  if (onClear === "remove-element" && typeof full[0] !== "number") {
    throw new Error(`${what}: onClear "remove-element" needs an element — an index or a numeric first path segment`);
  }
  if (onClear === "unset-leaf" && full.length > 0 && typeof full[full.length - 1] !== "string") {
    throw new Error(`${what}: onClear "unset-leaf" needs a keyed leaf — an array element has no key to unset (use "remove-element")`);
  }
}

/** Bind SEVERAL leaves to one source — a multi-layer text (title over
 *  subtitle) binds one entry per layer, in layer order. Editors open the
 *  rect as a stacked form. Writes `editor.bindings` (which wins over the
 *  single `binding`). Structured entries need `path` + `kind` like
 *  {@link bindPropPath}; an entry may carry `onClear` (an empty commit
 *  removes its row / unsets its leaf) and `seedDraft` (the prefill for an
 *  empty leaf). */
export function bindProps<
  T extends {
    editor?: {
      bindings?: Array<{ propKey: string; index?: number; path?: Array<string | number>; kind?: "string" | "number" | "color" | "rect" | "media"; layer?: number; onClear?: PropBindingClearAction; seedDraft?: string; companion?: boolean }>;
    };
  },
>(src: T, entries: ReadonlyArray<PropBindingEntry>): T {
  if (!entries.length) throw new Error("bindProps: at least one entry");
  const out = entries.map((e) => {
    if (!e.propKey) throw new Error("bindProps: propKey must be a non-empty dotted path");
    if (e.index !== undefined && (!Number.isInteger(e.index) || e.index < 0)) throw new Error(`bindProps: bad index ${String(e.index)}`);
    for (const seg of e.path ?? []) {
      const ok = typeof seg === "number" ? Number.isInteger(seg) && seg >= 0 : typeof seg === "string" && seg.length > 0;
      if (!ok) throw new Error(`bindProps: bad path segment ${JSON.stringify(seg)}`);
    }
    if (e.kind !== undefined && e.kind !== "string" && e.kind !== "number" && e.kind !== "color" && e.kind !== "rect" && e.kind !== "media") throw new Error(`bindProps: bad kind ${String(e.kind)}`);
    if (e.kind === "rect" && e.path?.length) throw new Error("bindProps: a rect binding names the whole prop or ONE element by index — never a path");
    if (e.layer !== undefined && (!Number.isInteger(e.layer) || e.layer < 0)) throw new Error(`bindProps: bad layer ${String(e.layer)}`);
    checkOnClear("bindProps", e.onClear, e.index !== undefined ? [e.index, ...(e.path ?? [])] : e.path ?? []);
    checkSeedDraft("bindProps", e.seedDraft, e.kind);
    checkCompanion("bindProps", e.companion, e.seedDraft, e.kind);
    return {
      propKey: e.propKey,
      ...(e.index !== undefined ? { index: e.index } : {}),
      ...(e.path ? { path: [...e.path] } : {}),
      ...(e.kind ? { kind: e.kind } : {}),
      ...(e.layer !== undefined ? { layer: e.layer } : {}),
      ...(e.onClear ? { onClear: e.onClear } : {}),
      ...(e.seedDraft !== undefined ? { seedDraft: e.seedDraft } : {}),
      ...(e.companion ? { companion: true } : {}),
    };
  });
  src.editor = { ...src.editor, bindings: out };
  return src;
}

/** Drop every prop binding from a document a HOST composes out of another
 *  template's render (a pipeline step from `renderNestedTemplate`, a beat in a
 *  runner). The bindings name the INNER template's props; against the host's
 *  schema they resolve as unknown-prop. Everything else on `editor` (labels,
 *  tags) stays. In place, like {@link bindProp}; recurses into `children`. */
export function stripPropBindings<
  T extends { sources?: unknown[]; children?: Record<string, unknown> },
>(doc: T): T {
  for (const s of doc.sources ?? []) {
    const ed = (s as { editor?: { binding?: unknown; bindings?: unknown } }).editor;
    if (!ed) continue;
    delete ed.binding;
    delete ed.bindings;
  }
  for (const child of Object.values(doc.children ?? {})) {
    if (child && typeof child === "object") stripPropBindings(child as T);
  }
  return doc;
}

/** Bind a source's rect to a `picker: "regions"` prop as the rect the user
 *  moves and resizes IN PLACE — Make opens the cell as a draw session seeded
 *  from what is painted, and writes the regions back so the template
 *  re-renders with them (never a destructive post-render edit). Two forms:
 *  a ONE-REGION picker (`regions.max: 1`) binds whole — `bindPropRect(src,
 *  key)`; a picker holding a LIST of rects (no cap, or a cap above the
 *  index) binds ONE element — `bindPropRect(src, key, i)`, the i-th region
 *  being this cell (a page of balloons: one prop, one handle per balloon;
 *  the session shows every sibling and writes the whole list). The cell
 *  keeps rendering the template's own placement while the prop (or the
 *  element) is empty; the binding is the handle. Sibling of {@link bindProp}. */
export function bindPropRect<
  T extends { editor?: { binding?: { propKey: string; index?: number; kind?: "string" | "number" | "color" | "rect" | "media" } } },
>(src: T, propKey: string, index?: number): T {
  if (!propKey) throw new Error("bindPropRect: propKey must be a non-empty dotted path");
  if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
    throw new Error(`bindPropRect: index must be a non-negative integer (got ${String(index)})`);
  }
  src.editor = { ...src.editor, binding: index === undefined ? { propKey, kind: "rect" } : { propKey, index, kind: "rect" } };
  return src;
}

export function bindPropPath<
  T extends { editor?: { binding?: { propKey: string; path?: Array<string | number>; kind?: "string" | "number" | "color" | "rect" | "media"; onClear?: PropBindingClearAction; seedDraft?: string } } },
>(
  src: T,
  propKey: string,
  path: ReadonlyArray<string | number>,
  kind: "string" | "number" | "color" | "media",
  opts?: { onClear?: PropBindingClearAction; seedDraft?: string },
): T {
  if (!propKey) throw new Error("bindPropPath: propKey must be a non-empty dotted path");
  if (!path.length) throw new Error("bindPropPath: path must name a leaf inside the prop value");
  for (const seg of path) {
    const ok = typeof seg === "number" ? Number.isInteger(seg) && seg >= 0 : typeof seg === "string" && seg.length > 0;
    if (!ok) throw new Error(`bindPropPath: bad path segment ${JSON.stringify(seg)}`);
  }
  if (kind !== "string" && kind !== "number" && kind !== "color" && kind !== "media") throw new Error(`bindPropPath: kind must be "string" | "number" | "color" | "media" (got ${String(kind)})`);
  checkOnClear("bindPropPath", opts?.onClear, path);
  checkSeedDraft("bindPropPath", opts?.seedDraft, kind);
  src.editor = {
    ...src.editor,
    binding: {
      propKey,
      path: [...path],
      kind,
      ...(opts?.onClear ? { onClear: opts.onClear } : {}),
      ...(opts?.seedDraft !== undefined ? { seedDraft: opts.seedDraft } : {}),
    },
  };
  return src;
}

export type LayoutConstraint = {
  /** The source tag to constrain (`sources[i].editor.label`). May hit MANY frames. */
  label: string;
  /** Realized aspect ratio (w/h) within `aspectTolerance`. */
  aspect?: number;
  /** Tolerance for `aspect`. Default `0.02`. */
  aspectTolerance?: number;
  /** Realized width as a fraction of canvas width (`w / canvasW`). */
  minWidthFrac?: number;
  maxWidthFrac?: number;
  /** Realized height as a fraction of canvas height (`h / canvasH`). */
  minHeightFrac?: number;
  maxHeightFrac?: number;
  /** The box's extent must stay within these canvas fractions (top 22% → yFrac:[0,0.22]). */
  within?: { xFrac?: [number, number]; yFrac?: [number, number] };
  /**
   * POSITION lock (px, canvas space): the label's boxes — sorted by x — must
   * have their x-centers at these positions, order-matched, within
   * `centerTolerancePx`. Built for axis ticks that must sit exactly where
   * computed geometry places a feature the contract CANNOT measure (a
   * mask-drawn data point): the tick is a real rect, so its center is the
   * proxy guarantee for the whole alignment.
   */
  xCenters?: number[];
  /** As `xCenters`, for y (boxes sorted by y). */
  yCenters?: number[];
  /** Absolute px tolerance for xCenters/yCenters. Default 4. */
  centerTolerancePx?: number;
  /**
   * GROUP-RELATIVE position lock: centers as fractions of the label group's
   * own center-span (first center → 0, last center → 1), boxes sorted by x.
   * MODEL-FREE — no canvas-space origin needed, so it is immune to the
   * card/rail chain's quantization drift that makes absolute xCenters
   * unmodelable from inside a template. Catches any element displaced
   * WITHIN the group (uniform whole-group shifts are structural when the
   * group shares its offset weights with the feature it proxies).
   */
  xCentersFrac?: number[];
  /** As `xCentersFrac`, for y. */
  yCentersFrac?: number[];
  /** Tolerance for the frac variants, as a fraction of the span. Default 0.015. */
  centerToleranceFrac?: number;
  /**
   * TEXT-FIT lock: the tagged TEXT source's literal string, at its authored
   * fontSize, must fit its box — estimated as longestLine × fontSize ×
   * `charWidthEm` (default 0.72, a CONSERVATIVE em-width modeling the CLI
   * rasterizer, which sets wider than the app; the whole point is to make
   * Make flag what would only break in the render). Non-text / expr-content
   * sources are skipped (nothing static to measure).
   */
  textFits?: { charWidthEm?: number; padPx?: number };
};

/**
 * A RELATIONAL invariant — compares a SET of labeled nodes (the image-collage's
 * "uniform thumbnails" / "consistent gutters"). The set is the union of frames
 * tagged with `label` (a single label's many nodes, or several labels combined).
 */
export type RelationalConstraint = {
  /** The node set: frames tagged with this label, or any of these labels. */
  label: string | string[];
  /** All nodes share this metric within `tolerance` (or `tolerancePx`). `"size"` = width AND height. */
  equal?: "width" | "height" | "aspect" | "size";
  /** Tolerance for `equal` (relative — fraction of the metric). Default `0.02`. */
  tolerance?: number;
  /** Absolute escape for `equal` (px): also pass when the raw spread is within
   *  this many pixels — the engine's equal split guarantees ±1px, which can
   *  exceed any sane fraction at tiny paint sizes. Not applied to `aspect`. */
  tolerancePx?: number;
  /**
   * Uniform gaps between nodes along an axis (nodes sorted by that axis).
   * 1-D — correct for a single row/column of nodes; for a 2-D packed layout
   * use `lattice` instead (sorting a grid's boxes along one axis produces
   * negative "gaps" across rows).
   */
  gutter?: {
    axis: "x" | "y";
    /** Target gap as a fraction of the canvas axis. Omit → just assert uniformity. */
    target?: number;
    /** Tolerance as a canvas fraction. Default `0.01`. */
    tolerance?: number;
  };
  /**
   * 2-D lattice gutters: every box's gap to its nearest neighbor per axis
   * (in PIXELS — the gutter is authored in px and the tolerance is the
   * engine's absolute floor-error bound). The image-collage's "consistent
   * gutters everywhere" invariant.
   */
  lattice?: LatticeGutterSpec;
  /**
   * Null-space accounting: the labeled boxes' painted area vs the canvas
   * (`1 − painted/canvas` must match the planned unpainted fraction). The
   * image-collage's "gutters + margins are the ONLY empty space" invariant.
   * Meaningful from a single node (a one-image sheet), unlike the pairwise
   * relations.
   */
  coverage?: CoverageSpec;
};

export type LayoutResolution = { stableKey: string; sourceIndex: number; rect: { x: number; y: number; w: number; h: number } };

export type LayoutCheckResult = {
  ok: boolean;
  violations: LayoutViolation[];
  /** `label → the node(s) it resolved to this render` (per-m0, for tooling). */
  resolved: Record<string, LayoutResolution[]>;
  /** `stableKey → label` for backfilling `doc.labels`. */
  resolvedLabels: Record<string, string>;
};

const EPS = 1e-9;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

type Box = { x: number; y: number; w: number; h: number };

function checkOne(
  c: LayoutConstraint,
  box: Box,
  w: number,
  h: number,
  stableKey: string,
  sourceIndex: number,
  out: MosaicLayoutViolation[],
): void {
  const push = (rule: MosaicLayoutViolationRule, expected: number | string, actual: number, detail: string): void => {
    out.push({ label: c.label, rule, expected, actual: round3(actual), stableKey, sourceIndex, realized: { ...box }, detail });
  };
  const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

  if (c.aspect != null) {
    const tol = c.aspectTolerance ?? 0.02;
    const ar = box.w / Math.max(1, box.h);
    if (Math.abs(ar - c.aspect) > tol)
      push("aspect", c.aspect, ar, `"${c.label}" aspect ${ar.toFixed(3)} ≠ ${c.aspect} (±${tol}) [${box.w}×${box.h}].`);
  }

  const wf = box.w / w;
  const hf = box.h / h;
  if (c.minWidthFrac != null && wf < c.minWidthFrac - EPS)
    push("min-width-frac", c.minWidthFrac, wf, `"${c.label}" width ${pct(wf)} < min ${pct(c.minWidthFrac)} of canvas.`);
  if (c.maxWidthFrac != null && wf > c.maxWidthFrac + EPS)
    push("max-width-frac", c.maxWidthFrac, wf, `"${c.label}" width ${pct(wf)} > max ${pct(c.maxWidthFrac)} of canvas.`);
  if (c.minHeightFrac != null && hf < c.minHeightFrac - EPS)
    push("min-height-frac", c.minHeightFrac, hf, `"${c.label}" height ${pct(hf)} < min ${pct(c.minHeightFrac)} of canvas.`);
  if (c.maxHeightFrac != null && hf > c.maxHeightFrac + EPS)
    push("max-height-frac", c.maxHeightFrac, hf, `"${c.label}" height ${pct(hf)} > max ${pct(c.maxHeightFrac)} of canvas.`);

  if (c.within?.xFrac) {
    const [lo, hi] = c.within.xFrac;
    const x0 = box.x / w, x1 = (box.x + box.w) / w;
    if (x0 < lo - EPS || x1 > hi + EPS)
      push("within-x", `[${lo},${hi}]`, x0 < lo ? x0 : x1, `"${c.label}" x-extent [${x0.toFixed(3)},${x1.toFixed(3)}] escapes [${lo},${hi}].`);
  }
  if (c.within?.yFrac) {
    const [lo, hi] = c.within.yFrac;
    const y0 = box.y / h, y1 = (box.y + box.h) / h;
    if (y0 < lo - EPS || y1 > hi + EPS)
      push("within-y", `[${lo},${hi}]`, y0 < lo ? y0 : y1, `"${c.label}" y-extent [${y0.toFixed(3)},${y1.toFixed(3)}] escapes [${lo},${hi}].`);
  }
}

// ── Relational checks (across a set of labeled nodes) ──────

const relLabel = (rel: RelationalConstraint): string =>
  Array.isArray(rel.label) ? rel.label.join("+") : rel.label;

function checkEqual(rel: RelationalConstraint, boxes: Box[], out: MosaicLayoutViolation[]): void {
  const tol = rel.tolerance ?? 0.02;
  // Absolute-pixel escape: a fractional tolerance is the wrong instrument at
  // tiny paint sizes (the engine's healthy equal-split ±1px is 8% of a 12px
  // bar). Pass when the spread is within EITHER bound. Aspect is unitless —
  // the px escape applies to width/height/size only.
  const tolPx = rel.tolerancePx ?? 0;
  const kinds: Array<"width" | "height" | "aspect"> =
    rel.equal === "size" ? ["width", "height"] : [rel.equal as "width" | "height" | "aspect"];
  const metric = (b: Box, k: string): number => (k === "width" ? b.w : k === "height" ? b.h : b.w / Math.max(1, b.h));
  const rule = (k: string): MosaicLayoutViolationRule => (k === "width" ? "equal-width" : k === "height" ? "equal-height" : "equal-aspect");
  for (const k of kinds) {
    const vals = boxes.map((b) => metric(b, k));
    const min = Math.min(...vals), max = Math.max(...vals);
    const spread = max > 0 ? (max - min) / max : 0;
    const withinPx = k !== "aspect" && tolPx > 0 && max - min <= tolPx;
    if (spread > tol && !withinPx)
      out.push({
        label: relLabel(rel), rule: rule(k), expected: tol, actual: round3(spread),
        detail: `"${relLabel(rel)}" ${k} not uniform: spread ${(spread * 100).toFixed(1)}% > ${(tol * 100).toFixed(1)}%${tolPx > 0 ? ` (and ${(max - min).toFixed(1)}px > ${tolPx}px)` : ""} (min ${min.toFixed(0)}, max ${max.toFixed(0)}).`,
      });
  }
}

function checkGutter(rel: RelationalConstraint, boxes: Box[], w: number, h: number, out: MosaicLayoutViolation[]): void {
  const g = rel.gutter!;
  const tol = g.tolerance ?? 0.01;
  const canvasAxis = g.axis === "x" ? w : h;
  const sorted = [...boxes].sort((a, b) => (g.axis === "x" ? a.x - b.x : a.y - b.y));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    const gapPx = g.axis === "x" ? cur.x - (prev.x + prev.w) : cur.y - (prev.y + prev.h);
    gaps.push(gapPx / canvasAxis);
  }
  if (gaps.length === 0) return;
  const gmin = Math.min(...gaps), gmax = Math.max(...gaps);
  if (gmax - gmin > tol)
    out.push({
      label: relLabel(rel), rule: "gutter-uniform", expected: tol, actual: round3(gmax - gmin),
      detail: `"${relLabel(rel)}" ${g.axis}-gutters not uniform: gaps ${(gmin * 100).toFixed(1)}%…${(gmax * 100).toFixed(1)}% (Δ ${((gmax - gmin) * 100).toFixed(1)}% > ${(tol * 100).toFixed(1)}%).`,
    });
  if (g.target != null) {
    const off = gaps.find((gap) => Math.abs(gap - g.target!) > tol);
    if (off != null)
      out.push({
        label: relLabel(rel), rule: "gutter-target", expected: g.target, actual: round3(off),
        detail: `"${relLabel(rel)}" ${g.axis}-gutter ${(off * 100).toFixed(1)}% ≠ target ${(g.target * 100).toFixed(1)}% (±${(tol * 100).toFixed(1)}%).`,
      });
  }
}

/**
 * Evaluate label-keyed ratio invariants against a doc at a canvas. PURE; never
 * throws. This is the function a layout search loops on.
 */
export function checkLayout(
  doc: MosaicDocument,
  opts: {
    canvasW: number;
    canvasH: number;
    /** Per-element ratio invariants (one labeled node each). */
    constraints?: LayoutConstraint[];
    /** Relational invariants (across a set of labeled nodes). */
    relations?: RelationalConstraint[];
    /**
     * Assert THROUGH nested children. A parent's top-level m0 is trivial
     * (`1{1{…}}`), so a child's real geometry only exists after flatten.
     * Default: auto (flatten when `doc.children` is present). A flatten FAILURE
     * is the drop signal — `grid/v1`'s silent nested vanish at a small canvas
     * was exactly `SPLIT_EXCEEDS_AXIS` here.
     */
    flatten?: boolean;
  },
): LayoutCheckResult {
  const w = Math.max(1, Math.round(opts.canvasW));
  const h = Math.max(1, Math.round(opts.canvasH));

  let target = doc;
  const nested = !!(doc.children && Object.keys(doc.children).length > 0);
  if (opts.flatten ?? nested) {
    const flat = flattenMosaicDocument({ file: doc, width: w, height: h, resolveRef: () => null });
    if (!flat.ok) {
      // The nested geometry couldn't be realized at this canvas — every
      // labeled element it should contain is, by definition, NOT present.
      const collapsed = `layout collapsed at ${w}×${h} (flatten failed — SPLIT_EXCEEDS_AXIS / nested precision drop)`;
      const violations: MosaicLayoutViolation[] = [
        ...(opts.constraints ?? []).map((c): MosaicLayoutViolation => ({
          label: c.label, rule: "missing-label", expected: c.label, actual: 0,
          detail: `${collapsed}; "${c.label}" cannot be present.`,
        })),
        ...(opts.relations ?? []).map((rel): MosaicLayoutViolation => ({
          label: relLabel(rel), rule: "too-few", expected: 2, actual: 0,
          detail: `${collapsed}; "${relLabel(rel)}" has no nodes to relate.`,
        })),
      ];
      return { ok: violations.length === 0, violations, resolved: {}, resolvedLabels: {} };
    }
    target = flat.file;
  }

  const { framesByLogical, labelToIndices, resolvedLabels } = resolveDocFrames(target, w, h);
  const sources = (target.sources ?? []) as Array<{ placement?: { inset?: unknown } } | undefined>;

  const violations: MosaicLayoutViolation[] = [];
  const resolved: Record<string, LayoutResolution[]> = {};

  // The judged region is what the viewer sees: the painted box. For an
  // inset-placed element (placeInsetPieces) that's the recovered box inside the
  // quantized cell, not the cell itself.
  const boxAt = (idx: number): Box => {
    const f = framesByLogical[idx];
    const cell: Box = { x: f.x, y: f.y, w: f.width, h: f.height };
    const inset = resolveInsetFrac(sources[idx]?.placement?.inset);
    return inset ? engineRecover(cell, inset) : cell;
  };

  // ── per-element constraints ──
  for (const c of opts.constraints ?? []) {
    const indices = labelToIndices.get(c.label) ?? [];
    if (indices.length === 0) {
      violations.push({
        label: c.label,
        rule: "missing-label",
        expected: c.label,
        actual: 0,
        detail: `no source tagged "${c.label}" at ${w}×${h} (label didn't land in this m0).`,
      });
      continue;
    }
    const list: LayoutResolution[] = [];
    for (const idx of indices) {
      const box = boxAt(idx);
      const stableKey = String(framesByLogical[idx].meta.stableKey);
      list.push({ stableKey, sourceIndex: idx, rect: box });
      checkOne(c, box, w, h, stableKey, idx, violations);
    }
    resolved[c.label] = list;

    // ── group position locks (xCenters / yCenters) ──
    const centerTol = c.centerTolerancePx ?? 4;
    const centerCheck = (expected: number[], axis: "x" | "y"): void => {
      const sorted = [...list].sort((a, b) => (axis === "x" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
      if (sorted.length !== expected.length) {
        violations.push({
          label: c.label, rule: "center-count", expected: expected.length, actual: sorted.length,
          detail: `"${c.label}" has ${sorted.length} boxes but ${expected.length} expected ${axis}-centers.`,
        });
        return;
      }
      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i].rect;
        const center = axis === "x" ? r.x + r.w / 2 : r.y + r.h / 2;
        if (Math.abs(center - expected[i]) > centerTol) {
          violations.push({
            label: c.label, rule: axis === "x" ? "x-center" : "y-center",
            expected: round3(expected[i]), actual: round3(center),
            stableKey: sorted[i].stableKey, sourceIndex: sorted[i].sourceIndex, realized: { ...r },
            detail: `"${c.label}"[${i}] ${axis}-center ${center.toFixed(1)} ≠ ${expected[i].toFixed(1)} (±${centerTol}px).`,
          });
        }
      }
    };
    if (c.xCenters?.length) centerCheck(c.xCenters, "x");
    if (c.yCenters?.length) centerCheck(c.yCenters, "y");

    const fracTol = c.centerToleranceFrac ?? 0.015;
    const centerFracCheck = (expected: number[], axis: "x" | "y"): void => {
      const sorted = [...list].sort((a, b) => (axis === "x" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
      if (sorted.length !== expected.length) {
        violations.push({
          label: c.label, rule: "center-count", expected: expected.length, actual: sorted.length,
          detail: `"${c.label}" has ${sorted.length} boxes but ${expected.length} expected ${axis}-center fracs.`,
        });
        return;
      }
      if (sorted.length < 2) return; // a span needs two centers
      const centerOf = (r: Box): number => (axis === "x" ? r.x + r.w / 2 : r.y + r.h / 2);
      const first = centerOf(sorted[0].rect);
      const last = centerOf(sorted[sorted.length - 1].rect);
      const span = Math.max(1e-6, last - first);
      for (let i = 0; i < sorted.length; i++) {
        const frac = (centerOf(sorted[i].rect) - first) / span;
        if (Math.abs(frac - expected[i]) > fracTol) {
          violations.push({
            label: c.label, rule: axis === "x" ? "x-center" : "y-center",
            expected: round3(expected[i]), actual: round3(frac),
            stableKey: sorted[i].stableKey, sourceIndex: sorted[i].sourceIndex, realized: { ...sorted[i].rect },
            detail: `"${c.label}"[${i}] ${axis}-center at span-frac ${frac.toFixed(3)} ≠ ${expected[i].toFixed(3)} (±${fracTol}).`,
          });
        }
      }
    };
    if (c.xCentersFrac?.length) centerFracCheck(c.xCentersFrac, "x");
    if (c.yCentersFrac?.length) centerFracCheck(c.yCentersFrac, "y");

    // ── text-fit lock ──
    if (c.textFits) {
      const em = c.textFits.charWidthEm ?? 0.72;
      const pad = c.textFits.padPx ?? 2;
      for (const r of list) {
        const src = sources[r.sourceIndex] as {
          type?: string;
          layers?: Array<{ content?: { kind?: string; text?: string }; style?: { fontSize?: number } }>;
        };
        if (src?.type !== "text") continue;
        for (const layer of src.layers ?? []) {
          if (layer?.content?.kind !== "literal" || typeof layer.content.text !== "string") continue;
          const fontSize = layer.style?.fontSize ?? 0;
          if (!fontSize) continue;
          // Script-aware length: wide scripts run wider than the Latin em
          // model (CJK/fullwidth ≈ 1.6×, Cyrillic ≈ 1.13×) — a flat char
          // count passed "620 из 1000 клиентов" while the render clipped it.
          const longest = layer.content.text.split("\n").reduce((m, l) => Math.max(m, textEmUnits(l)), 0);
          const est = longest * fontSize * em + pad;
          if (est > r.rect.w) {
            violations.push({
              label: c.label, rule: "text-fit", expected: round3(r.rect.w), actual: round3(est),
              stableKey: r.stableKey, sourceIndex: r.sourceIndex, realized: { ...r.rect },
              detail: `"${c.label}" text (${longest.toFixed(1)} em-units @ ${fontSize}px, ~${em}em) needs ~${est.toFixed(0)}px but its box is ${r.rect.w}px wide — clips in the CLI rasterizer.`,
            });
          }
        }
      }
    }
  }

  // ── relational constraints (across a set of labeled nodes) ──
  for (const rel of opts.relations ?? []) {
    const labels = Array.isArray(rel.label) ? rel.label : [rel.label];
    // Surface the resolved nodes for every label the relation references (a
    // relations-only check should still report `resolved`, for tooling / search).
    for (const l of labels) {
      if (!resolved[l]) {
        resolved[l] = (labelToIndices.get(l) ?? []).map((idx) => ({
          stableKey: String(framesByLogical[idx].meta.stableKey), sourceIndex: idx, rect: boxAt(idx),
        }));
      }
    }
    const idxs = labels.flatMap((l) => labelToIndices.get(l) ?? []);
    // Pairwise relations need ≥2 nodes; `coverage` is meaningful from 1 (a
    // single-image sheet still has a painted-vs-null accounting to hold).
    const minNodes = rel.equal || rel.gutter || rel.lattice ? 2 : 1;
    if (idxs.length < minNodes) {
      violations.push({
        label: relLabel(rel),
        rule: "too-few",
        expected: minNodes,
        actual: idxs.length,
        detail: `"${relLabel(rel)}" relation needs ≥${minNodes} nodes, found ${idxs.length} at ${w}×${h}.`,
      });
      continue;
    }
    const boxes = idxs.map(boxAt);
    if (rel.equal) checkEqual(rel, boxes, violations);
    if (rel.gutter) checkGutter(rel, boxes, w, h, violations);
    if (rel.lattice) checkLatticeGutter(relLabel(rel), rel.lattice, boxes, violations);
    if (rel.coverage) checkCoverage(relLabel(rel), rel.coverage, boxes, w, h, violations);
  }

  return { ok: violations.length === 0, violations, resolved, resolvedLabels };
}
