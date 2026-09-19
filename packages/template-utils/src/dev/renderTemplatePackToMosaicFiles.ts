/**
 * renderTemplatePackToMosaicFiles — Batch "template pack" generator.
 *
 * Renders multiple variants of a single template to .mosaic files on disk,
 * merging per-variant props/inject overrides over shared base files.
 *
 * Produces an index.json manifest in the output directory.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { RenderToFileOpts } from "./renderTemplateToMosaicFile";
import { renderTemplateToMosaicFile } from "./renderTemplateToMosaicFile";

import type { InjectRenderable } from "./renderTemplateToMosaicFile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PackVariant = {
  /** Unique name for this variant (used as the output filename stem). */
  name: string;

  /** Path to a JSON file with base props. Merged UNDER variant.props. */
  propsPath?: string;

  /** Path to a JSON file with base injectChildren. Merged UNDER variant.injectChildren. */
  injectPath?: string;

  /** Inline props that override the base props from propsPath. */
  props?: Record<string, unknown>;

  /** Inline injectChildren that override the base inject from injectPath. */
  injectChildren?: Record<string, InjectRenderable>;

  /** Override the wrap title for this variant. */
  wrapTitle?: string;
};

export type PackOpts = {
  /** Output directory for .mosaic files + index.json. */
  outDir: string;

  width?: number;
  height?: number;
  fps?: number;
  durationMs?: number;
  wrap?: boolean;
  warnOnMissingRefs?: boolean;
  injectChildrenDeep?: boolean;
  onWarn?: (message: string) => void;
};

export type PackIndexEntry = {
  name: string;
  outPath: string;
  propsPath?: string;
  injectPath?: string;
};

export type PackResult = {
  outDir: string;
  variants: PackIndexEntry[];
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function renderTemplatePackToMosaicFiles(
  templateId: string,
  variants: PackVariant[],
  opts: PackOpts,
): Promise<PackResult> {
  const outDir = path.resolve(opts.outDir);
  await fs.mkdir(outDir, { recursive: true });

  const results: PackIndexEntry[] = [];

  for (const variant of variants) {
    // Load base props from file
    let baseProps: Record<string, unknown> = {};
    if (variant.propsPath) {
      const raw = await fs.readFile(path.resolve(variant.propsPath), "utf8");
      baseProps = JSON.parse(raw);
    }

    // Load base inject from file
    let baseInject: Record<string, InjectRenderable> = {};
    if (variant.injectPath) {
      const raw = await fs.readFile(path.resolve(variant.injectPath), "utf8");
      baseInject = JSON.parse(raw);
    }

    // Merge: variant overrides win
    const mergedProps = { ...baseProps, ...(variant.props ?? {}) };
    const mergedInject = { ...baseInject, ...(variant.injectChildren ?? {}) };
    const hasInject = Object.keys(mergedInject).length > 0;

    const outPath = path.join(outDir, `${variant.name}.mosaic`);

    const renderOpts: RenderToFileOpts = {
      outPath,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      durationMs: opts.durationMs,
      wrap: opts.wrap,
      wrapTitle: variant.wrapTitle,
      injectChildren: hasInject ? mergedInject : undefined,
      injectChildrenDeep: opts.injectChildrenDeep,
      warnOnMissingRefs: opts.warnOnMissingRefs,
      onWarn: opts.onWarn,
    };

    await renderTemplateToMosaicFile(templateId, mergedProps, renderOpts);

    const entry: PackIndexEntry = { name: variant.name, outPath };
    if (variant.propsPath) entry.propsPath = variant.propsPath;
    if (variant.injectPath) entry.injectPath = variant.injectPath;
    results.push(entry);
  }

  // Write manifest
  const indexPath = path.join(outDir, "index.json");
  await fs.writeFile(indexPath, JSON.stringify(results, null, 2), "utf8");

  return { outDir, variants: results };
}
