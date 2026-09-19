/**
 * Schema-level template conventions — pure functions over `propsSchema`,
 * `defaultProps`, and the template's browse metadata. Each returns its
 * violations (empty = compliant); `enforceTemplateConventions` decides whether
 * a violation throws or is recorded (see templateConventions.ts for the
 * posture table and the founder ruling behind the seam).
 *
 * Plan: the internal template-conventions-v1 notes (2026-09-06).
 *
 *  - `colorProps`    — a colour-valued `string` / `string[]` prop declares
 *                      `constraints.isColor` AND `control.colorPicker`. The
 *                      app renders a swatch picker from the pair; with either
 *                      missing the user gets a bare text box.
 *  - `noLocalPaths`  — no value anywhere in `defaultProps` is an absolute
 *                      filesystem path. Such a default exists only on the
 *                      authoring machine and renders black everywhere else.
 *  - `browseSurface` — a non-empty `description` and at least one tag. The
 *                      Templates page and the manifest are built from these.
 *  - `propLabels`    — every visible prop (groups walked) carries `ui.label`;
 *                      the panel otherwise falls back to the raw key.
 *  - `defaultsValidate` — `defaultProps` passes the template's own schema
 *                      validator (types, `oneOf`, numeric bounds, list sizes).
 *                      A required input with no default is NOT a violation:
 *                      the defaults contract exempts inputs.
 *
 * "Looks like a colour" is the starter repo's heuristic, kept verbatim so the
 * two never disagree: the leaf key contains `color` (any case), or the
 * description mentions `#rrggbb`.
 */

import type { MosaicTemplate, MosaicTemplatePropDefinition, MosaicTemplateProps } from "@m0saic/types";

import { validateTemplateProps } from "./validateTemplateProps";

/** One violation of one convention. `key` is the dotted prop path (or the
 *  template field) at fault; `detail` names the fault AND the fix. */
export type TemplateConventionViolation = {
  key: string;
  detail: string;
};

type SchemaMap = Record<string, MosaicTemplatePropDefinition>;

/** Depth-first walk of a schema (a `group`'s `fields` nest under its key). */
export function walkPropDefinitions(
  schema: SchemaMap | undefined,
  visit: (key: string, def: MosaicTemplatePropDefinition) => void,
  prefix = "",
): void {
  for (const [name, def] of Object.entries(schema ?? {})) {
    if (!def || typeof def !== "object") continue;
    const key = prefix ? `${prefix}.${name}` : name;
    visit(key, def);
    if (def.type === "group" && def.fields) {
      walkPropDefinitions(def.fields as SchemaMap, visit, key);
    }
  }
}

const COLOR_KEY = /color/i;
const COLOR_DESC = /#rrggbb/i;

/** The starter repo's heuristic: a string-typed prop whose leaf key says
 *  "color" or whose description mentions `#rrggbb`. */
export function looksLikeColorProp(key: string, def: MosaicTemplatePropDefinition): boolean {
  if (def.type !== "string" && def.type !== "string[]") return false;
  const leaf = key.split(".").pop() ?? key;
  return COLOR_KEY.test(leaf) || COLOR_DESC.test(def.description ?? "");
}

/** `colorProps`: every colour-looking prop declares isColor + colorPicker. */
export function auditColorProps<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "propsSchema">,
): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  walkPropDefinitions(template.propsSchema as SchemaMap | undefined, (key, def) => {
    if (!looksLikeColorProp(key, def)) return;
    const isColor = def.meta?.constraints?.isColor === true;
    const picker = def.meta?.control?.colorPicker === true;
    if (isColor && picker) return;
    const missing = [!isColor ? "constraints.isColor" : "", !picker ? "control.colorPicker" : ""].filter(Boolean).join(" and ");
    out.push({
      key,
      detail: `${def.type} "${key}" reads as a colour but lacks ${missing} — declare both so the editor shows a swatch picker instead of a text box.`,
    });
  });
  return out;
}

const POSIX_ABS = /^\/(?!\/)/; // "/Users/…" but not a protocol-relative "//host"
const WIN_ABS = /^[A-Za-z]:[\\/]/; // "C:\…" / "C:/…"
const UNC = /^\\\\/; // "\\server\share"

/** True for a string that can only resolve on the authoring machine. */
export function isAbsoluteFilesystemPath(value: string): boolean {
  return POSIX_ABS.test(value) || WIN_ABS.test(value) || UNC.test(value);
}

/** `noLocalPaths`: no default is an absolute filesystem path. */
export function auditNoLocalPaths<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "defaultProps">,
): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  const scan = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (isAbsoluteFilesystemPath(value)) {
        out.push({
          key: path,
          detail: `defaultProps.${path} is an absolute filesystem path (${JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}…` : value)}) — it exists only on the authoring machine. Ship a bundled asset by relative reference, or leave the input empty.`,
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => scan(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) scan(v, path ? `${path}.${k}` : k);
    }
  };
  scan(template.defaultProps ?? {}, "");
  return out;
}

/** `browseSurface`: a description and at least one tag. */
export function auditBrowseSurface<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "description" | "tags">,
): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  const description = typeof template.description === "string" ? template.description.trim() : "";
  if (!description) {
    out.push({ key: "description", detail: `description is empty — the Templates page and the manifest show it as the template's one-line summary.` });
  }
  const tags = Array.isArray(template.tags) ? template.tags.filter((t) => typeof t === "string" && t.trim()) : [];
  if (tags.length === 0) {
    out.push({ key: "tags", detail: `tags is empty — the Templates page filters and groups by tag; an untagged template only surfaces through search.` });
  }
  return out;
}

