#!/usr/bin/env node
// @ts-check
/**
 * dictionary:generate
 *
 * For every dictionary entry, generates derived artifacts from authored truth:
 *
 * Generated files (DO NOT HAND-EDIT):
 * - m0saic_pretty.txt  — indented multi-line DSL (opt-out via artifacts.pretty: false)
 * - m0saic_tree.txt    — ASCII tree view of layout structure (opt-out via artifacts.tree: false)
 *
 * NOT generated (authored freeform):
 * - m0saic_visual.txt  — human-oriented visual representation (opt-in via artifacts.visual: true)
 *                        Authored by hand or by entry-specific tooling; this script preserves it.
 *
 * Per-entry config via metadata.json "artifacts" field:
 *   { "pretty": bool, "tree": bool, "visual": bool }
 *   Defaults: { pretty: true, tree: true, visual: false }
 *
 * Source of truth:
 * - m0saic.m0          — geometry (M0File format)
 * - metadata.json      — discovery metadata
 *
 * THIS FILE IS PART OF THE DICTIONARY BUILD PIPELINE.
 */

const fs = require("fs");
const path = require("path");

const ENTRIES_DIR = path.join(__dirname, "..", "src", "entries");

const GENERATED_HEADER = "// GENERATED — do not hand-edit. Run `npm run dictionary:generate` to regenerate.\n";

// ── Pretty-print ──────────────────────────────────────────

function prettyMosaic(input) {
  const src = input.replace(/\s+/g, "");
  let out = "";
  let indent = 0;
  const pad = () => "  ".repeat(indent);
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === "(" || ch === "[") {
      out += ch + "\n";
      indent++;
      out += pad();
      i++;
      continue;
    }

    if (ch === ",") {
      out += ",\n" + pad();
      i++;
      continue;
    }

    if (ch === ")" || ch === "]") {
      indent--;
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      const next = src[j];

      out += "\n" + pad() + ch;

      if (next === ",") {
        out += ",";
        i = j + 1;
        out += "\n" + pad();
      } else {
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out.trim() + "\n";
}

// ── Tree view ─────────────────────────────────────────────

/**
 * Build an ASCII tree from a m0saic DSL string.
 *
 * Example: "2(F,2[F,F])" →
 *   2(...)
 *   ├── F
 *   └── 2[...]
 *       ├── F
 *       └── F
 */
function buildTree(input) {
  const src = input.replace(/\s+/g, "");
  const root = parseNode(src, 0);
  if (!root.node) return input + "\n";
  return renderTree(root.node) + "\n";
}

function parseNode(s, pos) {
  if (pos >= s.length) return { node: null, end: pos };

  // Try to read a number prefix (split count)
  let numStr = "";
  let i = pos;
  while (i < s.length && /[0-9]/.test(s[i])) {
    numStr += s[i];
    i++;
  }

  // Check if this is a group: number followed by ( or [
  if (numStr && i < s.length && (s[i] === "(" || s[i] === "[")) {
    const bracket = s[i];
    const closeBracket = bracket === "(" ? ")" : "]";
    const axis = bracket === "(" ? "col" : "row";
    i++; // skip opening bracket

    const children = [];
    while (i < s.length && s[i] !== closeBracket) {
      if (s[i] === ",") { i++; continue; }
      const child = parseNode(s, i);
      if (child.node) children.push(child.node);
      i = child.end;
    }
    if (i < s.length) i++; // skip closing bracket

    // Check for overlay {…}
    let overlay = null;
    if (i < s.length && s[i] === "{") {
      const ov = parseOverlay(s, i);
      overlay = ov.text;
      i = ov.end;
    }

    const label = `${numStr}${bracket === "(" ? "(...)" : "[...]"}${overlay ? "{" + overlay + "}" : ""}`;
    return { node: { label, children }, end: i };
  }

  // Leaf token: F, 1, 0, >, -
  if (i < s.length && /[F10>\-]/.test(s[i])) {
    let leaf = numStr + s[i];
    i++;

    // Check for overlay {…}
    if (i < s.length && s[i] === "{") {
      const ov = parseOverlay(s, i);
      leaf += "{" + ov.text + "}";
      i = ov.end;
    }

    return { node: { label: leaf, children: [] }, end: i };
  }

  // Just a number with no bracket (shouldn't happen in valid DSL, but handle gracefully)
  if (numStr) {
    return { node: { label: numStr, children: [] }, end: i };
  }

  // Skip unknown characters
  return { node: null, end: i + 1 };
}

function parseOverlay(s, pos) {
  // pos should be at '{'
  let depth = 0;
  let i = pos;
  let text = "";
  while (i < s.length) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
    if (depth > 0 && i > pos) text += s[i];
    i++;
  }
  return { text, end: i };
}

