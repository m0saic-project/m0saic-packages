import type {
  MosaicDiagnostic,
  MosaicTemplate,
  MosaicTemplateProps,
  MosaicTemplatePropDefinition,
  MosaicTemplatePropType,
} from "@m0saic/types";
import { asDiagnosticCode } from "@m0saic/types";

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function validateSingleProp(
  key: string,
  def: MosaicTemplatePropDefinition,
  value: unknown
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  // Required check
  if (value === undefined || value === null) {
    if (def.required) {
      diagnostics.push({
        code: asDiagnosticCode("MISSING_REQUIRED_PROP"),
        message: `Missing required prop "${key}".`,
        severity: "error",
      });
    }
    return diagnostics;
  }

  const expectedType: MosaicTemplatePropType = def.type;
  let typeMatches = true;

  switch (expectedType) {
    case "string":
      typeMatches = typeof value === "string";
      break;

    case "number":
      typeMatches = typeof value === "number" && Number.isFinite(value);
      break;

    case "boolean":
      typeMatches = typeof value === "boolean";
      break;

    case "string[]":
      typeMatches =
        Array.isArray(value) && value.every((v) => typeof v === "string");
      break;

    case "number[]":
      typeMatches =
        Array.isArray(value) &&
        value.every((v) => typeof v === "number" && Number.isFinite(v));
      break;

    case "media":
      // "media" is intentionally loose – could be a path string or an object.
      typeMatches =
        typeof value === "string" ||
        (typeof value === "object" && value !== null);
      break;

    case "media[]":
      typeMatches =
        Array.isArray(value) &&
        value.every(
          (v) => typeof v === "string" || (typeof v === "object" && v !== null)
        );
      break;

    case "group":
      typeMatches = isPlainObject(value);
      break;

    case "list":
      typeMatches = Array.isArray(value);
      break;

    case "code":
      typeMatches =
        isPlainObject(value) &&
        typeof value.language === "string" &&
        value.language.trim().length > 0 &&
        typeof value.code === "string";
      break;

    case "json":
      // "json" is intentionally permissive — accept any non-undefined
      // value. The editor may deliver an already-parsed object or a
      // raw JSON string; both are valid at the engine boundary. The
      // template's render() is responsible for parsing strings and
      // validating shape against its own contract (or
      // `meta.constraints.jsonSchema` if the host wires one up).
      typeMatches = value !== undefined;
      break;

    default:
      // If new prop types are added upstream, don't hard-fail here.
      typeMatches = true;
      break;
  }

  if (!typeMatches) {
    const actual = Array.isArray(value) ? "array" : typeof value;
    diagnostics.push({
      code: asDiagnosticCode("INVALID_PROP_TYPE"),
      message: `Prop "${key}" expected type "${expectedType}" but got "${actual}".`,
      severity: "error",
    });
    return diagnostics; // constraints assume correct type
  }

  // Constraints only run if type is valid
  const c = def.meta?.constraints;
  if (c) {
    if (expectedType === "number" && typeof value === "number") {
      if (c.min != null && value < c.min) {
        diagnostics.push({
          code: asDiagnosticCode("PROP_BELOW_MIN"),
          message: `Prop "${key}" must be >= ${c.min} (got ${value}).`,
          severity: "error",
        });
      }
      if (c.max != null && value > c.max) {
        diagnostics.push({
          code: asDiagnosticCode("PROP_ABOVE_MAX"),
          message: `Prop "${key}" must be <= ${c.max} (got ${value}).`,
          severity: "error",
        });
      }
    }

    if (Array.isArray(value)) {
      if (c.minItems != null && value.length < c.minItems) {
        diagnostics.push({
          code: asDiagnosticCode("PROP_TOO_FEW_ITEMS"),
          message: `Prop "${key}" must have at least ${c.minItems} items (got ${value.length}).`,
          severity: "error",
        });
      }
      if (c.maxItems != null && value.length > c.maxItems) {
        diagnostics.push({
          code: asDiagnosticCode("PROP_TOO_MANY_ITEMS"),
          message: `Prop "${key}" must have at most ${c.maxItems} items (got ${value.length}).`,
          severity: "error",
        });
      }
    }

    if (c.oneOf && typeof value === "string") {
      if (!c.oneOf.includes(value)) {
        diagnostics.push({
          code: asDiagnosticCode("PROP_NOT_IN_ONEOF"),
          message: `Prop "${key}" must be one of [${c.oneOf.join(
            ", "
          )}] (got "${value}").`,
          severity: "error",
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Validate an arbitrary props bag against a template's propsSchema.
 *
 * Returns diagnostics (no throwing). Callers can decide whether to treat
 * warnings/errors as fatal.
 */
export function validateTemplateProps<P extends MosaicTemplateProps>(
  template: MosaicTemplate<P>,
  props: P
): MosaicDiagnostic[] {
  const diagnostics: MosaicDiagnostic[] = [];

  // schema keys are string-only now
  type K = Extract<keyof P, string>;
  const schema: Partial<Record<K, MosaicTemplatePropDefinition>> =
    (template.propsSchema ?? {}) as Partial<Record<K, MosaicTemplatePropDefinition>>;

  const keys = Object.keys(schema) as K[];

  for (const key of keys) {
    const def = schema[key];
    if (!def) continue;

    // index via string key
    const value = (props as any)[key] as unknown;
    diagnostics.push(...validateSingleProp(key, def, value));
  }

  return diagnostics;
}
