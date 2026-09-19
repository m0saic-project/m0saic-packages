#!/usr/bin/env node
// @ts-check
/**
 * dictionary:validate
 *
 * Validates every dictionary entry against the canonical contract:
 * - metadata.json parses and has required fields
 * - id matches folder path (category/slug)
 * - category matches parent folder
 * - m0saic.m0 parses as a valid M0File
 * - extracted DSL validates
 * - actual tile count matches sourceCount
 * - tags are deduped
 * - rankSets stableKeys (read from m0c) resolve to real frames
 *
 * Exit code 0 = all valid, 1 = errors found.
 *
 * Output tiers:
 *   default:   errors + warnings (high frame count only)
 *   --verbose: additionally shows INFO (passthrough count, missing tags)
 *
 * THIS FILE IS PART OF THE DICTIONARY BUILD PIPELINE.
 */

const fs = require("fs");
const path = require("path");

const verbose = process.argv.includes("--verbose");

const ENTRIES_DIR = path.join(__dirname, "..", "src", "entries");

const VALID_CATEGORIES = ["split", "grid", "layout", "brand"];
const CATEGORY_FOLDER_MAP = {
  splits: "split",
  grids: "grid",
  layouts: "layout",
  brand: "brand",
};
const REQUIRED_META_FIELDS = ["id", "title", "description", "category", "tags", "sourceCount"];

let errors = 0;
let warnings = 0;
let infos = 0;
let checked = 0;

function err(entryPath, msg) {
  errors++;
  console.error(`  ERROR [${entryPath}]: ${msg}`);
}

function warn(entryPath, msg) {
  warnings++;
  console.warn(`  WARN  [${entryPath}]: ${msg}`);
}

function info(entryPath, msg) {
  infos++;
  if (verbose) console.log(`  INFO  [${entryPath}]: ${msg}`);
}

// ── Thresholds ─────────────────────────────────────────
const WARN_FRAME_COUNT = 1000;
/**
 * Entries whose m0 is at most this long also get a sibling `m0.json`
 * (`{ "m0": "<canonical m0>" }`) the BROWSER entry can import statically —
 * `browser.ts` ships light entries inline and used to ship every brand
 * entry as `m0: ""` (lazy `m0File`), which broke every template that
 * reads `entry.m0` synchronously on web (QR Code's centre M, Brand Marks,
 * community-m; 2026-09-16). The M-33 is 6 KB, the pattern 9.5 KB — only
 * the 149 KB bitmap stays lazy. The file is generated and committed like
 * metadata.json's precomputed fields; the validator keeps it in step.
 */
const INLINE_M0_MAX_CHARS = 40_000;
const INFO_PASSTHROUGH_COUNT = 200;

/** Discover all entry directories (folders containing metadata.json) */
function discoverEntries() {
  const entries = [];
  for (const category of fs.readdirSync(ENTRIES_DIR)) {
    const catDir = path.join(ENTRIES_DIR, category);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const slug of fs.readdirSync(catDir)) {
      const entryDir = path.join(catDir, slug);
      if (!fs.statSync(entryDir).isDirectory()) continue;
      if (fs.existsSync(path.join(entryDir, "metadata.json"))) {
        entries.push({ category, slug, dir: entryDir });
      }
    }
  }
  return entries;
}

/**
 * Get fast complexity metrics for a DSL string.
 * Returns { frameCount, passthroughCount } in O(n), no full parse needed.
 */
