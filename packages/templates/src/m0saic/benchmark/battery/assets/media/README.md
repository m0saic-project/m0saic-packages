# Bundled benchmark media

Small, redistributable clips referenced by the media / audio workloads (and by
captured `real` workloads that need real footage). Extracted from **Big Buck
Bunny** (© Blender Foundation, Creative Commons Attribution 3.0,
peach.blender.org) with ffmpeg. Kept intentionally tiny.

| File | What | Used by |
|---|---|---|
| `bbb-clip-01.mp4` … `bbb-clip-04.mp4` | 4× 1280×720, ~4s, video-only (h264) | `sources-media` (2×2 decode bank) |
| `bbb-av.mp4` | 1280×720, ~8s, video + AAC audio | `sources-audio` |

Workloads reference these by relative path (e.g. `"path": "../media/bbb-av.mp4"`).
Regenerate via `tools/bake-benchmark-battery.mjs` (the clips themselves are
produced by the ffmpeg commands recorded in this repo's benchmark plan). Only
commit clearly redistributable assets, and note the source/license here.
