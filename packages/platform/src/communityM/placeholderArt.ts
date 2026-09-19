/**
 * Placeholder tile ART for Community M previews — ONE bank, two consumers:
 * the Community page's open-tile preview toggle and the
 * `@m0saic/brand/community-m/v1` template's dev preview knobs. Keep it
 * here (pure, browser-safe) so the app and the render agree on what a
 * simulated M looks like.
 *
 * Original note — a best guess at what
 * contributors will actually put in a tile, generated deterministically per
 * tile index as inline SVG data URLs so the painter treats them exactly like
 * uploaded images (cover-fit, clipped, orange edge, no glyph backing).
 *
 * Two families, mirroring the founder's community-sim mock:
 *   - logos: OSS-project-style marks — monogram on a rounded square,
 *     lowercase letter in a circle, hex badge, `{}` on dark, chevrons,
 *     mirrored pixel art — in the colours real projects use.
 *   - avatars: flat illustrated portraits — skin tone, hair, shoulders, a
 *     coloured backdrop, sometimes glasses — the "illustrated avatar" lane
 *     the tile rules invite.
 *
 * We do not know what people will do; this is the honest stand-in. Pure and
 * seedless (index-keyed) so a preview is identical on every machine.
 */

/**
 * URL-encoded, NOT base64 (no `Buffer`, so this stays browser-safe) and with
 * NO `;utf8` parameter: the render engine's plain-SVG data-URI parser only
 * accepts `;key=value` parameters, so a bare `data:image/svg+xml,…` is the
 * one form both the DOM and the rasterizer read.
 */
const svgUrl = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const wrap = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${body}</svg>`;

/** Project-mark palette: [background, foreground]. Colours real OSS marks use. */
const LOGO_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#1f6feb", "#ffffff"], ["#e34c26", "#ffffff"], ["#f7df1e", "#111111"], ["#3178c6", "#ffffff"],
  ["#00add8", "#ffffff"], ["#dea584", "#111111"], ["#41b883", "#ffffff"], ["#764abc", "#ffffff"],
  ["#ff3e00", "#ffffff"], ["#111111", "#ffffff"], ["#2496ed", "#ffffff"], ["#f05032", "#ffffff"],
  ["#5c6ac4", "#ffffff"], ["#0f9d58", "#ffffff"], ["#e91e63", "#ffffff"], ["#ff9800", "#111111"],
];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Mix a tile index with a shuffle seed into one 32-bit hash. Every art
 * decision (kind, palette, letter, avatar traits, logo-or-avatar) is drawn
 * from this, so nothing correlates with the raw tile index — the bug the
 * first version had, where "every third tile is a logo" and "kind = index
 * mod 6" conspired to show only two logo kinds in Mix.
 */
export function artHash(tileIndex: number, seed: number, salt: number): number {
  let h = (tileIndex * 0x9e3779b1) ^ (seed * 0x85ebca6b) ^ (salt * 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Tiny deterministic PRNG (mulberry32) — hash-seeded, no Math.random. */
function rng(seed: number): () => number {
  let s = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeholderLogoSvg(i: number, seed = 1): string {
  const [bg, fg] = LOGO_PALETTES[artHash(i, seed, 1) % LOGO_PALETTES.length];
  const letter = LETTERS[artHash(i, seed, 2) % LETTERS.length];
  const kind = artHash(i, seed, 3) % 6;
  const font = 'font-family="Helvetica, Arial, sans-serif" font-weight="700"';
  switch (kind) {
    case 0: // monogram on a rounded square
      return wrap(`<rect width="200" height="200" rx="40" fill="${bg}"/><text x="100" y="138" ${font} font-size="120" text-anchor="middle" fill="${fg}">${letter}</text>`);
    case 1: // lowercase letter in a circle
      return wrap(`<rect width="200" height="200" fill="${fg === "#ffffff" ? "#0b0f19" : "#ffffff"}"/><circle cx="100" cy="100" r="86" fill="${bg}"/><text x="100" y="134" ${font} font-size="104" text-anchor="middle" fill="${fg}">${letter.toLowerCase()}</text>`);
    case 2: // hex badge
      return wrap(`<rect width="200" height="200" fill="${bg}"/><polygon points="100,22 168,61 168,139 100,178 32,139 32,61" fill="none" stroke="${fg}" stroke-width="14"/><circle cx="100" cy="100" r="22" fill="${fg}"/>`);
    case 3: // braces on dark
      return wrap(`<rect width="200" height="200" fill="#0b0f19"/><text x="100" y="140" font-family="Menlo, Consolas, monospace" font-weight="700" font-size="120" text-anchor="middle" fill="${bg === "#111111" ? "#ffffff" : bg}">{}</text>`);
    case 4: // chevrons
      return wrap(`<rect width="200" height="200" fill="${bg}"/><polyline points="40,60 100,110 160,60" fill="none" stroke="${fg}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><polyline points="40,110 100,160 160,110" fill="none" stroke="${fg}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>`);
    default: { // mirrored pixel art
      const r = rng(artHash(i, seed, 4));
      let cells = "";
      for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) if (r() > 0.5) {
        cells += `<rect x="${x * 25}" y="${y * 25}" width="25" height="25" fill="${fg}"/><rect x="${175 - x * 25}" y="${y * 25}" width="25" height="25" fill="${fg}"/>`;
      }
      return wrap(`<rect width="200" height="200" fill="${bg}" shape-rendering="crispEdges"/><g shape-rendering="crispEdges">${cells}</g>`);
    }
  }
}

