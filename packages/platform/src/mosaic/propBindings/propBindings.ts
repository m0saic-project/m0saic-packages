/**
 * Prop bindings — the ONE predicate for "can this rect edit this prop?".
 *
 * A template marks the source that DISPLAYS a basic prop with
 * `source.editor.binding = { propKey, index? }` (`bindProp()` in
 * `@m0saic/template-utils`). Two consumers resolve those bindings against the
 * template's `propsSchema`:
 *
 *   - `resolvePropBindings` in template-utils (template tests / tooling)
 *   - the Make page's inline prop editor (double-click a rect → edit the prop)
 *
 * Both MUST agree on which props are bindable, so the classification lives
 * here, once. Pure (no node imports) — safe for CLI, Electron and the web.
 *
 * Rules:
 *   - `propKey` is the dotted path exactly as `propsSchema` nests it
 *     (`"label"`, `"titles.title"`); every segment past the first walks a
 *     `type: "group"` prop's `fields`.
 *   - Bindable: `"string"` (free text; a color-valued string — `isColor` /
 *     `colorPicker` — is kind `"color"` and gets a picker; enum / connection-
 *     option strings render closed pickers and are NOT bindable), `"number"`,
 *     and one ELEMENT of `"string[]"` / `"number[]"` (a non-negative integer
 *     `index` is required; the list itself is never bindable).
 *   - Structured props (`json` / `list` / `array` — rows of objects, nested
 *     records): bindable at a LEAF, addressed by `path` from the prop's
 *     value (`[2, "title"]`) with an explicit `kind` — the schema carries no
 *     per-leaf type, and an empty leaf must still be an "add" handle.
 *   - Rect: a `json` regions picker capped at ONE region binds whole
 *     (`kind: "rect"`, no path); a regions picker holding a LIST of rects
 *     binds ONE element with a non-negative integer `index` (never a
 *     `path`) — the element the bound tile paints. Make opens either as a
 *     move / resize session on the draw surface.
 *   - Media: a `media` prop binds whole; ONE element of a `media[]` prop
 *     binds with a non-negative integer `index` (the list itself never is —
 *     as `string[]`); a structured leaf that holds a path binds with `path`
 *     + `kind: "media"`. Kind `"media"` on any other prop type is refused.
 *     The rect is a DROP target in Make (a file dragged onto it writes the
 *     path) with a picture-glyph handle for the OS picker; the prop's
 *     `meta.control.accept` / `extensions` say what a drop may be.
 *   - `meta.ui.hidden` props are never bindable (not user-facing).
 *   - An `index` on a scalar prop is ignored (the scalar wins).
 *   - A STRING leaf may bind a `range` (`{start, end}` character span — one
 *     line of a multi-line prop) so the editor shows and writes only that
 *     slice; an optional `focus` sub-span names the token the rect shows.
 *     Ranges on number / color leaves are ignored (see `bindingRange`).
 *   - `onClear` names what an EMPTY commit means: `"remove-element"` splices
 *     the element at the leading numeric path segment out of its array (a
 *     row, or one element of a basic list), `"unset-leaf"` deletes the leaf
 *     key (or unsets a basic prop). Absent ⇒ numbers / colors reject empty
 *     and strings write `""`. Validated by `bindingOnClear`: a
 *     `remove-element` without an element, or an `unset-leaf` on an array
 *     element (no key to delete), is dropped.
 *   - `seedDraft` prefills the editor when the bound leaf reads EMPTY /
 *     absent (an "add" handle) with context the template derives from the
 *     rect (the clicked date, a slot number). A draft only: pre-selected,
 *     written on commit like a typed value, never applied by itself, and
 *     ignored when the leaf has a value. Validated by `bindingSeedDraft`: a
 *     blank seed, or a non-numeric seed on a number leaf, is dropped; a seed
 *     on a `rect` or `media` leaf is dropped outright.
 *   - `companion` marks a seeded leaf that ONLY the tile's media drop fills
 *     (the slot number a dropped file takes): a drop writes every empty
 *     seeded sibling, and a companion is kept out of the text form (a
 *     blur-commit there would write its seed on an unrelated edit) and the
 *     badge row. Validated by `bindingCompanion`: needs a kept `seedDraft`.
 */

import type { MosaicTemplatePropDefinition } from "@m0saic/types";

/** The value kind an inline editor must produce for a bound prop. `color`
 *  is a string holding a color (the editor shows a picker instead of text).
 *  `rect` is a rendered cell whose rect IS the prop: a `json` prop with
 *  `picker: "regions"` capped at ONE region, bound with no path — Make
 *  opens it as a move / resize session on that cell (the regions draw
 *  surface, seeded from the cell's painted rect) and writes the result
 *  back as `{ canvas, regions: [rect] }`. `media` is a leaf holding a file
 *  PATH (a `media` prop, one `media[]` element, or a structured leaf) —
 *  Make makes the cell a drop target and a picker handle; the value written
 *  is the dropped / picked path. */
