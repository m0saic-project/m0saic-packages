import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveTemplatePreview,
  resolveAllTemplatePreviews,
  encodeTemplateKey,
} from "./resolveTemplatePreview";
import { asTemplateId, asRepoId } from "@m0saic/types";
import type {
  MosaicTemplateRepoManifestEntry,
  MosaicTemplateRepoDescriptor,
} from "@m0saic/types";

jest.mock("node:fs");
const fsMock = fs as jest.Mocked<typeof fs>;

// Helper: make statSync report a file exists for given paths
function mockExistingFiles(existingPaths: string[]) {
  const normalized = new Set(existingPaths.map((p) => path.resolve(p)));
  fsMock.statSync.mockImplementation((p: any) => {
    if (normalized.has(path.resolve(String(p)))) {
      return { isFile: () => true } as any;
    }
    throw new Error("ENOENT");
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("encodeTemplateKey", () => {
  it("replaces slashes with double underscores", () => {
    expect(encodeTemplateKey("@m0saic-starter/hello-world/v1")).toBe(
      "@m0saic-starter__hello-world__v1",
    );
  });

  it("handles keys with no slashes", () => {
    expect(encodeTemplateKey("simple")).toBe("simple");
  });
});

describe("resolveTemplatePreview", () => {
  const repoRoot = "/repos/my-repo";

  it("resolves explicit preview paths from manifest entry", () => {
    const entry: MosaicTemplateRepoManifestEntry = {
      slug: "hello",
      templateKey: asTemplateId("@test/hello/v1"),
      preview: {
        image: "assets/templates/hello/preview.png",
        video: "assets/templates/hello/preview.mp4",
        poster: "assets/templates/hello/poster.png",
      },
    };
    mockExistingFiles([
      path.resolve(repoRoot, "assets/templates/hello/preview.png"),
      path.resolve(repoRoot, "assets/templates/hello/preview.mp4"),
      path.resolve(repoRoot, "assets/templates/hello/poster.png"),
    ]);

    const result = resolveTemplatePreview(repoRoot, entry);
    expect(result).toEqual({
      image: path.resolve(repoRoot, "assets/templates/hello/preview.png"),
      video: path.resolve(repoRoot, "assets/templates/hello/preview.mp4"),
      poster: path.resolve(repoRoot, "assets/templates/hello/poster.png"),
    });
  });

  it("returns only existing explicit files", () => {
    const entry: MosaicTemplateRepoManifestEntry = {
      slug: "hello",
      templateKey: asTemplateId("@test/hello/v1"),
      preview: {
        image: "assets/preview.png",
        video: "assets/preview.mp4",
      },
    };
    // Only image exists
    mockExistingFiles([path.resolve(repoRoot, "assets/preview.png")]);

    const result = resolveTemplatePreview(repoRoot, entry);
    expect(result).toEqual({
      image: path.resolve(repoRoot, "assets/preview.png"),
    });
  });

  it("falls back to convention when explicit paths all missing", () => {
    const entry: MosaicTemplateRepoManifestEntry = {
      slug: "hello",
      templateKey: asTemplateId("@test/hello/v1"),
      preview: { image: "does-not-exist.png" },
    };
    // Explicit path missing, but convention path exists
    const conventionImg = path.resolve(
      repoRoot,
      "assets/templates/@test__hello__v1/preview.png",
    );
    mockExistingFiles([conventionImg]);

    const result = resolveTemplatePreview(repoRoot, entry);
    expect(result).toEqual({ image: conventionImg });
  });

  it("discovers preview by convention when no explicit preview", () => {
    const entry: MosaicTemplateRepoManifestEntry = {
      slug: "hello",
      templateKey: asTemplateId("@test/hello/v1"),
    };
    const conventionImg = path.resolve(
      repoRoot,
      "assets/templates/@test__hello__v1/preview.png",
    );
    mockExistingFiles([conventionImg]);

    const result = resolveTemplatePreview(repoRoot, entry);
    expect(result).toEqual({ image: conventionImg });
  });

  it("uses templatesDir override from repo descriptor", () => {
    const entry: MosaicTemplateRepoManifestEntry = {
      slug: "hello",
      templateKey: asTemplateId("@test/hello/v1"),
    };
    const repo: MosaicTemplateRepoDescriptor = {
      repoId: asRepoId("@test"),
      displayName: "Test",
      schemaVersion: 1,
      assets: { templatesDir: "custom/previews" },
    };
    const customImg = path.resolve(
      repoRoot,
      "custom/previews/@test__hello__v1/preview.png",
    );
    mockExistingFiles([customImg]);

    const result = resolveTemplatePreview(repoRoot, entry, repo);
    expect(result).toEqual({ image: customImg });
  });

  it("returns undefined when no preview assets exist", () => {
    const entry: MosaicTemplateRepoManifestEntry = {
      slug: "empty",
      templateKey: asTemplateId("@test/empty/v1"),
    };
    mockExistingFiles([]); // nothing on disk

    const result = resolveTemplatePreview(repoRoot, entry);
    expect(result).toBeUndefined();
  });

  it("discovers video and poster by convention", () => {
    const entry: MosaicTemplateRepoManifestEntry = {
      slug: "vid",
      templateKey: asTemplateId("@test/vid/v1"),
    };
    const videoPath = path.resolve(
      repoRoot,
      "assets/templates/@test__vid__v1/preview.mp4",
    );
    const posterPath = path.resolve(
      repoRoot,
      "assets/templates/@test__vid__v1/poster.png",
    );
    mockExistingFiles([videoPath, posterPath]);

    const result = resolveTemplatePreview(repoRoot, entry);
    expect(result).toEqual({ video: videoPath, poster: posterPath });
  });
});

describe("resolveAllTemplatePreviews", () => {
  it("returns a map of templateKey to resolved preview", () => {
    const repoRoot = "/repos/test";
    const entries: MosaicTemplateRepoManifestEntry[] = [
      {
        slug: "a",
        templateKey: asTemplateId("@t/a/v1"),
        preview: { image: "a.png" },
      },
      {
        slug: "b",
        templateKey: asTemplateId("@t/b/v1"),
      },
    ];
    mockExistingFiles([path.resolve(repoRoot, "a.png")]);

    const result = resolveAllTemplatePreviews(repoRoot, entries);
    expect(result.size).toBe(1);
    expect(result.get("@t/a/v1")).toEqual({
      image: path.resolve(repoRoot, "a.png"),
    });
    expect(result.has("@t/b/v1")).toBe(false);
  });
});
