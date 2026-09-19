/**
 * Generate template-manifest.json from the authoring registry.
 *
 * Usage:  node dist/gen-template-manifest.js
 *
 * This script reads the compiled template-registry, validates entries,
 * discovers preview assets via convention, and writes the manifest to
 * the package root.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type {
  MosaicTemplateRepoManifest,
  MosaicTemplateRepoManifestEntry,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { parseTemplateId } from "@m0saic/platform";

import { templateRegistry } from "./template-registry";
import { TEMPLATE_REPO, TEMPLATE_PACKS } from "./repo";

const ROOT = path.resolve(__dirname, "..");

const TEMPLATES_DIR = "assets/templates";
const ENTRY_MODULE = "./dist/index.js";

/* ── Helpers ─────────────────────────────────────────────── */

function encodeTemplateKey(templateKey: string): string {
  return templateKey.replace(/\//g, "__");
}

function absFromRepo(relPath: string): string {
  return path.join(ROOT, relPath);
}

function existsRepoRel(relPath: string): boolean {
  return fs.existsSync(absFromRepo(relPath));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ensurePreviewPathsExist(
  preview: MosaicTemplateRepoManifestEntry["preview"] | undefined,
  templateKey: string,
) {
  if (!preview) return;
  const check = (p: string | undefined, field: string) => {
    if (!p) return;
    assert(
      existsRepoRel(p),
      `Template "${templateKey}" preview.${field} points to missing file: "${p}"`,
    );
  };
  check(preview.image, "image");
  check(preview.video, "video");
  check(preview.poster, "poster");
}

function buildPreviewFromConvention(
  templateKey: string,
): MosaicTemplateRepoManifestEntry["preview"] | undefined {
  const encoded = encodeTemplateKey(templateKey);
  const baseDir = `${TEMPLATES_DIR}/${encoded}`;

  const image = `${baseDir}/preview.png`;
  const video = `${baseDir}/preview.mp4`;
  const poster = `${baseDir}/poster.png`;

  const preview: NonNullable<MosaicTemplateRepoManifestEntry["preview"]> = {};
  if (existsRepoRel(image)) preview.image = image;
  if (existsRepoRel(video)) preview.video = video;
  if (existsRepoRel(poster)) preview.poster = poster;

  return preview.image || preview.video || preview.poster ? preview : undefined;
}

function mergePreview(
  explicit: MosaicTemplateRepoManifestEntry["preview"] | undefined,
  fallback: MosaicTemplateRepoManifestEntry["preview"] | undefined,
): MosaicTemplateRepoManifestEntry["preview"] | undefined {
  if (!explicit && !fallback) return undefined;
  const merged = {
    image: explicit?.image ?? fallback?.image,
    video: explicit?.video ?? fallback?.video,
    poster: explicit?.poster ?? fallback?.poster,
  };
  return merged.image || merged.video || merged.poster ? merged : undefined;
}

/* ── Validate ────────────────────────────────────────────── */

// Slugs are unique PER PACK, not globally — the npm-scope model where a pack
// namespaces its slugs. So `@m0saic/charts/bar-graph` and `@m0saic/alpine/bar-graph`
// coexist (same bare slug, different pack). The fully-qualified templateId stays
// globally unique (separate check below).
const seenSlugKeys = new Set<string>();
const seenTemplateIds = new Set<string>();
const seenExports = new Set<string>();

for (const entry of templateRegistry) {
  assert(entry.slug, `Entry missing slug (exportName=${entry.exportName})`);
  assert(entry.templateId, `Entry "${entry.slug}" missing templateId`);

  const pack = parseTemplateId(entry.templateId).pack;
  const slugKey = pack ? `${pack}/${entry.slug}` : entry.slug;
  assert(
    !seenSlugKeys.has(slugKey),
    `Duplicate pack-scoped slug: "${slugKey}"`,
  );
  seenSlugKeys.add(slugKey);

  assert(
    !seenTemplateIds.has(entry.templateId),
    `Duplicate templateId: "${entry.templateId}"`,
  );
  seenTemplateIds.add(entry.templateId);

  assert(entry.exportName, `Entry "${entry.slug}" missing exportName`);
  assert(
    !seenExports.has(entry.exportName),
    `Duplicate exportName: "${entry.exportName}"`,
  );
  seenExports.add(entry.exportName);
}

/* ── Build manifest ──────────────────────────────────────── */

const templates: MosaicTemplateRepoManifestEntry[] = templateRegistry.map(
  (entry): MosaicTemplateRepoManifestEntry => {
    const templateKey = entry.templateId;

    // Validate explicit preview paths if provided
    ensurePreviewPathsExist(entry.preview, templateKey);

    // Merge explicit preview with convention-based discovery
    const preview = mergePreview(entry.preview, buildPreviewFromConvention(templateKey));

    // If a video preview exists but no poster is provided,
    // use the video itself as the poster fallback.
    if (preview?.video && !preview.poster) {
      preview.poster = preview.video;
    }

    const pack = parseTemplateId(templateKey).pack;

    return {
      slug: entry.slug,
      templateKey: asTemplateId(templateKey),
      title: entry.title,
      description: entry.description,
      tags: entry.tags,
      ...(pack ? { pack } : {}),
      ...(entry.author ? { author: entry.author } : {}),
      preview,
    };
  },
);

const manifest: MosaicTemplateRepoManifest = {
  schemaVersion: 1,
  repo: TEMPLATE_REPO,
  entryModule: ENTRY_MODULE,
  templates,
  ...(TEMPLATE_PACKS.length ? { packs: TEMPLATE_PACKS } : {}),
};

const outPath = path.join(ROOT, "template-manifest.json");
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

const previewCount = templates.filter((t) => t.preview).length;
console.log(
  `[gen-template-manifest] wrote ${path.relative(ROOT, outPath)} ` +
    `(${templates.length} templates, ${previewCount} with preview assets)`,
);
