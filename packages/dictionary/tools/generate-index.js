#!/usr/bin/env node
// @ts-check
/**
 * dictionary:index
 *
 * Generates src/entries/__generated__.ts from the entry directory structure.
 *
 * This replaces manual barrel maintenance: category index.ts files and the
 * top-level entries/index.ts are superseded by the generated file.
 *
 * The generated file:
 * - Imports every entry's index.ts
 * - Builds `all` array and `byId` map
 * - Resolves rank sets and mask sets
 * - Provides getRankSet() and getMaskSet() helpers
 *
 * THIS FILE IS PART OF THE DICTIONARY BUILD PIPELINE.
 */

const fs = require("fs");
const path = require("path");

const ENTRIES_DIR = path.join(__dirname, "..", "src", "entries");
const OUTPUT = path.join(ENTRIES_DIR, "__generated__.ts");

const CATEGORY_ORDER = ["brand", "grids", "layouts", "splits"];

/**
 * Try to compute exact feasibility for a DSL string.
 * Returns { minWidthPx, minHeightPx } or null if unavailable.
 */
function tryFeasibility(dsl) {
  try {
    const dslPkg = require("@m0saic/dsl");
    if (dslPkg.computeFeasibility) {
      return dslPkg.computeFeasibility(dsl);
    }
  } catch { /* fall through */ }
  return null;
}

function discoverEntries() {
  const entries = [];
  for (const category of CATEGORY_ORDER) {
    const catDir = path.join(ENTRIES_DIR, category);
    if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) continue;

    const slugs = fs.readdirSync(catDir)
      .filter((s) => {
        const d = path.join(catDir, s);
        return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, "metadata.json"));
      })
      .sort();

    for (const slug of slugs) {
      // Read metadata to check for rankSets
      const meta = JSON.parse(fs.readFileSync(path.join(catDir, slug, "metadata.json"), "utf8"));
      const hasRankSets = meta.rankSets && Object.keys(meta.rankSets).length > 0;

      // Compute feasibility if metadata doesn't already have it (legacy
      // flat-field backfill; validate.js normally owns this writeback now).
      // Detect .m0c first, fall back to .m0.
      let feasibility = null;
      if (meta.minWidthPx == null || meta.minHeightPx == null) {
        const m0cPath = path.join(catDir, slug, "m0saic.m0c");
        const m0Path = path.join(catDir, slug, "m0saic.m0");
        try {
          const ff = require("@m0saic/dsl-file-formats");
          if (fs.existsSync(m0cPath)) {
            const parsed = ff.parseM0cFile(fs.readFileSync(m0cPath, "utf8"));
            feasibility = tryFeasibility(parsed.m0);
          } else if (fs.existsSync(m0Path)) {
            const parsed = ff.parseM0File(fs.readFileSync(m0Path, "utf8"));
            feasibility = tryFeasibility(parsed.m0);
          }
        } catch { /* skip */ }
      }

      entries.push({ category, slug, hasRankSets, feasibility });
    }
  }
  return entries;
}

function entryVarName(category, slug) {
  // e.g. brand/m0saic-m-64 → brand_m0saicM64
  const clean = slug.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `${category}_${clean}`;
}

function generate() {
  const entries = discoverEntries();

  const lines = [
    "// GENERATED FILE — do not hand-edit.",
    "// Run `npm run dictionary:index` to regenerate.",
    "//",
    `// ${entries.length} entries discovered.`,
    "",
    'import type { MosaicDictionaryEntryResolved } from "@m0saic/types";',
    'import type { MosaicRankSet, MosaicMaskSetFile } from "@m0saic/types";',
    "",
  ];

  // Imports
  for (const { category, slug, hasRankSets } of entries) {
    const varName = entryVarName(category, slug);
    const importPath = `./${category}/${slug}`;

    if (hasRankSets) {
      lines.push(`import { entry as ${varName} } from "${importPath}";`);
    } else {
      lines.push(`import { entry as ${varName} } from "${importPath}";`);
    }
  }

  lines.push("");

  // all array
  lines.push("/** All dictionary entries as a flat array. */");
  lines.push("export const all: MosaicDictionaryEntryResolved[] = [");
  for (const { category, slug } of entries) {
    lines.push(`  ${entryVarName(category, slug)},`);
  }
  lines.push("];");
  lines.push("");

  // byId map
  lines.push("/** All dictionary entries keyed by id. */");
  lines.push("export const byId: Record<string, MosaicDictionaryEntryResolved> =");
  lines.push("  Object.fromEntries(all.map((entry) => [entry.id, entry]));");
  lines.push("");

  // getRankSet helper
  lines.push("/** Look up a rank set by entry id and rank set name. */");
  lines.push("export function getRankSet(");
  lines.push("  entryId: string,");
  lines.push("  name: string,");
  lines.push("): MosaicRankSet {");
  lines.push("  const entry = byId[entryId];");
  lines.push("  if (!entry) {");
  lines.push('    throw new Error(`Dictionary entry not found: "${entryId}"`);');
  lines.push("  }");
  lines.push("");
  lines.push("  const rs = entry.rankSets?.[name];");
  lines.push("  if (!rs) {");
  lines.push("    throw new Error(");
  lines.push('      `Rank set not found: entry="${entryId}" name="${name}"`,');
  lines.push("    );");
  lines.push("  }");
  lines.push("");
  lines.push("  return rs;");
  lines.push("}");
  lines.push("");

  // getMaskSet helper
  lines.push("/** Look up a mask set by entry id and mask set name. */");
  lines.push("export function getMaskSet(");
  lines.push("  entryId: string,");
  lines.push("  name: string,");
  lines.push("): MosaicMaskSetFile {");
  lines.push("  const entry = byId[entryId];");
  lines.push("  if (!entry) {");
  lines.push('    throw new Error(`Dictionary entry not found: "${entryId}"`);');
  lines.push("  }");
  lines.push("");
  lines.push("  const ms = entry.maskSetsResolved?.[name];");
  lines.push("  if (!ms) {");
  lines.push("    throw new Error(");
  lines.push('      `Mask set not found: entry="${entryId}" name="${name}"`,');
  lines.push("    );");
  lines.push("  }");
  lines.push("");
  lines.push("  return ms;");
  lines.push("}");
  lines.push("");

  const content = lines.join("\n");
  fs.writeFileSync(OUTPUT, content, "utf8");

  console.log(`Generated ${OUTPUT}`);
  console.log(`  ${entries.length} entries indexed.`);
}

generate();
