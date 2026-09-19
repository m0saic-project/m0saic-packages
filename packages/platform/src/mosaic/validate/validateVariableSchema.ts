import type {
    MosaicTemplateVariableDefinition,
    MosaicTemplateVariableType,
} from "@m0saic/types";

/**
 * Pure variable-schema validation for the back-edge data channel.
 *
 * # Why this exists (a hypothetical)
 *
 * A `.mosaicx` pipeline wires two independently authored templates:
 * step 0 is a capability-tier fetcher that pulls athlete stats from an
 * API and publishes `{ name, marathonPB }` under the alias
 * `athleteData`; step 1 is a title-card renderer, written by someone
 * else, that reads `ctx.upstreamData.athleteData.name`. The payload
 * crosses that boundary as raw JSON — neither template's compiler ever
 * saw the other. Now the fetcher ships v2 and renames `name` →
 * `fullName`. Both templates still typecheck in isolation; the
 * composition silently breaks, and without a runtime check the result
 * is the string "undefined" baked into 30 seconds of rendered frames.
 * Because the renderer declared
 * `upstreamVariablesSchema: { name: { type: "string", required: true } }`,
 * the drift instead surfaces as a `VARIABLES_SCHEMA_MISMATCH` error
 * diagnostic at resolve time, naming the invocation and key, before
 * ffmpeg spends a single frame.
 *
 * Note this is a CHECK, not a transform: payloads are never coerced,
 * parsed, or rehydrated — consumers always receive the producer's raw
 * values untouched.
 *
 * # Contract surfaces
 *
 * Templates declare structured-data contracts via three schema maps
 * (`@m0saic/types` — {@link MosaicTemplateVariableDefinition}):
 *
 *  - `outputsSchema` — what a producer publishes (doc `variables` +
 *    `MosaicDataSource.variables`).
 *  - `upstreamVariablesSchema` — what a consumer reads from the flat
 *    `ctx.upstreamVariables` union.
 *  - `upstreamDataSchema` — what a consumer reads from the aliased
 *    `ctx.upstreamData` blocks.
 *
 * The functions here check a runtime payload against those maps and
 * return structured violations. They are PURE — no I/O, no diagnostic
 * construction. The caller (the `.mosaicx` resolver in `@m0saic/core`)
 * wraps violations into `VARIABLES_SCHEMA_MISMATCH` diagnostics with
 * its own invocation context; editor UIs can render them directly.
 */

/** One schema violation found while validating a variables payload. */
export type MosaicVariableSchemaViolation = {
    /**
     * The variable key the violation is about. For
     * `malformed_payload` this is `"*"` (the payload itself, not a
     * specific key).
     */
    key: string;

    /**
     * The aliased data-block the key belongs to, when validating
     * against an `upstreamDataSchema`. Absent for flat-union /
     * outputs validation.
     */
    alias?: string;

    kind:
        | "missing_required"
        | "type_mismatch"
        | "constraint_violation"
        | "malformed_payload";

    /** What the schema expected (type name / constraint description). */
    expected: string;

    /** What the payload actually carried (typeof-style description). */
    received: string;

    /** Human-readable, context-free description of the violation. */
    message: string;
};

/**
 * Shape of {@link MosaicTemplate.upstreamDataSchema} once generics are
 * erased — alias → per-key variable definitions. Re-declared here
 * structurally so the validator stays decoupled from the template
 * generics.
 */
export type MosaicUpstreamDataSchemaShape = Partial<
    Record<
        string,
        {
            description?: string;
            variables: Partial<Record<string, MosaicTemplateVariableDefinition>>;
        }
    >
>;

/**
 * Validate a flat variables payload against a per-key schema map.
 *
 * Rules:
 *  - `required: true` + key absent (`undefined`) → `missing_required`.
 *  - key present + value doesn't match the declared
 *    {@link MosaicTemplateVariableType} → `type_mismatch` (optional
 *    keys are only checked when present).
 *  - `constraints.min` / `constraints.max` apply to `number` values;
 *    `constraints.oneOf` applies to `string` values → violations are
 *    `constraint_violation`. Constraints are only checked when the
 *    declared type matched (one violation per key, most-specific).
 *  - a defined-but-non-object payload (array / primitive / null) →
 *    one `malformed_payload` violation, then required-key checks run
 *    against the empty payload so missing contract keys still surface.
 *
 * `undefined` payload means "no upstream data reached this consumer" —
 * legal for a schema with no required keys, `missing_required` for
 * each required one.
 */
