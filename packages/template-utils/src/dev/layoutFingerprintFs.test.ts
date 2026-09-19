import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { LayoutFingerprint } from "../template";
import { fingerprintHash } from "../template";
import { checkLayoutFingerprint, layoutFingerprintLocation, readLayoutFingerprint, writeLayoutFingerprint } from "./layoutFingerprintFs";

const fp = (docs: string[]): LayoutFingerprint => {
  const m0 = docs.join("\n");
  return { canvas: { width: 1280, height: 720 }, docs, m0, hash: fingerprintHash(m0), chars: m0.length, frames: 0 };
};
const ID = "@x/pack/slug/v1";

describe("layout fingerprints on disk — sidecar to the template, central fallback", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-fp-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lives next to the source when the id maps to a folder, centrally otherwise", () => {
    expect(layoutFingerprintLocation(root, ID)).toMatchObject({ dir: path.join(root, "layout-fingerprints"), base: "x__pack__slug__v1", sidecar: false });
    fs.mkdirSync(path.join(root, "src/pack/slug/v1"), { recursive: true });
    expect(layoutFingerprintLocation(root, ID)).toMatchObject({ dir: path.join(root, "src/pack/slug/v1"), base: "slug.layout", sidecar: true });
    fs.mkdirSync(path.join(root, "src/m0saic/charts/donut/v3"), { recursive: true });
    expect(layoutFingerprintLocation(root, "@m0saic/charts/donut/v3", { srcRoot: "src/m0saic" }).sidecar).toBe(true);
    expect(layoutFingerprintLocation(root, "@m0saic/charts/bar-graph/internal/bar-cell/v1", { srcRoot: "src/m0saic" }).sidecar).toBe(false);
  });

  it("round-trips as a sidecar, drops a stale step file, compares, and reports 'missing' for an unknown id", () => {
    fs.mkdirSync(path.join(root, "src/pack/slug/v1"), { recursive: true });
    expect(writeLayoutFingerprint(root, ID, fp(["2[1,1]", "3[1,1,1]"]))).toBe(2);
    expect(fs.existsSync(path.join(root, "src/pack/slug/v1/slug.layout.m0"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/pack/slug/v1/slug.layout.step2.m0"))).toBe(true);
    expect(writeLayoutFingerprint(root, ID, fp(["2[1,1]", "3[1,1,1]"]))).toBe(0);
    expect(readLayoutFingerprint(root, ID)).toMatchObject({ docs: ["2[1,1]", "3[1,1,1]"], size: { width: 1280, height: 720 }, location: { sidecar: true } });
    expect(checkLayoutFingerprint(root, ID, fp(["2[1,1]", "3[1,1,1]"]))).toBeNull();
    expect(checkLayoutFingerprint(root, ID, fp(["2[1,1]", "4[1,1,1,1]"]))).toMatchObject({ convention: "layoutFingerprint", severity: "error" });
    // primary rewritten (note no longer says "document 1 of 2") + stale step removed
    expect(writeLayoutFingerprint(root, ID, fp(["2[1,1]"]))).toBe(2);
    expect(fs.existsSync(path.join(root, "src/pack/slug/v1/slug.layout.step2.m0"))).toBe(false);
    expect(checkLayoutFingerprint(root, "@x/pack/other/v1", fp(["2[1,1]"]))).toBe("missing");
  });

  it("migrates: a sidecar write removes the stale central copy and an emptied central folder", () => {
    expect(writeLayoutFingerprint(root, ID, fp(["2[1,1]"]))).toBe(1);
    expect(fs.existsSync(path.join(root, "layout-fingerprints/x__pack__slug__v1.m0"))).toBe(true);
    fs.mkdirSync(path.join(root, "src/pack/slug/v1"), { recursive: true });
    expect(writeLayoutFingerprint(root, ID, fp(["2[1,1]"]))).toBe(2);
    expect(fs.existsSync(path.join(root, "src/pack/slug/v1/slug.layout.m0"))).toBe(true);
    expect(fs.existsSync(path.join(root, "layout-fingerprints"))).toBe(false);
  });
});
