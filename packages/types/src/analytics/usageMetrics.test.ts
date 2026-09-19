import {
  FEATURE_KEY_SHAPE_RE,
  FIRST_PARTY_TEMPLATE_ID_RE,
  isFeatureKeyShaped,
} from "./usageMetrics";

describe("feature-key shape rule", () => {
  it("accepts dotted lower-case keys of 2–4 segments", () => {
    for (const k of ["session.start", "page.make", "template.open.builtin", "cli.command.make_wireframe_animated", "a.b.c.d"]) {
      expect(isFeatureKeyShaped(k)).toBe(true);
    }
  });
  it("rejects anything that could carry data", () => {
    for (const k of [
      "page", // one segment
      "a.b.c.d.e", // five segments
      "Page.make",
      "page.make/",
      "page.Make",
      "page.make ",
      "page.-x",
      "page.make.@m0saic/hero/v1",
      "/Users/me/file.mp4",
      "x".repeat(41) + ".y",
      "",
      42,
      null,
    ]) {
      expect(isFeatureKeyShaped(k)).toBe(false);
    }
    expect(FEATURE_KEY_SHAPE_RE.test("1page.make")).toBe(false);
  });
});

describe("first-party template id shape", () => {
  it("matches catalog ids and nothing foreign", () => {
    expect(FIRST_PARTY_TEMPLATE_ID_RE.test("@m0saic/hero/github/v1")).toBe(true);
    expect(FIRST_PARTY_TEMPLATE_ID_RE.test("@m0saic/story/scrapbook/v1")).toBe(true);
    expect(FIRST_PARTY_TEMPLATE_ID_RE.test("@m0saic/demos/v12")).toBe(true);
    expect(FIRST_PARTY_TEMPLATE_ID_RE.test("@m0saic-dev/hero/x/v1")).toBe(false);
    expect(FIRST_PARTY_TEMPLATE_ID_RE.test("@evil/x/v1")).toBe(false);
    expect(FIRST_PARTY_TEMPLATE_ID_RE.test("@m0saic/hero/x")).toBe(false);
    expect(FIRST_PARTY_TEMPLATE_ID_RE.test("@m0saic/hero/x/v1/extra/deeper/too/v1")).toBe(false);
  });
});
