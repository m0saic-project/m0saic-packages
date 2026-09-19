// Mint the INCLUDED starter media — `assets/starter/<role>.svg` — the vector
// stand-ins a template shows in a media slot while the user's prop is empty
// (see `src/media/defaultMedia.ts` → `starterMedia(role)`).
//
// Deterministic and ffmpeg-free: pure string assembly, so the six files are
// regenerable byte-for-byte. Every file carries a `viewBox` ONLY (no width /
// height): the engine's plan-time rasterizer picks the density from the cell
// it fills. No text anywhere — the rasterizer's font fallback is not ours to
// trust, and a stand-in should read as media, not as a label; the Make
// canvas is what says "this one is yours to replace".
//
//   node packages/template-utils/tools/mint-starter-svg.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "starter");

// Studio-dark palette (the creator pack's stage) + the brand orange.
const SURFACE = "#0B0B10";
const TILE = ["#17171F", "#1E1E27", "#14141B", "#23232E"];
const ACCENT = "#EF7525";
const SILHOUETTE = "#2C2C3A";

// The m0saic M — the 33 paths of the canonical 272×272 mark, mirrored as
// data (a public package cannot import the app's assets/M.svg).
const M_PATHS = [
  "M19.7296 0.010376H0.0599976V48.117H19.7296V0.010376Z",
  "M34.9327 55.9604H0V104.067H34.9327V55.9604Z",
  "M62.2438 111.931H34.9327V160.038H62.2438V111.931Z",
  "M27.3212 111.931H0V160.038H27.3212V111.931Z",
  "M34.9327 167.912H0V216.019H34.9327V167.912Z",
  "M62.1336 223.893H27.3712V272H62.1336V223.893Z",
  "M19.7197 223.893H0.0100098V272H19.7197V223.893Z",
  "M131.799 111.931H103.496V160.038H131.799V111.931Z",
  "M174.503 56.0122L163.737 55.9915L139.49 89.6651V104.088L174.503 104.119V56.0122Z",
  "M118.248 104.067H131.799V89.52L107.582 55.9604H69.675V104.067H115.614H118.248Z",
  "M91.3477 33.9223L69.675 3.38805V48.1067H101.924L91.3477 33.9223Z",
  "M180.422 32.8758L169.886 48.1067H180.051H181.574H201.754V3.34662L180.422 32.9172V32.8758Z",
  "M139.49 160.069H165.81L200.512 111.962H139.49V160.069Z",
  "M95.8845 148.278L95.8946 111.931H69.675L95.8845 148.278Z",
  "M135.054 202.612L160.151 167.912L110.036 167.902L135.054 202.612Z",
  "M62.1738 55.9604H42.5742V75.6776H62.1738V55.9604Z",
  "M62.1738 83.5313H42.5742V104.057H62.1738V83.5313Z",
  "M182.185 104.088L201.714 104.067V55.9604L182.185 55.9915V104.088Z",
  "M62.1837 0.010376H27.3312V48.117H62.1837V0.010376Z",
  "M62.0736 167.912H42.5141V187.629H62.0736V167.912Z",
  "M62.0736 195.494H42.5141V216.019H62.0736V195.494Z",
  "M271.95 223.883H252.28V271.99H271.95V223.883Z",
  "M272 167.933H237.067V216.04H272V167.933Z",
  "M237.067 111.952H209.756V160.059H237.067V111.952Z",
  "M272 111.952H244.679V160.059H272V111.952Z",
  "M272 55.9707H237.067V104.077H272V55.9707Z",
  "M244.629 0H209.866V48.1067H244.629V0Z",
  "M271.99 0H252.28V48.1067H271.99V0Z",
  "M229.426 196.322H209.826V216.04H229.426V196.322Z",
  "M229.426 167.933H209.826V188.458H229.426V167.933Z",
  "M244.679 223.883H209.826V271.99H244.679V223.883Z",
  "M229.486 84.3602H209.926V104.077H229.486V84.3602Z",
  "M229.486 55.9707H209.926V76.4961H229.486V55.9707Z",
];

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

/** The M mark, scaled to `size` with its top-left at (x, y). */
function mark(x, y, size, opacity = 1) {
  const s = size / 272;
  return (
    `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(s)})" fill="${ACCENT}"` +
    (opacity < 1 ? ` opacity="${fmt(opacity)}"` : "") +
    `>` +
    M_PATHS.map((d) => `<path d="${d}"/>`).join("") +
    `</g>`
  );
}

/** A mosaic of rounded tiles on the surface — "rectangles on a canvas". */
function tile(x, y, w, h, fill, r = 10) {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${r}" fill="${fill}"/>`;
}

/** A quiet light falling across a tile — the one gradient the set uses. */
const SHEEN =
  `<defs><linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="#ffffff" stop-opacity="0.045"/>` +
  `<stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>` +
  `</linearGradient></defs>`;

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
}

/** Head-and-shoulders, centred at cx with the head at cy — two flat shapes
 *  on the surface, nothing behind them (founder 2026-09-17: no halo). */