export function validateVariablesAgainstSchema(
    variables: Record<string, unknown> | undefined,
    schema:
        | Partial<Record<string, MosaicTemplateVariableDefinition>>
        | undefined,
    opts: { alias?: string } = {},
): MosaicVariableSchemaViolation[] {
    if (!schema) return [];

    const violations: MosaicVariableSchemaViolation[] = [];
    const aliasField = opts.alias !== undefined ? { alias: opts.alias } : {};
    const inBlock = opts.alias !== undefined ? ` in data block "${opts.alias}"` : "";

    let payload: Record<string, unknown>;
    if (variables === undefined) {
        payload = {};
    } else if (
        variables === null ||
        typeof variables !== "object" ||
        Array.isArray(variables)
    ) {
        violations.push({
            key: "*",
            ...aliasField,
            kind: "malformed_payload",
            expected: "object",
            received: describeValue(variables),
            message: `Variables payload${inBlock} must be a plain object; received ${describeValue(variables)}.`,
        });
        payload = {};
    } else {
        payload = variables;
    }

    for (const key of Object.keys(schema)) {
        const def = schema[key];
        if (!def) continue;

        const value = payload[key];
        if (value === undefined) {
            if (def.required) {
                violations.push({
                    key,
                    ...aliasField,
                    kind: "missing_required",
                    expected: def.type,
                    received: "undefined",
                    message: `Required variable "${key}"${inBlock} is missing (expected ${def.type}).`,
                });
            }
            continue;
        }

        if (!matchesVariableType(value, def.type)) {
            violations.push({
                key,
                ...aliasField,
                kind: "type_mismatch",
                expected: def.type,
                received: describeValue(value),
                message: `Variable "${key}"${inBlock} expected ${def.type}, received ${describeValue(value)}.`,
            });
            continue;
        }

        const constraintViolation = checkConstraints(key, value, def, inBlock);
        if (constraintViolation) {
            violations.push({ ...constraintViolation, ...aliasField });
        }
    }

    return violations;
}

/**
 * Validate the aliased `ctx.upstreamData` view against a consumer's
 * `upstreamDataSchema`.
 *
 * For each alias declared in the schema:
 *  - block absent → `missing_required` for each `required: true` key
 *    in the alias's variables (an alias with only optional keys may
 *    be legally absent).
 *  - block present → per-key validation via
 *    {@link validateVariablesAgainstSchema}, with `alias` stamped on
 *    every violation.
 *
 * Aliases present in `data` but not in the schema are ignored —
 * schemas declare what the consumer NEEDS, not an exhaustive
 * inventory of what upstream publishes.
 */
export function validateUpstreamDataAgainstSchema(
    data: Record<string, Record<string, unknown>> | undefined,
    schema: MosaicUpstreamDataSchemaShape | undefined,
): MosaicVariableSchemaViolation[] {
    if (!schema) return [];

    const violations: MosaicVariableSchemaViolation[] = [];
    for (const alias of Object.keys(schema)) {
        const block = schema[alias];
        if (!block) continue;
        violations.push(
            ...validateVariablesAgainstSchema(data?.[alias], block.variables, {
                alias,
            }),
        );
    }
    return violations;
}

/** Runtime check of one value against a {@link MosaicTemplateVariableType}. */
function matchesVariableType(
    value: unknown,
    type: MosaicTemplateVariableType,
): boolean {
    switch (type) {
        case "any":
            return true;
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "boolean":
            return typeof value === "boolean";
        case "string[]":
            return Array.isArray(value) && value.every((v) => typeof v === "string");
        case "number[]":
            return (
                Array.isArray(value) &&
                value.every((v) => typeof v === "number" && Number.isFinite(v))
            );
        case "boolean[]":
            return Array.isArray(value) && value.every((v) => typeof v === "boolean");
        case "object":
            return value !== null && typeof value === "object" && !Array.isArray(value);
        default:
            // Unknown type string (future addition) — don't fail payloads
            // against a contract this validator can't interpret.
            return true;
    }
}

/**
 * Constraint checks — only invoked after the type matched.
 * `min` / `max` bound `number` values; `oneOf` restricts `string`
 * values. Constraints on other types are ignored (nothing sensible
 * to enforce).
 */
function checkConstraints(
    key: string,
    value: unknown,
    def: MosaicTemplateVariableDefinition,
    inBlock: string,
): Omit<MosaicVariableSchemaViolation, "alias"> | null {
    const c = def.constraints;
    if (!c) return null;

    if (typeof value === "number") {
        if (c.min !== undefined && value < c.min) {
            return {
                key,
                kind: "constraint_violation",
                expected: `>= ${c.min}`,
                received: String(value),
                message: `Variable "${key}"${inBlock} must be >= ${c.min}; received ${value}.`,
            };
        }
        if (c.max !== undefined && value > c.max) {
            return {
                key,
                kind: "constraint_violation",
                expected: `<= ${c.max}`,
                received: String(value),
                message: `Variable "${key}"${inBlock} must be <= ${c.max}; received ${value}.`,
            };
        }
    }

    if (typeof value === "string" && c.oneOf !== undefined) {
        if (!c.oneOf.includes(value)) {
            return {
                key,
                kind: "constraint_violation",
                expected: `one of [${c.oneOf.join(", ")}]`,
                received: JSON.stringify(value),
                message: `Variable "${key}"${inBlock} must be one of [${c.oneOf.join(", ")}]; received ${JSON.stringify(value)}.`,
            };
        }
    }

    return null;
}

/** typeof-style description used in violation messages. */
function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}
