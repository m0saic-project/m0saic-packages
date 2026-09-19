import { validateTemplateProps } from "./validateTemplateProps";
import type { MosaicTemplate, MosaicTemplatePropDefinition } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";

type Props = {
  name?: unknown;
  count?: unknown;
  enabled?: unknown;
  tags?: unknown;
  nums?: unknown;
  media?: unknown;
  medias?: unknown;
  group?: unknown;
  list?: unknown;
  choice?: unknown;
  filter?: unknown;
  setup?: unknown;
};

const baseTemplate: MosaicTemplate<Props> = {
  id: asTemplateId("test/props/v1"),
  label: "Test",
  version: 1,
  capabilities: { tier: "core" },
  propsSchema: {},
  defaultProps: {},
  render: async () => {
    throw new Error("not used");
  },
};

function def(
  type: MosaicTemplatePropDefinition["type"],
  required = false,
  meta?: MosaicTemplatePropDefinition["meta"]
): MosaicTemplatePropDefinition {
  return { type, required, meta };
}

describe("validateTemplateProps", () => {
  test("required prop missing -> MISSING_REQUIRED_PROP", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: { name: def("string", true) },
    };

    const diags = validateTemplateProps(template, {});
    expect(diags.some((d) => d.code === "MISSING_REQUIRED_PROP")).toBe(true);
  });

  test("type mismatch string -> INVALID_PROP_TYPE", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: { name: def("string", true) },
    };

    const diags = validateTemplateProps(template, { name: 123 });
    expect(diags.some((d) => d.code === "INVALID_PROP_TYPE")).toBe(true);
  });

  test("validates string[] and number[] types", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: {
        tags: def("string[]", true),
        nums: def("number[]", true),
      },
    };

    expect(validateTemplateProps(template, { tags: ["a", "b"], nums: [1, 2] }).length).toBe(0);

    const bad1 = validateTemplateProps(template, { tags: ["a", 2], nums: [1, 2] });
    expect(bad1.some((d) => d.code === "INVALID_PROP_TYPE")).toBe(true);

    const bad2 = validateTemplateProps(template, { tags: ["a"], nums: [1, NaN] });
    expect(bad2.some((d) => d.code === "INVALID_PROP_TYPE")).toBe(true);
  });

  test("validates read-only code handoff values", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: { setup: def("code", true) },
    };

    expect(
      validateTemplateProps(template, {
        setup: { language: "javascript", code: "console.log('ready');" },
      }),
    ).toHaveLength(0);
    expect(
      validateTemplateProps(template, {
        setup: { language: "", code: "console.log('ready');" },
      })[0]?.message,
    ).toMatch(/expected type "code"/);
    expect(
      validateTemplateProps(template, {
        setup: { language: "javascript", code: 42 },
      })[0]?.message,
    ).toMatch(/expected type "code"/);
  });

  test("media accepts string or object; media[] accepts string/object elements", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: {
        media: def("media", true),
        medias: def("media[]", true),
      },
    };

    expect(validateTemplateProps(template, { media: "file.mp4", medias: ["a", { id: "x" }] }).length).toBe(0);

    const bad = validateTemplateProps(template, { media: 123, medias: ["a"] });
    expect(bad.some((d) => d.code === "INVALID_PROP_TYPE")).toBe(true);
  });

  test("group requires plain object; list requires array", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: {
        group: def("group", true),
        list: def("list", true),
      },
    };

    expect(validateTemplateProps(template, { group: { a: 1 }, list: [1, 2] }).length).toBe(0);

    const bad1 = validateTemplateProps(template, { group: [1, 2], list: [1] });
    expect(bad1.some((d) => d.code === "INVALID_PROP_TYPE")).toBe(true);

    const bad2 = validateTemplateProps(template, { group: { a: 1 }, list: { a: 1 } });
    expect(bad2.some((d) => d.code === "INVALID_PROP_TYPE")).toBe(true);
  });

  test("number constraints: min/max", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: {
        count: def("number", true, { constraints: { min: 2, max: 4 } }),
      },
    };

    const low = validateTemplateProps(template, { count: 1 });
    expect(low.some((d) => d.code === "PROP_BELOW_MIN")).toBe(true);

    const high = validateTemplateProps(template, { count: 5 });
    expect(high.some((d) => d.code === "PROP_ABOVE_MAX")).toBe(true);

    expect(validateTemplateProps(template, { count: 3 }).length).toBe(0);
  });

  test("array constraints: minItems/maxItems", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: {
        tags: def("string[]", true, { constraints: { minItems: 2, maxItems: 3 } }),
      },
    };

    const few = validateTemplateProps(template, { tags: ["a"] });
    expect(few.some((d) => d.code === "PROP_TOO_FEW_ITEMS")).toBe(true);

    const many = validateTemplateProps(template, { tags: ["a", "b", "c", "d"] });
    expect(many.some((d) => d.code === "PROP_TOO_MANY_ITEMS")).toBe(true);

    expect(validateTemplateProps(template, { tags: ["a", "b"] }).length).toBe(0);
  });

  test("oneOf constraint for string", () => {
    const template: MosaicTemplate<Props> = {
      ...baseTemplate,
      propsSchema: {
        choice: def("string", true, { constraints: { oneOf: ["x", "y"] } }),
      },
    };

    const bad = validateTemplateProps(template, { choice: "z" });
    expect(bad.some((d) => d.code === "PROP_NOT_IN_ONEOF")).toBe(true);

    expect(validateTemplateProps(template, { choice: "x" }).length).toBe(0);
  });

  describe("type: \"json\"", () => {
    test("accepts plain objects", () => {
      const template: MosaicTemplate<Props> = {
        ...baseTemplate,
        propsSchema: { filter: def("json", true) },
      };
      const diags = validateTemplateProps(template, {
        filter: { q: "hello", perPage: 25 },
      });
      expect(diags).toEqual([]);
    });

    test("accepts arrays (a valid JSON value)", () => {
      const template: MosaicTemplate<Props> = {
        ...baseTemplate,
        propsSchema: { filter: def("json", true) },
      };
      const diags = validateTemplateProps(template, { filter: [1, 2, 3] });
      expect(diags).toEqual([]);
    });

    test("accepts raw JSON strings (transport-friendly)", () => {
      const template: MosaicTemplate<Props> = {
        ...baseTemplate,
        propsSchema: { filter: def("json", true) },
      };
      const diags = validateTemplateProps(template, {
        filter: '{"q":"hello"}',
      });
      expect(diags).toEqual([]);
    });

    test("accepts primitive values (JSON allows them)", () => {
      const template: MosaicTemplate<Props> = {
        ...baseTemplate,
        propsSchema: { filter: def("json", true) },
      };
      expect(
        validateTemplateProps(template, { filter: 42 }).length,
      ).toBe(0);
      expect(
        validateTemplateProps(template, { filter: false }).length,
      ).toBe(0);
    });

    test("required + missing -> MISSING_REQUIRED_PROP", () => {
      const template: MosaicTemplate<Props> = {
        ...baseTemplate,
        propsSchema: { filter: def("json", true) },
      };
      const diags = validateTemplateProps(template, {});
      expect(diags.some((d) => d.code === "MISSING_REQUIRED_PROP")).toBe(true);
    });

    test("optional + absent -> no diagnostics", () => {
      const template: MosaicTemplate<Props> = {
        ...baseTemplate,
        propsSchema: { filter: def("json", false) },
      };
      const diags = validateTemplateProps(template, {});
      expect(diags).toEqual([]);
    });

    test("jsonSchema constraint hint compiles + is ignored by the validator (engine-pass-through)", () => {
      const template: MosaicTemplate<Props> = {
        ...baseTemplate,
        propsSchema: {
          filter: def("json", false, {
            constraints: {
              jsonSchema: {
                ref: "@m0saic/schemas/github-find-filter/v1",
              },
            },
          }),
        },
      };
      // Validator accepts any value — schema is an editor hint, not a gate.
      const diags = validateTemplateProps(template, {
        filter: { totally: { unrelated: "shape" } },
      });
      expect(diags).toEqual([]);
    });
  });
});
