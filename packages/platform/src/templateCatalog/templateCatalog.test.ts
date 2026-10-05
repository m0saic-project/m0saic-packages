import {
  TEMPLATE_CATALOG_AUTHORED_KEY,
  TEMPLATE_CATALOG_FILE,
  TEMPLATE_CATALOG_SIDECAR_SUFFIX,
  applyTemplateCatalogEntry,
  authoredCatalogFields,
  authoredPropCopy,
  authoredPropsSchema,
  parseTemplateCatalogFile,
  parseTemplateCatalogSidecar,
  sameTemplateDeprecation,
  splitPropPresentation,
  unknownCatalogProps,
  withTemplateCatalog,
} from "./templateCatalog";

const V1 = "@acme/cards/quote/v1";
const V2 = "@acme/cards/quote/v2";
const DEP = { reason: "v2 binds every prop", replacement: V2, since: "2026-09-29" };

describe("parseTemplateCatalogFile", () => {
  it("names the wire catalog and the sidecar suffix", () => {
    expect(TEMPLATE_CATALOG_FILE).toBe("template-catalog.json");
    expect(TEMPLATE_CATALOG_SIDECAR_SUFFIX).toBe(".catalog.json");
  });

  it("reads a clean catalog with no problems", () => {
    const entry = {
      label: "Quote Card",
      description: "Pull-quote card.",
      tags: ["social", "quote"],
      platforms: ["instagram"],
      channels: ["social"],
      preview: { poster: "assets/poster.png" },
      internal: false,
      primitive: true,
      deprecated: DEP,
      props: { quote: { label: "Quote", description: "The quote body.", placeholder: "…", order: 1, primary: true, collapsedByDefault: false } },
    };
    const { file, problems } = parseTemplateCatalogFile({ schemaVersion: 1, templates: { [V1]: entry } });
    expect(problems).toEqual([]);
    expect(file.templates[V1]).toEqual(entry);
  });

  it("refuses a key that is not a catalog field — a catalog never changes what a template renders", () => {
    const { file, problems } = parseTemplateCatalogFile({
      schemaVersion: 1,
      templates: { [V1]: { tags: ["a"], defaultProps: { x: 1 }, outputHints: {} } },
    });
    expect(file.templates[V1]).toEqual({ tags: ["a"] });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/"defaultProps" is not a catalog field/);
  });

  it("drops a field with the wrong shape and reports it", () => {
    const { file, problems } = parseTemplateCatalogFile({
      schemaVersion: 1,
      templates: { [V1]: { label: "", tags: "social", internal: "yes", preview: [], description: "ok" } },
    });
    expect(file.templates[V1]).toEqual({ description: "ok" });
    expect(problems).toHaveLength(4);
  });

  it("validates deprecated: reason and since required, replacement a template id, no other keys", () => {
    const { file, problems } = parseTemplateCatalogFile({
      schemaVersion: 1,
      templates: { [V1]: { deprecated: { replacement: V2, since: "Sept 29", note: "x" } } },
    });
    expect(file.templates[V1]).toEqual({ deprecated: { replacement: V2 } });
    expect(problems.join("\n")).toMatch(/deprecated.reason/);
    expect(problems.join("\n")).toMatch(/YYYY-MM-DD/);
    expect(problems.join("\n")).toMatch(/unknown key "note"/);
  });

  it("reads no entries from an unknown schemaVersion or a malformed file, and says so", () => {
    expect(parseTemplateCatalogFile({ schemaVersion: 2, templates: { [V1]: {} } }).problems.join()).toMatch(/schemaVersion 2/);
    expect(parseTemplateCatalogFile([]).problems.join()).toMatch(/JSON object/);
    expect(parseTemplateCatalogFile({ schemaVersion: 1, templates: [] }).problems.join()).toMatch(/must map template ids/);
    const dropped = parseTemplateCatalogFile({ schemaVersion: 1, templates: { [V1]: "old" } });
    expect(dropped.file.templates).toEqual({});
  });
});

describe("sameTemplateDeprecation", () => {
  it("compares reason, replacement and since", () => {
    expect(sameTemplateDeprecation(DEP as never, { ...DEP } as never)).toBe(true);
    expect(sameTemplateDeprecation(DEP as never, { ...DEP, since: "2026-09-30" } as never)).toBe(false);
    expect(sameTemplateDeprecation(undefined, undefined)).toBe(true);
  });
});

