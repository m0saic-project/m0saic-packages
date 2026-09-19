import {
  M0SAIC_TMP_PREFIX,
  makeM0saicTempPrefix,
  isM0saicTempName,
} from "./tempPrefix";

describe("M0SAIC_TMP_PREFIX", () => {
  it("is the bracketed sentinel", () => {
    expect(M0SAIC_TMP_PREFIX).toBe("[m0saic]_");
  });
});

describe("makeM0saicTempPrefix", () => {
  it("concatenates prefix + descriptor + trailing dash", () => {
    expect(makeM0saicTempPrefix("qr-test")).toBe("[m0saic]_qr-test-");
    expect(makeM0saicTempPrefix("make")).toBe("[m0saic]_make-");
    expect(makeM0saicTempPrefix("workspace")).toBe("[m0saic]_workspace-");
  });

  it("accepts alphanumeric, dash, underscore", () => {
    expect(makeM0saicTempPrefix("foo_bar-baz1")).toBe("[m0saic]_foo_bar-baz1-");
  });

  it("rejects empty descriptors", () => {
    expect(() => makeM0saicTempPrefix("")).toThrow(/descriptor must match/);
  });

  it("rejects descriptors starting with non-alphanumeric", () => {
    expect(() => makeM0saicTempPrefix("-foo")).toThrow(/descriptor must match/);
    expect(() => makeM0saicTempPrefix("_foo")).toThrow(/descriptor must match/);
  });

  it("rejects descriptors with whitespace or path separators", () => {
    expect(() => makeM0saicTempPrefix("foo bar")).toThrow(/descriptor must match/);
    expect(() => makeM0saicTempPrefix("foo/bar")).toThrow(/descriptor must match/);
    expect(() => makeM0saicTempPrefix("foo\\bar")).toThrow(/descriptor must match/);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error testing runtime guard
    expect(() => makeM0saicTempPrefix(undefined)).toThrow(/descriptor must match/);
    // @ts-expect-error testing runtime guard
    expect(() => makeM0saicTempPrefix(42)).toThrow(/descriptor must match/);
  });
});

describe("isM0saicTempName", () => {
  it("matches names starting with the prefix", () => {
    expect(isM0saicTempName("[m0saic]_make-abc123")).toBe(true);
    expect(isM0saicTempName("[m0saic]_previews")).toBe(true);
    expect(isM0saicTempName("[m0saic]_qr-test-Xy7q9F")).toBe(true);
  });

  it("rejects names without the prefix", () => {
    expect(isM0saicTempName("m0saic-make-abc")).toBe(false); // legacy unbracketed
    expect(isM0saicTempName("brandQrV1-test-LcWn")).toBe(false);
    expect(isM0saicTempName("qr-test-abc")).toBe(false);
    expect(isM0saicTempName("[other]_thing")).toBe(false);
  });

  it("handles non-string input safely", () => {
    // @ts-expect-error testing runtime guard
    expect(isM0saicTempName(undefined)).toBe(false);
    // @ts-expect-error testing runtime guard
    expect(isM0saicTempName(null)).toBe(false);
  });
});
