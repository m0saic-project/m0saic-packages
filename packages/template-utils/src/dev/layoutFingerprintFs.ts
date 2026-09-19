/**
 * Layout fingerprints on disk — the node-only half (locate / read / write /
 * check). Lives under `dev/` so the root barrel, which the web bundle walks,
 * never sees `node:fs`. Consumers: every repo's `tools/check-registry.mjs`
 * and `m0saic doctor`, via `@m0saic/template-utils/dist/dev`.
 *
 * Placement is decided by the FOLDER's existence, never by the file's, so a
 * fingerprint cannot silently live in two places: the sidecar
 * `<srcRoot>/<pack>/<slug>/vN/<slug>.layout.m0` when the id maps to a source
 * folder, else the central `layout-fingerprints/<key>.m0`. A sidecar write
 * removes a stale central copy (that is the migration).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { LayoutFingerprint, TemplateConventionFinding } from "../template";
import {
  LAYOUT_FINGERPRINTS_DIR,
  layoutFingerprintFileName,
  layoutFingerprintFiles,
  layoutFingerprintFinding,
  layoutFingerprintKey,
  layoutFingerprintSidecar,
  parseLayoutFingerprintFile,
} from "../template";

export type LayoutFingerprintOptions = {
  /** Where template sources live, relative to the root (`src` in the
   *  starters, `src/m0saic` in the m0saic core). */
  srcRoot?: string;
};

export type LayoutFingerprintLocation = {
  /** Absolute folder the file(s) live in. */
  dir: string;
  /** File base: `<slug>.layout` next to the source, `<key>` centrally. */
  base: string;
  /** True when the fingerprint sits next to the template source. */
  sidecar: boolean;
};

/** Where a template's fingerprint lives: the sidecar folder when it exists, else the central folder. */
export function layoutFingerprintLocation(root: string, templateId: string, opts: LayoutFingerprintOptions = {}): LayoutFingerprintLocation {
  const sidecar = layoutFingerprintSidecar(templateId);
  if (sidecar) {
    const dir = path.join(root, opts.srcRoot ?? "src", ...sidecar.segments);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return { dir, base: sidecar.base, sidecar: true };
  }
  return { dir: path.join(root, LAYOUT_FINGERPRINTS_DIR), base: layoutFingerprintKey(templateId), sidecar: false };
}

/** Read every file of a template's fingerprint (`base.m0`, `base.step2.m0`, …). Null when the primary is absent. */
export function readLayoutFingerprint(
  root: string,
  templateId: string,
  opts: LayoutFingerprintOptions = {},
): { docs: string[]; size: { width: number; height: number } | null; location: LayoutFingerprintLocation } | null {
  const location = layoutFingerprintLocation(root, templateId, opts);
  if (!fs.existsSync(path.join(location.dir, layoutFingerprintFileName(location.base, 0)))) return null;
  const docs: string[] = [];
  let size: { width: number; height: number } | null = null;
  for (let i = 0; ; i++) {
    const file = path.join(location.dir, layoutFingerprintFileName(location.base, i));
    if (!fs.existsSync(file)) break;
    const parsed = parseLayoutFingerprintFile(fs.readFileSync(file, "utf8"));
    if (i === 0) size = parsed.size;
    docs.push(parsed.m0);
  }
  return { docs, size, location };
}

/**
 * Write a fingerprint at its location, creating the folder. Returns how many
 * files changed on disk (0 = the re-mint was a no-op). Drops a stale
 * `.stepN.m0` a shrunken pipeline left behind, and a central copy a sidecar
 * supersedes.
 */
export function writeLayoutFingerprint(root: string, templateId: string, layout: LayoutFingerprint, opts: LayoutFingerprintOptions = {}): number {
  const location = layoutFingerprintLocation(root, templateId, opts);
  fs.mkdirSync(location.dir, { recursive: true });
  let changed = 0;
  for (const { name, content } of layoutFingerprintFiles(templateId, layout, location.base)) {
    const file = path.join(location.dir, name);
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (before !== content) {
      fs.writeFileSync(file, content);
      changed++;
    }
  }
  for (let i = layout.docs.length; ; i++) {
    const stale = path.join(location.dir, layoutFingerprintFileName(location.base, i));
    if (!fs.existsSync(stale)) break;
    fs.unlinkSync(stale);
    changed++;
  }
  if (location.sidecar) {
    const central = path.join(root, LAYOUT_FINGERPRINTS_DIR);
    for (let i = 0; ; i++) {
      const stale = path.join(central, layoutFingerprintFileName(layoutFingerprintKey(templateId), i));
      if (!fs.existsSync(stale)) break;
      fs.unlinkSync(stale);
      changed++;
    }
    if (fs.existsSync(central) && fs.readdirSync(central).length === 0) fs.rmdirSync(central);
  }
  return changed;
}

/** Compare a committed fingerprint with the current layout: `"missing"`, `null` (identical), or the finding. */
export function checkLayoutFingerprint(
  root: string,
  templateId: string,
  layout: LayoutFingerprint,
  external = false,
  opts: LayoutFingerprintOptions = {},
): "missing" | TemplateConventionFinding | null {
  const stored = readLayoutFingerprint(root, templateId, opts);
  if (!stored) return "missing";
  return layoutFingerprintFinding(templateId, stored.docs.join("\n"), layout.docs.join("\n"), external);
}
