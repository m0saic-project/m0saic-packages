# Print authoring rules

> Templates layer. For any template whose deliverable goes to paper (cards, banners,
> wraps, posters). A screen is backlit; paper only reflects, and has a black floor.
> Tune a print palette on the screen and the shadows that read there print as one
> flat black. P1–P5 were paid for by a printed business card (2026-10-18); P6 by a
> 10 ft booth banner (2026-10-16).

## P1 — A dark pattern must clear paper's black floor
Paper only gets so black. Soft-proofed through Adobe's press profiles, a near-black
navy (#050314, L\* 1.3 on screen) prints at **L\* 11 on coated stock (FOGRA39)** and
**L\* 29 on uncoated stock (FOGRA29)**. Everything darker than the floor collapses
onto it, and the gaps just above it shrink. Keep every ink that must stay distinct
well clear of it: the pattern at **L\* 28 or more** in the file, at least **25 L\*
over the ground**. That prints about 20 apart on coated stock and 10 on uncoated.

Paid for: `@m0saic/brand/business-card/v1` and `v2` tuned the dark field on screen,
tiles at L\* 6.5 on an L\* 1.3 navy (`DEFAULT_FIELD_OPACITY = 0.28`,
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/brand/business-card/v1/business-card.ts#L142). The
printed cards were flat black; the brick showed only under a strong light. The
soft proof agrees: those tiles print 2.4 L\* above the navy on coated stock and 1.6 on
uncoated. v3's dark tiles default to #434574 (L\* 31.1), which prints 20 and 10.6 above
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/brand/business-card/v3/business-card.ts#L174).

**Lift the lightness, keep the hue, and raise the chroma — then raise it again for
paper.** A dark brand colour lifted to print lightness at its old chroma reads as
grey: v3's first cut, #48465C (chroma 14), was the navy's hue but looked like slate.
Luminance stays put as chroma rises, so the print gap and every text contrast hold.
Print also takes chroma away: soft-proofed, chroma 24 printed at 21 (coated) and 17
(uncoated), and chroma 30 printed at 26 and 20, with the hue steady (294° → 288°).
Only 30 still read blue on uncoated stock, so v3 ships 30. Judge hue and chroma in
CIELCh through the press profile, not by eye on a backlit screen.

## P2 — A light pattern needs a smaller gap
Highlights survive print well. About **9 L\* under the page** reads as "clearly there,
still soft": business card v3's light tiles #E5DCD0 under an ivory #FAF7F2, the same
tint as the jewelry booth's printed fabric banner.

## P3 — Lifting a dark pattern lowers text contrast; recheck the small inks
Text sits on the pattern as well as the ground. When the tiles move from L\* 6.5 to
30.8, v2's secondary grey #8A89A3 falls to 2.7:1. v3 lifts it to #B0AFC6 (4.2:1 on
the tiles, 9.5:1 on the navy) so the 8 pt role / handle / command lines still read
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/brand/business-card/v3/business-card.ts#L257). Hold
secondary inks to **4:1 or better against the pattern**.

## P4 — Lock print contrast in a test
Compute L\* and contrast from the template's palette function, and assert P1–P3. A
later screen-only tweak then cannot quietly undo them. Reference: the "print
contrast" block in
https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/brand/business-card/v3/business-card.test.ts#L138.

## P5 — Soft-proof, then proof on the stock you are ordering
Stocks differ: uncoated, coated and fabric each have their own floor and gamut.
First soft-proof. Take each ink sRGB → the press CMYK profile (relative colorimetric
with black-point compensation, a RIP's usual RGB path), then → Lab (absolute
colorimetric) for what the sheet will measure. littleCMS through Pillow's
`ImageCms` does it with Adobe's `CoatedFOGRA39.icc` / `UncoatedFOGRA29.icc`. Then give
the reviewer a ladder, a few strengths of the knob that sets the pattern, to print
before the order. Keep that knob exposed (v3: `fieldOpacity`) so a stock that needs
more can get it without a new version.

Re-verify (as of 2026-10-18):
`grep -n "DEFAULT_FIELD_OPACITY\|DARK_FIELD_INK\|#B0AFC6" https://github.com/m0saic-project/m0saic-packages/blob/main/packages/templates/src/m0saic/brand/business-card/v3/business-card.ts

## P6 — Print scale: the walls past 8K
A 10 ft banner at 150 DPI is 18000 × 14400 px, 259 MP. Measured on the 8 GB M1 Air
(`@qsbuilds/booth/backdrop/v1`, 2026-10-16; re-measured 2026-10-20 through the
engine's own jpeg path):

- **ffmpeg's frame limit** is `(8·W + 1024)·(H + 128) < 2^31 − 1`
  (`av_image_check_size`). 18000 × 14400 passes by about 2 %; at that width a frame
  can be at most 14679 px tall, so a 120 × 102 in artwork (pocket allowance) does not
  fit at 150 DPI (146 DPI is the most). Compute this in the template and refuse with
  the max DPI; do not discover it in ffmpeg.
- **It renders.** About 105 flat tiles plus one masked M: 128–148 s and ~1.5 GB peak
  RSS for the lossless PNG master, which is under 1 MB for flat colour art. One scaled
  image at the same size goes straight to a jpeg in 6 s at 1.4 GB.
- **JPEG at that size is the engine's job since 0.4.0.** Every `.jpg` still is
  `mjpeg` at `yuvj444p` with the quantizer pinned to the best tables
  (`-q:v 1 -qmin 1 -qmax 1`), one encoder thread, and `-huffman default` once the
  canvas is 64 MP or more: the encoder's default `-huffman optimal` buffers every
  coefficient of ~12 M blocks and failed to open (`ENOMEM`) at 259 MP. Huffman is
  lossless, so quality is unchanged. `encodes` to `jpeg` / `png` / `tiff` / `bmp`
  reach a real muxer too. A `.jpg` output or a `jpeg` encode is enough; the `mjpeg`
  container with hand-set encoder options is no longer needed.
- **Metadata:** the engine writes no DPI and no ICC. A JPEG's JFIF APP0 density and
  an APP2 `ICC_PROFILE` can be written afterwards by rebuilding only the header
  segments, leaving the scan data byte-identical (the booth's `render.mjs` does this).
- **Proof labels:** svg-rasterized text is one inline mask per line; ~45 labels over
  a full-canvas drawbox track drove `OVERLAY_CHAIN_DEEP` to 24. Plain `drawtext`
  labels (no `rasterizer`) carry no mask; the only mask left is the logo.
- **Keep inches authoritative** and convert edges, not sizes, with one rounding
  rule. Never upscale a proof. Verify the written file (dimensions, chroma sampling,
  density, profile, a full decode), not the plan.

Re-verify (as of 2026-10-20):
`grep -n "DEFAULT_JPEG_STILL_HUGE_PIXELS\|huffman" the render engine source (not published)
