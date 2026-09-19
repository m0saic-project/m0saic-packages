import type { MosaicTemplate, MosaicTemplatePropDefinition } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import {
  TEMPLATE_CONVENTION_POSTURE,
  TemplateConventionError,
  drainTemplateConventionFindings,
  enforceTemplateConventions,
  listTemplateConventionFindings,
} from "./templateConventions";
import {
  auditBrowseSurface,
  auditColorProps,
  auditDefaultsValidate,
  auditNoLocalPaths,
  auditOutputFormat,
  auditPropLabels,
  isAbsoluteFilesystemPath,
} from "./auditSchemaConventions";
import { defineMosaicTemplate } from "./defineMosaicTemplate";
import { registerTemplate, withExternalTemplateOrigin } from "./templateRegistry";

const schema = (s: Record<string, MosaicTemplatePropDefinition>) => s;
const doc = { kind: "mosaic_document" as const, version: 1 as const, m0: "F", assets: {}, sources: [{ type: "color" as const, color: "#000" }] };

function tmpl(id: string, extra: Partial<MosaicTemplate<Record<string, unknown>>> = {}): MosaicTemplate<Record<string, unknown>> {
  return {
    id: asTemplateId(id),
    label: id,
    version: 1,
    description: "t",
    tags: ["test"],
    propsSchema: schema({ showCanvas: { type: "boolean", required: false, meta: { ui: { label: "Show canvas" } } } }),
    defaultProps: {},
    // Every public template declares its deliverable (the `outputFormat`
    // convention); the fixture is compliant so the OTHER rules test alone.
    outputHints: { format: { kind: "image", container: "png" } },
    render: async () => doc as never,
    ...extra,
  } as MosaicTemplate<Record<string, unknown>>;
}

beforeEach(() => {
  drainTemplateConventionFindings();
});

describe("template conventions at the defineMosaicTemplate seam", () => {
  it("THROWS for a first-party template that hides a default — there is no escape hatch", () => {
    expect(() => enforceTemplateConventions(tmpl("@x/hidden/v1"))).toThrow(TemplateConventionError);
    expect(() => defineMosaicTemplate(tmpl("@x/hidden/v1"))).toThrow(/breaks the "defaultProps" convention/);
    const [f] = listTemplateConventionFindings();
    expect(f).toMatchObject({ templateId: "@x/hidden/v1", convention: "defaultProps", external: false });
    expect(f.violations.map((v) => v.key)).toEqual(["showCanvas"]);
  });

  it("passes silently for a compliant template and records nothing", () => {
    const t = tmpl("@x/clean/v1", { defaultProps: { showCanvas: true } });
    expect(enforceTemplateConventions(t)).toEqual([]);
    expect(() => defineMosaicTemplate(t)).not.toThrow();
    expect(listTemplateConventionFindings()).toEqual([]);
  });

  it("outputFormat: a public template with no outputHints.format WARNS (recorded, never thrown)", () => {
    const t = tmpl("@x/no-format/v1", { defaultProps: { showCanvas: true }, outputHints: undefined });
    expect(TEMPLATE_CONVENTION_POSTURE.outputFormat).toBe("record");
    const findings = enforceTemplateConventions(t);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ templateId: "@x/no-format/v1", convention: "outputFormat", severity: "warning", external: false });
    expect(findings[0].violations.map((v) => v.key)).toEqual(["outputHints.format"]);
    expect(() => defineMosaicTemplate(t)).not.toThrow();
    expect(listTemplateConventionFindings().map((f) => f.convention)).toEqual(["outputFormat"]);
  });

  it("outputFormat: hints WITHOUT a format still warn; an empty format object is not a declaration", () => {
    expect(auditOutputFormat({ outputHints: { width: 1280, height: 720, fps: 30 } })).toHaveLength(1);
    expect(auditOutputFormat({ outputHints: { format: {} as never } })).toHaveLength(1);
  });

  it("outputFormat: a declared deliverable is silent — video, image, and container-only forms", () => {
    expect(auditOutputFormat({ outputHints: { format: { kind: "video", container: "mp4" } } })).toEqual([]);
    expect(auditOutputFormat({ outputHints: { format: { kind: "image", container: "png", pixelFormat: "rgba" } } })).toEqual([]);
    expect(auditOutputFormat({ outputHints: { format: { kind: "image", frameCount: 1 } as never } })).toEqual([]);
  });

  it("outputFormat: internal building blocks and deprecated templates are exempt", () => {
    expect(auditOutputFormat({ internal: true })).toEqual([]);
    expect(auditOutputFormat({ deprecated: { reason: "old" } })).toEqual([]);
    const internal = tmpl("@x/block/v1", { defaultProps: { showCanvas: true }, outputHints: undefined, internal: true });
    expect(enforceTemplateConventions(internal)).toEqual([]);
  });

  it("an EXTERNAL repo template records instead of throwing (a bad template never aborts a repo load)", () => {
    const r = withExternalTemplateOrigin("community-x", () => registerTemplate(tmpl("@community-x/hidden/v1")));
    expect(r.ok).toBe(true);
    expect(listTemplateConventionFindings()).toMatchObject([{ templateId: "@community-x/hidden/v1", external: true }]);
  });

  it("registerTemplate (first-party) throws before the template lands in the registry", () => {
    expect(() => registerTemplate(tmpl("@x/hidden-registry/v1"))).toThrow(TemplateConventionError);
  });

  it("re-registering a template replaces its finding rather than stacking duplicates", () => {
    const t = tmpl("@community-x/hot/v1");
    withExternalTemplateOrigin("community-x", () => { defineMosaicTemplate(t); defineMosaicTemplate(t); });
    expect(listTemplateConventionFindings()).toHaveLength(1);
  });

  it("a re-registered template that now passes clears its earlier finding (hot reload after a fix)", () => {
    withExternalTemplateOrigin("community-x", () => defineMosaicTemplate(tmpl("@community-x/fixed/v1")));
    expect(listTemplateConventionFindings()).toHaveLength(1);
    withExternalTemplateOrigin("community-x", () => defineMosaicTemplate(tmpl("@community-x/fixed/v1", { defaultProps: { showCanvas: false } })));
    expect(listTemplateConventionFindings()).toEqual([]);
  });

  it("defineMosaicTemplate called from a repo's own module body inside the external scope records instead of throwing", () => {
    const t = tmpl("@community-x/module-body/v1");
    expect(() => withExternalTemplateOrigin("community-x", () => defineMosaicTemplate(t))).not.toThrow();
    expect(listTemplateConventionFindings()).toMatchObject([{ templateId: "@community-x/module-body/v1", external: true }]);
    // The scope has closed again: the same call outside it is first-party and throws.
    expect(() => defineMosaicTemplate(t)).toThrow(TemplateConventionError);
  });

  it("an explicit `conventions` option overrides the ambient posture", () => {
    const t = tmpl("@x/override/v1");
    expect(() => defineMosaicTemplate(t, { conventions: "record" })).not.toThrow();
    expect(listTemplateConventionFindings()).toMatchObject([{ templateId: "@x/override/v1", external: true }]);
    expect(() => withExternalTemplateOrigin("community-x", () => defineMosaicTemplate(t, { conventions: "throw" }))).toThrow(TemplateConventionError);
  });
});

