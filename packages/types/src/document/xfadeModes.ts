/**
 * The 58 built-in `xfade` transition modes — verified against the pinned
 * ffmpeg build (N-124279, `ffmpeg -h filter=xfade`), 2026-07-03.
 *
 * `custom` is deliberately EXCLUDED: `xfade=custom` evaluates a per-pixel
 * expression through the interpreter (~41 ms/f measured — catastrophic
 * tier), while every mode below is a compiled, slice-threaded kernel whose
 * cost is confined to the transition window (~2.5 ms/f). Never `custom`.
 */
export const MOSAIC_XFADE_MODES = [
  "fade",
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "circlecrop",
  "rectcrop",
  "distance",
  "fadeblack",
  "fadewhite",
  "radial",
  "smoothleft",
  "smoothright",
  "smoothup",
  "smoothdown",
  "circleopen",
  "circleclose",
  "vertopen",
  "vertclose",
  "horzopen",
  "horzclose",
  "dissolve",
  "pixelize",
  "diagtl",
  "diagtr",
  "diagbl",
  "diagbr",
  "hlslice",
  "hrslice",
  "vuslice",
  "vdslice",
  "hblur",
  "fadegrays",
  "wipetl",
  "wipetr",
  "wipebl",
  "wipebr",
  "squeezeh",
  "squeezev",
  "zoomin",
  "fadefast",
  "fadeslow",
  "hlwind",
  "hrwind",
  "vuwind",
  "vdwind",
  "coverleft",
  "coverright",
  "coverup",
  "coverdown",
  "revealleft",
  "revealright",
  "revealup",
  "revealdown",
] as const;

export type MosaicXfadeMode = (typeof MOSAIC_XFADE_MODES)[number];

export const MOSAIC_XFADE_MODES_SET: ReadonlySet<string> = new Set(
  MOSAIC_XFADE_MODES,
);
