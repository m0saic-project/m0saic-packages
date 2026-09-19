#!/usr/bin/env node

/**
 * One-shot migration: brand/m0 + brand/m-33 from `.m0` + sidecar `masks.json`
 * to a single `.m0c` with embedded per-StableKey masks.
 *
 * Why: the dictionary convention now is — entries that carry labels or masks
 * ship a single `.m0c`. The legacy `masks.json` is a positional array keyed
 * by source index; the new representation is `Record<StableKey, ...>`, which
 * stays bound to the right cell across structural edits.
 *
 * What it does, per entry:
 *   1. Reads `m0saic.m0` (DSL + size) and `masks.json` (positional masks).
 *   2. Parses the DSL with `parseM0StringComplete` to get source-ordered
 *      StableKeys (renderFrames sorted by logicalIndex).
 *   3. Asserts `masks.length === sourceKeys.length`.
 *   4. Zips positional masks → `Record<StableKey, M0cMaskEntry | null>`.
 *   5. Writes `m0saic.m0c` next to the existing files.
 *   6. Byte-equivalence check: round-trips the new m0c through parseM0cFile
 *      and asserts both the m0 string and every (key → mask) entry survive.
 *
 * This script does NOT delete `m0saic.m0` / `masks.json` / `maskSets.ts`.
 * That happens after consumer migration + tests pass (Phase 1e of the plan).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TARGETS = [
  path.join(REPO_ROOT, "packages/dictionary/src/entries/brand/m0"),
  path.join(REPO_ROOT, "packages/dictionary/src/entries/brand/m-33"),
];

async function loadDeps() {
  const dsl = await import("@m0saic/dsl");
  const ff = await import("@m0saic/dsl-file-formats");
  return { dsl, ff };
}

function sourceOrderStableKeys(ir) {
  const frames = ir.renderFrames.slice().sort((a, b) => a.logicalIndex - b.logicalIndex);
  return frames.map((f) => f.meta.stableKey);
}

/**
 * The SVG → Mosaic wizard occasionally emits a path that traces the full
 * bounding rect (with sub-pixel rounding noise) for cells whose silhouette
 * happens to be rectangular. Such a mask is semantically equivalent to
 * `null` (no clipping) — the wizard just didn't optimize it out. We treat
 * those as null at migration time so downstream consumers don't pay the
 * clipPath cost and the editor's mask preview doesn't paint a phantom rect.
 *
 * See `tools/clean-rect-shaped-masks.mjs` for the standalone cleanup that
 * patches existing .m0c files; this helper keeps re-runs of the migration
 * itself producing clean output.
 */
const RECT_TOLERANCE_PX = 1.5;
function extractPolygonVertices(localPath) {
  const tokens = localPath.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d+(?:\.\d+)?/g) ?? [];
  const verts = [];
  let cx = 0; let cy = 0; let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "Z" || cmd === "z") continue;
    if (cmd === "M" || cmd === "L") { cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "m" || cmd === "l") { cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "H") { cx = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "h") { cx += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "V") { cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "v") { cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "C") { i += 4; cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "c") { i += 4; cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "S" || cmd === "Q") { i += 2; cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "s" || cmd === "q") { i += 2; cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "T") { cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "t") { cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "A" || cmd === "a") {
      i += 5;
      if (cmd === "A") { cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); }
      else { cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); }
      verts.push([cx, cy]);
    } else return null;
  }
  return verts;
}
function isEssentiallyRectMask(mask) {
  if (!mask || !mask.localPath || !mask.bounds) return false;
  const { width, height } = mask.bounds;
  const verts = extractPolygonVertices(mask.localPath);
  if (!verts || verts.length === 0) return false;
  const near = (a, target) => Math.abs(a - target) < RECT_TOLERANCE_PX;
  // First pass: every vertex must lie on a corner of the bounding rect. If
  // any interior vertex is present this isn't a rect.
  for (const [x, y] of verts) {
    if (!near(x, 0) && !near(x, width)) return false;
    if (!near(y, 0) && !near(y, height)) return false;
  }
  // Second pass: it's only a rect if ALL FOUR corners are actually visited.
  // A right triangle inscribed in three of the four corners (e.g. the
  // brand/m-33 "M 26 36 L 26 0 H 0 L 26 36 Z" silhouette) passes the first
  // check but should NOT be dropped — it's a triangle, not a rect.
  let tl = false, tr = false, bl = false, br = false;
  for (const [x, y] of verts) {
    if (near(x, 0) && near(y, 0)) tl = true;
    else if (near(x, width) && near(y, 0)) tr = true;
    else if (near(x, 0) && near(y, height)) bl = true;
    else if (near(x, width) && near(y, height)) br = true;
  }
  return tl && tr && bl && br;
}