describe("applyTemplateCatalogEntry / withTemplateCatalog", () => {
  const tpl = (id: string, extra: Record<string, unknown> = {}) => ({ id, render: () => id, defaultProps: {}, ...extra });

  it("catalog-first: the entry overrides the template's own fields; the rest are the original's", () => {
    const shipped = Object.freeze(tpl(V1, { label: "Old", tags: ["old"], internal: false }));
    const merged = applyTemplateCatalogEntry(shipped, { tags: ["new", "social"], internal: true }) as Record<string, unknown>;
    expect(merged.tags).toEqual(["new", "social"]);
    expect(merged.internal).toBe(true);
    expect(merged.label).toBe("Old");
    expect(merged.render).toBe(shipped.render);
    expect((shipped as Record<string, unknown>).tags).toEqual(["old"]);
  });

  it("keeps the as-written catalog fields, so the template still answers for its file", () => {
    const shipped = tpl(V1, { label: "Old", tags: ["old"] });
    const merged = applyTemplateCatalogEntry(shipped, { tags: ["new"], deprecated: DEP as never });
    expect(authoredCatalogFields(merged)).toEqual({ label: "Old", tags: ["old"] });
    expect(authoredCatalogFields(shipped)).toEqual({ label: "Old", tags: ["old"] });
    // Merging twice keeps the FIRST as-written view.
    expect(authoredCatalogFields(applyTemplateCatalogEntry(merged, { label: "Newer" }))).toEqual({ label: "Old", tags: ["old"] });
    expect(Object.keys(merged)).not.toContain(String(TEMPLATE_CATALOG_AUTHORED_KEY));
  });

  it("keeps symbol-keyed and non-enumerable own properties on the copy", () => {
    const mark = Symbol.for("test.mark");
    const t = tpl(V1) as Record<string | symbol, unknown>;
    t[mark] = "kept";
    Object.defineProperty(t, "hidden", { value: 1, enumerable: false });
    const copy = applyTemplateCatalogEntry(t, { tags: ["x"] }) as Record<string | symbol, unknown>;
    expect(copy[mark]).toBe("kept");
    expect(copy.hidden).toBe(1);
  });

  it("merges a list: catalogued ids become copies, the rest pass through, unknown ids are reported", () => {
    const v1 = tpl(V1);
    const v2 = tpl(V2);
    const merge = withTemplateCatalog([v1, v2], { [V1]: { deprecated: DEP as never }, "@acme/gone/v1": { tags: ["x"] } });
    expect(merge.applied).toEqual([V1]);
    expect(merge.unknown).toEqual(["@acme/gone/v1"]);
    expect((merge.templates[0] as Record<string, unknown>).deprecated).toEqual(DEP);
    expect(merge.templates[1]).toBe(v2);
  });
});

