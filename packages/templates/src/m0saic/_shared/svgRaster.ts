/**
 * SVG rasterization for templates — the thin node-only seam that replaced
 * sharp. Backed by `@resvg/resvg-wasm` (zero optional platform packages, no
 * native binary), same engine core uses in `@m0saic/core/core/svgRaster`.
 *
 * Deliberately NOT shared through `@m0saic/platform`: platform is imported by
 * the browser bundle, and putting a 2.4 MB wasm dependency there risks pulling
 * it into the web build. Templates cannot import `@m0saic/core` (moat rule,
 * the agent contract §7.4), so this thin wrapper is the seam for template code.
 *
 * ⭐ `loadSystemFonts: false` is load-bearing — resvg builds a system font DB
 * per instance otherwise (364 ms/call vs 6 ms). Safe because template SVGs
 * carry no `<text>`; glyphs arrive as paths.
 */

import * as fs from "node:fs";

const NO_FONTS = { font: { loadSystemFonts: false } } as const;

/**
 * ⭐ resvg REQUIRES the SVG namespace; libvips/librsvg (what sharp used) did
 * NOT. A namespace-less `<svg viewBox="…">` — invalid per spec but extremely
 * common in hand-authored and inline markup — rasterized fine before the
 * 2026-09-07 resvg swap and afterwards throws
 * `"SVG data parsing failed cause the document does not have a root node"`.
 *
 * That reaches USER input (a template's `svg`/`svgPath` prop, an `svg-media`
 * asset, a plain-SVG data URI), so silently losing it is a real regression,
 * not a fixture problem. Inject the namespace when the root tag lacks one and
 * leave every already-valid document byte-identical.
 */
export function ensureSvgNamespace<T extends Buffer | string>(svg: T): T {
  const text = typeof svg === "string" ? svg : svg.toString("utf8");
  const open = /<svg\b[^>]*>/i.exec(text);
  // Not recognisably an SVG, or already namespaced — hand it through untouched
  // so resvg still owns the error message for genuinely malformed input.
  if (!open || /\bxmlns\s*=/i.test(open[0])) return svg;
  const patched =
    text.slice(0, open.index) +
    open[0].replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"') +
    text.slice(open.index + open[0].length);
  return (typeof svg === "string" ? patched : Buffer.from(patched, "utf8")) as T;
}


type ResvgCtor = new (svg: Buffer | string, opts?: unknown) => {
  width: number;
  height: number;
  render(): { width: number; height: number; pixels: Uint8Array; asPng(): Uint8Array };
};

let _Resvg: ResvgCtor | null = null;
let _init: Promise<void> | null = null;

async function resvg(): Promise<ResvgCtor> {
  if (_Resvg) return _Resvg;
  if (!_init) {
    _init = (async () => {
      // Lazy require keeps the wasm out of the import graph for templates that
      // never rasterize — the same posture the sharp loader had.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("@resvg/resvg-wasm");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const wasm = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
      await mod.initWasm(fs.readFileSync(wasm));
      _Resvg = mod.Resvg as ResvgCtor;
    })();
  }
  await _init;
  return _Resvg!;
}

/** Rasterize an SVG to a PNG file at an exact pixel width (height follows). */
export async function renderSvgToPngFile(
  svg: string,
  outPath: string,
  widthPx: number,
): Promise<void> {
  const Resvg = await resvg();
  const img = new Resvg(ensureSvgNamespace(svg), {
    fitTo: { mode: "width", value: Math.max(1, Math.round(widthPx)) },
    ...NO_FONTS,
  }).render();
  fs.writeFileSync(outPath, Buffer.from(img.asPng()));
}

/**
 * Rasterize an SVG into a `res × res` RGBA buffer with CONTAIN semantics —
 * aspect preserved, centred, transparent padding. Replaces
 * `sharp(svg).resize(res, res, { fit: "contain", background: transparent })
 *   .ensureAlpha().raw()`.
 */
export async function renderSvgContainRgba(
  svg: string,
  res: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const Resvg = await resvg();
  const probe = new Resvg(ensureSvgNamespace(svg), NO_FONTS);
  const iw = probe.width || 1;
  const ih = probe.height || 1;
  // Fit the LONG side to `res` so the whole graphic lands inside the box.
  const fitTo =
    iw >= ih
      ? { mode: "width", value: res }
      : { mode: "height", value: res };
  const img = new Resvg(ensureSvgNamespace(svg), { fitTo, ...NO_FONTS }).render();
  const src = Buffer.from(img.pixels);
  if (img.width === res && img.height === res) {
    return { data: src, width: res, height: res };
  }
  // Centre onto a transparent res×res canvas (the padding sharp's `contain`
  // would have added). Alpha 0 everywhere it isn't covered.
  const out = Buffer.alloc(res * res * 4, 0);
  const dx = Math.floor((res - img.width) / 2);
  const dy = Math.floor((res - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= res) continue;
    const from = y * img.width * 4;
    const to = (ty * res + dx) * 4;
    src.copy(out, to, from, from + img.width * 4);
  }
  return { data: out, width: res, height: res };
}
