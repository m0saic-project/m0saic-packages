/**
 * @m0saic/brand/business-card/v2 — template gate. v2 is v1's card held to the
 * 0.3.1 conventions, so the core lock is PAINT PARITY with v1 (both faces,
 * handles stripped); the rest locks what changed: the catalog sidecar, the
 * add handles on the name rect, the declared props, the audit as new work.
 */
import type { MosaicDocument, MosaicDocumentPipeline, MosaicEngineContext, MosaicRenderableFile } from "@m0saic/types";
import { auditRenderedTemplate, getTemplate, getTemplateAsRegistered, resolvePropBindings } from "@m0saic/template-utils";
import "../../../index"; // registers every back the catalog nests
import { BusinessCard } from "../v1/business-card";
import { cardCanvas } from "../v1/layout";
import { BusinessCardV2 } from "./business-card";

const ID = "@m0saic/brand/business-card/v2";
const NATURAL = cardCanvas("moo", 300);

const ctxFor = (w: number, h: number): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 1000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/business-card-v2-test" }, media: {} } as unknown as MosaicEngineContext;
};

const render = async (props: Record<string, unknown>, ctx = ctxFor(NATURAL.W, NATURAL.H)): Promise<MosaicRenderableFile> =>
  BusinessCardV2.render({ ...BusinessCardV2.defaultProps, ...props }, ctx);

const faces = (file: MosaicRenderableFile): { front: MosaicDocument; back: MosaicDocument } => {
  const p = file as MosaicDocumentPipeline;
  expect(p.steps.map((s) => s.name)).toEqual(["front", "back"]);
  return { front: p.steps[0].file as MosaicDocument, back: p.steps[1].file as MosaicDocument };
};

/** Strip the editor handles: what the card PAINTS, for the v1 parity check. */
const painted = (file: MosaicRenderableFile): unknown =>
  JSON.parse(JSON.stringify(file), (k, v) => (k === "binding" || k === "bindings" ? undefined : v));

const keysOn = (doc: MosaicDocument, label: string): string[] => {
  const s = doc.sources.find((x) => (x as { editor?: { label?: string } }).editor?.label === label) as
    | { editor?: { binding?: { propKey: string }; bindings?: Array<{ propKey: string }> } }
    | undefined;
  return (s?.editor?.bindings ?? (s?.editor?.binding ? [s.editor.binding] : [])).map((b) => b.propKey);
};

describe(`${ID} — template shell`, () => {
  it("id, version 2, core tier, PNG still hints at MOO's exact bleed box", () => {
    expect(String(BusinessCardV2.id)).toBe(ID);
    expect(BusinessCardV2.version).toBe(2);
    expect(BusinessCardV2.outputHints).toMatchObject({ width: 1098, height: 648, format: { kind: "image", container: "png" } });
  });

  it("describes itself in its catalog sidecar only; the registry applies it", () => {
    const code = getTemplateAsRegistered(ID)!;
    for (const field of ["label", "description", "tags"]) expect((code as unknown as Record<string, unknown>)[field]).toBeUndefined();
    const registered = getTemplate(ID)!;
    expect(registered.label).toBe("Business Card");
    expect(registered.propsSchema?.name?.meta?.ui).toMatchObject({ label: "Name", primary: true });
  });

  it("supersedes v1, and v3 supersedes both: each sidecar points at the live version", () => {
    expect(getTemplate(String(BusinessCard.id))!.deprecated).toMatchObject({ replacement: "@m0saic/brand/business-card/v3" });
    expect(getTemplate(ID)!.deprecated).toMatchObject({ replacement: "@m0saic/brand/business-card/v3" });
  });

  it("meets every 0.3.1 convention as new work", async () => {
    const audit = await auditRenderedTemplate(getTemplate(ID)!, { record: false });
    const errors = audit.findings.filter((f) => f.severity === "error");
    expect(errors.map((f) => `${f.convention}: ${f.violations.map((v) => v.detail).join(" | ")}`)).toEqual([]);
    expect(audit.lagging).toEqual([]);
  });

  it("paints exactly what v1 paints — defaults, a sparse front, another back with guides, a smaller canvas", async () => {
    const cases: Array<[Record<string, unknown>, MosaicEngineContext]> = [
      [{}, ctxFor(NATURAL.W, NATURAL.H)],
      [{ role: "", email: "", handle: "" }, ctxFor(NATURAL.W, NATURAL.H)],
      [{ back: "donut", guides: true, accent: "#22cc88" }, ctxFor(NATURAL.W, NATURAL.H)],
      [{ bleed: "none" }, ctxFor(525, 300)],
    ];
    for (const [props, ctx] of cases) {
      const v1 = await BusinessCard.render({ ...BusinessCard.defaultProps, ...props }, ctx);
      const v2 = await render(props, ctx);
      expect(painted(v2)).toEqual(painted(v1));
    }
  });
});

describe(`${ID} — prop bindings (Make canvas handles)`, () => {
  it("defaults: every contact line is drawn, so the name rect carries only the name", async () => {
    const { front } = faces(await render({}));
    expect(keysOn(front, "name")).toEqual(["name"]);
    const r = resolvePropBindings(front, NATURAL.W, NATURAL.H, { propsSchema: BusinessCardV2.propsSchema });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "email", "handle", "name", "role", "site"]);
  });

  it("an empty contact line rides the name rect as an add handle", async () => {
    const { front } = faces(await render({ role: "", email: "", handle: "" }));
    expect(keysOn(front, "name")).toEqual(["name", "role", "email", "handle"]);
    const r = resolvePropBindings(front, NATURAL.W, NATURAL.H, { propsSchema: BusinessCardV2.propsSchema });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "email", "handle", "name", "role", "site"]);
  });

  it("declares the two props no rect shows: the print resolution and the field's tint", () => {
    expect(BusinessCardV2.bindings?.unbound).toEqual({ dpi: "print resolution", fieldOpacity: "texture" });
  });
});
