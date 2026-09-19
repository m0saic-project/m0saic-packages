import { TEMPLATE_REPO_DEP_ALLOWLIST } from "./depAllowlist";

describe("TEMPLATE_REPO_DEP_ALLOWLIST", () => {
  it("carries the substrate packages every template needs", () => {
    for (const pkg of [
      "@m0saic/types",
      "@m0saic/template-utils",
      "@m0saic/dsl-stdlib",
    ]) {
      expect(TEMPLATE_REPO_DEP_ALLOWLIST.packages).toContain(pkg);
    }
  });

  it("ships only what the hosts ship — no native or third-party runtime deps", () => {
    // Founder ruling 2026-09-16: `sharp` / `@twemoji/svg` left with the
    // defunct community-m pack; adding any non-@m0saic package back is a
    // founder decision, not a per-PR change.
    for (const pkg of TEMPLATE_REPO_DEP_ALLOWLIST.packages) {
      expect(pkg.startsWith("@m0saic/")).toBe(true);
    }
    expect(TEMPLATE_REPO_DEP_ALLOWLIST.packages).not.toContain("sharp");
    expect(TEMPLATE_REPO_DEP_ALLOWLIST.packages).not.toContain("@twemoji/svg");
  });

  it("has no duplicate entries", () => {
    const all = [
      ...TEMPLATE_REPO_DEP_ALLOWLIST.packages,
      ...TEMPLATE_REPO_DEP_ALLOWLIST.builtins,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("never allowlists the moat", () => {
    expect(TEMPLATE_REPO_DEP_ALLOWLIST.packages).not.toContain("@m0saic/core");
    expect(TEMPLATE_REPO_DEP_ALLOWLIST.packages).not.toContain("@m0saic/cli");
    expect(TEMPLATE_REPO_DEP_ALLOWLIST.packages).not.toContain("@m0saic/product");
  });
});
