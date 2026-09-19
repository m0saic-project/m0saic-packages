/**
 * Pure-JS RGBA pixel helpers — the non-SVG half of what sharp used to do.
 *
 * No native binary, no wasm: plain typed-array work plus node's zlib for the
 * PNG container. Mirrors the same primitives in `@m0saic/core`'s
 * `core/svgRaster` — templates cannot import core (moat rule, the agent contract
 * §7.4), and these are too small to justify a package. If a third consumer
 * ever appears, promote them to `@m0saic/platform` (pure JS, browser-safe —
 * unlike the resvg wrapper, which stays out of platform on purpose).
 */

import * as zlib from "node:zlib";

/**
 * Nearest-neighbour stretch to an exact size — replaces
 * `sharp(raw).resize(w, h, { kernel: "nearest", fit: "fill" })`.
 *
 * `fit: "fill"` semantics: STRETCH, never preserve aspect, never crop. That
 * distinction is load-bearing for the watermark grid — sharp's default
 * (`cover`) center-cropped and silently discarded most of the cells on any
 * canvas whose aspect differed from cols:rows.
 */
export function stretchNearestRgba(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    // +0.5 samples the CENTRE of the destination pixel, so the mapping is
    // symmetric rather than biased toward the top-left.
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW));
      src.copy(out, (y * dstW + x) * 4, (sy * srcW + sx) * 4, (sy * srcW + sx) * 4 + 4);
    }
  }
  return out;
}

/**
 * Three-pass separable box blur ≈ gaussian — replaces sharp's `.blur(sigma)`.
 * All four channels blur together, so alpha ramps with colour (the
 * low-frequency bump the watermark's soft cell edges rely on).
 */
export function blurRgba(px: Buffer, w: number, h: number, sigma: number): Buffer {
  const r = Math.max(1, Math.round(sigma * 1.5));
  let src = Buffer.from(px);
  let dst = Buffer.alloc(px.length);
  const pass = (horizontal: boolean): void => {
    const outer = horizontal ? h : w;
    const inner = horizontal ? w : h;
    for (let a = 0; a < outer; a++) {
      for (let b = 0; b < inner; b++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          let n = 0;
          for (let k = -r; k <= r; k++) {
            const bb = b + k;
            if (bb < 0 || bb >= inner) continue;
            sum += src[horizontal ? (a * w + bb) * 4 + c : (bb * w + a) * 4 + c]!;
            n++;
          }
          dst[horizontal ? (a * w + b) * 4 + c : (b * w + a) * 4 + c] = Math.round(sum / n);
        }
      }
    }
    const t = src;
    src = dst;
    dst = t;
  };
  for (let i = 0; i < 3; i++) {
    pass(true);
    pass(false);
  }
  return src;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** RGBA8 → PNG bytes (filter 0 + deflate). Replaces `.png().toFile()`. */
export function encodePng(rgba: Buffer, w: number, h: number, level = 6): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
