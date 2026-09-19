# `colors/` — connectivity matrix

**Source:** `packages/types/src/colors/` — `mosaicColor.ts`, `ffmpegNamedColors.ts`, `parseMosaicColors.ts`
**Test:** `packages/types/src/colors/colors.test.ts` (if present)
**Phase 3 owners:** — (utility; touched by 3d for output color tagging)

---

## Status: ⬜ not yet enumerated

## Types in this concept

- `MosaicColor` — hex / FFmpeg-color-string union
- `FFMPEG_NAMED_COLORS` — closed list of ffmpeg-recognized color names
- `parseMosaicColors` — runtime parser helpers

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:colors.MosaicColor` | `MosaicColor` | wired | n/a (consumed downstream) | — | TBD | n/a | — |
| `T:colors.FFMPEG_NAMED_COLORS` | const array | wired | n/a | — | TBD | n/a | Each named color is a row — enumerate. |
| ... | TODO walk every named color, every parser branch | | | | | | |
