# `defaults/` — connectivity matrix

**Source:** `packages/types/src/defaults/` — `audio.ts`, `color.ts`, `media.ts`, `placement.ts`, `text.ts`, `timing.ts`, `visual.ts`
**Test:** (co-located if present)
**Phase 3 owners:** — (constants consumed throughout)

---

## Status: ⬜ not yet enumerated

Default-value constants for every concept. Each constant is a row, and
each row's "wired" status depends on whether the corresponding feature
is wired in the engine.

## Files / concepts

- `audio.ts` — default `enabled`, default `volume`
- `color.ts` — default background colors, default text colors
- `media.ts` — default `mediaType`, default fit
- `placement.ts` — default `fit`, default `hAlign`, default `vAlign`
- `text.ts` — default `fontFamily`, default `fontSize`, default `fontColor`
- `timing.ts` — default `fps`, default `durationMs`, default `playSpeed` (+ `MIN_PLAY_SPEED`/`MAX_PLAY_SPEED` clamp range; no `loopMode` default lives here — the engine hardcodes `?? "loop"`)
- `visual.ts` — default `opacity`, default `backgroundColor`

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:defaults.timing.fps` | `DEFAULT_FPS` | wired | n/a | — | TBD | n/a | — |
| `T:defaults.timing.durationMs` | `DEFAULT_DURATION_MS` | wired | n/a | — | TBD | n/a | — |
| ... | TODO walk every default constant | | | | | | |
