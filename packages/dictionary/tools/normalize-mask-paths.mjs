#!/usr/bin/env node

/**
 * One-shot data cleanup: walk every `m0saic.m0c` under
 * `packages/dictionary/src/entries/` and normalize the per-leaf mask paths
 * to behave like the rect boundaries are impenetrable walls. Two passes:
 *
 * 1. **Drop rect-shaped masks** — if a mask's path traces the bounding
 *    rect (with sub-pixel rounding noise), null it out. A null mask is
 *    semantically equivalent to "full rect" but skips the clipPath
 *    altogether, saving bytes and avoiding a phantom render layer.
 *
 * 2. **Snap boundary coords to exact rect bounds** — for the masks that
 *    survive, walk each vertex and snap any coord within ±1.5px of a rect
 *    boundary (0 or width / height) to the exact integer boundary. The
 *    SVG → Mosaic wizard authors coords like `-0.7972` and `19.972`
 *    instead of `0` and `20`, and the rasterizer faithfully draws the
 *    sub-pixel overshoot — visible at zoom as the mask bleeding past its
 *    container rect. Snapping locks every boundary touch to the rect
 *    edge while leaving genuine interior geometry (curves, diagonals)
 *    untouched.
 *
 * Both passes are conservative — a 1.5px tolerance absorbs the wizard's
 * typical noise without false-positiving real geometry. Future-proofing:
 * `migrate-masks-to-m0c.mjs` mirrors both helpers so subsequent
 * migrations stay clean from the start.
 *
 * Safe to re-run — idempotent. Skips files where neither pass touches
 * anything.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENTRIES_ROOT = path.resolve(__dirname, "..", "src", "entries");

const RECT_TOLERANCE_PX = 1.5;

function extractPolygonVertices(localPath) {
  // Returns the sequence of cursor positions reached by the path's
  // commands. Curve commands (C/Q/S/T) contribute their endpoint as a
  // vertex; control-point coords are excluded because they're handles
  // shaping the curve, not points the path actually touches.
  const tokens = localPath.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d+(?:\.\d+)?/g) ?? [];
  const verts = [];
  let cx = 0;
  let cy = 0;
  let i = 0;
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
    else if (cmd === "S") { i += 2; cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "s") { i += 2; cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "Q") { i += 2; cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "q") { i += 2; cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "T") { cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "t") { cx += parseFloat(tokens[i++]); cy += parseFloat(tokens[i++]); verts.push([cx, cy]); }
    else if (cmd === "A" || cmd === "a") {
      // Arcs: rx ry x-axis-rot large-arc-flag sweep-flag x y. Just consume to the endpoint.
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
  for (const [x, y] of verts) {
    if (!near(x, 0) && !near(x, width)) return false;
    if (!near(y, 0) && !near(y, height)) return false;
  }
  return true;
}

function fmt(n) {
  if (Number.isInteger(n)) return String(n);
  // Trim to 4 decimals, then strip trailing zeros; matches wizard precision.
  return String(parseFloat(n.toFixed(4)));
}

/**
 * Rewrite an SVG path string, snapping any coord within tolerance of a
 * rect boundary to the exact boundary. Handles M / L / V / H (absolute
 * and relative) plus Z. Curves / arcs cause a bail — we leave the path
 * alone rather than risk distorting real geometry. Relative commands are
 * snapped against the resolved absolute cursor and rewritten so the path
 * shape is unchanged except at the bounds.
 */