function getQuickMetrics(dsl) {
  try {
    const dslPkg = require("@m0saic/dsl");
    if (dslPkg.getComplexityMetricsFast) {
      return dslPkg.getComplexityMetricsFast(dsl);
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Get exact minimum feasible resolution for a DSL string.
 * Returns { minWidthPx, minHeightPx } via O(n) structural analysis.
 */
function getFeasibility(dsl) {
  try {
    const dslPkg = require("@m0saic/dsl");
    if (dslPkg.computeFeasibility) {
      return dslPkg.computeFeasibility(dsl);
    }
  } catch { /* fall through */ }
  return null;
}

function validateEntry({ category, slug, dir }) {
  const relPath = `${category}/${slug}`;
  checked++;

  // --- metadata.json ---
  const metaPath = path.join(dir, "metadata.json");
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (e) {
    err(relPath, `metadata.json parse error: ${e.message}`);
    return;
  }

  // Required fields
  for (const field of REQUIRED_META_FIELDS) {
    if (meta[field] == null || meta[field] === "") {
      err(relPath, `metadata.json missing required field: ${field}`);
    }
  }

  // id matches folder path
  const expectedId = `${category}/${slug}`;
  const expectedCategory = CATEGORY_FOLDER_MAP[category];
  if (!expectedCategory) {
    err(relPath, `unknown category folder: ${category}`);
  }

  if (meta.id !== expectedId) {
    err(relPath, `id mismatch: metadata says "${meta.id}", expected "${expectedId}"`);
  }

  // category matches parent folder
  if (expectedCategory && meta.category !== expectedCategory) {
    err(relPath, `category mismatch: metadata says "${meta.category}", expected "${expectedCategory}"`);
  }

  // category is valid
  if (meta.category && !VALID_CATEGORIES.includes(meta.category)) {
    info(relPath, `non-standard category: "${meta.category}"`);
  }

  // tags deduped
  if (Array.isArray(meta.tags)) {
    const unique = new Set(meta.tags);
    if (unique.size !== meta.tags.length) {
      err(relPath, `tags contain duplicates: [${meta.tags.join(", ")}]`);
    }
  }

  // sourceCount is a positive integer
  if (typeof meta.sourceCount !== "number" || meta.sourceCount < 0 || !Number.isInteger(meta.sourceCount)) {
    err(relPath, `sourceCount must be a non-negative integer, got: ${meta.sourceCount}`);
  }

  // --- m0saic.m0 or m0saic.m0c ---
  // Prefer .m0c when present (carries labels + structured meta). Fall back
  // to plain .m0 for entries that don't need the label channel. Exactly
  // one of the two must exist.
  const m0cPath = path.join(dir, "m0saic.m0c");
  const m0Path = path.join(dir, "m0saic.m0");
  const hasM0c = fs.existsSync(m0cPath);
  const hasM0 = fs.existsSync(m0Path);

  if (!hasM0c && !hasM0) {
    err(relPath, "missing m0saic.m0 (or m0saic.m0c)");
    return;
  }
  if (hasM0c && hasM0) {
    err(relPath, "entry has BOTH m0saic.m0c and m0saic.m0 — pick one (m0c wins if you intend labels)");
    return;
  }

  let m0saic;
  let m0Size = null; // { width, height } from file header (.m0) or top-level field (.m0c)
  let m0cLabels = null; // Record<StableKey, M0Label> from .m0c, or null when sourced from .m0
  let m0cMasks = null;  // Record<StableKey, M0cMaskEntry | null> from .m0c, or null when sourced from .m0
  let m0cRankSets = null; // Record<rankSetName, M0cRankSet | null> from .m0c, or null when sourced from .m0
  let m0cCreated = null; // ISO string from the m0c's `created` field — reused as the m0saic_src.m0 companion timestamp
  try {
    const ff = require("@m0saic/dsl-file-formats");
    if (hasM0c) {
      const parsed = ff.parseM0cFile(fs.readFileSync(m0cPath, "utf8"));
      m0saic = parsed.m0;
      m0Size = parsed.size || null;
      m0cLabels = parsed.labels || null;
      m0cMasks = parsed.masks || null;
      m0cRankSets = parsed.rankSets || null;
      m0cCreated = parsed.created || null;
    } else {
      const parsed = ff.parseM0File(fs.readFileSync(m0Path, "utf8"));
      m0saic = parsed.m0;
      m0Size = parsed.size || null;
    }
  } catch (e) {
    err(relPath, `${hasM0c ? "m0saic.m0c" : "m0saic.m0"} parse error: ${e.message}`);
    return;
  }

  if (!m0saic || m0saic.trim() === "") {
    err(relPath, `${hasM0c ? "m0saic.m0c" : "m0saic.m0"} has empty m0 payload`);
    return;
  }

  // Label validation: every stableKey in m0c.labels must resolve to a
  // real frame in the parsed layout. Orphans surface as warnings via
  // `validateLabels()` in @m0saic/dsl-file-formats.
  if (m0cLabels && Object.keys(m0cLabels).length > 0) {
    try {
      const { parseM0StringComplete } = require("@m0saic/dsl");
      const { validateLabels } = require("@m0saic/dsl-file-formats");
      // Width/height don't affect stableKey computation (purely structural);
      // pick any reasonable values for the parse.
      const probeW = m0Size?.width ?? 1000;
      const probeH = m0Size?.height ?? 1000;
      const complete = parseM0StringComplete(m0saic, probeW, probeH);
      if (complete && complete.ok && complete.ir) {
        const validKeys = new Set(
          complete.ir.editorFrames.map((f) => /** @type {string} */ (f.meta.stableKey)),
        );
        const result = validateLabels({ validStableKeys: validKeys, labels: m0cLabels });
        for (const issue of result.issues) {
          err(relPath, `m0c label "${issue.text}" → stableKey "${issue.stableKey}": ${issue.message}`);
        }
      } else {
        warn(relPath, "m0c labels present but parseM0StringComplete failed; skipping label validation");
      }
    } catch (e) {
      warn(relPath, `m0c label validation skipped: ${e.message}`);
    }
  }

  // Companion sidecar: `.m0c`-sourced entries get a human-readable
  // `m0saic_src.m0` regenerated alongside. The dictionary never reads
  // this file — `loadEntryM0()` looks for `m0saic.m0` (different name)
  // — but it's nice to have the canonical DSL sitting in plain text for
  // grep / quick visual inspection. Always derived from the m0c, never
  // edited by hand. Stable timestamp = m0c's `created`, so re-running
  // validate.js doesn't dirty the working tree.
  if (hasM0c) {
    try {
      const ff = require("@m0saic/dsl-file-formats");
      const createdDate = m0cCreated ? new Date(m0cCreated) : new Date(0);
      const companionText = ff.serializeM0File({
        m0: m0saic,
        size: m0Size,
        created: createdDate,
        app: "m0saic-dictionary",
        meta: {
          note:
            "HUMAN-READABLE COMPANION (auto-regenerated from m0saic.m0c on dictionary:validate). " +
            "Edit the .m0c, not this file — this mirror exists only for quick visual inspection of the DSL.",
        },
      });
      const companionPath = path.join(dir, "m0saic_src.m0");
      const existing = fs.existsSync(companionPath)
        ? fs.readFileSync(companionPath, "utf8")
        : null;
      if (existing !== companionText) {
        fs.writeFileSync(companionPath, companionText, "utf8");
      }
    } catch (e) {
      warn(relPath, `m0saic_src.m0 companion regeneration skipped: ${e.message}`);
    }
  }

  // Tile count vs sourceCount (fast O(n) check, no full parse)
  const metrics = getQuickMetrics(m0saic);
  const actualCount = metrics ? metrics.frameCount : null;
  if (actualCount != null && actualCount !== meta.sourceCount) {
    err(relPath, `sourceCount mismatch: metadata says ${meta.sourceCount}, DSL produces ${actualCount} rendered tiles`);
  }

  // Feasibility metadata (exact minimum resolution)
  const feasibility = getFeasibility(m0saic);
  if (feasibility) {
    // If m0 header has a size, check feasibility against it
    if (m0Size) {
      if (m0Size.width < feasibility.minWidthPx || m0Size.height < feasibility.minHeightPx) {
        err(relPath, `m0 header size ${m0Size.width}x${m0Size.height} is below minimum feasible ${feasibility.minWidthPx}x${feasibility.minHeightPx}`);
      }
    }
  }

  // Persist precomputed complexity + feasibility + sourceResolution back to
  // metadata.json so the panel/UI can read them verbatim with no DSL ops at
  // runtime. This is a pragmatic build-time side-effect: validate.js already
  // parses each .m0 and computes both metrics and feasibility for its own
  // validation checks, so it's the natural single-pass owner of the
  // writeback. Doing it in a separate "generate" step would mean parsing
  // the same .m0 twice per build.
  //
  // The dictionary is the source of truth at build time; runtime reads
  // these fields verbatim. We deliberately overwrite any hand-set values
  // so the metadata always matches the .m0.
  //
  // Schema written:
  //   feasibility:      { minWidthPx, minHeightPx }
  //   complexity:       { frameCount, passthroughCount, ..., precision }
  //   sourceResolution: { width, height }   ← only if .m0 has a `size` header
  //
  // Stale flat-field migration: prior versions of this script wrote
  // `minWidthPx` / `minHeightPx` as top-level fields. We strip them here
  // so old metadata files migrate cleanly on first re-validate.
  if (metrics && feasibility) {
    let metaChanged = false;

    const newComplexity = {
      frameCount: metrics.frameCount,
      passthroughCount: metrics.passthroughCount,
      nullCount: metrics.nullCount,
      groupCount: metrics.groupCount,
      nodeCount: metrics.nodeCount,
      precisionCost: metrics.precisionCost,
      precision: {
        maxSplitX: metrics.precision.maxSplitX,
        maxSplitY: metrics.precision.maxSplitY,
        maxSplitAny: metrics.precision.maxSplitAny,
      },
    };
    if (JSON.stringify(meta.complexity) !== JSON.stringify(newComplexity)) {
      meta.complexity = newComplexity;
      metaChanged = true;
    }

    const newFeasibility = {
      minWidthPx: feasibility.minWidthPx,
      minHeightPx: feasibility.minHeightPx,
    };
    if (JSON.stringify(meta.feasibility) !== JSON.stringify(newFeasibility)) {
      meta.feasibility = newFeasibility;
      metaChanged = true;
    }

    if (m0Size) {
      const newSourceResolution = { width: m0Size.width, height: m0Size.height };
      if (JSON.stringify(meta.sourceResolution) !== JSON.stringify(newSourceResolution)) {
        meta.sourceResolution = newSourceResolution;
        metaChanged = true;
      }
    } else if (meta.sourceResolution != null) {
      // .m0 no longer declares a size — strip the stale field.
      delete meta.sourceResolution;
      metaChanged = true;
    }

    // Migrate legacy flat fields if present.
    if (meta.minWidthPx != null) { delete meta.minWidthPx; metaChanged = true; }
    if (meta.minHeightPx != null) { delete meta.minHeightPx; metaChanged = true; }
    if (meta.metrics != null) { delete meta.metrics; metaChanged = true; }

    // Labels: round-trip from m0c into metadata.json so the runtime
    // registry can expose them without re-parsing the m0c.
    if (m0cLabels && Object.keys(m0cLabels).length > 0) {
      if (JSON.stringify(meta.labels) !== JSON.stringify(m0cLabels)) {
        meta.labels = m0cLabels;
        metaChanged = true;
      }
    } else if (meta.labels != null) {
      // Entry switched away from m0c (or m0c lost its labels) — strip the stale field.
      delete meta.labels;
      metaChanged = true;
    }

    // Masks: round-trip from m0c into metadata.json (mirrors labels). The
    // runtime registry exposes these as `entry.masks` for templates that
    // need per-frame clipping — the canonical mask-access path for .m0c-
    // sourced entries (the older `maskSets` mechanism is reserved for
    // future named-alternate sets).
    if (m0cMasks && Object.keys(m0cMasks).length > 0) {
      if (JSON.stringify(meta.masks) !== JSON.stringify(m0cMasks)) {
        meta.masks = m0cMasks;
        metaChanged = true;
      }
    } else if (meta.masks != null) {
      // Entry switched away from m0c (or m0c lost its masks) — strip the stale field.
      delete meta.masks;
      metaChanged = true;
    }

    // RankSets: round-trip from m0c into metadata.json (mirrors labels +
    // masks). The runtime registry exposes these as `entry.rankSets` keyed
    // by friendly set name (e.g. "diag", "cascade", "radial", "hero") then
    // by stableKey. Sidecar `*_ranks.json` files are no longer the source
    // of truth — entries carry their canonical rank sets inline on the m0c.
    if (m0cRankSets && Object.keys(m0cRankSets).length > 0) {
      if (JSON.stringify(meta.rankSets) !== JSON.stringify(m0cRankSets)) {
        meta.rankSets = m0cRankSets;
        metaChanged = true;
      }
    } else if (meta.rankSets != null) {
      // Entry switched away from m0c (or m0c lost its rank sets) — strip
      // the stale field (or the now-invalid sidecar-paths shape from
      // pre-cutover metadata).
      delete meta.rankSets;
      metaChanged = true;
    }

    if (metaChanged) {
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    }
  }

  // m0.json: the canonical m0 as a static JSON sibling for the browser entry
  // (see INLINE_M0_MAX_CHARS). Rewritten only when it drifts; removed when
  // the m0 grows past the cap so a stale copy can never ship.
  {
    const inlinePath = path.join(dir, "m0.json");
    if (typeof m0saic === "string" && m0saic.length <= INLINE_M0_MAX_CHARS) {
      const next = JSON.stringify({ m0: m0saic }) + "\n";
      const prev = fs.existsSync(inlinePath) ? fs.readFileSync(inlinePath, "utf8") : null;
      if (prev !== next) fs.writeFileSync(inlinePath, next, "utf8");
    } else if (fs.existsSync(inlinePath)) {
      fs.unlinkSync(inlinePath);
    }
  }

  // RankSet validation: every stableKey inside each set's `ranks` must
  // resolve to a real frame in the parsed layout. Mirrors the label
  // validation pattern above; the StableKey-keyed shape makes this a
  // straightforward set-membership check.
  if (m0cRankSets && Object.keys(m0cRankSets).length > 0) {
    try {
      const { parseM0StringComplete } = require("@m0saic/dsl");
      const probeW = m0Size?.width ?? 1000;
      const probeH = m0Size?.height ?? 1000;
      const complete = parseM0StringComplete(m0saic, probeW, probeH);
      if (complete && complete.ok && complete.ir) {
        const validKeys = new Set(
          complete.ir.editorFrames.map((f) => /** @type {string} */ (f.meta.stableKey)),
        );
        for (const [name, set] of Object.entries(m0cRankSets)) {
          if (!set || !set.ranks) continue;
          for (const k of Object.keys(set.ranks)) {
            if (!validKeys.has(k)) {
              err(
                relPath,
                `m0c rankSets["${name}"].ranks: stableKey "${k}" does not match any frame in the parsed layout`,
              );
            }
          }
        }
      } else {
        warn(relPath, "m0c rankSets present but parseM0StringComplete failed; skipping rankSet validation");
      }
    } catch (e) {
      warn(relPath, `m0c rankSet validation skipped: ${e.message}`);
    }
  }

  // --- preview ---
  if (meta.preview) {
    if (meta.preview.mode !== "canvas" && meta.preview.mode !== "image") {
      err(relPath, `preview.mode must be "canvas" or "image", got: "${meta.preview.mode}"`);
    }
    if (meta.preview.mode === "image") {
      if (!meta.preview.src || typeof meta.preview.src !== "string") {
        err(relPath, `preview.mode is "image" but src is missing`);
      } else {
        const previewPath = path.join(dir, meta.preview.src);
        if (!fs.existsSync(previewPath)) {
          err(relPath, `preview.src references missing file: ${meta.preview.src}`);
        }
      }
    }
  }

  // --- diagnostics ---

  // WARN: high frame count (render cost) — the only warning
  if (actualCount != null && actualCount > WARN_FRAME_COUNT) {
    warn(relPath, `high frame count (render cost): ${actualCount.toLocaleString()} frames`);
  }

  // INFO (verbose): high passthrough count (structural complexity)
  if (metrics && metrics.passthroughCount > INFO_PASSTHROUGH_COUNT) {
    info(relPath, `high passthrough count (structural complexity): ${metrics.passthroughCount.toLocaleString()}`);
  }

  // INFO (verbose): no tags
  if (!Array.isArray(meta.tags) || meta.tags.length === 0) {
    info(relPath, "no tags defined");
  }
}

// --- Main ---
console.log("Validating dictionary entries...\n");
const entries = discoverEntries();

for (const entry of entries) {
  validateEntry(entry);
}

console.log(`\nChecked ${checked} entries.`);
if (verbose && infos > 0) console.log(`${infos} info(s).`);
if (warnings > 0) console.log(`${warnings} warning(s).`);
if (errors > 0) {
  console.error(`${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log("All entries valid.");
}