describe("prop presentation (props) and sidecars", () => {
  const schema = {
    quote: { type: "string", required: true, description: "old hint", meta: { ui: { label: "Old" }, constraints: { minLength: 1 } } },
    titles: { type: "group", required: false, fields: { title: { type: "string", required: false } } },
    size: { type: "number", required: false },
  };
  const tpl = { id: V1, propsSchema: schema, render: () => V1 };

  it("refuses a prop field that decides the value, and a wrong shape", () => {
    const { file, problems } = parseTemplateCatalogFile({
      schemaVersion: 1,
      templates: { [V1]: { props: { quote: { label: "Q", required: false, constraints: {} }, size: { order: "1" } } } },
    });
    expect(file.templates[V1]!.props).toEqual({ quote: { label: "Q" }, size: {} });
    expect(problems.join("\n")).toMatch(/"required" is not a prop presentation field/);
    expect(problems.join("\n")).toMatch(/order must be a number/);
  });

  it("writes presentation into a COPY of each definition — group fields by dotted key — and keeps the file's schema", () => {
    const merged = applyTemplateCatalogEntry(tpl, {
      props: { quote: { label: "Quote", description: "The quote body.", placeholder: "Say it", order: 2 }, "titles.title": { label: "Title" } },
    }) as unknown as { propsSchema: Record<string, any> };
    expect(merged.propsSchema.quote.description).toBe("The quote body.");
    expect(merged.propsSchema.quote.meta.ui).toEqual({ label: "Quote", order: 2 });
    expect(merged.propsSchema.quote.meta.control).toEqual({ placeholder: "Say it" });
    expect(merged.propsSchema.quote.meta.constraints).toEqual({ minLength: 1 });
    expect(merged.propsSchema.titles.fields.title.meta.ui.label).toBe("Title");
    // the original is untouched, and still reachable as the file's schema
    expect(schema.quote.description).toBe("old hint");
    expect((schema.titles.fields.title as Record<string, unknown>).meta).toBeUndefined();
    expect(authoredPropsSchema(merged)).toBe(schema);
  });

  it("authoredPropCopy lists the presentation a FILE declares; unknownCatalogProps the keys a catalog invents", () => {
    expect(authoredPropCopy(tpl)).toEqual(["quote.description", "quote.label"]);
    const merged = applyTemplateCatalogEntry(tpl, { props: { size: { label: "Size" } } });
    expect(authoredPropCopy(merged)).toEqual(["quote.description", "quote.label"]);
    expect(unknownCatalogProps(tpl, { props: { quote: {}, "titles.title": {}, "titles.nope": {}, gone: {} } })).toEqual(["gone", "titles.nope"]);
  });

  it("parses a sidecar: schemaVersion 1, the template it names, its catalog fields", () => {
    const ok = parseTemplateCatalogSidecar({ schemaVersion: 1, templateId: V2, label: "Quote Card", tags: ["social"] });
    expect(ok).toEqual({ templateId: V2, entry: { label: "Quote Card", tags: ["social"] }, problems: [] });
    expect(parseTemplateCatalogSidecar({ schemaVersion: 1, label: "x" }).problems.join()).toMatch(/templateId/);
    expect(parseTemplateCatalogSidecar({ schemaVersion: 2, templateId: V2 }).problems.join()).toMatch(/schemaVersion 2/);
    expect(parseTemplateCatalogSidecar({ schemaVersion: 1, templateId: V2, render: "x" }).problems.join()).toMatch(/"render" is not a catalog field/);
  });
});

describe("splitPropPresentation — the code keeps what a value IS, the catalog gets how it is presented", () => {
  it("moves label / hint / placeholder / order / primary / collapsedByDefault out, keeps everything else, never mutates", () => {
    const schema = {
      greeting: { type: "string", required: false, description: "The line.", meta: { ui: { label: "Greeting", order: 1, primary: true }, control: { placeholder: "hi" } } },
      accent: { type: "string", required: false, description: "Colour.", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Accent", hidden: false } } },
      titles: { type: "group", required: false, fields: { title: { type: "string", required: false, meta: { ui: { label: "Title", collapsedByDefault: true } } } } },
      raw: { type: "number", required: true },
    };
    const before = JSON.stringify(schema);
    const { schema: bare, props } = splitPropPresentation(schema);
    expect(JSON.stringify(schema)).toBe(before);
    expect(bare).toEqual({
      greeting: { type: "string", required: false },
      accent: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { hidden: false } } },
      titles: { type: "group", required: false, fields: { title: { type: "string", required: false } } },
      raw: { type: "number", required: true },
    });
    expect(props).toEqual({
      greeting: { label: "Greeting", description: "The line.", placeholder: "hi", order: 1, primary: true },
      accent: { label: "Accent", description: "Colour." },
      "titles.title": { label: "Title", collapsedByDefault: true },
    });
  });

  it("round-trips: applying the split-off props onto the bare schema restores the presentation", () => {
    const schema = { q: { type: "string", required: true, description: "Hint.", meta: { ui: { label: "Q", order: 2 }, constraints: { minLength: 1 } } } };
    const { schema: bare, props } = splitPropPresentation(schema);
    const merged = applyTemplateCatalogEntry({ id: "x/v1", propsSchema: bare }, { props }) as unknown as { propsSchema: unknown };
    expect(merged.propsSchema).toEqual(schema);
    expect(authoredPropCopy({ propsSchema: bare })).toEqual([]);
  });
});

