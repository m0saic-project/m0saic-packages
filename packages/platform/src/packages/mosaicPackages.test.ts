import { MOSAIC_PACKAGE_TIER_LABEL, MOSAIC_PACKAGE_TIER_ORDER, describeMosaicPackage, sortMosaicPackages } from "./mosaicPackages";

describe("describeMosaicPackage", () => {
  it("places the language packages in their own repo", () => {
    const d = describeMosaicPackage("@m0saic/dsl-stdlib");
    expect(d.tier).toBe("language");
    expect(d.published).toBe(true);
    expect(d.repoUrl).toMatch(/m0saic-dsl\/m0$/);
    expect(d.npmUrl).toBe("https://www.npmjs.com/package/@m0saic/dsl-stdlib");
  });

  it("places the lockstep set in the substrate repo", () => {
    for (const n of ["types", "platform", "template-utils", "templates", "text", "dictionary", "dsl-react", "knowledge"]) {
      const d = describeMosaicPackage(`@m0saic/${n}`);
      expect(d.tier).toBe("substrate");
      expect(d.repoUrl).toMatch(/m0saic-packages$/);
    }
  });

  it("⭐ the community catalog is its own tier — each package IS its repo, and GitHub is the transport", () => {
    const t = describeMosaicPackage("@m0saic/community-templates");
    expect(t.tier).toBe("community");
    expect(t.published).toBe(true);
    expect(t.repoUrl).toBe("https://github.com/m0saic-project/m0saic-community-templates");
    expect(t.npmUrl).toBeUndefined(); // the npm copy lags by design — never the link a reader should follow

    const m = describeMosaicPackage("@m0saic/community-m");
    expect(m.tier).toBe("community");
    expect(m.repoUrl).toBe("https://github.com/m0saic-project/community-m");
    expect(m.npmUrl).toBeUndefined();
  });

  it("⭐ the MOAT links nowhere rather than to a 404", () => {
    for (const n of ["core", "cli", "product", "types-internal", "momo", "sandbox"]) {
      const d = describeMosaicPackage(`@m0saic/${n}`);
      expect(d.published).toBe(false);
      expect(d.npmUrl).toBeUndefined();
      expect(d.repoUrl).toBeUndefined();
    }
  });

  it("handles a bare name as well as a scoped one", () => {
    expect(describeMosaicPackage("dsl").tier).toBe("language");
    expect(describeMosaicPackage("community-m").tier).toBe("community");
  });

  it("sorts by tier then name, so a reader scans language → substrate → product → community", () => {
    const sorted = sortMosaicPackages([
      { name: "@m0saic/community-templates" }, { name: "@m0saic/platform" }, { name: "@m0saic/core" },
      { name: "@m0saic/dsl" }, { name: "@m0saic/types" }, { name: "@m0saic/community-m" },
    ]);
    expect(sorted.map((p) => p.name)).toEqual([
      "@m0saic/dsl", "@m0saic/platform", "@m0saic/types", "@m0saic/core",
      "@m0saic/community-m", "@m0saic/community-templates",
    ]);
    expect(MOSAIC_PACKAGE_TIER_ORDER).toEqual(["language", "substrate", "product", "community"]);
  });

  it("every tier has a label", () => {
    for (const tier of MOSAIC_PACKAGE_TIER_ORDER) expect(MOSAIC_PACKAGE_TIER_LABEL[tier]).toBeTruthy();
  });
});