export type BindableKind = "string" | "number" | "color" | "rect" | "media";

function isKind(k: unknown): k is BindableKind {
  return k === "string" || k === "number" || k === "color" || k === "rect" || k === "media";
}

/** True for a prop whose VALUE is a media path or a list of them. */
export function isMediaPropType(def: MosaicTemplatePropDefinition | undefined): boolean {
  return def?.type === "media" || def?.type === "media[]";
}

/** True for a prop a `rect` binding may target WHOLE: a `json` prop with the
 *  regions picker capped at exactly one region. */
export function isRectPickerProp(def: MosaicTemplatePropDefinition | undefined): boolean {
  if (!def || def.type !== "json") return false;
  const control = def.meta?.control as { picker?: string; regions?: { max?: number } } | undefined;
  return control?.picker === "regions" && control.regions?.max === 1;
}

/** True for a prop ONE ELEMENT of which a `rect` binding may target: a
 *  `json` regions picker that holds a LIST of rects (no cap, or a cap above
 *  `index`) — a page of balloons, a sticker sheet. Region `index` of the
 *  prop's value is the bound tile's rect; Make's draw session moves it among
 *  its siblings and writes the whole list back. */
export function isRectListPickerProp(def: MosaicTemplatePropDefinition | undefined, index: number): boolean {
  if (!def || def.type !== "json") return false;
  const control = def.meta?.control as { picker?: string; regions?: { max?: number } } | undefined;
  if (control?.picker !== "regions") return false;
  // A one-region picker binds WHOLE (see isRectPickerProp), never by element.
  const max = control.regions?.max;
  return typeof max !== "number" || (max > 1 && max > index);
}

/** What an EMPTY commit on a binding means (see the module doc). */
export type BindingClearAction = "remove-element" | "unset-leaf";

function isClearAction(v: unknown): v is BindingClearAction {
  return v === "remove-element" || v === "unset-leaf";
}

/** The wire shape of `source.editor.binding`. */
export type PropBindingRef = {
  /** Dotted path into the template's props, as `propsSchema` nests it. */
  propKey: string;
  /** Element index for `string[]` / `number[]` props (shorthand for a
   *  leading numeric `path` segment). */
  index?: number;
  /** Route from the prop's VALUE to the leaf this rect shows — structured
   *  (`json` / `list` / `array`) props only: `[2, "title"]`. */
  path?: ReadonlyArray<string | number>;
  /** Leaf value type for structured props (required there — an empty leaf
   *  must still be an "add" handle). Ignored for basic props. */
  kind?: BindableKind;
  /** Which text layer of the source shows this leaf (multi-layer text). */
  layer?: number;
  /** What an EMPTY commit means. Absent = numbers / colors reject empty,
   *  strings write `""`. `"remove-element"` needs an element (an `index` or
   *  a numeric first `path` segment); `"unset-leaf"` needs a keyed leaf (a
   *  basic prop, or a path ending in a key). */
  onClear?: BindingClearAction;
  /** Initial DRAFT when the leaf is empty / absent (an add handle) — the
   *  clicked date, a slot number. Pre-selected, written only on commit;
   *  ignored on a leaf that has a value. */
  seedDraft?: string;
  /** A seeded leaf ONLY the tile's media drop fills — never in the text
   *  form, never a badge. Needs `seedDraft`. */
  companion?: boolean;
  /** Character span of the STRING leaf this rect edits (one line of a
   *  multi-line prop). The editor shows / writes only this slice. */
  range?: TextSpan;
  /** Sub-span of `range` the rect shows (the clicked token) — pre-selected. */
  focus?: TextSpan;
};

/** A character span `[start, end)` into a string leaf. */
export type TextSpan = { start: number; end: number };

function isSpan(v: unknown): v is TextSpan {
  if (!v || typeof v !== "object") return false;
  const { start, end } = v as { start?: unknown; end?: unknown };
  return (
    typeof start === "number" && Number.isInteger(start) && start >= 0 &&
    typeof end === "number" && Number.isInteger(end) && end >= start
  );
}

/**
 * The validated text span a binding edits, or `undefined` when it has none.
 * Only STRING leaves take a range (a number / color leaf is edited whole);
 * a malformed `range` is dropped (the rect falls back to editing the whole
 * leaf), and a `focus` outside `range` is dropped while `range` stands.
 */
export function bindingRange(
  ref: { range?: unknown; focus?: unknown },
  kind: BindableKind | null,
): { range: TextSpan; focus?: TextSpan } | undefined {
  if (kind !== "string" || !isSpan(ref.range)) return undefined;
  const range = { start: ref.range.start, end: ref.range.end };
  const f = ref.focus;
  if (isSpan(f) && f.start >= range.start && f.end <= range.end) {
    return { range, focus: { start: f.start, end: f.end } };
  }
  return { range };
}

