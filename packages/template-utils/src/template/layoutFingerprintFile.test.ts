import type { LayoutFingerprint } from "./auditRenderedTemplate";
import { fingerprintHash } from "./auditRenderedTemplate";
import {
  layoutFingerprintFileName,
  layoutFingerprintFiles,
  layoutFingerprintKey,
  layoutFingerprintSidecar,
  parseLayoutFingerprintFile,
} from "./layoutFingerprintFile";

const fp = (docs: string[]): LayoutFingerprint => {
  const m0 = docs.join("\n");
  return { canvas: { width: 1280, height: 720 }, docs, m0, hash: fingerprintHash(m0), chars: m0.length, frames: 0 };
};
const ID = "@x/pack/slug/v1";

describe("layout fingerprint files — the browser-safe format half", () => {
  it("derives the key, the sidecar path segments and the file names from the id", () => {
    expect(layoutFingerprintKey(ID)).toBe("x__pack__slug__v1");
    expect(layoutFingerprintSidecar(ID)).toEqual({ segments: ["pack", "slug", "v1"], base: "slug.layout" });
    expect(layoutFingerprintSidecar("@m0saic/charts/bar-graph/internal/bar-cell/v1")).toEqual({ segments: ["charts", "bar-graph", "internal", "bar-cell", "v1"], base: "bar-cell.layout" });
    expect(layoutFingerprintSidecar("@x/odd-shape")).toBeNull();
    expect(layoutFingerprintFileName("slug.layout")).toBe("slug.layout.m0");
    expect(layoutFingerprintFileName("slug.layout", 1)).toBe("slug.layout.step2.m0");
    expect(layoutFingerprintFiles(ID, fp(["2[1,1]", "3[1,1,1]"]), "slug.layout").map((f) => f.name)).toEqual(["slug.layout.m0", "slug.layout.step2.m0"]);
  });

  it("writes a real .m0: header with the canvas and the template id, canonical payload; re-minting is byte-stable", () => {
    const [f] = layoutFingerprintFiles(ID, fp(["2[1,1]"]), "slug.layout");
    expect(f.content).toMatch(/^# m0\n# version: 1\n# created: 2026-01-01T00:00:00\.000Z\n# size: 1280x720\n/);
    expect(f.content).toMatch(/# title: @x\/pack\/slug\/v1\n/);
    expect(f.content.trimEnd().endsWith("2[1,1]")).toBe(true);
    expect(layoutFingerprintFiles(ID, fp(["2[1,1]"]), "slug.layout")[0].content).toBe(f.content);
    expect(parseLayoutFingerprintFile(f.content)).toEqual({ size: { width: 1280, height: 720 }, m0: "2[1,1]" });
  });
});
