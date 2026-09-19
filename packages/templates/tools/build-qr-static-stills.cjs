/**
 * Bake the STATIC brand-QR stills used by `@m0saic/brand/qr-stamp/video/v2`'s
 * short-clip static tier (clips < ~2.5s overlay a fully-solid, opaque QR
 * instead of the animation, so a 2s attribution clip is scannable the whole
 * time).
 *
 * Source: `brand-qr-with-logo.svg` (the canonical brand QR WITH the solid M
 * logo — committed alongside the mp4s). We rasterize it rather than grab a
 * frame of the animated mp4, because the mp4's M is mid-shimmer at any frame
 * (loading-UI breathe) and never fully solid. The SVG's M is solid.
 *
 * Rounded modules: the QR cells are converted to circles (`roundModules`)
 * so the still matches the animated mp4's dot-matrix look — the mp4 renders
 * with qr-animate's `moduleBorderRadius: 1.0`. The embedded `<image>` M logo
 * stays solid and square; only the data/eye cells round.
 *
 *   light → SVG as-authored (white card + orange modules/M)
 *   dark  → same SVG with #ffffff → #000000 (black card; modules/M stay orange)
 *
 * Each output adds a URL strip below the QR matching the animated mp4
 * variant (1222×1342 → 1225×1345 here, same aspect ratio): white text
 * on black for dark, black text on white for light. Keeps the short-clip
 * static tier visually consistent with the animated stamp.
 *
 * Writes:
 *   src/m0saic/brand/qr-stamp/assets/qr-animate.light.static.png
 *   src/m0saic/brand/qr-stamp/assets/qr-animate.dark.static.png
 *
 * Run, then rebuild the templates package so copy-assets.mjs mirrors the PNGs
 * into dist/:
 *
 *   node packages/templates/tools/build-qr-static-stills.cjs
 *   npm run build -w @m0saic/templates
 *
 * Needs `sharp` (already a dependency of @m0saic/dictionary for mask raster).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ASSETS_DIR = path.resolve(
  __dirname,
  "..",
  "src",
  "m0saic",
  "brand",
  "qr-stamp",
  "assets",
);
const SVG_PATH = path.join(ASSETS_DIR, "brand-qr-with-logo.svg");

// 49 QR modules × 25 px = a crisp integer scale; the engine scales the stamp
// down to its corner slot, so this just needs to be comfortably high-res.
const SIZE = 1225;

// URL strip below the QR — matches the animated mp4's aspect (1222×1342 → 1.098:1).
// Strip height is proportional so the static still has the same overall
// shape; qr-stamp/video/v2's `fit: "contain"` placement will render both
// the animated and static variants at identical proportions in the user's
// video stamp slot.
const STRIP_HEIGHT = Math.round(SIZE * (120 / 1222)); // ≈ 120
const URL_LABEL = "https://m0saic.io";
// Match the mp4 font sizing: ~85% of strip height, glyphs fill the strip
// with a small natural quiet area top/bottom.
const URL_FONT_SIZE = Math.round(STRIP_HEIGHT * 0.85);
// SVG baseline y position. librsvg (sharp's SVG renderer) doesn't
// honor `dominant-baseline` reliably, so we position the baseline
// explicitly. For a font-size of ~85% of strip height with typical
// ascender/descender ratios (~0.75 / 0.25 of em), placing the
// baseline at ~71% of strip height puts cap-tops ~9% from the top
// and descender bottoms ~9% from the bottom — symmetric padding,
// no clipping on "p"/"j"/etc.
const TEXT_BASELINE_Y = Math.round(STRIP_HEIGHT * 0.71);

// Text/bg colors per variant — invert each pair so the URL is legible:
//   light: black text on white plate (matches QR card)
//   dark:  off-white text on black plate
const STRIP_COLORS = {
  light: { bg: "#ffffff", fg: "#111111" },
  dark:  { bg: "#000000", fg: "#f5f5f5" },
};

// The committed SVG declares only a viewBox; inject explicit pixel dims so
// sharp rasterizes at full resolution instead of the 49 px intrinsic size.
// Also drop `shape-rendering="crispEdges"` — crisp edges alias the rounded
// modules (see `roundModules`); we want antialiased circles.
function sized(svg) {
  return svg
    .replace(/\s*shape-rendering="crispEdges"/, "")
    .replace(/<svg\s/, `<svg width="${SIZE}" height="${SIZE}" `);
}

// ── Finder geometry (must match the baked mp4 / qr-animate) ──────────
// The brand QR is version 6: a 41×41 matrix with a 4-module quiet zone
// (49×49 grid). Its three finder patterns are 7×7 blocks at the corners.
const QZ = 4;
const MATRIX = 41;
const FINDER_SPAN = 7;
const GRID = QZ + MATRIX + QZ; // 49
const FINDER_ORIGINS = [
  { x: QZ, y: QZ }, // top-left (4,4)
  { x: GRID - QZ - FINDER_SPAN, y: QZ }, // top-right (38,4)
  { x: QZ, y: GRID - QZ - FINDER_SPAN }, // bottom-left (4,38)
];
// Rounded-eye corner radii — mirror qr-animate's `eyes` defaults exactly so
// the static still and the animated mp4 read identically: outer rounded
// square 0.35, circular centre dot (1.0). borderRadius is a fraction of the
// half-dimension (1.0 → a perfect circle), same as makeColorTile rounding.
const EYE_OUTER_BR = 0.35;
const EYE_DOT_BR = 1.0;

/** True if the integer cell (x, y) lies inside any of the three finders. */
function isFinderCell(x, y) {
  return FINDER_ORIGINS.some(
    (o) =>
      x >= o.x && x < o.x + FINDER_SPAN && y >= o.y && y < o.y + FINDER_SPAN,
  );
}