const SKIN = ["#f3d1b0", "#e0ac7e", "#c68642", "#8d5524", "#5a3825"];
const HAIR = ["#1b1b1b", "#3a2a1a", "#7a4a1f", "#c99a3b", "#6b6b6b", "#b33a3a"];
const BACKDROP = ["#2b6cb0", "#c05621", "#2f855a", "#6b46c1", "#b7791f", "#c53030", "#0f766e", "#374151", "#7c3aed", "#0891b2"];

export function placeholderAvatarSvg(i: number, seed = 1): string {
  const r = rng(artHash(i, seed, 5));
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const bg = BACKDROP[Math.floor(r() * BACKDROP.length)];
  const style = Math.floor(r() * 5);
  const glasses = r() > 0.7;
  const shirt = BACKDROP[Math.floor(r() * BACKDROP.length)];
  // hair shapes drawn behind/over the head
  const hairBack = style === 2 ? `<ellipse cx="100" cy="118" rx="52" ry="58" fill="${hair}"/>` : "";
  const hairTop = [
    `<path d="M56 96 Q100 40 144 96 L144 84 Q100 46 56 84 Z" fill="${hair}"/>`,               // short cap
    `<circle cx="100" cy="62" r="18" fill="${hair}"/><path d="M58 96 Q100 56 142 96 Z" fill="${hair}"/>`, // bun
    `<path d="M54 100 Q100 44 146 100 Z" fill="${hair}"/>`,                                     // long (with back)
    `<path d="M60 92 Q100 58 140 92 Z" fill="${hair}" opacity="0.9"/>`,                        // buzz
    `<circle cx="72" cy="78" r="16" fill="${hair}"/><circle cx="100" cy="66" r="18" fill="${hair}"/><circle cx="128" cy="78" r="16" fill="${hair}"/>`, // curly
  ][style];
  const specs = glasses ? `<g fill="none" stroke="#111" stroke-width="4"><circle cx="84" cy="104" r="12"/><circle cx="116" cy="104" r="12"/><line x1="96" y1="104" x2="104" y2="104"/></g>` : "";
  return wrap(
    `<rect width="200" height="200" fill="${bg}"/>` +
    hairBack +
    `<path d="M40 200 Q40 150 100 150 Q160 150 160 200 Z" fill="${shirt}"/>` +
    `<rect x="88" y="128" width="24" height="26" fill="${skin}"/>` +
    `<circle cx="100" cy="102" r="40" fill="${skin}"/>` +
    hairTop +
    `<circle cx="86" cy="104" r="3.5" fill="#1b1b1b"/><circle cx="114" cy="104" r="3.5" fill="#1b1b1b"/>` +
    `<path d="M88 122 Q100 132 112 122" fill="none" stroke="#7a3b2e" stroke-width="3" stroke-linecap="round"/>` +
    specs,
  );
}

export const placeholderLogoUrl = (i: number, seed = 1): string => svgUrl(placeholderLogoSvg(i, seed));
export const placeholderAvatarUrl = (i: number, seed = 1): string => svgUrl(placeholderAvatarSvg(i, seed));
/**
 * Mix: a crowd of avatars with logos threaded through. `logoShare` (0..1,
 * default a third) sets the balance; which tiles get logos is hash-drawn so
 * a shuffle re-deals both the balance and the art.
 */
export const placeholderMixUrl = (i: number, seed = 1, logoShare = 1 / 3): string =>
  artHash(i, seed, 6) / 4294967296 < logoShare ? placeholderLogoUrl(i, seed) : placeholderAvatarUrl(i, seed);

/** The stand-in families the preview offers. */
export type PlaceholderArtStyle = "faces" | "logos" | "mix";

/**
 * One tile's stand-in as an SVG STRING (the url helpers above wrap this for
 * the DOM; the render path base64s it into a data-uri media asset, which the
 * engine rasterizes). `mix` draws logo-or-avatar from the same hash the url
 * helper uses, so a given (tile, seed, share) is the same art everywhere.
 */
export function placeholderArtSvg(i: number, style: PlaceholderArtStyle, seed = 1, logoShare = 1 / 3): string {
  if (style === "faces") return placeholderAvatarSvg(i, seed);
  if (style === "logos") return placeholderLogoSvg(i, seed);
  return artHash(i, seed, 6) / 4294967296 < logoShare ? placeholderLogoSvg(i, seed) : placeholderAvatarSvg(i, seed);
}

/**
 * Where a stand-in wants to be cropped. Avatars are portraits — the tile
 * rule of thumb puts the hair just under the top edge, so the crop sits
 * above centre; logos are centred marks.
 */
export function placeholderArtFocus(i: number, style: PlaceholderArtStyle, seed = 1, logoShare = 1 / 3): { x: number; y: number } {
  const isLogo = style === "logos" || (style === "mix" && artHash(i, seed, 6) / 4294967296 < logoShare);
  return isLogo ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 0.42 };
}

/** One tile's stand-in as a data URL — URL-encoded, NOT base64, so it needs no `Buffer` and works in the browser bundle. */
export function placeholderArtUrl(i: number, style: PlaceholderArtStyle, seed = 1, logoShare = 1 / 3): string {
  return svgUrl(placeholderArtSvg(i, style, seed, logoShare));
}

/** Stand-in art is authored on a square viewBox; the crop maths only needs the aspect. */
export const PLACEHOLDER_ART_SIZE = { width: 200, height: 200 } as const;
