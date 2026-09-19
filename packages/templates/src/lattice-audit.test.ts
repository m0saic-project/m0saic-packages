/**
 * Registry-wide lock for the `latticeSmooth` convention (throw posture since
 * 2026-09-16; plan `.ai/proposed-plans/lattice-convention.md`): every split
 * count above {@link LATTICE_SMALL_BASIS} in every template's flattened layout
 * is 5-smooth (2ᵃ·3ᵇ·5ᶜ), so any two templates compose at a small LCM and no
 * cell ever inherits a rough factor (handbook `composition-arithmetic.md`).
 *
 * The committed layout fingerprints (`<slug>.layout.m0` sidecars: the
 * flattened layout at the hinted canvas, child m0 spliced verbatim) are the
 * evidence, read straight off disk — no render for a template whose flattened
 * layout is clean, which is the fleet. The build gate (`tools/check-registry.mjs`)
 * measures the same rule on a fresh render, at the hinted canvas and on the
 * standard sweep canvases; this test is the cheap, deterministic half that
 * fails in jest before a stale sidecar or a new offender reaches the gate.
 *
 * Exemptions are the convention's own: `lattice.mode: "bitmap"` (a baked
 * raster, never live-composed), `lattice.allow` (content cardinality above 12,
 * with its reason) and `lattice.canvas: "physical"` (a print size the template
 * cannot move — counts the canvas hands down are charged to it, not to the
 * construction). One exemption the flattened string cannot show is a nested
 * document declared bitmap per document (`engine.lattice.mode`, the business
 * card's QR child): a template whose sidecar is rough is therefore re-measured
 * by the audit itself — one render, exactly the gate's reading — and is an
 * offender only if that agrees. Deprecated templates are held to the rule too:
 * the kit fix reaches them, and a deprecated child (the hero beats still nest
 * the absolute alpine v1s) poisons its parent all the same.
 */
import fs from "node:fs";
import path from "node:path";

import {
  LATTICE_SMALL_BASIS,
  auditRenderedTemplate,
  getTemplate,
  latticeViolations,
  layoutFingerprintFileName,
  layoutFingerprintSidecar,
  listRegisteredTemplateIds,
  parseLayoutFingerprintFile,
} from "@m0saic/template-utils";

import "./m0saic"; // side-effect: register every template

const SRC_ROOT = path.join(__dirname, "m0saic");

/** The committed fingerprint of a template: every document's flattened m0 + the hinted size. */
function readSidecar(id: string): { docs: string[]; size: { width: number; height: number } | null } | null {
  const sidecar = layoutFingerprintSidecar(id);
  if (!sidecar) return null;
  const dir = path.join(SRC_ROOT, ...sidecar.segments);
  const docs: string[] = [];
  let size: { width: number; height: number } | null = null;
  for (let i = 0; ; i++) {
    const file = path.join(dir, layoutFingerprintFileName(sidecar.base, i));
    if (!fs.existsSync(file)) break;
    const parsed = parseLayoutFingerprintFile(fs.readFileSync(file, "utf8"));
    if (i === 0) size = parsed.size;
    docs.push(parsed.m0);
  }
  return docs.length ? { docs, size } : null;
}

describe(`latticeSmooth — every split count > ${LATTICE_SMALL_BASIS} in every committed layout is 5-smooth`, () => {
  const ids = listRegisteredTemplateIds().map(String).sort();
  const measured: string[] = [];
  const bitmap: string[] = [];
  const unfingerprinted: string[] = [];
  /** Rough on the sidecar → re-measured by the audit (per-document exemptions). */
  const suspects: Array<{ id: string; sidecar: string[] }> = [];

  for (const id of ids) {
    const t = getTemplate(id)!;
    if (t.lattice?.mode === "bitmap") { bitmap.push(id); continue; }
    const fp = readSidecar(id);
    if (!fp) { unfingerprinted.push(id); continue; }
    measured.push(id);
    const violations = latticeViolations(fp.docs, {
      canvas: fp.size ?? undefined,
      allow: t.lattice?.allow?.map((a) => a.count),
      physicalCanvas: t.lattice?.canvas === "physical",
    });
    if (violations.length) suspects.push({ id, sidecar: violations.map((v) => v.detail) });
  }

  const describeId = (id: string): string => `${id}${getTemplate(id)!.deprecated ? " (deprecated)" : ""}`;

  it("reads the fleet's fingerprints (the gate mints one per rendered template)", () => {
    expect(measured.length).toBeGreaterThan(50);
    // Capability-tier templates (no render at defaults) have no sidecar; a
    // registered template that SHOULD have one is the fingerprint gate's job.
    expect(unfingerprinted.length).toBeLessThan(ids.length / 4);
  });

  it("bitmap-mode templates are the baked rasters, declared as such", () => {
    expect(bitmap.every((id) => /\/(qr|logo|barcode|community-m|qr-stamp)/.test(id))).toBe(true);
  });

  it("almost every template is clean on its sidecar alone (the rest re-render below)", () => {
    // Today: the business card (its QR child is bitmap per document). A
    // growing list here means flattened layouts are going rough — look.
    expect(suspects.map((s) => s.id)).toEqual(["@m0saic/brand/business-card/v1"]);
  });

  it("no template — deprecated ones included — carries a rough split count above the small basis", async () => {
    const offenders: string[] = [];
    for (const { id, sidecar } of suspects) {
      const audit = await auditRenderedTemplate(getTemplate(id)!, { record: false });
      if (audit.skipped) offenders.push(`${describeId(id)} — sidecar rough and the audit skipped it (${audit.skipped})\n${sidecar.map((d) => `    • ${d}`).join("\n")}`);
      for (const f of audit.findings.filter((x) => x.convention === "latticeSmooth")) {
        offenders.push(`${describeId(id)}\n${f.violations.map((v) => `    • ${v.detail}`).join("\n")}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 120_000);
});
