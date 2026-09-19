#!/usr/bin/env node
// @ts-check
/**
 * Build the two committed brand-QR animation assets.
 *
 * Renders `@m0saic/media/qr/animate/v1` against the `brand/qr` dictionary
 * entry at native 1222×1222, once for each variant ("light" / "dark"),
 * writing the resulting mp4s into the template's `assets/` directory:
 *
 *   src/m0saic/brand/qr-stamp/assets/qr-animate.light.mp4
 *   src/m0saic/brand/qr-stamp/assets/qr-animate.dark.mp4
 *
 * Idempotent: re-running overwrites the existing files. Intended to be
 * run manually whenever the brand QR's m0c, the qr-animate template, or
 * the brand-orange/M-33 entry changes. Build output is committed.
 *
 * Bootstrap requirement: `@m0saic/dictionary` and `@m0saic/templates`
 * must be built (dist/) before running this script — the CLI it invokes
 * resolves both packages from their dist. After this script writes new
 * mp4s, rebuild the templates package one more time so `copy-assets.mjs`
 * mirrors them into `dist/`.
 *
 *   npm run build -w @m0saic/dictionary
 *   npm run build -w @m0saic/templates
 *   node packages/templates/tools/build-qr-rendered.cjs
 *   npm run build -w @m0saic/templates   # re-run to mirror new mp4s
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PKG_ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(
  PKG_ROOT,
  "src",
  "m0saic",
  "brand",
  "qr-stamp",
  "assets",
);
const CLI_ENTRY = path.resolve(
  PKG_ROOT,
  "..",
  "cli",
  "dist",
  "index.js",
);

// Lock the rendered envelope so consumers (qr-stamp/v2) can rely on it.
// Mirrors the qr-animate defaults; if the template defaults change,
// update this constant and re-run.
const NATURAL_DUR_MS = 7020;

// Canvas width = QR's native size. Height = QR + URL strip. The QR
// template auto-detects the strip when `height > width` and emits a
// vertical-split doc with `https://m0saic.io` rendered in the bottom
// band (so viewers can reach the URL even when they can't scan). The
// QR keeps its full 4-module quiet zone on all four sides — this is
// the safer scannability tier; the tighter in-quiet-zone variant is
// a follow-up if a smaller stamp footprint is desired.
const CANVAS_W = 1222;
const STRIP_HEIGHT = 120;
const CANVAS_H = CANVAS_W + STRIP_HEIGHT;

if (!fs.existsSync(CLI_ENTRY)) {
  throw new Error(
    `CLI entry not found at ${CLI_ENTRY}. ` +
    `Run "npm run build -w @m0saic/cli" first.`,
  );
}

const { registry } = require("@m0saic/dictionary");
const qr = registry.byId["brand/qr"];
if (!qr) {
  throw new Error(
    `Dictionary entry "brand/qr" not found. ` +
    `Run "npm run build -w @m0saic/dictionary" first.`,
  );
}

fs.mkdirSync(ASSETS_DIR, { recursive: true });

/** @type {Array<"light" | "dark">} */
const VARIANTS = ["light", "dark"];

const baseProps = {
  qrM0: qr.m0,
  qrLabels: qr.labels,
  spawnDurMs: 1200,
  tileFadeMs: 220,
  tileOffsetPx: 2,
  mDelayMs: 200,
  mInDurMs: 700,
  mTileFadeMs: 220,
  idleDurMs: 4000,
  fadeOutDurMs: 700,
  centreLabel: "safe-area",
  // Per-cell module gleam — a travelling shine over the QR modules that stacks
  // under the M's loading shimmer. The committed mp4 (consumed by
  // qr-stamp/video/v2) carries it, so the watermark gleams per-cell.
  gleam: true,
  // Circle dots for the brand stamp. Each data module renders as a circular
  // dot. Set to 0 to go back to the canonical square tiles.
  moduleBorderRadius: 1.0,
  // Instagram-style rounded finder eyes: each of the three 7×7 finder
  // patterns becomes a single rounded-square ring with a circular centre
  // dot, instead of a grid of dots. The underlying per-cell finder modules
  // are suppressed so nothing bleeds past the ring. Geometry defaults match
  // the brand QR (version 6 → 41×41 matrix, quiet zone 4).
  eyes: { outerBorderRadius: 0.35, innerDotBorderRadius: 1.0 },
};

const envelopeCheck =
  baseProps.spawnDurMs +
  baseProps.tileFadeMs +
  baseProps.mDelayMs +
  baseProps.mInDurMs +
  baseProps.idleDurMs +
  baseProps.fadeOutDurMs;
if (envelopeCheck !== NATURAL_DUR_MS) {
  throw new Error(
    `Computed envelope (${envelopeCheck}ms) does not match NATURAL_DUR_MS ` +
    `(${NATURAL_DUR_MS}ms). Update one to match the other.`,
  );
}

for (const variant of VARIANTS) {
  const propsPath = path.join(
    os.tmpdir(),
    `qr-rendered-build-${variant}.json`,
  );
  fs.writeFileSync(
    propsPath,
    JSON.stringify({ ...baseProps, variant }, null, 2),
  );

  const outPath = path.join(ASSETS_DIR, `qr-animate.${variant}.mp4`);

  console.log(`\n→ Rendering ${variant} variant to ${outPath}`);
  console.log(`  ${CANVAS_W}×${CANVAS_H} (QR ${CANVAS_W}×${CANVAS_W} + URL strip ${CANVAS_W}×${STRIP_HEIGHT}), ${NATURAL_DUR_MS}ms`);

  execFileSync(
    process.execPath,
    [
      CLI_ENTRY,
      "make",
      "@m0saic/media/qr/animate/v1",
      "-w",
      String(CANVAS_W),
      "-h",
      String(CANVAS_H),
      "--durationMs",
      String(NATURAL_DUR_MS),
      "--props",
      `@${propsPath}`,
      "-o",
      outPath,
      // libx264 is widely available (libopenh264 isn't on every Mac ffmpeg
      // build). Final mp4 quality is comparable; both produce H.264.
      "--video-codec",
      "libx264",
      "--quiet",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        // The free-tier stamp wrapper would slap a second QR on top —
        // bypass it via the paid-tier license env so this script (which
        // IS the brand-asset builder) renders a clean QR.
        M0SAIC_PRODUCT_KEY: "internal-brand-asset-builder",
      },
    },
  );

  fs.unlinkSync(propsPath);

  const stat = fs.statSync(outPath);
  console.log(`  ✅ ${(stat.size / 1024).toFixed(1)} KB`);
}

console.log("\n✅ Brand QR assets written to:");
console.log(`     ${ASSETS_DIR}`);
console.log("\nNext: re-run `npm run build -w @m0saic/templates` to mirror");
console.log("the new mp4s into dist/ via copy-assets.mjs.");
