#!/usr/bin/env node

/**
 * One-shot migration: fold sidecar `*_ranks.json` files into each brand
 * entry's `m0saic.m0c` as inline `rankSets`.
 *
 * Why: the dictionary convention now is — entries that carry per-frame
 * channels (labels, masks, rank sets) ship a single `.m0c` carrying them
 * all. The legacy `*_ranks.json` sidecars are positional arrays keyed by
 * source index; the new representation is `Record<rankSetName,
 * { mode?, ranks: Record<StableKey, number | null> }>`, which stays bound
 * to the right cell across structural edits and matches the masks + labels
 * indexing primitive.
 *
 * What it does, per entry:
 *   1. Reads `m0saic.m0c` (or upgrades `m0saic.m0` to one).
 *   2. Reads every sibling `*_ranks.json` sidecar (one per named set).
 *   3. Parses the DSL with `parseM0StringComplete` to get source-ordered
 *      StableKeys (renderFrames sorted by logicalIndex).
 *   4. Asserts every sidecar's `ranks.length === sourceKeys.length`.
 *   5. Zips positional `number[]` → `Record<StableKey, number>`.
 *   6. Reserializes the `.m0c` with `rankSets` populated; preserves any
 *      existing `labels` / `masks` / `derive.image` / `custom` / `meta` /
 *      `created` so this migration is non-destructive for those channels.
 *   7. Byte-equivalence check: round-trips the new m0c through
 *      `parseM0cFile` and asserts every (rank-set name → keyed-ranks)
 *      entry survives.
 *   8. When the input was `.m0` (m0saic-pattern), writes the new `.m0c`
 *      and deletes the original `.m0`.
 *
 * Sidecar `*_ranks.json` files and per-entry `rankSets.ts` exporters are
 * NOT deleted by this script. That happens after consumer migration +
 * tests pass (Phase 3 cleanup below).
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
  path.join(REPO_ROOT, "packages/dictionary/src/entries/brand/m0saic-pattern"),
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

function findSidecars(entryDir) {
  return fs
    .readdirSync(entryDir)
    .filter((f) => /_ranks\.json$/.test(f))
    .sort();
}

function buildRankSetsFromSidecars({ entryDir, sidecars, sourceKeys, slug }) {
  const rankSets = {};
  for (const sidecar of sidecars) {
    const name = sidecar.replace(/_ranks\.json$/, "");
    const raw = JSON.parse(fs.readFileSync(path.join(entryDir, sidecar), "utf8"));
    if (!raw || !Array.isArray(raw.ranks)) {
      throw new Error(`${slug}: ${sidecar} missing ranks[] array`);
    }
    if (raw.ranks.length !== sourceKeys.length) {
      throw new Error(
        `${slug}: ${sidecar} has ${raw.ranks.length} ranks, expected ${sourceKeys.length} (sourceCount)`,
      );
    }
    const ranks = {};
    for (let i = 0; i < sourceKeys.length; i++) {
      const v = raw.ranks[i];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(
          `${slug}: ${sidecar} ranks[${i}] is not a finite number (got ${String(v)})`,
        );
      }
      ranks[sourceKeys[i]] = v;
    }
    rankSets[name] = raw.mode !== undefined ? { mode: raw.mode, ranks } : { ranks };
  }
  return rankSets;
}

function migrateOne({ dsl, ff }, entryDir) {
  const slug = path.relative(REPO_ROOT, entryDir);
  console.log(`\n— migrating ${slug}`);

  const m0cPath = path.join(entryDir, "m0saic.m0c");
  const m0Path = path.join(entryDir, "m0saic.m0");
  const hasM0c = fs.existsSync(m0cPath);
  const hasM0 = fs.existsSync(m0Path);

  if (!hasM0c && !hasM0) {
    throw new Error(`${slug}: missing both m0saic.m0c and m0saic.m0`);
  }
  if (hasM0c && hasM0) {
    throw new Error(`${slug}: has BOTH m0saic.m0c and m0saic.m0 — refusing to migrate ambiguous state`);
  }

  const sidecars = findSidecars(entryDir);
  if (sidecars.length === 0) {
    console.log(`  no rank sidecars — skipping`);
    return;
  }
  console.log(`  ${sidecars.length} rank sidecars: ${sidecars.join(", ")}`);

  // Parse the existing source-of-truth file so we preserve every channel
  // already there (labels/masks/derive/meta/custom/created).
  let m0;
  let size;
  let existingLabels = null;
  let existingMasks = null;
  let existingCustom = null;
  let existingDeriveImage = null;
  let existingMeta = null;
  let existingApp = "m0saic-dictionary";
  let existingAppVersion = null;
  let existingCreated = null;

  if (hasM0c) {
    const parsed = ff.parseM0cFile(fs.readFileSync(m0cPath, "utf8"));
    m0 = parsed.m0;
    size = parsed.size;
    existingLabels = parsed.labels;
    existingMasks = parsed.masks;
    existingCustom = parsed.custom;
    existingDeriveImage = parsed.derive?.image ?? null;
    existingMeta = parsed.meta;
    existingApp = parsed.app ?? existingApp;
    existingAppVersion = parsed.appVersion;
    existingCreated = parsed.created;
  } else {
    const parsed = ff.parseM0File(fs.readFileSync(m0Path, "utf8"));
    m0 = parsed.m0;
    size = parsed.size;
    existingMeta = parsed.meta;
    if (parsed.app) existingApp = parsed.app;
    if (parsed.appVersion) existingAppVersion = parsed.appVersion;
    if (parsed.created) existingCreated = parsed.created;
  }

  if (!size) {
    throw new Error(`${slug}: source file has no size header — needed to compute stableKeys`);
  }

  // Parse DSL → source-order stableKeys.
  const result = dsl.parseM0StringComplete(m0, size.width, size.height);
  if (!result.ok) {
    throw new Error(`${slug}: parseM0StringComplete failed: ${result.error?.message ?? "unknown"}`);
  }
  const sourceKeys = sourceOrderStableKeys(result.ir);

  // Build the StableKey-keyed rankSets from each sidecar.
  const rankSets = buildRankSetsFromSidecars({ entryDir, sidecars, sourceKeys, slug });

  const nonNullRanks = Object.values(rankSets).reduce(
    (n, set) => n + (set && set.ranks ? Object.keys(set.ranks).length : 0),
    0,
  );
  console.log(`  ${sourceKeys.length} sources × ${Object.keys(rankSets).length} sets = ${nonNullRanks} rank entries`);

  // Reserialize the m0c with rankSets populated (and every other channel preserved).
  const m0cText = ff.serializeM0cFile({
    m0,
    size,
    created: existingCreated ? new Date(existingCreated) : new Date(),
    app: existingApp,
    appVersion: existingAppVersion,
    meta: existingMeta,
    labels: existingLabels,
    deriveImage: existingDeriveImage,
    masks: existingMasks,
    rankSets,
    custom: existingCustom,
  });

  // Round-trip verify: every channel survives.
  const roundTripped = ff.parseM0cFile(m0cText);
  if (roundTripped.m0 !== m0) throw new Error(`${slug}: round-trip m0 mismatch`);
  if (!roundTripped.rankSets) throw new Error(`${slug}: round-trip lost rankSets entirely`);
  const inNames = Object.keys(rankSets).sort();
  const outNames = Object.keys(roundTripped.rankSets).sort();
  if (JSON.stringify(inNames) !== JSON.stringify(outNames)) {
    throw new Error(`${slug}: round-trip rankSets names mismatch (${outNames.join(",")} vs ${inNames.join(",")})`);
  }
  // Structural comparison — the serializer sorts inner stableKey keys, so
  // JSON.stringify byte-comparison wouldn't survive the re-order. Walk
  // entries individually.
  function eqOrder(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
      const av = a[ak[i]];
      const bv = b[ak[i]];
      if (av === null && bv === null) continue;
      if (typeof av === "number" && typeof bv === "number") {
        if (av !== bv) return false;
        continue;
      }
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    }
    return true;
  }

  for (const name of inNames) {
    const before = rankSets[name];
    const after = roundTripped.rankSets[name];
    if (!after) throw new Error(`${slug}: round-trip dropped rankSet "${name}"`);
    if ((before.mode ?? undefined) !== (after.mode ?? undefined)) {
      throw new Error(`${slug}: round-trip rankSet "${name}" mode mismatch`);
    }
    if (!eqOrder(before.ranks, after.ranks)) {
      throw new Error(`${slug}: round-trip rankSet "${name}" ranks mismatch`);
    }
  }
  // Sanity-check the channels we preserved survived too. Masks/labels are
  // already StableKey-keyed — the serializer sorts them too — so use the
  // same key-ordered comparison.
  if (existingMasks) {
    if (!eqOrder(existingMasks, roundTripped.masks)) {
      throw new Error(`${slug}: round-trip masks mismatch — migration would have lost mask data`);
    }
  }
  if (existingLabels) {
    if (!eqOrder(existingLabels, roundTripped.labels)) {
      throw new Error(`${slug}: round-trip labels mismatch — migration would have lost label data`);
    }
  }
  console.log(`  round-trip OK`);

  fs.writeFileSync(m0cPath, m0cText, "utf8");
  console.log(`  wrote ${path.relative(REPO_ROOT, m0cPath)}`);

  if (hasM0) {
    fs.unlinkSync(m0Path);
    console.log(`  removed ${path.relative(REPO_ROOT, m0Path)} (now sourced from .m0c)`);
  }
}

async function main() {
  const deps = await loadDeps();
  for (const entryDir of TARGETS) {
    migrateOne(deps, entryDir);
  }
  console.log("\nDone. Next: update each entry's index.ts to drop rankSetsResolved, update validate.js to bake rankSets, delete *_ranks.json + rankSets.ts.");
}

main().catch((e) => {
  console.error("\nMigration failed:", e.message);
  process.exit(1);
});
