import {
  absolutizeManifestPathsWeb,
  isAbsoluteFilePath,
} from "./absolutizeManifestPathsWeb";
import type {
  MosaicAsset,
  MosaicAssetManifest,
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicXPipeline,
} from "@m0saic/types";

function asManifest(o: Record<string, MosaicAsset>): MosaicAssetManifest {
  return o as MosaicAssetManifest;
}

function makeDoc(
  over: { assets?: Record<string, MosaicAsset>; children?: MosaicDocument["children"] } = {},
): MosaicDocument {
  const { assets = {}, children } = over;
  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: "1" as MosaicDocument["m0"],
    assets: asManifest(assets),
    sources: [],
  };
  if (children) doc.children = children;
  return doc;
}

const pathOf = (doc: MosaicDocument, id: string): string =>
  ((doc.assets as Record<string, MosaicAsset>)[id] as { path: string }).path;

describe("isAbsoluteFilePath", () => {
  it("recognizes POSIX, Windows-drive, and UNC absolutes", () => {
    expect(isAbsoluteFilePath("/abs/x.mp4")).toBe(true);
    expect(isAbsoluteFilePath("C:\\media\\x.mp4")).toBe(true);
    expect(isAbsoluteFilePath("c:/media/x.mp4")).toBe(true);
    expect(isAbsoluteFilePath("\\\\server\\share\\x.mp4")).toBe(true);
  });
  it("rejects relatives in both styles", () => {
    expect(isAbsoluteFilePath("x.mp4")).toBe(false);
    expect(isAbsoluteFilePath("./x.mp4")).toBe(false);
    expect(isAbsoluteFilePath("../media/x.mp4")).toBe(false);
    expect(isAbsoluteFilePath("media\\x.mp4")).toBe(false);
  });
});

describe("absolutizeManifestPathsWeb", () => {
  it("leaves absolute paths unchanged (idempotent)", () => {
    const doc = makeDoc({
      assets: { hero: { kind: "file", path: "/abs/hero.mp4" } },
    });
    absolutizeManifestPathsWeb(doc, "/projects/session/weekly.mosaic");
    expect(pathOf(doc, "hero")).toBe("/abs/hero.mp4");
    absolutizeManifestPathsWeb(doc, "/projects/session/weekly.mosaic");
    expect(pathOf(doc, "hero")).toBe("/abs/hero.mp4");
  });

  it("resolves relative paths against the definition file's directory", () => {
    const doc = makeDoc({
      assets: {
        plain: { kind: "file", path: "media/x.png" },
        dotted: { kind: "file", path: "./media/y.png" },
        up: { kind: "file", path: "../examples/media/z.png" },
      },
    });
    absolutizeManifestPathsWeb(doc, "/repo/packages/cli/test-templates/f.mosaic");
    expect(pathOf(doc, "plain")).toBe("/repo/packages/cli/test-templates/media/x.png");
    expect(pathOf(doc, "dotted")).toBe("/repo/packages/cli/test-templates/media/y.png");
    expect(pathOf(doc, "up")).toBe("/repo/packages/cli/examples/media/z.png");
  });

  it("keeps Windows separator style when the base dir is Windows-shaped", () => {
    const doc = makeDoc({
      assets: { clip: { kind: "file", path: "..\\media\\clip.mp4" } },
    });
    absolutizeManifestPathsWeb(doc, "C:\\work\\session\\weekly.mosaic");
    expect(pathOf(doc, "clip")).toBe("C:\\work\\media\\clip.mp4");
  });

  it("leaves url and data-uri asset kinds untouched", () => {
    const doc = makeDoc({
      assets: {
        remote: { kind: "url", url: "https://example.com/x.png" },
        inline: { kind: "data-uri", uri: "data:image/png;base64,AAAA" },
      } as unknown as Record<string, MosaicAsset>,
    });
    const before = JSON.stringify(doc.assets);
    absolutizeManifestPathsWeb(doc, "/projects/f.mosaic");
    expect(JSON.stringify(doc.assets)).toBe(before);
  });

  it("recurses into children and pipeline steps", () => {
    const child = makeDoc({
      assets: { inner: { kind: "file", path: "inner.png" } },
    });
    const stepDoc = makeDoc({
      assets: { stepAsset: { kind: "file", path: "../shared/step.png" } },
    });
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: stepDoc }],
    };
    const root = makeDoc({ children: { kid: child, pipe } });
    absolutizeManifestPathsWeb(root, "/projects/session/root.mosaic");
    expect(pathOf(child, "inner")).toBe("/projects/session/inner.png");
    expect(pathOf(stepDoc, "stepAsset")).toBe("/projects/shared/step.png");
  });

  it("absolutizes a pipeline ROOT's step files", () => {
    const stepDoc = makeDoc({
      assets: { a: { kind: "file", path: "media/a.png" } },
    });
    const pipe: MosaicDocumentPipeline = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [
        { durationMs: 500, file: stepDoc },
        { durationMs: 500, ref: "external-step" },
      ],
    };
    absolutizeManifestPathsWeb(pipe, "/projects/p.mosaic");
    expect(pathOf(stepDoc, "a")).toBe("/projects/media/a.png");
    // ref step untouched
    expect((pipe.steps[1] as { ref: string }).ref).toBe("external-step");
  });

  it("absolutizes a mosaicx_pipeline ROOT's step files (source form walks the same)", () => {
    const stepDoc = makeDoc({
      assets: { a: { kind: "file", path: "media/a.png" } },
    });
    const chain = {
      kind: "mosaicx_pipeline",
      version: 1,
      steps: [{ durationMs: 500, file: stepDoc }],
    } as unknown as MosaicXPipeline;
    absolutizeManifestPathsWeb(chain, "/projects/chain.mosaicx");
    expect(pathOf(stepDoc, "a")).toBe("/projects/media/a.png");
  });

  it("tolerates malformed manifests and empty paths without throwing", () => {
    const doc = makeDoc();
    (doc as { assets?: unknown }).assets = {
      broken: null,
      noPath: { kind: "file" },
      empty: { kind: "file", path: "" },
    };
    expect(() =>
      absolutizeManifestPathsWeb(doc, "/projects/f.mosaic"),
    ).not.toThrow();
    const map = doc.assets as unknown as Record<string, { path?: string }>;
    expect(map.empty.path).toBe("");
  });

  it("is a no-op when the definition path has no directory component", () => {
    const doc = makeDoc({
      assets: { a: { kind: "file", path: "media/a.png" } },
    });
    absolutizeManifestPathsWeb(doc, "f.mosaic");
    expect(pathOf(doc, "a")).toBe("media/a.png");
  });
});
