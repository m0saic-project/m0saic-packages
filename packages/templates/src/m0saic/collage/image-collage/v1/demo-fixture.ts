/**
 * Demo fixture — the zero-setup collage.
 *
 * When no images are supplied the template packs this deterministic set of
 * synthetic "photos" (aspect + tile color) instead of erroring. That gives a
 * meaningful defaultProps render everywhere it matters: the Templates-page
 * preview, the media-free CLI E2E case, and the `audit:layout-envelope`
 * sweep (which renders defaultProps at 51 canvases and needs the contract to
 * have real geometry to judge).
 *
 * The mix mirrors the founder's traced seed collage proportionally:
 * landscape-dominant with a few portraits and a square.
 */

export type DemoImage = { aspect: number; color: string };

export const DEMO_IMAGES: readonly DemoImage[] = [
  { aspect: 1.5, color: "#2d4f67" },
  { aspect: 1.33, color: "#5a3e5d" },
  { aspect: 1.78, color: "#3e5c46" },
  { aspect: 0.67, color: "#7a5230" },
  { aspect: 1.5, color: "#37556e" },
  { aspect: 1.25, color: "#6e4444" },
  { aspect: 0.75, color: "#44606a" },
  { aspect: 1.6, color: "#585a38" },
  { aspect: 1.0, color: "#4f4668" },
  { aspect: 1.45, color: "#2f5f58" },
  { aspect: 0.56, color: "#6a3f52" },
  { aspect: 1.33, color: "#3f5a2f" },
];