function fmt(n) {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(4)));
}

/**
 * Snap any path coord within tolerance of a rect boundary to the exact
 * boundary. Mirrors the `snapMaskPathToBounds` helper in
 * `normalize-mask-paths.mjs` — kept inline here so future migration
 * re-runs produce already-snapped output.
 */
function snapMaskPathToBounds(localPath, bounds) {
  const { width, height } = bounds;
  const tokens = localPath.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d+(?:\.\d+)?/g) ?? [];
  const near = (a, target) => Math.abs(a - target) < RECT_TOLERANCE_PX;
  const snapX = (x) => (near(x, 0) ? 0 : near(x, width) ? width : x);
  const snapY = (y) => (near(y, 0) ? 0 : near(y, height) ? height : y);
  const out = [];
  let cx = 0; let cy = 0; let changed = false; let i = 0;
  function snapEnd(x, y, rel) {
    const absX = rel ? cx + x : x;
    const absY = rel ? cy + y : y;
    const nx = snapX(absX); const ny = snapY(absY);
    const moved = nx !== absX || ny !== absY;
    const outX = rel ? nx - cx : nx;
    const outY = rel ? ny - cy : ny;
    cx = nx; cy = ny;
    return { x: outX, y: outY, moved };
  }
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "Z" || cmd === "z") { out.push(cmd); continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "M" || C === "L") {
      const r = snapEnd(parseFloat(tokens[i++]), parseFloat(tokens[i++]), rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(r.x), fmt(r.y));
    } else if (C === "H") {
      const dx = parseFloat(tokens[i++]); const absX = rel ? cx + dx : dx;
      const nx = snapX(absX); if (nx !== absX) changed = true;
      const newDx = rel ? nx - cx : nx; cx = nx; out.push(cmd, fmt(newDx));
    } else if (C === "V") {
      const dy = parseFloat(tokens[i++]); const absY = rel ? cy + dy : dy;
      const ny = snapY(absY); if (ny !== absY) changed = true;
      const newDy = rel ? ny - cy : ny; cy = ny; out.push(cmd, fmt(newDy));
    } else if (C === "C") {
      const cp1x = parseFloat(tokens[i++]); const cp1y = parseFloat(tokens[i++]);
      const cp2x = parseFloat(tokens[i++]); const cp2y = parseFloat(tokens[i++]);
      const r = snapEnd(parseFloat(tokens[i++]), parseFloat(tokens[i++]), rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(cp1x), fmt(cp1y), fmt(cp2x), fmt(cp2y), fmt(r.x), fmt(r.y));
    } else if (C === "S" || C === "Q") {
      const cpx = parseFloat(tokens[i++]); const cpy = parseFloat(tokens[i++]);
      const r = snapEnd(parseFloat(tokens[i++]), parseFloat(tokens[i++]), rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(cpx), fmt(cpy), fmt(r.x), fmt(r.y));
    } else if (C === "T") {
      const r = snapEnd(parseFloat(tokens[i++]), parseFloat(tokens[i++]), rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(r.x), fmt(r.y));
    } else if (C === "A") {
      const rx = parseFloat(tokens[i++]); const ry = parseFloat(tokens[i++]);
      const rot = parseFloat(tokens[i++]);
      const largeArc = parseFloat(tokens[i++]); const sweep = parseFloat(tokens[i++]);
      const r = snapEnd(parseFloat(tokens[i++]), parseFloat(tokens[i++]), rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(rx), fmt(ry), fmt(rot), fmt(largeArc), fmt(sweep), fmt(r.x), fmt(r.y));
    } else {
      return { path: localPath, changed: false, bailed: true };
    }
  }
  return { path: out.join(" "), changed, bailed: false };
}