/**
 * The validated clear action of a binding, or `undefined` when it has none
 * (or names one its leaf can't honor). `leafPath` is the EFFECTIVE route to
 * the leaf (`[]` for a basic scalar — a stray index is already ignored):
 * `remove-element` needs a leading numeric segment (the element to splice),
 * `unset-leaf` needs a keyed leaf (an empty path, or one ending in a key —
 * an array element has no key to delete). Unbindable (`kind === null`) ⇒
 * nothing.
 */
export function bindingOnClear(
  ref: { onClear?: unknown },
  kind: BindableKind | null,
  leafPath: ReadonlyArray<PropPathSegment>,
): BindingClearAction | undefined {
  if (kind === null || !isClearAction(ref.onClear)) return undefined;
  if (ref.onClear === "remove-element") {
    return typeof leafPath[0] === "number" ? "remove-element" : undefined;
  }
  const last = leafPath[leafPath.length - 1];
  return leafPath.length === 0 || typeof last === "string" ? "unset-leaf" : undefined;
}

/**
 * The validated seed draft of a binding, or `undefined` when it has none (or
 * one its leaf can't take). A seed is a non-blank string; on a number leaf
 * it must read as a finite number (a seed the field would refuse to commit
 * is noise). Unbindable (`kind === null`) ⇒ nothing.
 */
export function bindingSeedDraft(
  ref: { seedDraft?: unknown },
  kind: BindableKind | null,
): string | undefined {
  if (kind === null || kind === "rect" || kind === "media") return undefined;
  const s = ref.seedDraft;
  if (typeof s !== "string" || s.trim() === "") return undefined;
  if (kind === "number" && !Number.isFinite(Number(s.trim()))) return undefined;
  return s;
}

/**
 * True when the binding is a media-drop COMPANION: a seeded leaf the drop
 * fills that the text form must not show. Needs a seed that survived
 * `bindingSeedDraft` (so never a media / rect leaf, never a blank seed).
 */
export function bindingCompanion(ref: { companion?: unknown }, seedDraft: string | undefined): boolean {
  return ref.companion === true && seedDraft !== undefined;
}

/** The binding entries a source carries: `bindings` (multi-layer) wins over
 *  the single `binding`; malformed entries are dropped. */
export function sourceBindings(
  editor: { binding?: unknown; bindings?: unknown } | undefined,
): PropBindingRef[] {
  const raw = Array.isArray(editor?.bindings) && editor!.bindings.length
    ? (editor!.bindings as unknown[])
    : editor?.binding
      ? [editor.binding]
      : [];
  return raw.filter(
    (b): b is PropBindingRef =>
      !!b && typeof b === "object" && typeof (b as { propKey?: unknown }).propKey === "string" && !!(b as { propKey: string }).propKey,
  );
}

/** A path segment: array index or object key. */
export type PropPathSegment = string | number;

/** Prop types whose VALUE is structured — bindable only with `path` + `kind`. */
const STRUCTURED_TYPES = new Set<string>(["json", "list", "array"]);

/** True when the prop's value is structured (bind with `path` + `kind`). */
export function isStructuredPropType(def: MosaicTemplatePropDefinition | undefined): boolean {
  return !!def && STRUCTURED_TYPES.has(def.type as string);
}

/** The full route from the prop value to the bound leaf (`index` folded in).
 *  `[]` for a basic scalar. */
export function bindingPath(ref: { index?: number; path?: ReadonlyArray<PropPathSegment> }): PropPathSegment[] {
  const tail = ref.path ? [...ref.path] : [];
  return ref.index !== undefined ? [ref.index, ...tail] : tail;
}

/** A `propsSchema` (or a group's `fields`) — the shape both consumers hold. */
export type PropSchemaMap = Record<string, MosaicTemplatePropDefinition | undefined>;

/**
 * Walk a dotted `propKey` through the schema. Segments past the first must
 * descend through a `type: "group"` prop's `fields`; any miss → `undefined`.
 */
export function propDefinitionAtPath(
  schema: PropSchemaMap | undefined,
  propKey: string,
): MosaicTemplatePropDefinition | undefined {
  if (!schema || !propKey) return undefined;
  let level: PropSchemaMap | undefined = schema;
  let def: MosaicTemplatePropDefinition | undefined;
  for (const segment of propKey.split(".")) {
    if (!segment) return undefined;
    def = level?.[segment];
    if (!def) return undefined;
    level = def.type === "group" ? def.fields : undefined;
  }
  return def;
}

function isValidIndex(index: number | undefined): index is number {
  return index !== undefined && Number.isInteger(index) && index >= 0;
}