function snapMaskPathToBounds(localPath, bounds) {
  const { width, height } = bounds;
  const tokens = localPath.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d+(?:\.\d+)?/g) ?? [];
  const near = (a, target) => Math.abs(a - target) < RECT_TOLERANCE_PX;
  const snapX = (x) => (near(x, 0) ? 0 : near(x, width) ? width : x);
  const snapY = (y) => (near(y, 0) ? 0 : near(y, height) ? height : y);

  const out = [];
  let cx = 0;
  let cy = 0;
  let changed = false;
  let i = 0;

  // Snap an endpoint (x, y). For absolute commands the snapped (x, y) IS
  // the cursor; for relative commands we have to back-solve the new
  // delta so the resolved cursor lands on the snapped point.
  function snapEnd(args, isRelative) {
    const dx = args.x; const dy = args.y;
    const absX = isRelative ? cx + dx : dx;
    const absY = isRelative ? cy + dy : dy;
    const nx = snapX(absX); const ny = snapY(absY);
    const moved = nx !== absX || ny !== absY;
    if (isRelative) {
      const newDx = nx - cx; const newDy = ny - cy;
      cx = nx; cy = ny;
      return { dx: newDx, dy: newDy, moved };
    }
    cx = nx; cy = ny;
    return { dx: nx, dy: ny, moved };
  }

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "Z" || cmd === "z") { out.push(cmd); continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === "M" || C === "L") {
      const r = snapEnd({ x: parseFloat(tokens[i++]), y: parseFloat(tokens[i++]) }, rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(r.dx), fmt(r.dy));
    } else if (C === "H") {
      const dx = parseFloat(tokens[i++]);
      const absX = rel ? cx + dx : dx;
      const nx = snapX(absX);
      if (nx !== absX) changed = true;
      const newDx = rel ? nx - cx : nx;
      cx = nx;
      out.push(cmd, fmt(newDx));
    } else if (C === "V") {
      const dy = parseFloat(tokens[i++]);
      const absY = rel ? cy + dy : dy;
      const ny = snapY(absY);
      if (ny !== absY) changed = true;
      const newDy = rel ? ny - cy : ny;
      cy = ny;
      out.push(cmd, fmt(newDy));
    } else if (C === "C") {
      // Two control points (pass through unchanged) + endpoint (snapped).
      const cp1x = parseFloat(tokens[i++]); const cp1y = parseFloat(tokens[i++]);
      const cp2x = parseFloat(tokens[i++]); const cp2y = parseFloat(tokens[i++]);
      const r = snapEnd({ x: parseFloat(tokens[i++]), y: parseFloat(tokens[i++]) }, rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(cp1x), fmt(cp1y), fmt(cp2x), fmt(cp2y), fmt(r.dx), fmt(r.dy));
    } else if (C === "S" || C === "Q") {
      // One control point + endpoint.
      const cpx = parseFloat(tokens[i++]); const cpy = parseFloat(tokens[i++]);
      const r = snapEnd({ x: parseFloat(tokens[i++]), y: parseFloat(tokens[i++]) }, rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(cpx), fmt(cpy), fmt(r.dx), fmt(r.dy));
    } else if (C === "T") {
      // Just endpoint.
      const r = snapEnd({ x: parseFloat(tokens[i++]), y: parseFloat(tokens[i++]) }, rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(r.dx), fmt(r.dy));
    } else if (C === "A") {
      // Arc: rx ry x-axis-rot large-arc-flag sweep-flag x y. Snap endpoint only.
      const rx = parseFloat(tokens[i++]); const ry = parseFloat(tokens[i++]);
      const rot = parseFloat(tokens[i++]);
      const largeArc = parseFloat(tokens[i++]); const sweep = parseFloat(tokens[i++]);
      const r = snapEnd({ x: parseFloat(tokens[i++]), y: parseFloat(tokens[i++]) }, rel);
      if (r.moved) changed = true;
      out.push(cmd, fmt(rx), fmt(ry), fmt(rot), fmt(largeArc), fmt(sweep), fmt(r.dx), fmt(r.dy));
    } else {
      return { path: localPath, changed: false, bailed: true };
    }
  }

  return { path: out.join(" "), changed, bailed: false };
}

function findM0cFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...findM0cFiles(p));
    else if (name === "m0saic.m0c") out.push(p);
  }
  return out;
}

async function loadDeps() {
  const ff = await import("@m0saic/dsl-file-formats");
  return { ff };
}

function normalizeOne({ ff }, m0cPath) {
  const slug = path.relative(ENTRIES_ROOT, path.dirname(m0cPath));
  const parsed = ff.parseM0cFile(fs.readFileSync(m0cPath, "utf8"));
  if (!parsed.masks) return { slug, droppedRect: 0, snapped: 0, total: 0 };

  const before = parsed.masks;
  const after = {};
  let droppedRect = 0;
  let snapped = 0;
  let nonNullTotal = 0;
  for (const [key, mask] of Object.entries(before)) {
    if (mask == null) {
      after[key] = mask;
      continue;
    }
    nonNullTotal++;
    if (isEssentiallyRectMask(mask)) {
      after[key] = null;
      droppedRect++;
      continue;
    }
    const result = snapMaskPathToBounds(mask.localPath, mask.bounds);
    if (result.changed) {
      after[key] = { ...mask, localPath: result.path };
      snapped++;
    } else {
      after[key] = mask;
    }
  }

  if (droppedRect === 0 && snapped === 0) {
    return { slug, droppedRect: 0, snapped: 0, total: nonNullTotal };
  }

  const text = ff.serializeM0cFile({
    m0: parsed.m0,
    size: parsed.size,
    created: parsed.created ? new Date(parsed.created) : new Date(),
    app: parsed.app ?? "m0saic-dictionary",
    appVersion: parsed.appVersion ?? null,
    meta: parsed.meta,
    labels: parsed.labels,
    masks: after,
    deriveImage: parsed.derive?.image ?? null,
    custom: parsed.custom,
  });
  fs.writeFileSync(m0cPath, text, "utf8");
  return { slug, droppedRect, snapped, total: nonNullTotal };
}

async function main() {
  const deps = await loadDeps();
  const files = findM0cFiles(ENTRIES_ROOT);
  let touched = 0;
  for (const f of files) {
    const result = normalizeOne(deps, f);
    if (result.droppedRect > 0 || result.snapped > 0) {
      const parts = [];
      if (result.droppedRect) parts.push(`dropped ${result.droppedRect}/${result.total} rect-shaped`);
      if (result.snapped) parts.push(`snapped ${result.snapped}/${result.total} bound-overshoot`);
      console.log(`  ${parts.join(", ")}  ${result.slug}`);
      touched++;
    }
  }
  if (touched === 0) {
    console.log("No mask paths needed normalization. All entries clean.");
  } else {
    console.log(`\nDone — touched ${touched} entr${touched === 1 ? "y" : "ies"}.`);
    console.log("Next: run `npm run dictionary:validate` to refresh metadata.json + companion .m0 sidecars.");
  }
}

main().catch((e) => {
  console.error("\nNormalization failed:", e.message);
  process.exit(1);
});