function renderTree(node, prefix, isLast) {
  if (prefix === undefined) {
    // Root node
    let out = node.label;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const last = i === node.children.length - 1;
      out += "\n" + renderTree(child, "", last);
    }
    return out;
  }

  const connector = isLast ? "└── " : "├── ";
  const extension = isLast ? "    " : "│   ";
  let out = prefix + connector + node.label;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const last = i === node.children.length - 1;
    out += "\n" + renderTree(child, prefix + extension, last);
  }

  return out;
}

// ── Entry discovery ───────────────────────────────────────

function discoverEntries() {
  const entries = [];
  for (const category of fs.readdirSync(ENTRIES_DIR)) {
    const catDir = path.join(ENTRIES_DIR, category);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const slug of fs.readdirSync(catDir)) {
      const entryDir = path.join(catDir, slug);
      if (!fs.statSync(entryDir).isDirectory()) continue;
      if (fs.existsSync(path.join(entryDir, "m0saic.m0"))) {
        entries.push({ category, slug, dir: entryDir });
      }
    }
  }
  return entries;
}

function extractDsl(dir) {
  const m0Path = path.join(dir, "m0saic.m0");
  const text = fs.readFileSync(m0Path, "utf8");
  // Extract DSL payload: skip header lines (starting with #) and blank lines
  const lines = text.split(/\r?\n/);
  const payload = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    payload.push(trimmed);
  }
  return payload.join("").trim();
}

// ── Artifact config ───────────────────────────────────────

const DEFAULT_ARTIFACTS = { pretty: true, tree: true, visual: false };

function readArtifactConfig(dir) {
  const metaPath = path.join(dir, "metadata.json");
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return { ...DEFAULT_ARTIFACTS, ...(meta.artifacts || {}) };
  } catch {
    return { ...DEFAULT_ARTIFACTS };
  }
}

// ── Main ──────────────────────────────────────────────────

console.log("Generating dictionary artifacts...\n");
const entries = discoverEntries();
let prettyCount = 0;
let treeCount = 0;
let skippedCount = 0;

// NOTE: precomputed `metrics` (frameCount/passthroughCount/etc.) and
// feasibility (`minWidthPx`/`minHeightPx`) are written back to metadata.json
// by `validate.js`, NOT here. validate.js already parses each .m0 and runs
// `getComplexityMetricsFast` for its frame-count sanity check, so we let it
// be the single source of truth and avoid the double-parse cost. This script
// stays focused on the text artifact files (pretty.txt, tree.txt).

for (const { category, slug, dir } of entries) {
  const relPath = `${category}/${slug}`;
  const config = readArtifactConfig(dir);
  const dsl = extractDsl(dir);

  if (!dsl) {
    console.warn(`  SKIP [${relPath}]: empty DSL payload`);
    skippedCount++;
    continue;
  }

  // Pretty
  if (config.pretty) {
    fs.writeFileSync(path.join(dir, "m0saic_pretty.txt"), prettyMosaic(dsl), "utf8");
    prettyCount++;
  } else {
    // Clean up stale pretty file if entry opted out
    const prettyPath = path.join(dir, "m0saic_pretty.txt");
    if (fs.existsSync(prettyPath)) fs.unlinkSync(prettyPath);
  }

  // Tree
  if (config.tree) {
    fs.writeFileSync(path.join(dir, "m0saic_tree.txt"), buildTree(dsl), "utf8");
    treeCount++;
  } else {
    // Clean up stale tree file if entry opted out
    const treePath = path.join(dir, "m0saic_tree.txt");
    if (fs.existsSync(treePath)) fs.unlinkSync(treePath);
  }

  // Visual: authored freeform — not generated, just preserved.
  // (m0saic_visual.txt is NOT generated by this script.)
}

console.log(`Generated: ${prettyCount} pretty, ${treeCount} tree (${entries.length} entries, ${skippedCount} skipped).`);
