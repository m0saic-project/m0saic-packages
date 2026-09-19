import * as path from "path";
import {
  absolutizeManifestPathsInPlace,
  loadMosaicDocument,
} from "./loadMosaicDocument";
import type {
  MosaicAsset,
  MosaicAssetManifest,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicXPipeline,
} from "@m0saic/types";

const abs = (...segments: string[]): string => path.resolve(...segments);

function asManifest(o: Record<string, MosaicAsset>): MosaicAssetManifest {
  return o as MosaicAssetManifest;
}

function makeDoc(
  over: { assets?: Record<string, MosaicAsset>; children?: MosaicDocument["children"] } = {},
): MosaicDocument {
  const { assets = {}, children } = over;
  const doc: MosaicDocument = {
    kind: "mosaic_document",
    size: { width: 640, height: 360 },
    version: 1,
    m0: "1" as MosaicDocument["m0"],
    assets: asManifest(assets),
    sources: [],
  };
  if (children) doc.children = children;
  return doc;
}

const pathOf = (doc: MosaicDocument, id: string): string =>
  (doc.assets as Record<string, MosaicAsset>)[id] != null &&
  (doc.assets as Record<string, MosaicAsset>)[id].kind === "file"
    ? ((doc.assets as Record<string, MosaicAsset>)[id] as { path: string }).path
    : "";

describe("absolutizeManifestPathsInPlace", () => {
  it("leaves absolute paths unchanged", () => {
    const absHero = abs("/abs/hero.mp4");
    const doc = makeDoc({
      assets: {
        hero: { kind: "file", path: absHero },
      },
    });
    absolutizeManifestPathsInPlace(doc, abs("/proj/work.mosaic"));
    expect(pathOf(doc, "hero")).toBe(absHero);
  });

  it("resolves relative paths against the definition file's directory", () => {
    const doc = makeDoc({
      assets: {
        hero: { kind: "file", path: "media/hero.mp4" },
      },
    });
    absolutizeManifestPathsInPlace(doc, abs("/proj/work.mosaic"));
    expect(pathOf(doc, "hero")).toBe(abs("/proj/media/hero.mp4"));
  });

  it("leaves url and data-uri kinds untouched", () => {
    const doc = makeDoc({
      assets: {
        remote: { kind: "url", url: "https://example.com/clip.mp4" },
        inline: { kind: "data-uri", uri: "data:image/png;base64,AAAA" },
      },
    });
    absolutizeManifestPathsInPlace(doc, abs("/proj/work.mosaic"));
    expect(doc.assets).toEqual({
      remote: { kind: "url", url: "https://example.com/clip.mp4" },
      inline: { kind: "data-uri", uri: "data:image/png;base64,AAAA" },
    });
  });

  it("recurses into children mosaics", () => {
    const child = makeDoc({
      assets: {
        bg: { kind: "file", path: "bg.png" },
      },
    });
    const parent = makeDoc({
      assets: {
        hero: { kind: "file", path: "hero.mp4" },
      },
      children: { stage1: child },
    });
    absolutizeManifestPathsInPlace(parent, abs("/proj/work.mosaic"));
    expect(pathOf(parent, "hero")).toBe(abs("/proj/hero.mp4"));
    expect(pathOf(child, "bg")).toBe(abs("/proj/bg.png"));
  });

  it("recurses into pipeline steps", () => {
    const inner = makeDoc({
      assets: { a: { kind: "file", path: "a.mp4" } },
    });
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: inner } as never],
    } as MosaicDocumentPipeline;
    absolutizeManifestPathsInPlace(pipe, abs("/proj/work.mosaic"));
    expect(pathOf(inner, "a")).toBe(abs("/proj/a.mp4"));
  });

  it("recurses into a mosaicx_pipeline root's steps (source form walks the same)", () => {
    const inner = makeDoc({
      assets: { a: { kind: "file", path: "a.mp4" } },
    });
    const chain = {
      kind: "mosaicx_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: inner }],
    } as unknown as MosaicXPipeline;
    absolutizeManifestPathsInPlace(chain, abs("/proj/chain.mosaicx"));
    expect(pathOf(inner, "a")).toBe(abs("/proj/a.mp4"));
  });

  it("is idempotent (a second run is a no-op)", () => {
    const doc = makeDoc({
      assets: {
        hero: { kind: "file", path: "hero.mp4" },
      },
    });
    absolutizeManifestPathsInPlace(doc, abs("/proj/work.mosaic"));
    const after1 = pathOf(doc, "hero");
    absolutizeManifestPathsInPlace(doc, abs("/proj/work.mosaic"));
    const after2 = pathOf(doc, "hero");
    expect(after2).toBe(after1);
  });

  it("does not throw on malformed manifest (entries without kind)", () => {
    const doc = {
      kind: "mosaic_document",
      size: { width: 640, height: 360 },
      version: 1,
      m0: "1" as MosaicDocument["m0"],
      assets: {
        broken: { path: "x.mp4" },
        also: null,
      },
      sources: [],
    } as unknown as MosaicDocument;
    expect(() => absolutizeManifestPathsInPlace(doc, abs("/proj/x.mosaic"))).not.toThrow();
  });
});

describe("loadMosaicDocument", () => {
  it("parses JSON and absolutizes file paths", () => {
    const raw = JSON.stringify({
      kind: "mosaic_document",
      size: { width: 640, height: 360 },
      version: 1,
      m0: "1" as MosaicDocument["m0"],
      assets: {
        hero: { kind: "file", path: "media/hero.mp4" },
      },
      sources: [],
    });
    const doc = loadMosaicDocument(raw, abs("/proj/work.mosaic")) as MosaicDocument;
    expect(pathOf(doc, "hero")).toBe(abs("/proj/media/hero.mp4"));
  });

  it("throws SyntaxError on malformed JSON", () => {
    expect(() => loadMosaicDocument("{not json}", abs("/proj/x.mosaic"))).toThrow(SyntaxError);
  });
});

describe("gate-28 boundary law on read", () => {
  it("loading a sizeless root document fails loudly", () => {
    const raw = JSON.stringify({
      kind: "mosaic_document",
      version: 1,
      m0: "F",
      assets: {},
      sources: [],
    });
    expect(() => loadMosaicDocument(raw, "/tmp/x.mosaic")).toThrow(
      /root mosaic_document has no canvas/,
    );
  });
});