// Convert each 1×1 QR DATA-module `<rect>` into a `<circle>` so the baked
// still matches the animated mp4's dot-matrix look (qr-animate renders data
// modules with `moduleBorderRadius: 1.0`). The three finder patterns are
// handled separately by `addRoundedEyes` — their per-cell rects are DROPPED
// here so nothing shows underneath the single rounded eye.
//
// Only 1×1 module rects match. The white background (49×49) and safe-area
// (13×13) rects keep their square shape, and the embedded base64 `<image>`
// M logo is untouched — so the centre M stays solid exactly as before.
function roundModules(svg) {
  return svg.replace(
    /<rect x="(\d+(?:\.\d+)?)" y="(\d+(?:\.\d+)?)" width="1" height="1"\s*\/>/g,
    (_m, x, y) =>
      isFinderCell(Number(x), Number(y))
        ? "" // finder cell — replaced wholesale by the rounded eye
        : `<circle cx="${Number(x) + 0.5}" cy="${Number(y) + 0.5}" r="0.5"/>`,
  );
}

// Emit a single "Instagram-style" rounded eye per finder: an outer rounded
// square (orange, inheriting the group fill), an inner light ring square
// (white → black in the dark variant via the #ffffff swap), and a rounded
// centre dot (orange). Concentric 7 → 5 → 3 cells, matching
// makeQrEyeChildDoc's composition. Injected just before the orange group's
// `</g>` so the outer square + dot inherit `fill="#f97316"`.
function addRoundedEyes(svg) {
  const rx = (size, br) => (br * size) / 2;
  const outerRx = rx(FINDER_SPAN, EYE_OUTER_BR); // 7 → 1.225
  const lightRx = rx(FINDER_SPAN - 2, EYE_OUTER_BR); // 5 → 0.875
  const dotRx = rx(FINDER_SPAN - 4, EYE_DOT_BR); // 3 → 1.5 (circle)
  const eyes = FINDER_ORIGINS.map((o) => {
    const outer = `<rect x="${o.x}" y="${o.y}" width="${FINDER_SPAN}" height="${FINDER_SPAN}" rx="${outerRx}" ry="${outerRx}"/>`;
    const light = `<rect x="${o.x + 1}" y="${o.y + 1}" width="${FINDER_SPAN - 2}" height="${FINDER_SPAN - 2}" rx="${lightRx}" ry="${lightRx}" fill="#ffffff"/>`;
    const dot = `<rect x="${o.x + 2}" y="${o.y + 2}" width="${FINDER_SPAN - 4}" height="${FINDER_SPAN - 4}" rx="${dotRx}" ry="${dotRx}"/>`;
    return outer + light + dot;
  }).join("");
  // Inject before the first (only) group close — the orange module group.
  return svg.replace("</g>", `${eyes}</g>`);
}

/** Build the URL strip as an SVG buffer so sharp can rasterize it. */
function buildStripSvg(bg, fg) {
  // No `dominant-baseline` — see TEXT_BASELINE_Y above. We treat `y`
  // as the literal text baseline (the SVG default), which is the one
  // attribute librsvg implements consistently across versions.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${STRIP_HEIGHT}">` +
      `<rect width="100%" height="100%" fill="${bg}"/>` +
      `<text x="50%" y="${TEXT_BASELINE_Y}" ` +
      `font-family="Helvetica, Arial, sans-serif" font-weight="500" ` +
      `font-size="${URL_FONT_SIZE}" fill="${fg}" ` +
      `text-anchor="middle">` +
      URL_LABEL +
      `</text>` +
      `</svg>`,
  );
}

async function main() {
  const svg = fs.readFileSync(SVG_PATH, "utf8");
  const rounded = addRoundedEyes(roundModules(sized(svg)));
  const variants = {
    light: rounded,
    dark: rounded.replace(/#ffffff/gi, "#000000"),
  };
  const totalHeight = SIZE + STRIP_HEIGHT;

  for (const [variant, str] of Object.entries(variants)) {
    const out = path.join(ASSETS_DIR, `qr-animate.${variant}.static.png`);
    const colors = STRIP_COLORS[variant];

    // Rasterize the QR portion to a buffer (so we can composite the strip
    // below it on a single canvas).
    const qrBuf = await sharp(Buffer.from(str)).png().toBuffer();

    // Build + rasterize the strip SVG.
    const stripBuf = await sharp(buildStripSvg(colors.bg, colors.fg))
      .png()
      .toBuffer();

    // Composite: base canvas filled with the QR's bg color (so any rounding
    // gaps along the seam blend invisibly), QR pasted at top, strip below.
    await sharp({
      create: {
        width: SIZE,
        height: totalHeight,
        channels: 4,
        background: colors.bg,
      },
    })
      .composite([
        { input: qrBuf, top: 0, left: 0 },
        { input: stripBuf, top: SIZE, left: 0 },
      ])
      .png()
      .toFile(out);

    console.log(`→ ${variant.padEnd(5)} → ${path.basename(out)} (${SIZE}×${totalHeight})`);
  }
  console.log("\nDone. Re-run `npm run build -w @m0saic/templates` to mirror into dist/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