function silhouette(cx, cy, headR, w, bottom) {
  const shoulderTop = cy + headR * 1.55;
  const half = w / 2;
  return (
    `<path d="M${fmt(cx - half)} ${fmt(bottom)}C${fmt(cx - half)} ${fmt(shoulderTop + headR * 0.4)} ${fmt(cx - headR * 1.15)} ${fmt(shoulderTop)} ${fmt(cx)} ${fmt(shoulderTop)}C${fmt(cx + headR * 1.15)} ${fmt(shoulderTop)} ${fmt(cx + half)} ${fmt(shoulderTop + headR * 0.4)} ${fmt(cx + half)} ${fmt(bottom)}Z" fill="${SILHOUETTE}"/>` +
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(headR)}" fill="${SILHOUETTE}"/>`
  );
}

const FILES = {
  // 16:9 — a wide tile beside two stacked ones; the mark rides the small one.
  "landscape.svg": () => {
    const W = 1600, H = 900, g = 16;
    const left = [g, g, 928, H - 2 * g];
    const r1 = [960, g, W - 960 - g, 426];
    const r2 = [960, 458, W - 960 - g, H - 458 - g];
    return svg(W, H,
      SHEEN +
      `<rect width="${W}" height="${H}" fill="${SURFACE}"/>` +
      tile(...left, TILE[0]) + tile(...left, "url(#sheen)") +
      tile(...r1, TILE[1]) + tile(...r2, TILE[2]) +
      mark(W - g - 40 - 96, H - g - 40 - 96, 96),
    );
  },
  // 9:16 — a tall tile over two side by side.
  "portrait.svg": () => {
    const W = 900, H = 1600, g = 16;
    const top = [g, g, W - 2 * g, 1000];
    const b1 = [g, 1032, 426, H - 1032 - g];
    const b2 = [458, 1032, W - 458 - g, H - 1032 - g];
    return svg(W, H,
      SHEEN +
      `<rect width="${W}" height="${H}" fill="${SURFACE}"/>` +
      tile(...top, TILE[0]) + tile(...top, "url(#sheen)") +
      tile(...b1, TILE[2]) + tile(...b2, TILE[1]) +
      mark(W - g - 40 - 96, H - g - 40 - 96, 96),
    );
  },
  // 1:1 — a big tile, a tall one beside it, a strip under both.
  "square.svg": () => {
    const W = 1200, H = 1200, g = 16;
    const big = [g, g, 776, 776];
    const side = [808, g, W - 808 - g, 776];
    const strip = [g, 808, W - 2 * g, H - 808 - g];
    return svg(W, H,
      SHEEN +
      `<rect width="${W}" height="${H}" fill="${SURFACE}"/>` +
      tile(...big, TILE[0]) + tile(...big, "url(#sheen)") +
      tile(...side, TILE[1]) + tile(...strip, TILE[2]) +
      mark(W - g - 40 - 96, H - g - 40 - 96, 96),
    );
  },
  // A phone-shot facecam: the camera window, a person-shaped stand-in, a
  // quiet rec light. Portrait, because that is what a facecam slot expects.
  "facecam.svg": () => {
    const W = 900, H = 1600, g = 24;
    return svg(W, H,
      `<rect width="${W}" height="${H}" fill="${SURFACE}"/>` +
      tile(g, g, W - 2 * g, H - 2 * g, TILE[0], 28) +
      `<clipPath id="win"><rect x="${g}" y="${g}" width="${W - 2 * g}" height="${H - 2 * g}" rx="28"/></clipPath>` +
      `<g clip-path="url(#win)">` + silhouette(W / 2, 600, 150, 640, H) + `</g>` +
      `<circle cx="84" cy="84" r="13" fill="${ACCENT}"/>` +
      `<circle cx="84" cy="84" r="22" fill="none" stroke="${ACCENT}" stroke-width="3" opacity="0.45"/>` +
      mark(W - g - 32 - 72, H - g - 32 - 72, 72, 0.9),
    );
  },
  // Circle-safe: everything — the figure, the ring, the mark — sits inside
  // the inscribed circle, so a round mask (the usual avatar treatment)
  // loses nothing.
  "avatar.svg": () => {
    const W = 1024, H = 1024, c = 512;
    return svg(W, H,
      `<clipPath id="disc"><circle cx="${c}" cy="${c}" r="500"/></clipPath>` +
      `<circle cx="${c}" cy="${c}" r="500" fill="${TILE[0]}"/>` +
      `<g clip-path="url(#disc)">` + silhouette(c, 430, 170, 720, H) + `</g>` +
      `<circle cx="${c}" cy="${c}" r="494" fill="none" stroke="${ACCENT}" stroke-width="12"/>` +
      // The mark hugs the top of the ring (its inner edge is y 24), centred
      // above the figure — inside the disc, so a circular mask keeps it.
      mark(c - 36, 44, 72, 0.9),
    );
  },
  // The M itself, on nothing — a logo slot keeps its own background.
  "logo.svg": () => svg(272, 272, `<g fill="${ACCENT}">` + M_PATHS.map((d) => `<path d="${d}"/>`).join("") + `</g>`),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, build] of Object.entries(FILES)) {
  const text = build();
  if (/<text[\s>]/.test(text)) throw new Error(`${name}: no text in a starter`);
  if (/<svg[^>]*\s(width|height)=/.test(text)) throw new Error(`${name}: viewBox only, no width/height`);
  const p = path.join(OUT, name);
  fs.writeFileSync(p, text);
  console.log(`${name.padEnd(14)} ${String(Buffer.byteLength(text)).padStart(5)} B`);
}
