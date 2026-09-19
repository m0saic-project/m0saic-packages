/**
 * Stand-in pictures, so the film can be laid out and paced before a single
 * real photograph exists.
 *
 * Deliberately NOT photographic: soft warm shapes that read as "a picture
 * goes here" at a glance. Fakes that looked real would flatter the layout
 * and hide what the real thing has to survive.
 *
 * Generated as URL-encoded SVG data URIs — no `Buffer` (so this module is
 * browser-safe) and no `;utf8` parameter, which the engine's plain-SVG
 * parser rejects.
 */

export type ClaimImageLike = { kind: "file"; path: string } | { kind: "data-uri"; uri: string };

/** Warm, faded-snapshot palettes: [sky, ground, subject]. */
const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#D8C7A8", "#B49B78", "#6E5842"],
  ["#C9CFC0", "#9FAE94", "#4F5C4A"],
  ["#E2C7B4", "#C39A85", "#7A5545"],
  ["#C6CDD8", "#98A5B6", "#4C5769"],
  ["#E0D2B6", "#BFA97F", "#6B5636"],
];

function hash(i: number, salt: number): number {
  let h = (i * 0x9e3779b1) ^ (salt * 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** One stand-in picture, deterministic per page index. */
export function standInPhotoSvg(i: number, paper: string): string {
  const [sky, ground, subject] = PALETTES[hash(i, 1) % PALETTES.length];
  const horizon = 96 + (hash(i, 2) % 40);
  const sunX = 40 + (hash(i, 3) % 120);
  const figures = 1 + (hash(i, 4) % 3);
  const people = Array.from({ length: figures }, (_, k) => {
    const x = 40 + ((hash(i, 10 + k) % 120));
    const h = 26 + (hash(i, 20 + k) % 18);
    return `<circle cx="${x}" cy="${horizon + 14 - h}" r="7" fill="${subject}"/><rect x="${x - 7}" y="${horizon + 22 - h}" width="14" height="${h}" rx="6" fill="${subject}"/>`;
  }).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">` +
    `<rect width="200" height="200" fill="${sky}"/>` +
    `<circle cx="${sunX}" cy="${horizon - 54}" r="18" fill="${paper}" opacity="0.55"/>` +
    `<rect y="${horizon}" width="200" height="${200 - horizon}" fill="${ground}"/>` +
    people +
    `</svg>`
  );
}

export function standInPhotoUrl(i: number, paper: string): string {
  return `data:image/svg+xml,${encodeURIComponent(standInPhotoSvg(i, paper))}`;
}
