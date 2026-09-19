// covers: T:template.outputsSchema, T:template.upstreamVariablesSchema,
//         T:template.upstreamDataSchema,
//         T:diagnostic.VARIABLES_SCHEMA_MISMATCH#violation-source
import type { MosaicTemplateVariableDefinition } from "@m0saic/types";
import {
    validateUpstreamDataAgainstSchema,
    validateVariablesAgainstSchema,
    type MosaicUpstreamDataSchemaShape,
} from "./validateVariableSchema";

const def = (
    overrides: Partial<MosaicTemplateVariableDefinition> = {},
): MosaicTemplateVariableDefinition => ({
    type: "string",
    required: true,
    ...overrides,
});

describe("validateVariablesAgainstSchema", () => {
    it("returns no violations without a schema", () => {
        expect(validateVariablesAgainstSchema({ a: 1 }, undefined)).toEqual([]);
    });

    it("passes a payload matching the schema exactly", () => {
        const schema = {
            name: def({ type: "string" }),
            score: def({ type: "number" }),
            tags: def({ type: "string[]", required: false }),
            flags: def({ type: "boolean[]", required: false }),
            meta: def({ type: "object", required: false }),
            anything: def({ type: "any", required: false }),
        };
        const payload = {
            name: "Eliud",
            score: 99,
            tags: ["a", "b"],
            flags: [true, false],
            meta: { nested: true },
            anything: null,
        };
        expect(validateVariablesAgainstSchema(payload, schema)).toEqual([]);
    });

    it("flags each missing required key (including on an undefined payload)", () => {
        const schema = {
            name: def(),
            score: def({ type: "number" }),
            note: def({ required: false }),
        };
        const onEmpty = validateVariablesAgainstSchema({}, schema);
        expect(onEmpty).toHaveLength(2);
        expect(onEmpty.map((v) => v.key).sort()).toEqual(["name", "score"]);
        expect(onEmpty.every((v) => v.kind === "missing_required")).toBe(true);

        // undefined payload = "no upstream reached this consumer".
        const onUndefined = validateVariablesAgainstSchema(undefined, schema);
        expect(onUndefined).toHaveLength(2);
    });

    it("does not check absent optional keys", () => {
        expect(
            validateVariablesAgainstSchema({}, { note: def({ required: false }) }),
        ).toEqual([]);
    });

    it("flags type mismatches per declared type", () => {
        const cases: Array<[MosaicTemplateVariableDefinition["type"], unknown]> = [
            ["string", 42],
            ["number", "42"],
            ["number", NaN],
            ["boolean", "true"],
            ["string[]", ["ok", 1]],
            ["number[]", [1, "2"]],
            ["boolean[]", [true, 0]],
            ["object", [1, 2]],
            ["object", null],
        ];
        for (const [type, value] of cases) {
            const violations = validateVariablesAgainstSchema(
                { key: value },
                { key: def({ type }) },
            );
            expect(violations).toHaveLength(1);
            expect(violations[0].kind).toBe("type_mismatch");
            expect(violations[0].expected).toBe(type);
        }
    });

    it("'any' accepts every value shape", () => {
        for (const value of ["s", 1, true, null, [1], { a: 1 }]) {
            expect(
                validateVariablesAgainstSchema(
                    { key: value },
                    { key: def({ type: "any" }) },
                ),
            ).toEqual([]);
        }
    });

    it("enforces min/max on numbers and oneOf on strings", () => {
        const schema = {
            score: def({ type: "number", constraints: { min: 0, max: 100 } }),
            mode: def({ type: "string", constraints: { oneOf: ["fast", "slow"] } }),
        };
        expect(
            validateVariablesAgainstSchema({ score: 50, mode: "fast" }, schema),
        ).toEqual([]);

        const low = validateVariablesAgainstSchema({ score: -1, mode: "fast" }, schema);
        expect(low).toHaveLength(1);
        expect(low[0]).toMatchObject({ key: "score", kind: "constraint_violation", expected: ">= 0" });

        const high = validateVariablesAgainstSchema({ score: 101, mode: "fast" }, schema);
        expect(high[0].expected).toBe("<= 100");

        const badMode = validateVariablesAgainstSchema({ score: 1, mode: "medium" }, schema);
        expect(badMode).toHaveLength(1);
        expect(badMode[0]).toMatchObject({ key: "mode", kind: "constraint_violation" });
    });

    it("reports type_mismatch (not constraint_violation) when the type is already wrong", () => {
        const violations = validateVariablesAgainstSchema(
            { score: "high" },
            { score: def({ type: "number", constraints: { min: 0 } }) },
        );
        expect(violations).toHaveLength(1);
        expect(violations[0].kind).toBe("type_mismatch");
    });

    it("flags malformed payloads and still surfaces missing required keys", () => {
        for (const payload of [null, [1, 2], "nope", 42]) {
            const violations = validateVariablesAgainstSchema(
                payload as unknown as Record<string, unknown>,
                { name: def() },
            );
            expect(violations.map((v) => v.kind).sort()).toEqual([
                "malformed_payload",
                "missing_required",
            ]);
            expect(violations.find((v) => v.kind === "malformed_payload")?.key).toBe("*");
        }
    });

    it("skips undefined schema entries (Partial record holes)", () => {
        expect(
            validateVariablesAgainstSchema(
                {},
                { hole: undefined, real: def({ required: false }) },
            ),
        ).toEqual([]);
    });

    it("stamps the alias onto violations when validating a data block", () => {
        const violations = validateVariablesAgainstSchema({}, { name: def() }, { alias: "athleteData" });
        expect(violations[0].alias).toBe("athleteData");
        expect(violations[0].message).toContain('data block "athleteData"');
    });
});

describe("validateUpstreamDataAgainstSchema", () => {
    const schema: MosaicUpstreamDataSchemaShape = {
        athleteData: {
            description: "published by step 0",
            variables: {
                name: def(),
                score: def({ type: "number", required: false }),
            },
        },
        designTokens: {
            variables: { primary: def({ required: false }) },
        },
    };

    it("returns no violations without a schema", () => {
        expect(validateUpstreamDataAgainstSchema({ x: { a: 1 } }, undefined)).toEqual([]);
    });

    it("passes when every declared block satisfies its variables schema", () => {
        expect(
            validateUpstreamDataAgainstSchema(
                { athleteData: { name: "Eliud", score: 1 }, designTokens: { primary: "#f00" } },
                schema,
            ),
        ).toEqual([]);
    });

    it("an absent block with required keys reports missing_required per key, alias-stamped", () => {
        const violations = validateUpstreamDataAgainstSchema({}, schema);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            key: "name",
            alias: "athleteData",
            kind: "missing_required",
        });
    });

    it("an absent block with only optional keys is legal", () => {
        const optionalOnly: MosaicUpstreamDataSchemaShape = {
            designTokens: { variables: { primary: def({ required: false }) } },
        };
        expect(validateUpstreamDataAgainstSchema(undefined, optionalOnly)).toEqual([]);
    });

    it("validates types inside a present block", () => {
        const violations = validateUpstreamDataAgainstSchema(
            { athleteData: { name: 42 } },
            schema,
        );
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            key: "name",
            alias: "athleteData",
            kind: "type_mismatch",
        });
    });

    it("ignores aliases published upstream but not declared in the schema", () => {
        expect(
            validateUpstreamDataAgainstSchema(
                { athleteData: { name: "ok" }, surprise: { whatever: 1 } },
                schema,
            ),
        ).toEqual([]);
    });
});