function migrateOne({ dsl, ff }, entryDir) {
  const slug = path.relative(REPO_ROOT, entryDir);
  console.log(`\n— migrating ${slug}`);

  const m0Path = path.join(entryDir, "m0saic.m0");
  const m0cPath = path.join(entryDir, "m0saic.m0c");
  const masksJsonPath = path.join(entryDir, "masks.json");

  if (!fs.existsSync(m0Path)) throw new Error(`${slug}: missing m0saic.m0`);
  if (!fs.existsSync(masksJsonPath)) throw new Error(`${slug}: missing masks.json`);
  if (fs.existsSync(m0cPath)) throw new Error(`${slug}: m0saic.m0c already exists — refusing to overwrite. Delete it first if you really mean to re-run.`);

  const parsedM0 = ff.parseM0File(fs.readFileSync(m0Path, "utf8"));
  if (!parsedM0.m0 || parsedM0.m0.trim() === "") throw new Error(`${slug}: m0saic.m0 has empty payload`);
  if (!parsedM0.size) throw new Error(`${slug}: m0saic.m0 has no size header — needed to compute stableKeys`);

  const masksFile = JSON.parse(fs.readFileSync(masksJsonPath, "utf8"));
  if (!Array.isArray(masksFile.masks)) throw new Error(`${slug}: masks.json missing masks[] array`);

  const result = dsl.parseM0StringComplete(parsedM0.m0, parsedM0.size.width, parsedM0.size.height);
  if (!result.ok) throw new Error(`${slug}: parseM0StringComplete failed: ${result.error?.message ?? "unknown"}`);

  const sourceKeys = sourceOrderStableKeys(result.ir);

  if (sourceKeys.length !== masksFile.masks.length) {
    throw new Error(`${slug}: source count mismatch — parsed ${sourceKeys.length} rendered frames, masks.json has ${masksFile.masks.length}`);
  }

  const masks = {};
  let rectShapedDropped = 0;
  let snappedToBounds = 0;
  for (let i = 0; i < sourceKeys.length; i++) {
    const m = masksFile.masks[i] ?? null;
    if (m && isEssentiallyRectMask(m)) {
      masks[sourceKeys[i]] = null;
      rectShapedDropped++;
    } else if (m) {
      const snap = snapMaskPathToBounds(m.localPath, m.bounds);
      if (snap.changed) {
        masks[sourceKeys[i]] = { ...m, localPath: snap.path };
        snappedToBounds++;
      } else {
        masks[sourceKeys[i]] = m;
      }
    } else {
      masks[sourceKeys[i]] = null;
    }
  }

  const nonNullCount = sourceKeys.filter((k) => masks[k] !== null).length;
  const suffixParts = [];
  if (rectShapedDropped > 0) suffixParts.push(`dropped ${rectShapedDropped} rect-shaped`);
  if (snappedToBounds > 0) suffixParts.push(`snapped ${snappedToBounds} bound-overshoot`);
  const suffix = suffixParts.length ? ` (${suffixParts.join(", ")})` : "";
  console.log(`  ${sourceKeys.length} sources, ${nonNullCount} non-rect masks${suffix}`);

  const m0cText = ff.serializeM0cFile({
    m0: parsedM0.m0,
    size: parsedM0.size,
    app: "m0saic-dictionary",
    masks,
  });

  const roundTripped = ff.parseM0cFile(m0cText);
  if (roundTripped.m0 !== parsedM0.m0) {
    throw new Error(`${slug}: round-trip m0 mismatch`);
  }
  if (!roundTripped.masks) {
    throw new Error(`${slug}: round-trip lost masks`);
  }
  for (const key of sourceKeys) {
    const before = masks[key];
    const after = roundTripped.masks[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`${slug}: round-trip mask mismatch at ${key}`);
    }
  }
  console.log(`  round-trip OK`);

  fs.writeFileSync(m0cPath, m0cText, "utf8");
  console.log(`  wrote ${path.relative(REPO_ROOT, m0cPath)}`);

  // Companion sidecar — same logic validate.js uses on every dictionary:validate run.
  const companionPath = path.join(entryDir, "m0saic_src.m0");
  const companionText = ff.serializeM0File({
    m0: parsedM0.m0,
    size: parsedM0.size,
    created: new Date(roundTripped.created || Date.now()),
    app: "m0saic-dictionary",
    meta: {
      note:
        "HUMAN-READABLE COMPANION (auto-regenerated from m0saic.m0c on dictionary:validate). " +
        "Edit the .m0c, not this file — this mirror exists only for quick visual inspection of the DSL.",
    },
  });
  fs.writeFileSync(companionPath, companionText, "utf8");
  console.log(`  wrote ${path.relative(REPO_ROOT, companionPath)}`);
}

async function main() {
  const deps = await loadDeps();
  for (const entryDir of TARGETS) {
    migrateOne(deps, entryDir);
  }
  console.log("\nDone. Next: update each entry's index.ts to load from m0saic.m0c, migrate consumers, then delete m0saic.m0 + masks.json + maskSets.ts.");
}

main().catch((e) => {
  console.error("\nMigration failed:", e.message);
  process.exit(1);
});
