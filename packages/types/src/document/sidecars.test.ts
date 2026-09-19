import {
  SIDECAR_EXT_PATTERN,
  STEP_OUTPUT_TOKEN_RE,
  isMosaicTextSidecar,
  isValidSidecarExt,
  stepOutputToken,
} from "./sidecars";

// covers: T:sidecars.MosaicTextSidecar, T:sidecars.SIDECAR_EXT_PATTERN,
//         T:sidecars.isMosaicTextSidecar, T:sidecars.isValidSidecarExt,
//         T:sidecars.stepOutputToken, T:sidecars.STEP_OUTPUT_TOKEN_RE
describe("isMosaicTextSidecar", () => {
  it("accepts the canonical shape", () => {
    expect(
      isMosaicTextSidecar({ kind: "text", ext: "vtt", content: "WEBVTT\n" }),
    ).toBe(true);
  });

  it("accepts empty content (a valid, if useless, text file)", () => {
    expect(isMosaicTextSidecar({ kind: "text", ext: "txt", content: "" })).toBe(
      true,
    );
  });

  it("rejects non-objects and null", () => {
    expect(isMosaicTextSidecar(null)).toBe(false);
    expect(isMosaicTextSidecar(undefined)).toBe(false);
    expect(isMosaicTextSidecar("WEBVTT")).toBe(false);
    expect(isMosaicTextSidecar(42)).toBe(false);
  });

  it("rejects wrong discriminant or missing/mistyped fields", () => {
    expect(isMosaicTextSidecar({ kind: "json", ext: "vtt", content: "" })).toBe(
      false,
    );
    expect(isMosaicTextSidecar({ kind: "text", content: "x" })).toBe(false);
    expect(isMosaicTextSidecar({ kind: "text", ext: "vtt" })).toBe(false);
    expect(
      isMosaicTextSidecar({ kind: "text", ext: 7, content: "x" }),
    ).toBe(false);
    expect(
      isMosaicTextSidecar({ kind: "text", ext: "vtt", content: 7 }),
    ).toBe(false);
  });

  it("is structural only — does NOT validate the ext pattern", () => {
    // The writer validates ext separately so it can report a bad ext.
    expect(
      isMosaicTextSidecar({ kind: "text", ext: "b/../ad", content: "x" }),
    ).toBe(true);
  });
});

describe("isValidSidecarExt / SIDECAR_EXT_PATTERN", () => {
  it("accepts 1-8 alphanumerics", () => {
    for (const ext of ["vtt", "srt", "VTT", "a", "a1", "markdown".slice(0, 8)]) {
      expect(isValidSidecarExt(ext)).toBe(true);
    }
  });

  it("rejects empty, dotted, slashed, oversized, and non-string values", () => {
    for (const ext of ["", "v.t", "a/b", "a\\b", ".vtt", "vtt ", "abcdefghi", "a-b"]) {
      expect(isValidSidecarExt(ext)).toBe(false);
    }
    expect(isValidSidecarExt(undefined)).toBe(false);
    expect(isValidSidecarExt(7)).toBe(false);
  });

  it("pattern anchors both ends (no partial matches)", () => {
    expect(SIDECAR_EXT_PATTERN.test("vtt\njson")).toBe(false);
  });
});

describe("stepOutputToken / STEP_OUTPUT_TOKEN_RE", () => {
  it("round-trips: built token parses back to the step name", () => {
    const token = stepOutputToken("movie__sheet_01");
    const matches = [...token.matchAll(STEP_OUTPUT_TOKEN_RE)];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("movie__sheet_01");
  });

  it("finds every token in mixed content via matchAll", () => {
    const s = `WEBVTT\n\n${stepOutputToken("a_1")}#xywh=0,0,320,180\n${stepOutputToken("b_2")}#xywh=320,0,320,180\n`;
    const names = [...s.matchAll(STEP_OUTPUT_TOKEN_RE)].map((m) => m[1]);
    expect(names).toEqual(["a_1", "b_2"]);
  });

  it("substitutes with String.replace and the shared global regex", () => {
    const s = `${stepOutputToken("x")} and ${stepOutputToken("x")}`;
    const out = s.replace(STEP_OUTPUT_TOKEN_RE, (_m, name) => `${name}.png`);
    expect(out).toBe("x.png and x.png");
  });

  it("round-trips slugified filenames with hyphens and dots (buildStepNames output)", () => {
    const token = stepOutputToken("my-movie.v2__sheet_01");
    const matches = [...token.matchAll(STEP_OUTPUT_TOKEN_RE)];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("my-movie.v2__sheet_01");
  });

  it("throws on step names the grammar cannot round-trip", () => {
    for (const bad of ["", "-leading", ".leading", "a b", "a/b", "{{x}}", "é"]) {
      expect(() => stepOutputToken(bad)).toThrow(TypeError);
    }
  });

  it("does not match malformed tokens", () => {
    const s = "{{stepOutput:}} {{stepOutput:-ab}} {{steppOutput:ok}}";
    expect([...s.matchAll(STEP_OUTPUT_TOKEN_RE)]).toHaveLength(0);
  });
});
