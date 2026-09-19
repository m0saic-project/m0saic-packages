import * as kit from "./index";
import * as brand from "../index";
import * as root from "../../index";

describe("onboarding-cover kit barrel", () => {
  it("exposes the assembler and the composition helpers", () => {
    expect(typeof kit.buildBrandedCover).toBe("function");
    expect(typeof kit.brandedCoverHeroBox).toBe("function");
    expect(typeof kit.inlineHeroDoc).toBe("function");
    expect(typeof kit.onboardingSplit).toBe("function");
    expect(typeof kit.onboardingTextBlock).toBe("function");
    expect(typeof kit.onboardingBrandRow).toBe("function");
    expect(kit.ONBOARDING_THEME.accent).toBe("#EF7525");
  });

  it("keeps the screencap-grid renders and the presets private", () => {
    const names = Object.keys(kit);
    expect(names).not.toContain("renderScreencapGridV2Cover");
    expect(names).not.toContain("renderScreencapGridV2Tutorial");
    expect(names).not.toContain("THEME_PRESETS");
    expect(names).not.toContain("resolveTheme");
  });

  it("reaches the package surface through brand/ and the root barrel", () => {
    expect(brand.buildBrandedCover).toBe(kit.buildBrandedCover);
    expect(root.buildBrandedCover).toBe(kit.buildBrandedCover);
    expect(root.onboardingTypeRamp).toBe(kit.onboardingTypeRamp);
  });
});
