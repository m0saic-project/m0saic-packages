import type { MosaicTemplatePropDefinition } from "@m0saic/types";
import { auditDefaultProps, assertDefaultPropsComplete } from "./auditDefaultProps";

const schema = (s: Record<string, MosaicTemplatePropDefinition>) => s;

describe("auditDefaultProps — optional knobs must show their effective default", () => {
  it("flags a boolean without a default (a toggle shows OFF for unset)", () => {
    const v = auditDefaultProps({ propsSchema: schema({ showCanvas: { type: "boolean", required: false } }), defaultProps: {} });
    expect(v.map((x) => [x.key, x.fix])).toEqual([["showCanvas", "defaultProps"]]);
  });

  it("flags a plain string/number with neither a default nor a placeholder", () => {
    const v = auditDefaultProps({
      propsSchema: schema({
        title: { type: "string", required: false },
        cameraZoom: { type: "number", required: false, meta: { control: { placeholder: "auto" } } },
        speed: { type: "number", required: false },
      }),
      defaultProps: { speed: 1 },
    });
    expect(v.map((x) => x.key)).toEqual(["title"]);
    expect(v[0].fix).toBe("defaultProps-or-placeholder");
  });

  it("flags a closed-set string without a default even when it has a placeholder", () => {
    const v = auditDefaultProps({
      propsSchema: schema({
        preset: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "dark"] }, control: { placeholder: "light" } } },
        mode: { type: "string", required: false, meta: { control: { options: [{ value: "a" }, { value: "b" }] } } },
      }),
      defaultProps: { mode: "a" },
    });
    expect(v.map((x) => x.key)).toEqual(["preset"]);
  });

  it("exempts required, hidden, and input-like props; audits group fields against the group default", () => {
    const v = auditDefaultProps({
      propsSchema: schema({
        M0String: { type: "m0", required: true },
        sourceIds: { type: "media[]", required: false },
        payload: { type: "json", required: false },
        secret: { type: "boolean", required: false, meta: { ui: { hidden: true } } },
        friendly: { type: "number", required: false, meta: { ui: { consumer: "human" }, control: { syncsTo: [] } } },
        chrome: {
          type: "group",
          required: false,
          fields: { show: { type: "boolean", required: false }, title: { type: "string", required: false } },
        },
      }),
      defaultProps: { chrome: { show: true } },
    });
    expect(v.map((x) => x.key)).toEqual(["chrome.title"]);
  });

  it("assertDefaultPropsComplete names the template and every knob", () => {
    expect(() =>
      assertDefaultPropsComplete({ id: "@x/t/v1" as never, propsSchema: schema({ a: { type: "boolean", required: false } }), defaultProps: {} }),
    ).toThrow(/@x\/t\/v1: 1 optional knob hide/);
    expect(() =>
      assertDefaultPropsComplete({ id: "@x/t/v1" as never, propsSchema: schema({ a: { type: "boolean", required: false } }), defaultProps: { a: false } }),
    ).not.toThrow();
  });
});
