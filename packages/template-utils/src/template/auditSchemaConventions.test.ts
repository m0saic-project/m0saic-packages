import type { MosaicTemplatePropDefinition } from "@m0saic/types";
import {
  auditPropLabels,
  isAbsoluteFilesystemPath,
  looksLikeColorProp,
  walkPropDefinitions,
} from "./auditSchemaConventions";

const def = (d: Partial<MosaicTemplatePropDefinition> & { type: MosaicTemplatePropDefinition["type"] }) =>
  ({ required: false, ...d }) as MosaicTemplatePropDefinition;

describe("auditSchemaConventions — the pure pieces (the rules themselves are locked in templateConventions.test.ts)", () => {
  it("walkPropDefinitions yields dotted keys and descends into group fields", () => {
    const seen: string[] = [];
    walkPropDefinitions(
      {
        a: def({ type: "string" }),
        theme: def({ type: "group", fields: { bg: def({ type: "string" }), nested: def({ type: "group", fields: { deep: def({ type: "number" }) } }) } }),
      },
      (key) => seen.push(key),
    );
    expect(seen).toEqual(["a", "theme", "theme.bg", "theme.nested", "theme.nested.deep"]);
  });

  it("looksLikeColorProp: leaf key or #rrggbb description, string types only", () => {
    expect(looksLikeColorProp("accentColor", def({ type: "string" }))).toBe(true);
    expect(looksLikeColorProp("theme.bgColor", def({ type: "string" }))).toBe(true);
    expect(looksLikeColorProp("swatches", def({ type: "string[]", description: "Fills as #rrggbb." }))).toBe(true);
    expect(looksLikeColorProp("colorCount", def({ type: "number" }))).toBe(false);
    expect(looksLikeColorProp("colorful.title", def({ type: "string" }))).toBe(false); // the LEAF decides
    expect(looksLikeColorProp("title", def({ type: "string" }))).toBe(false);
  });

  it("isAbsoluteFilesystemPath: POSIX, Windows drive, UNC — not URLs, data URIs, or relative refs", () => {
    for (const p of ["/Users/x/a.png", "/tmp", "C:\\\\x\\\\a.mp4", "d:/x/a.mp4", "\\\\\\\\host\\\\share\\\\a.mp4"]) expect(isAbsoluteFilesystemPath(p)).toBe(true);
    for (const p of ["assets/a.png", "./a.png", "//cdn/a.png", "https://x/a.png", "data:image/png;base64,AA", "", "a:b"]) expect(isAbsoluteFilesystemPath(p)).toBe(false);
  });

  it("auditPropLabels skips hidden props and walks groups", () => {
    const v = auditPropLabels({
      propsSchema: {
        ok: def({ type: "string", meta: { ui: { label: "Ok" } } }),
        hidden: def({ type: "string", meta: { ui: { hidden: true } } }),
        blank: def({ type: "string", meta: { ui: { label: "  " } } }),
        g: def({ type: "group", meta: { ui: { label: "G" } }, fields: { inner: def({ type: "number" }) } }),
      } as never,
    });
    expect(v.map((x) => x.key)).toEqual(["blank", "g.inner"]);
  });

  it("auditPropLabels exempts internal templates — a building block has no panel", () => {
    const propsSchema = { title: def({ type: "string" }) } as never;
    expect(auditPropLabels({ propsSchema }).map((x) => x.key)).toEqual(["title"]);
    expect(auditPropLabels({ propsSchema, internal: true })).toEqual([]);
  });
});