function isValidPath(path: ReadonlyArray<PropPathSegment>): boolean {
  return path.every((seg) =>
    typeof seg === "number" ? isValidIndex(seg) : typeof seg === "string" && seg.length > 0,
  );
}

/** A color-valued string prop (`constraints.isColor` / `control.colorPicker`). */
export function isColorPropDef(def: MosaicTemplatePropDefinition | undefined): boolean {
  return !!def && !!(def.meta?.constraints?.isColor || def.meta?.control?.colorPicker);
}

/** A free-text string prop — no closed picker. */
function isFreeTextString(def: MosaicTemplatePropDefinition): boolean {
  const meta = def.meta;
  if (meta?.constraints?.oneOf) return false;
  if (meta?.control?.options) return false;
  if (meta?.control?.optionsFromConnection) return false;
  return true;
}

/** The kind a string-typed prop edits: a color picker or free text. */
function stringKind(def: MosaicTemplatePropDefinition): BindableKind | null {
  if (isColorPropDef(def)) return "color";
  return isFreeTextString(def) ? "string" : null;
}

/**
 * Classify a prop definition for inline editing. Returns the value kind the
 * editor must write, or `null` when the prop (at this binding) is not
 * bindable. See the module doc for the rules. `ref` may be the bare element
 * index (basic lists) or the binding itself (structured props need `path`
 * and `kind`).
 */
export function classifyBindableProp(
  def: MosaicTemplatePropDefinition | undefined,
  ref?: number | { index?: number; path?: ReadonlyArray<PropPathSegment>; kind?: BindableKind },
): BindableKind | null {
  if (!def) return null;
  if (def.meta?.ui?.hidden) return null;
  const r = typeof ref === "number" ? { index: ref } : ref ?? {};
  const full = bindingPath(r);
  switch (def.type) {
    case "string":
      return stringKind(def);
    case "number":
      return "number";
    case "media":
      return "media";
    case "string[]":
      return full.length === 1 && typeof full[0] === "number" && isValidIndex(full[0]) ? stringKind(def) : null;
    case "number[]":
      return full.length === 1 && typeof full[0] === "number" && isValidIndex(full[0]) ? "number" : null;
    case "media[]":
      return full.length === 1 && typeof full[0] === "number" && isValidIndex(full[0]) ? "media" : null;
    default:
      if (!isStructuredPropType(def)) return null;
      // A rect binding names the whole prop (no path — a one-region regions
      // picker) or ONE element of a rect-list picker (a bare numeric index).
      if (r.kind === "rect") {
        if (full.length === 0) return isRectPickerProp(def) ? "rect" : null;
        const element = full.length === 1 && typeof full[0] === "number" && isValidIndex(full[0]) ? full[0] : null;
        return element !== null && r.path === undefined && isRectListPickerProp(def, element) ? "rect" : null;
      }
      if (full.length === 0 || !isValidPath(full)) return null;
      return isKind(r.kind) ? r.kind : null;
  }
}

/** True when the prop type is a list (so a binding needs an `index`). */
export function isListPropType(def: MosaicTemplatePropDefinition | undefined): boolean {
  return def?.type === "string[]" || def?.type === "number[]" || def?.type === "media[]";
}

/**
 * Resolve a binding against a schema in one call: the definition it names
 * and the kind it edits. `kind === null` ⇒ not bindable (unknown prop,
 * unsupported type, list without index, hidden, closed picker). `onClear`
 * is the binding's validated clear action (against the EFFECTIVE leaf — a
 * basic scalar's stray index counts for nothing), absent when it has none;
 * `seedDraft` likewise (validated against the kind).
 */
export function resolveBindableProp(
  schema: PropSchemaMap | undefined,
  binding: PropBindingRef,
): {
  def: MosaicTemplatePropDefinition | undefined;
  kind: BindableKind | null;
  path: PropPathSegment[];
  onClear?: BindingClearAction;
  seedDraft?: string;
  companion?: true;
  range?: TextSpan;
  focus?: TextSpan;
} {
  const def = propDefinitionAtPath(schema, binding.propKey);
  const kind = classifyBindableProp(def, binding);
  const span = bindingRange(binding, kind);
  const path = bindingPath(binding);
  const leafPath = def?.type === "string" || def?.type === "number" || def?.type === "media" ? [] : path;
  const onClear = bindingOnClear(binding, kind, leafPath);
  const seedDraft = bindingSeedDraft(binding, kind);
  const companion = bindingCompanion(binding, seedDraft);
  return {
    def,
    kind,
    path,
    ...(onClear ? { onClear } : {}),
    ...(seedDraft !== undefined ? { seedDraft } : {}),
    ...(companion ? { companion: true as const } : {}),
    ...(span ?? {}),
  };
}
