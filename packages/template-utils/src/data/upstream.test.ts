// covers: upstream ctx reader helpers — hasUpstream / block readers /
// flat-union readers / publication lookups. Semantics under test:
// "no upstream threaded" stays distinguishable from "threaded but
// empty", and no helper transforms the producer's raw values.
import type { MosaicEngineContext, MosaicUpstreamPublication } from "@m0saic/types";
import {
  findUpstreamPublications,
  getUpstreamBlock,
  getUpstreamPublications,
  getUpstreamVariable,
  getUpstreamVariables,
  hasUpstream,
  hasUpstreamBlock,
  listUpstreamAliases,
  requireUpstreamBlock,
} from "./upstream";

function makeCtx(overrides: Partial<MosaicEngineContext> = {}): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 640, height: 360, fps: 30, durationMs: 1000, workspaceDir: "/tmp" },
    target: { width: 640, height: 360, fps: 30, durationMs: 1000 },
    media: {},
    ...overrides,
  } as MosaicEngineContext;
}

const PUBS = [
  { variables: { n: 1 }, alias: "athleteData", stepIndex: 0, templateId: "@t/fetcher/v1" },
  { variables: { n: 2 }, alias: "designTokens", tileStableKey: "r/fc0" },
  { variables: { n: 3 }, alias: "athleteData", tileStableKey: "r/fc1" },
] as unknown as MosaicUpstreamPublication[];

const THREADED = makeCtx({
  upstreamVariables: { dataset: "m0saic-fixture", count: 4 },
  upstreamData: {
    designTokens: { accent: "#e33" },
    athleteData: { name: "Eliud" },
  },
  upstreamPublications: PUBS,
} as Partial<MosaicEngineContext>);

describe("hasUpstream", () => {
  it("false for a standalone ctx, true once anything was threaded", () => {
    expect(hasUpstream(makeCtx())).toBe(false);
    expect(hasUpstream(THREADED)).toBe(true);
    // Threaded-but-empty still counts as upstream context.
    expect(
      hasUpstream(
        makeCtx({ upstreamVariables: {}, upstreamData: {} } as Partial<MosaicEngineContext>),
      ),
    ).toBe(true);
  });
});

describe("block readers", () => {
  it("getUpstreamBlock returns the raw block or undefined", () => {
    expect(getUpstreamBlock(THREADED, "athleteData")).toEqual({ name: "Eliud" });
    expect(getUpstreamBlock(THREADED, "missing")).toBeUndefined();
    expect(getUpstreamBlock(makeCtx(), "athleteData")).toBeUndefined();
  });

  it("hasUpstreamBlock mirrors getUpstreamBlock", () => {
    expect(hasUpstreamBlock(THREADED, "designTokens")).toBe(true);
    expect(hasUpstreamBlock(THREADED, "missing")).toBe(false);
  });

  it("requireUpstreamBlock returns the block or throws naming what WAS available", () => {
    expect(requireUpstreamBlock(THREADED, "athleteData")).toEqual({ name: "Eliud" });
    expect(() => requireUpstreamBlock(THREADED, "missing")).toThrow(
      /"missing".*available: athleteData, designTokens/,
    );
    expect(() => requireUpstreamBlock(makeCtx(), "athleteData")).toThrow(
      /no upstream data was threaded/,
    );
  });

  it("listUpstreamAliases is sorted and [] without upstream", () => {
    expect(listUpstreamAliases(THREADED)).toEqual(["athleteData", "designTokens"]);
    expect(listUpstreamAliases(makeCtx())).toEqual([]);
  });
});

describe("flat-union readers", () => {
  it("getUpstreamVariables preserves the absent-vs-empty distinction", () => {
    expect(getUpstreamVariables(THREADED)).toEqual({ dataset: "m0saic-fixture", count: 4 });
    expect(getUpstreamVariables(makeCtx())).toBeUndefined();
    expect(
      getUpstreamVariables(makeCtx({ upstreamVariables: {} } as Partial<MosaicEngineContext>)),
    ).toEqual({});
  });

  it("getUpstreamVariable reads one key, undefined when absent", () => {
    expect(getUpstreamVariable<string>(THREADED, "dataset")).toBe("m0saic-fixture");
    expect(getUpstreamVariable(THREADED, "nope")).toBeUndefined();
    expect(getUpstreamVariable(makeCtx(), "dataset")).toBeUndefined();
    // The idiomatic default pattern:
    expect(getUpstreamVariable<string>(makeCtx(), "accent") ?? "#e33").toBe("#e33");
  });
});

describe("publication lookups", () => {
  it("getUpstreamPublications returns the list verbatim, [] when absent", () => {
    expect(getUpstreamPublications(THREADED)).toBe(PUBS);
    expect(getUpstreamPublications(makeCtx())).toEqual([]);
  });

  it("findUpstreamPublications ANDs the supplied provenance fields", () => {
    expect(findUpstreamPublications(THREADED, { alias: "athleteData" })).toHaveLength(2);
    expect(
      findUpstreamPublications(THREADED, { alias: "athleteData", tileStableKey: "r/fc1" }),
    ).toEqual([PUBS[2]]);
    expect(findUpstreamPublications(THREADED, { stepIndex: 0 })).toEqual([PUBS[0]]);
    expect(findUpstreamPublications(THREADED, { templateId: "@t/fetcher/v1" })).toEqual([
      PUBS[0],
    ]);
    expect(findUpstreamPublications(THREADED, { alias: "nope" })).toEqual([]);
    expect(findUpstreamPublications(makeCtx(), {})).toEqual([]);
  });
});
