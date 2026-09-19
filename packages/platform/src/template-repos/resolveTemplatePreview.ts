/**
 * Resolve template preview assets to absolute file paths.
 *
 * Resolution order:
 * 1. Explicit paths from manifest entry `preview` field (repo-relative)
 * 2. Convention-based discovery: `{templatesDir}/{encodedKey}/preview.{png,mp4}`
 *    where encodedKey replaces "/" with "__"
 *    (e.g. "@m0saic-starter/hello-world/v1" → "@m0saic-starter__hello-world__v1")
 *
 * All returned paths are absolute filesystem paths suitable for file:// URLs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  MosaicTemplatePreview,
  MosaicTemplateRepoManifestEntry,
  MosaicTemplateRepoDescriptor,
} from "@m0saic/types";

const DEFAULT_TEMPLATES_DIR = "assets/templates";

export type ResolvedPreview = {
  image?: string;
  video?: string;
  poster?: string;
};

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Encode a templateKey for the conventional preview asset folder name.
 * Replaces "/" with "__".
 */
export function encodeTemplateKey(templateKey: string): string {
  return templateKey.replace(/\//g, "__");
}

/**
 * Resolve preview assets for a single manifest entry.
 *
 * @param repoRoot  Absolute path to the repo root directory
 * @param entry     Manifest entry (may have explicit preview paths)
 * @param repo      Repo descriptor (may have assets.templatesDir override)
 * @returns Resolved absolute paths, or undefined if no preview found
 */
export function resolveTemplatePreview(
  repoRoot: string,
  entry: MosaicTemplateRepoManifestEntry,
  repo?: MosaicTemplateRepoDescriptor,
): ResolvedPreview | undefined {
  // 1. Try explicit preview paths from manifest entry
  if (entry.preview) {
    const resolved = resolveExplicitPreview(repoRoot, entry.preview);
    if (resolved) return resolved;
  }

  // 2. Fall back to convention-based discovery
  return discoverPreviewByConvention(repoRoot, entry.templateKey, repo);
}

/**
 * Resolve explicit repo-relative preview paths to absolute paths.
 * Returns undefined if none of the declared paths exist on disk.
 */
function resolveExplicitPreview(
  repoRoot: string,
  preview: MosaicTemplatePreview,
): ResolvedPreview | undefined {
  const result: ResolvedPreview = {};
  let found = false;

  if (preview.image) {
    const abs = path.resolve(repoRoot, preview.image);
    if (fileExists(abs)) {
      result.image = abs;
      found = true;
    }
  }
  if (preview.video) {
    const abs = path.resolve(repoRoot, preview.video);
    if (fileExists(abs)) {
      result.video = abs;
      found = true;
    }
  }
  if (preview.poster) {
    const abs = path.resolve(repoRoot, preview.poster);
    if (fileExists(abs)) {
      result.poster = abs;
      found = true;
    }
  }

  return found ? result : undefined;
}

/**
 * Discover preview assets using the folder convention:
 *   {templatesDir}/{encodedKey}/preview.png | preview.mp4 | poster.png
 */
function discoverPreviewByConvention(
  repoRoot: string,
  templateKey: string,
  repo?: MosaicTemplateRepoDescriptor,
): ResolvedPreview | undefined {
  const templatesDir = repo?.assets?.templatesDir ?? DEFAULT_TEMPLATES_DIR;
  const encoded = encodeTemplateKey(templateKey);
  const folder = path.resolve(repoRoot, templatesDir, encoded);

  const result: ResolvedPreview = {};
  let found = false;

  const imagePath = path.join(folder, "preview.png");
  if (fileExists(imagePath)) {
    result.image = imagePath;
    found = true;
  }

  const videoPath = path.join(folder, "preview.mp4");
  if (fileExists(videoPath)) {
    result.video = videoPath;
    found = true;
  }

  const posterPath = path.join(folder, "poster.png");
  if (fileExists(posterPath)) {
    result.poster = posterPath;
    found = true;
  }

  return found ? result : undefined;
}

/**
 * Resolve previews for all entries in a manifest, keyed by templateKey.
 */
export function resolveAllTemplatePreviews(
  repoRoot: string,
  entries: MosaicTemplateRepoManifestEntry[],
  repo?: MosaicTemplateRepoDescriptor,
): Map<string, ResolvedPreview> {
  const result = new Map<string, ResolvedPreview>();
  for (const entry of entries) {
    const resolved = resolveTemplatePreview(repoRoot, entry, repo);
    if (resolved) {
      result.set(entry.templateKey, resolved);
    }
  }
  return result;
}
