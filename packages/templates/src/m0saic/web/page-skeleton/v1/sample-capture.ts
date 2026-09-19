import type {
  PageSkeletonCapture,
  PageSkeletonCaptureRect,
} from "./schema";

const card = (
  x: number,
  y: number,
  titleWidth: number,
  subtitleWidth: number,
): PageSkeletonCaptureRect[] => [
  { x, y, w: 181, h: 102, k: "image", r: 10, d: 2 },
  { x, y: y + 116, w: 32, h: 32, k: "image", r: 16, d: 3 },
  { x: x + 44, y: y + 117, w: titleWidth, h: 12, k: "text", r: 6, d: 3 },
  { x: x + 44, y: y + 139, w: subtitleWidth, h: 10, k: "text", r: 5, d: 3 },
];

/**
 * Network-free default capture: a hand-authored 1440x900 video-site home page.
 * It exercises every rect kind, round avatar/pill geometry, shallow and deep
 * paint order, and the renderer's expected 2x6 card layout.
 */
export const SAMPLE_CAPTURE: PageSkeletonCapture = {
  format: "m0saic-page-skeleton",
  version: 1,
  viewport: { w: 1440, h: 900, dpr: 2 },
  rects: [
    { x: 0, y: 0, w: 1440, h: 64, k: "block", r: 0, d: 0 },
    { x: 24, y: 18, w: 112, h: 28, k: "image", r: 6, d: 1 },
    { x: 425, y: 12, w: 520, h: 40, k: "control", r: 20, d: 1 },
    { x: 957, y: 14, w: 36, h: 36, k: "control", r: 18, d: 1 },
    { x: 1240, y: 16, w: 72, h: 32, k: "control", r: 16, d: 1 },
    { x: 1320, y: 16, w: 32, h: 32, k: "control", r: 16, d: 1 },
    { x: 1368, y: 16, w: 32, h: 32, k: "image", r: 16, d: 1 },
    { x: 0, y: 64, w: 216, h: 836, k: "block", r: 0, d: 0 },
    { x: 0, y: 63, w: 1440, h: 1, k: "divider", r: 0, d: 1 },

    { x: 240, y: 80, w: 54, h: 32, k: "control", r: 16, d: 1 },
    { x: 302, y: 80, w: 74, h: 32, k: "control", r: 16, d: 1 },
    { x: 384, y: 80, w: 88, h: 32, k: "control", r: 16, d: 1 },
    { x: 480, y: 80, w: 66, h: 32, k: "control", r: 16, d: 1 },
    { x: 554, y: 80, w: 102, h: 32, k: "control", r: 16, d: 1 },
    { x: 664, y: 80, w: 78, h: 32, k: "control", r: 16, d: 1 },
    { x: 750, y: 80, w: 94, h: 32, k: "control", r: 16, d: 1 },

    ...card(240, 136, 126, 92),
    ...card(437, 136, 118, 104),
    ...card(634, 136, 132, 78),
    ...card(831, 136, 110, 98),
    ...card(1028, 136, 125, 88),
    ...card(1225, 136, 122, 96),
    ...card(240, 504, 116, 82),
    ...card(437, 504, 128, 100),
    ...card(634, 504, 104, 74),
    ...card(831, 504, 130, 94),
    ...card(1028, 504, 120, 86),
    ...card(1225, 504, 112, 90),
  ],
  meta: { total: 64, dropped: 0 },
};
