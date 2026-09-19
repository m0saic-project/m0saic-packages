/**
 * Registry-wide lock for the DEFINITION-TIME template conventions
 * (`.ai/proposed-plans/template-conventions-v1.md`, 2026-09-06): every
 * first-party template passes the throw-posture rules, and the record-posture
 * rules only ratchet down. Like `default-props-audit.test.ts`, importing the
 * registry IS the gate — a throw-posture violation throws at registration —
 * and the assertions restate the guarantee as a readable report.
 *
 * Render-time rules (bindings, drawn copy) are locked by the build gate
 * `tools/check-registry.mjs`, which renders every template at its defaults.
 */
import {
  auditBrowseSurface,
  auditColorProps,
  auditDefaultsValidate,
  auditNoLocalPaths,
  auditPropLabels,
  getTemplate,
  listRegisteredTemplateIds,
  listTemplateConventionFindings,
} from "@m0saic/template-utils";

import "./m0saic"; // side-effect: register every template (conventions fire here)

/** Knobs still missing `ui.label` when the rule landed (211 on 2026-09-06).
 *  Lower it as templates are labelled; never raise it. */
const PROP_LABELS_RATCHET = 211;

describe("template conventions — definition time, whole registry", () => {
  const ids = listRegisteredTemplateIds().map(String).sort();
  const report = (name: string, audit: (t: NonNullable<ReturnType<typeof getTemplate>>) => Array<{ key: string; detail: string }>) => {
    const out: string[] = [];
    for (const id of ids) {
      const v = audit(getTemplate(id)!);
      if (v.length) out.push(`${id} [${name}]\n${v.map((x) => `    • ${x.detail}`).join("\n")}`);
    }
    return out;
  };

  it("registers templates", () => {
    expect(ids.length).toBeGreaterThan(50);
  });

  it("colorProps: every colour-looking prop declares isColor + colorPicker", () => {
    expect(report("colorProps", (t) => auditColorProps(t))).toEqual([]);
  });

  it("noLocalPaths: no default is an absolute filesystem path", () => {
    expect(report("noLocalPaths", (t) => auditNoLocalPaths(t))).toEqual([]);
  });

  it("defaultsValidate: every template's defaults pass its own schema (required inputs excepted)", () => {
    expect(report("defaultsValidate", (t) => auditDefaultsValidate(t))).toEqual([]);
  });

  it("browseSurface: every template has a description and a tag", () => {
    expect(report("browseSurface", (t) => auditBrowseSurface(t))).toEqual([]);
  });

  it(`propLabels: unlabelled knobs only ratchet down (≤ ${PROP_LABELS_RATCHET})`, () => {
    const missing = ids.flatMap((id) => auditPropLabels(getTemplate(id)!).map((v) => `${id}::${v.key}`));
    expect(missing.length).toBeLessThanOrEqual(PROP_LABELS_RATCHET);
  });

  it("recorded no first-party ERROR finding", () => {
    expect(listTemplateConventionFindings().filter((f) => !f.external && f.severity === "error")).toEqual([]);
  });
});