/** `outputFormat`: a PUBLIC template declares its deliverable —
 *  `outputHints.format` with at least one field (kind / container / …).
 *  Without it the CLI names the output `out.mp4` even for a still, and a Make
 *  share link at defaults carries an `f=` ask because the form has nothing to
 *  agree with. Building blocks (`internal: true`) render only nested, and
 *  deprecated templates are frozen history — both are skipped. */
export function auditOutputFormat<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "outputHints" | "internal" | "deprecated">,
): TemplateConventionViolation[] {
  if (template.internal === true || template.deprecated) return [];
  const format = template.outputHints?.format;
  const declared =
    format != null && typeof format === "object" && Object.keys(format as Record<string, unknown>).length > 0;
  if (declared) return [];
  return [
    {
      key: "outputHints.format",
      detail:
        `outputHints.format is not declared — the CLI defaults the output to out.mp4 (even for a still) and a share link at defaults carries an f= ask. ` +
        `Declare the deliverable: { kind: "video", container: "mp4" } for motion, { kind: "image", container: "png" } for a still ` +
        `(add pixelFormat: "rgba" when it ships alpha); a template with an outputFormat knob declares the knob's DEFAULT.`,
    },
  ];
}

/** `propLabels`: every visible prop carries `ui.label`.
 *
 *  Internal templates are exempt: a label is a PANEL affordance, and an
 *  `internal` template is a building block other templates render — its props
 *  are set by the parent, never typed into a panel. (Same exemption as
 *  `outputFormat`; render-time provenance checks still cover it.) */
export function auditPropLabels<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "propsSchema" | "internal">,
): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  if (template.internal === true) return out;
  walkPropDefinitions(template.propsSchema as SchemaMap | undefined, (key, def) => {
    if (def.meta?.ui?.hidden) return;
    const label = def.meta?.ui?.label;
    if (typeof label === "string" && label.trim()) return;
    out.push({ key, detail: `${def.type} "${key}" has no ui.label — the panel falls back to the raw key.` });
  });
  return out;
}

/** Diagnostic codes that describe an INPUT the author left for the user, not a bad default. */
const INPUT_NOT_DEFAULT_CODES = new Set(["MISSING_REQUIRED_PROP"]);

/** `defaultsValidate`: the defaults pass the schema validator. */
export function auditDefaultsValidate<P extends MosaicTemplateProps>(
  template: MosaicTemplate<P>,
): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  let diagnostics: ReturnType<typeof validateTemplateProps> = [];
  try {
    diagnostics = validateTemplateProps(template, (template.defaultProps ?? {}) as P);
  } catch (err) {
    out.push({ key: "defaultProps", detail: `the schema validator threw on defaultProps: ${err instanceof Error ? err.message : String(err)}` });
    return out;
  }
  for (const d of diagnostics) {
    if (d.severity !== "error") continue;
    if (INPUT_NOT_DEFAULT_CODES.has(String(d.code))) continue;
    const prop = /Prop "([^"]+)"|prop "([^"]+)"/.exec(d.message);
    out.push({ key: prop?.[1] ?? prop?.[2] ?? String(d.code), detail: `${d.code}: ${d.message}` });
  }
  return out;
}

/**
 * `outputHintsResolve`: a template that declares `resolveOutputHints` keeps
 * it PURE and CONSISTENT with its static hints. Checked at the seam because
 * every host trusts the resolver blind: (1) it must return an object; (2) two
 * calls at `defaultProps` must agree (deterministic — hosts call it on every
 * prop edit); (3) every field it returns at defaults must equal the static
 * `outputHints` field (the static hints are the browse-time truth the
 * manifest and cards carry, so a default that disagrees with them is a lie
 * on the card). A resolver that throws at defaults is a violation too.
 */
export function auditOutputHintsResolve<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "outputHints" | "resolveOutputHints" | "defaultProps">,
): TemplateConventionViolation[] {
  const resolver = template.resolveOutputHints;
  if (typeof resolver !== "function") return [];
  const out: TemplateConventionViolation[] = [];
  const defaults = (template.defaultProps ?? {}) as P;
  let a: unknown;
  let b: unknown;
  try {
    a = resolver(defaults);
    b = resolver(defaults);
  } catch (err) {
    return [
      {
        key: "resolveOutputHints",
        detail: `resolveOutputHints threw at defaultProps (${err instanceof Error ? err.message : String(err)}) — it must never throw; an unknown prop value resolves to the default.`,
      },
    ];
  }
  if (!a || typeof a !== "object" || Array.isArray(a)) {
    return [{ key: "resolveOutputHints", detail: `resolveOutputHints must return an object of hints (got ${a === null ? "null" : typeof a}).` }];
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ key: "resolveOutputHints", detail: "resolveOutputHints is not deterministic — two calls at defaultProps disagree." });
  }
  const statics = (template.outputHints ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
    if (v === undefined || !(k in statics)) continue;
    if (JSON.stringify(v) !== JSON.stringify(statics[k])) {
      out.push({
        key: `resolveOutputHints.${k}`,
        detail: `resolveOutputHints(defaultProps).${k} = ${JSON.stringify(v)} disagrees with outputHints.${k} = ${JSON.stringify(statics[k])} — at defaults the resolver must agree with the static hints (they are what the manifest and the cards show).`,
      });
    }
  }
  return out;
}