describe("schema-level conventions (2026-09-06)", () => {
  const clean = (id: string, extra: Partial<MosaicTemplate<Record<string, unknown>>> = {}) =>
    tmpl(id, { defaultProps: { showCanvas: true }, ...extra });

  it("colorProps THROWS when a colour-looking prop lacks isColor + colorPicker", () => {
    const t = clean("@x/color/v1", {
      propsSchema: schema({ accentColor: { type: "string", required: false, meta: { control: { placeholder: "theme" }, ui: { label: "Accent" } } } }),
    });
    expect(auditColorProps(t).map((v) => v.key)).toEqual(["accentColor"]);
    expect(() => enforceTemplateConventions(t)).toThrow(/breaks the "colorProps" convention/);
    // The description heuristic counts too, and the pair satisfies it.
    const byDesc = clean("@x/color-desc/v1", {
      propsSchema: schema({ ink: { type: "string", required: false, description: "Ink as #rrggbb.", meta: { control: { placeholder: "auto" }, ui: { label: "Ink" } } } }),
    });
    expect(auditColorProps(byDesc).map((v) => v.key)).toEqual(["ink"]);
    const fixed = clean("@x/color-ok/v1", {
      propsSchema: schema({
        accentColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true, placeholder: "theme" }, ui: { label: "Accent" } } },
        swatches: { type: "string[]", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Swatches" } } },
      }),
    });
    expect(auditColorProps(fixed)).toEqual([]);
    expect(() => enforceTemplateConventions(fixed)).not.toThrow();
  });

  it("colorProps walks group fields and ignores non-string types", () => {
    const t = clean("@x/color-group/v1", {
      propsSchema: schema({
        theme: { type: "group", required: false, meta: { ui: { label: "Theme" } }, fields: { bgColor: { type: "string", required: false, meta: { control: { placeholder: "auto" }, ui: { label: "Bg" } } } } },
        colorCount: { type: "number", required: false, meta: { control: { placeholder: "auto" }, ui: { label: "Count" } } },
      }),
    });
    expect(auditColorProps(t).map((v) => v.key)).toEqual(["theme.bgColor"]);
  });

  it("noLocalPaths THROWS on an absolute filesystem path anywhere in defaultProps", () => {
    expect(isAbsoluteFilesystemPath("/Users/me/clip.mp4")).toBe(true);
    expect(isAbsoluteFilesystemPath("C:\\clips\\a.mp4")).toBe(true);
    expect(isAbsoluteFilesystemPath("\\\\server\\share\\a.mp4")).toBe(true);
    expect(isAbsoluteFilesystemPath("//cdn.example/a.png")).toBe(false);
    expect(isAbsoluteFilesystemPath("assets/a.png")).toBe(false);
    expect(isAbsoluteFilesystemPath("data:image/png;base64,AA")).toBe(false);
    const t = clean("@x/paths/v1", {
      propsSchema: schema({ clips: { type: "media[]", required: false, meta: { ui: { label: "Clips" } } }, nest: { type: "json", required: false, meta: { ui: { label: "Nest" } } } }),
      defaultProps: { showCanvas: true, clips: ["assets/ok.mp4", "/Users/me/clip.mp4"], nest: { deep: { file: "D:/x/y.png" } } },
    });
    expect(auditNoLocalPaths(t).map((v) => v.key)).toEqual(["clips[1]", "nest.deep.file"]);
    expect(() => enforceTemplateConventions(t)).toThrow(/breaks the "noLocalPaths" convention/);
  });

  it("browseSurface THROWS without a description or without tags", () => {
    expect(auditBrowseSurface(clean("@x/b/v1", { description: "  " })).map((v) => v.key)).toEqual(["description"]);
    expect(auditBrowseSurface(clean("@x/b/v1", { tags: [] })).map((v) => v.key)).toEqual(["tags"]);
    expect(() => enforceTemplateConventions(clean("@x/b/v1", { tags: undefined }))).toThrow(/breaks the "browseSurface" convention/);
  });

  it("propLabels only WARNS (record posture): first-party stays loadable, the finding is recorded with severity warning", () => {
    expect(TEMPLATE_CONVENTION_POSTURE.propLabels).toBe("record");
    const t = clean("@x/labels/v1", {
      propsSchema: schema({
        title: { type: "string", required: false, meta: { control: { placeholder: "auto" } } },
        secret: { type: "string", required: false, meta: { control: { placeholder: "auto" }, ui: { hidden: true } } },
      }),
    });
    expect(auditPropLabels(t).map((v) => v.key)).toEqual(["title"]);
    expect(() => defineMosaicTemplate(t)).not.toThrow();
    expect(listTemplateConventionFindings()).toMatchObject([
      { templateId: "@x/labels/v1", convention: "propLabels", severity: "warning", external: false },
    ]);
  });

  it("defaultsValidate THROWS when a default breaks its own schema — and ignores required inputs left for the user", () => {
    const bad = clean("@x/defaults-bad/v1", {
      propsSchema: schema({
        mode: { type: "string", required: false, meta: { constraints: { oneOf: ["a", "b"] }, ui: { label: "Mode" } } },
        count: { type: "number", required: false, meta: { constraints: { min: 0, max: 10 }, ui: { label: "Count" } } },
      }),
      defaultProps: { showCanvas: true, mode: "zzz", count: 99 },
    });
    expect(auditDefaultsValidate(bad).map((v) => v.key).sort()).toEqual(["count", "mode"]);
    expect(() => enforceTemplateConventions(bad)).toThrow(/breaks the "defaultsValidate" convention/);

    const inputs = clean("@x/defaults-inputs/v1", {
      propsSchema: schema({
        sourceId: { type: "media", required: true, meta: { ui: { label: "Clip" } } },
        title: { type: "string", required: false, meta: { control: { placeholder: "auto" }, ui: { label: "Title" } } },
      }),
      defaultProps: { showCanvas: true },
    });
    expect(auditDefaultsValidate(inputs)).toEqual([]); // a required input with no default is an INPUT
    expect(() => enforceTemplateConventions(inputs)).not.toThrow();
  });

  it("several fatal conventions surface in ONE error, and every finding is recorded", () => {
    const t = tmpl("@x/many/v1", {
      tags: [],
      propsSchema: schema({ showCanvas: { type: "boolean", required: false }, tintColor: { type: "string", required: false, meta: { control: { placeholder: "auto" } } } }),
    });
    let err: unknown;
    try {
      enforceTemplateConventions(t);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TemplateConventionError);
    const e = err as TemplateConventionError;
    expect(e.findings.map((f) => f.convention)).toEqual(["defaultProps", "colorProps", "browseSurface"]);
    expect(e.message).toMatch(/"defaultProps" convention/);
    expect(e.message).toMatch(/"browseSurface" convention/);
    expect(listTemplateConventionFindings().map((f) => [f.convention, f.severity])).toEqual([
      ["defaultProps", "error"],
      ["colorProps", "error"],
      ["browseSurface", "error"],
      ["propLabels", "warning"],
    ]);
  });

  it("an EXTERNAL template records every convention — errors and warnings — and never throws", () => {
    const t = tmpl("@community-x/many/v1", { tags: [] });
    expect(() => withExternalTemplateOrigin("community-x", () => defineMosaicTemplate(t))).not.toThrow();
    expect(listTemplateConventionFindings().map((f) => [f.convention, f.severity, f.external])).toEqual([
      ["defaultProps", "error", true],
      ["browseSurface", "error", true],
    ]);
  });
});
