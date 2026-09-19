/**
 * auditDefaultProps — the "a knob shows what it does" contract.
 *
 * Founder ruling (2026-09-05, gate 33): a template's optional props MUST show
 * their effective value in an editor. The Make panel showed `title` EMPTY while
 * the header rendered "DSL Tutorial", and `showCanvas` OFF while the canvas was
 * on — because the template resolved those defaults INSIDE `render()`
 * (`props.title ?? "DSL Tutorial"`, `props.showCanvas !== false`) where no
 * editor can see them. Some templates do this, some don't; the fix is a
 * contract, not a per-template patch:
 *
 *   An optional knob's UNSET state must be visible —
 *     - `boolean`               → must have a `defaultProps` value (a toggle
 *                                 has no way to show "unset"; it shows OFF).
 *     - closed-set string/number → must have a `defaultProps` value (a picker
 *       (`constraints.oneOf` /       with no default shows "—" for a state the
 *        `control.options`)         render never has).
 *     - plain string / number   → a `defaultProps` value OR a
 *                                 `meta.control.placeholder` naming the unset
 *                                 behaviour ("auto", "1920") — the placeholder
 *                                 IS the visible unset state.
 *   Everything else (media, json, lists, m0-family, code, groups' own
 *   presence) is an INPUT, not a default; a `group`'s `fields` are audited
 *   against the group's default object. `ui.hidden` knobs are exempt (never
 *   shown), so are `ui.consumer:"human"` derived controls (they never enter
 *   the rendered props). Required props are exempt (no default to show).
 *
 * Pure: returns the offending keys with the fix each needs. The template
 * package's registry sweep turns it into a merge-gate test; a template's own
 * gate test asserts an empty list.
 */

import type {
  MosaicTemplate,
  MosaicTemplatePropDefinition,
  MosaicTemplateProps,
} from "@m0saic/types";

export type DefaultPropsViolation = {
  /** Dotted key (`showCanvas`, `theme.preset`). */
  key: string;
  type: MosaicTemplatePropDefinition["type"];
  /** What would satisfy the contract. */
  fix: "defaultProps" | "defaultProps-or-placeholder";
  detail: string;
};

const CLOSED_SET_TYPES = new Set(["string", "number"]);

function isClosedSet(def: MosaicTemplatePropDefinition): boolean {
  const oneOf = def.meta?.constraints?.oneOf;
  const options = def.meta?.control?.options;
  return (Array.isArray(oneOf) && oneOf.length > 0) || (Array.isArray(options) && options.length > 0);
}

function hasPlaceholder(def: MosaicTemplatePropDefinition): boolean {
  const p = def.meta?.control?.placeholder;
  return typeof p === "string" && p.trim().length > 0;
}

function auditEntry(
  key: string,
  def: MosaicTemplatePropDefinition,
  defaults: Record<string, unknown> | undefined,
  out: DefaultPropsViolation[],
): void {
  if (def.required) return;
  if (def.meta?.ui?.hidden) return;
  // A `consumer:"human"` control is a DERIVED view of agent props (never enters
  // the rendered props) — it has no default of its own to show.
  if (def.meta?.ui?.consumer === "human") return;
  const has = defaults !== undefined && defaults[key.split(".").pop() as string] !== undefined;

  if (def.type === "group" && def.fields) {
    const sub = defaults?.[key.split(".").pop() as string];
    const subDefaults = sub && typeof sub === "object" ? (sub as Record<string, unknown>) : undefined;
    for (const [k, d] of Object.entries(def.fields)) auditEntry(`${key}.${k}`, d, subDefaults, out);
    return;
  }

  if (def.type === "boolean") {
    if (!has) out.push({ key, type: def.type, fix: "defaultProps", detail: `boolean "${key}" has no defaultProps value — a toggle shows OFF for "unset", which is a lie when the render treats unset as on.` });
    return;
  }
  if (CLOSED_SET_TYPES.has(def.type) && isClosedSet(def)) {
    if (!has) out.push({ key, type: def.type, fix: "defaultProps", detail: `closed-set ${def.type} "${key}" has no defaultProps value — the picker shows "—" for a state the render never has.` });
    return;
  }
  if (def.type === "string" || def.type === "number") {
    if (!has && !hasPlaceholder(def)) {
      out.push({ key, type: def.type, fix: "defaultProps-or-placeholder", detail: `${def.type} "${key}" has neither a defaultProps value nor a control.placeholder — an empty field for a value the render fills in.` });
    }
  }
}

/** Audit one template. Empty array = the contract holds. */
export function auditDefaultProps<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "propsSchema" | "defaultProps">,
): DefaultPropsViolation[] {
  const out: DefaultPropsViolation[] = [];
  const schema = (template.propsSchema ?? {}) as Record<string, MosaicTemplatePropDefinition>;
  const defaults = (template.defaultProps ?? {}) as Record<string, unknown>;
  for (const [key, def] of Object.entries(schema)) auditEntry(key, def, defaults, out);
  return out;
}

/** Throwing sibling for a template's own gate test. */
export function assertDefaultPropsComplete<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "id" | "propsSchema" | "defaultProps">,
): void {
  const v = auditDefaultProps(template);
  if (v.length > 0) {
    throw new Error(
      `${String(template.id)}: ${v.length} optional knob${v.length === 1 ? "" : "s"} hide their effective default:\n` +
        v.map((x) => `  • ${x.detail}`).join("\n"),
    );
  }
}
