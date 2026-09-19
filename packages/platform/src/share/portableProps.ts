// Share link — which props can travel to another machine.
//
// Two rules decide the payload:
//   1. STRIP machine-local paths. A `media` / `media[]` knob, a string knob
//      with a file / folder picker or an `extensions` filter, and the
//      `sourceId` / `sourceIds` convention all hold paths on the sender's
//      disk — broken for the recipient AND a privacy leak (`/Users/<name>/…`).
//      They are removed and reported so a UI can say so.
//   2. DIFF against the template's defaults. The receiver spreads the
//      template's `defaultProps` under whatever arrives, so only knobs the
//      sender changed need to travel. Strip runs first: a changed path prop
//      is reported as stripped, never silently dropped by the diff.
//
// `PortablePropSchemaEntry` is the structural subset of
// `MosaicTemplatePropDefinition` (`@m0saic/types`) these rules read, so both
// the full definition and a host's looser template-meta shape satisfy it.

/** Structural subset of `MosaicTemplatePropDefinition`. */
export type PortablePropSchemaEntry = {
  type?: string;
  meta?: { control?: { picker?: string; extensions?: string[] } };
  /** `type: "group"` — nested field definitions. */
  fields?: Record<string, PortablePropSchemaEntry>;
};
export type PortablePropsSchema = Record<string, PortablePropSchemaEntry>;

/** Never travel, schema or not: input sources are chosen by the recipient. */
export const UNTRAVELABLE_CONVENTION_KEYS = ["sourceId", "sourceIds"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Object.prototype.toString.call(v) === "[object Object]";
}

/** Structural equality for prop values (scalars, arrays, plain objects). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Does this knob hold a path on the sender's machine? */
export function isPathPropDef(def: PortablePropSchemaEntry | undefined): boolean {
  if (!def) return false;
  if (def.type === "media" || def.type === "media[]") return true;
  if (def.type === "string" || def.type === "string[]") {
    const control = def.meta?.control;
    if (control?.picker === "file" || control?.picker === "folder") return true;
    if (Array.isArray(control?.extensions) && control.extensions.length > 0) return true;
  }
  return false;
}

/** Non-empty value check for the "was it set" question. */
function isSet(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function stripObject(
  schema: PortablePropsSchema | undefined,
  obj: Record<string, unknown>,
  defaults: Record<string, unknown> | undefined,
  prefix: string,
  stripped: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const def = schema?.[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPathPropDef(def)) {
      // Report only a path the sender actually changed — one still at its
      // default is not lost, the recipient gets the same default.
      if (isSet(value) && !sameJson(value, defaults?.[key])) stripped.push(path);
      continue;
    }
    if (def?.type === "group" && def.fields && isPlainObject(value)) {
      const nestedDefaults = isPlainObject(defaults?.[key]) ? (defaults![key] as Record<string, unknown>) : undefined;
      out[key] = stripObject(def.fields, value, nestedDefaults, path, stripped);
      continue;
    }
    // `list` items have no per-item schema on the definition, so a path inside
    // a list item is not detectable here — documented limitation.
    out[key] = value;
  }
  return out;
}

/**
 * Remove path-bearing props (schema-detected) and the convention keys.
 * `stripped` names the knobs that were changed AND removed, `group.field`
 * for nested ones; `hadSourceIds` says whether inputs were assigned.
 */
export function stripUntravelableProps(
  schema: PortablePropsSchema | undefined,
  props: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
): { props: Record<string, unknown>; stripped: string[]; hadSourceIds: boolean } {
  const stripped: string[] = [];
  let hadSourceIds = false;
  const withoutConvention: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if ((UNTRAVELABLE_CONVENTION_KEYS as readonly string[]).includes(key)) {
      if (isSet(props[key])) hadSourceIds = true;
      continue;
    }
    withoutConvention[key] = props[key];
  }
  const out = stripObject(schema, withoutConvention, defaults, "", stripped);
  return { props: out, stripped, hadSourceIds };
}

/** Top-level keys whose value differs from the default (JSON equality). */
export function diffPropsAgainstDefaults(
  props: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (props[key] === undefined) continue;
    if (!sameJson(props[key], defaults[key])) out[key] = props[key];
  }
  return out;
}

/** The props that go in a link + what was left behind. Strip first, then diff. */
export function buildPortablePropsPayload(args: {
  props: Record<string, unknown>;
  defaults: Record<string, unknown> | undefined;
  schema: PortablePropsSchema | undefined;
}): { props: Record<string, unknown>; stripped: string[]; hadSourceIds: boolean } {
  const defaults = args.defaults ?? {};
  const { props, stripped, hadSourceIds } = stripUntravelableProps(args.schema, args.props, defaults);
  return { props: diffPropsAgainstDefaults(props, defaults), stripped, hadSourceIds };
}
