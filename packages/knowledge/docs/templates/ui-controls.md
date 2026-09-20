# Template UI controls

Templates declare per-prop editor controls via `meta.control` on each
`MosaicTemplatePropDefinition`. The desktop app's prop-dispatch surfaces read those
declarations and render the matching widget.

⚠️ **If you are adding a new control kind: the dispatch is duplicated across TWO
surfaces, and a one-surface change silently no-ops on the other.** Update both.
(There is no `props-control-dispatch.md` yet — the writeup is still an unmerged
candidate at (internal design history); read
that for the two surface locations.)

---

## The `picker` taxonomy

`MosaicPropControl.picker` is a closed union
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/types/src/template/template.ts#L186):

| Value | Renders | Prop shape |
|---|---|---|
| `"file"` | OS file picker | one `type: "media"` prop |
| `"folder"` | OS folder picker | one `type: "media"` prop |
| `"time-range"` | Single-range clip modal | **paired** `*StartMs` / `*EndMs` numbers |
| `"time-ranges"` | Multi-range Clip-Range Studio | **one** `type: "json"` prop |
| `"cards"` | Image-card option grid | any prop with `control.options` |

`"time-range"` and `"time-ranges"` are **both current and both in use** — the plural did
not supersede the singular. Pick by cardinality:

- **One window** out of a source (trim, clip, preview segment) → `"time-range"`.
  Adopters: `media/subtitle-burn/v1`, `language/dual-sub/v1`,
  `media/video_to_png_sequence/v1`.
- **N windows** (highlight reels, multi-cut) → `"time-ranges"`.
  Adopter: `media/highlights/v1`.

---

## `"time-range"` — the paired-prop picker

Declared on **both** halves of a `<base>StartMs` / `<base>EndMs` numeric pair, with the
same control block on each:

```ts
clipStartMs: {
  type: "number",
  required: false,
  meta: {
    control: {
      picker: "time-range",
      videoFromProp: "sourceId",            // sibling prop holding the video path
      targetDurationMsFromProp: "duration", // optional — draws a "target band"
      markersProvider: {                    // optional — semantic timeline ticks
        kind: "subtitles",
        videoFromProp: "sourceId",
        languageFromProp: "languageCode",
        trackIndexFromProp: "trackIndex",
      },
    },
    ui: { label: "Clip start (ms)" },
  },
},
clipEndMs: { /* mirrors clipStartMs, label "Clip end (ms)" */ },
```

**Pairing rule.** The dispatch matches the two halves by name suffix
(`*StartMs` ↔ `*EndMs`) via `planTimeRangeEntries`
(the Mosaic Desktop / Web app source (not published)). Both dispatch surfaces
call that same planner, so pair-detection cannot drift between them.

**`{ 0, 0 }` means "full source"** — it is the documented cleared sentinel, not a
zero-length range. Don't treat it as an empty selection.

---

## `"time-ranges"` — the multi-range studio

**One** `type: "json"` prop whose value is `Array<MosaicTimeRangeMs>`
(`{ startMs, endMs, label? }`; integer ms, source-relative, sorted ascending; overlaps
allowed; `[]` = no selection). No prop pairing — the editor reads and writes the whole
array in a single `onChange`.

```ts
clipRanges: {
  type: "json",
  required: false,
  meta: { control: { picker: "time-ranges", videoFromProp: "sourceId" } },
},
```

**Read the value with `parseTimeRangesValue`**
(https://github.com/m0saic-project/m0saic-packages/blob/main/packages/template-utils/src/media/timeRanges.ts) — never hand-parse. The boundary is
deliberately permissive (see `reference/json-prop-type.md`), so the value may arrive as a
parsed array *or* a JSON string.

---

## Both pickers are one component underneath

The Clip-Range Studio is the single implementation; the singular picker is an adapter
over it.

| Component | Role |
|---|---|
| `rangestudio/ClipRangeStudio.tsx` + `ClipRangeStudioModal.tsx` | the studio |
| `rangestudio/SingleRangeModal.tsx` | single-range adapter — the studio at `maxRanges: 1`, legacy `{startMs, endMs}` in/out |
| `rangestudio/TimeRangesField.tsx` | the `"time-ranges"` form field, rendered by **both** dispatch chains |

> **Historical note:** `TimeRangePickerField.tsx` / `TimeRangePickerModal.tsx` were
> **deleted** in the Clip-Range Studio rebuild. `SingleRangeModal` is their drop-in
> replacement with the same public API. Older docs, plans, and candidates that cite
> those two filenames are stale — the *pattern* they describe survived, the files did
> not.

Consumers of `SingleRangeModal` today: `PropsSchemaForm`, `MakePage`, and
`compose/sources/MediaSourceEditor`.

---

## Marker providers (declarative)

`markersProvider` asks the editor to overlay semantic landmarks on the timeline. The
union currently has **exactly one kind**:

- **`kind: "subtitles"`** — extracts cues for the resolved language/track and draws them
  as ticks with inline labels. Chain: `subtitles:extract` IPC
  (the Mosaic Desktop / Web app source (not published)) → cue hook → `markers` on the studio. The cues are
  also painted as a live caption overlay on the preview `<video>`, because HTML5 video
  cannot surface embedded MKV subtitle tracks.

**There is no fallback path.** A `kind` the dispatch doesn't recognize is *silently
ignored* — no warning, no error, the markers just never appear. Adding a kind
(`scene-cuts`, `audio-peaks`, `chapters`) means expanding the union **and** adding the
IPC **and** the hook **and** the dispatch wiring, in lockstep.

---

## Companion props and gotchas

**Loop mode.** A time-range pairs naturally with a loop-mode enum when the selected
segment can be shorter or longer than the render duration. Subtitle-burn's
`clipLoopMode: "cut" | "loop" | "freeze"` is the reference — a plain enum via
`meta.control.options`, threaded into `MosaicPlaybackProps.loopMode` at render time.

**Cue-offset trap on clipped templates.** When a template offsets cues to output-time
(subtitle-burn's `offsetCuesToOutput(rawCues, clipStartMs, clipEndMs, durationMs)`), the
picked range must actually overlap where cues exist — otherwise the render is silently
subtitle-free. The marker overlay is the editor-side mitigation: users see where cues
live and aim accordingly. Surface this on any cue-bearing template rather than burying
it.
