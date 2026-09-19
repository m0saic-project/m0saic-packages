// covers: @m0saic/meta/upstream-echo/v1 — upstream read + sidecar
// mirror, self-evidencing status card (green OK / red MISSING),
// standalone fallback, fail-fast color validation.
import type { MosaicDocument, MosaicEngineContext, MosaicTextSource } from "@m0saic/types";
import {
  UpstreamEcho,
  UPSTREAM_ECHO_MISSING_BG,
  UPSTREAM_ECHO_OK_BG,
} from "./upstream-echo";

function makeCtx(overrides: Partial<MosaicEngineContext> = {}): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 640, height: 360, fps: 30, durationMs: 1000, workspaceDir: "/tmp" },
    target: { width: 640, height: 360, fps: 30, durationMs: 1000 },
    media: {},
    ...overrides,
  } as MosaicEngineContext;
}

const UPSTREAM = {
  upstreamVariables: { dataset: "m0saic-fixture", version: 1 },
  upstreamData: {
    fixtureData: { dataset: "m0saic-fixture", version: 1, series: [3, 5, 8, 13] },
    other: { irrelevant: true },
  },
  upstreamPublications: [],
};

function textSourceOf(doc: MosaicDocument): MosaicTextSource {
  const src = doc.sources?.[0] as MosaicTextSource;
  expect(src?.type).toBe("text");
  return src;
}

function layerTexts(src: MosaicTextSource): string[] {
  return (src.layers ?? []).map((l) =>
    l.content?.kind === "literal" ? l.content.text : "",
  );
}

describe("@m0saic/meta/upstream-echo/v1", () => {
  it("renders the green OK card + block summary when the aliased block arrived", async () => {
    const doc = (await UpstreamEcho.render(
      { ...UpstreamEcho.defaultProps },
      makeCtx(UPSTREAM as Partial<MosaicEngineContext>),
    )) as MosaicDocument;

    const src = textSourceOf(doc);
    expect(src.visual?.backgroundColor).toBe(UPSTREAM_ECHO_OK_BG);
    const texts = layerTexts(src);
    expect(texts[0]).toBe("UPSTREAM OK");
    expect(texts).toContain("alias: fixtureData");
    expect(texts).toContain("block keys: dataset, series, version");
    expect(texts).toContain("flat union keys: 2");
  });

  it("mirrors the received upstream into sidecars byte-exactly", async () => {
    const doc = (await UpstreamEcho.render(
      { ...UpstreamEcho.defaultProps },
      makeCtx(UPSTREAM as Partial<MosaicEngineContext>),
    )) as MosaicDocument;

    expect(doc.sidecars).toEqual({
      upstreamEcho: {
        alias: "fixtureData",
        upstreamData: UPSTREAM.upstreamData.fixtureData,
        upstreamVariables: UPSTREAM.upstreamVariables,
      },
    });
  });

  it("selects the block by the alias prop", async () => {
    const doc = (await UpstreamEcho.render(
      { alias: "other" },
      makeCtx(UPSTREAM as Partial<MosaicEngineContext>),
    )) as MosaicDocument;

    expect((doc.sidecars as Record<string, { upstreamData: unknown }>).upstreamEcho.upstreamData).toEqual({
      irrelevant: true,
    });
    expect(layerTexts(textSourceOf(doc))[0]).toBe("UPSTREAM OK");
  });

  it("renders the red MISSING card when the alias has no block (standalone render)", async () => {
    const doc = (await UpstreamEcho.render(
      { ...UpstreamEcho.defaultProps },
      makeCtx(),
    )) as MosaicDocument;

    const src = textSourceOf(doc);
    expect(src.visual?.backgroundColor).toBe(UPSTREAM_ECHO_MISSING_BG);
    const texts = layerTexts(src);
    expect(texts[0]).toBe("UPSTREAM MISSING");
    expect(texts).toContain("available blocks: (none)");

    expect(doc.sidecars).toEqual({
      upstreamEcho: {
        alias: "fixtureData",
        upstreamData: null,
        upstreamVariables: null,
      },
    });
  });

  it("MISSING card lists which blocks WERE available under other aliases", async () => {
    const doc = (await UpstreamEcho.render(
      { alias: "wrongAlias" },
      makeCtx(UPSTREAM as Partial<MosaicEngineContext>),
    )) as MosaicDocument;

    const texts = layerTexts(textSourceOf(doc));
    expect(texts[0]).toBe("UPSTREAM MISSING");
    expect(texts).toContain("available blocks: fixtureData, other");
  });

  it("the color prop overrides the semantic background in both states", async () => {
    const okDoc = (await UpstreamEcho.render(
      { color: "#aabbcc" },
      makeCtx(UPSTREAM as Partial<MosaicEngineContext>),
    )) as MosaicDocument;
    expect(textSourceOf(okDoc).visual?.backgroundColor).toBe("#aabbcc");

    const missingDoc = (await UpstreamEcho.render(
      { color: "#aabbcc" },
      makeCtx(),
    )) as MosaicDocument;
    expect(textSourceOf(missingDoc).visual?.backgroundColor).toBe("#aabbcc");
  });

  it("is deterministic for identical inputs", async () => {
    const ctx = () => makeCtx(UPSTREAM as Partial<MosaicEngineContext>);
    const a = await UpstreamEcho.render({}, ctx());
    const b = await UpstreamEcho.render({}, ctx());
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it("fails fast on a malformed color", async () => {
    await expect(
      UpstreamEcho.render({ color: "blue" }, makeCtx()),
    ).rejects.toThrow(/#rrggbb/);
  });

  it("declares core tier + the upstream schemas the resolver guard reads", () => {
    expect(UpstreamEcho.capabilities).toEqual({ tier: "core" });
    expect(UpstreamEcho.internal).toBe(true);
    expect(UpstreamEcho.upstreamVariablesSchema).toBeDefined();
    expect(UpstreamEcho.upstreamDataSchema?.fixtureData?.variables.series?.type).toBe(
      "number[]",
    );
  });
});
