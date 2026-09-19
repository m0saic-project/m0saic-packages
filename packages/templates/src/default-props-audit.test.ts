/**
 * Registry-wide "a knob shows what it does" lock (founder ruling 2026-09-05,
 * gate 33): every optional boolean / closed-set knob of every first-party
 * template carries a `defaultProps` value, and every plain string/number knob a
 * default or a `control.placeholder` — so an editor never shows OFF / empty /
 * "—" for a value the render fills in. See `@m0saic/template-utils`
 * `auditDefaultProps` for the exact rule.
 *
 * The convention is ENFORCED inside `defineMosaicTemplate`: a first-party
 * template that hides a default THROWS at registration, so importing the
 * registry below is itself the gate (the throw surfaces as an import failure
 * naming the template and the knobs). The assertions restate the guarantee in
 * a readable report and confirm no finding was recorded for a first-party id.
 * The 76 pre-contract templates were migrated on 2026-09-05; there is no
 * legacy escape.
 */
import {
  auditDefaultProps,
  getTemplate,
  listRegisteredTemplateIds,
  listTemplateConventionFindings,
} from "@m0saic/template-utils";

import "./m0saic"; // side-effect: register every template (conventions fire here)

describe("default-props contract — every optional knob shows its effective default", () => {
  const ids = listRegisteredTemplateIds().map(String).sort();

  it("registers templates", () => {
    expect(ids.length).toBeGreaterThan(50);
  });

  it("holds for every registered template", () => {
    const report: string[] = [];
    for (const id of ids) {
      const v = auditDefaultProps(getTemplate(id)!);
      if (v.length) report.push(`${id}\n${v.map((x) => `    • ${x.key} (${x.type}) → ${x.fix}: ${x.detail}`).join("\n")}`);
    }
    expect(report).toEqual([]);
  });

  it("recorded no first-party ERROR finding (throw-posture violations throw; record-posture ones are warnings)", () => {
    expect(listTemplateConventionFindings().filter((f) => !f.external && f.severity === "error")).toEqual([]);
  });
});
