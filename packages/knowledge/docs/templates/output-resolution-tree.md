# The output-resolution tree

How a render's top-level **duration / size / fps / format / audio** resolve,
across CLI, Make, templates, and the engine. Mapped at gate 28 (2026-08-31)
after three gates of the same bug class; merged from
`candidates/2026-08-31-output-resolution-tree.md`.

When writing a template or a host feature that touches any of these values,
place it in the tree FIRST — the recurring failure is a value from one layer
masquerading as another.

## The law (as it now stands, gates 20–28)

Precedence, top to bottom — higher wins:

```
L0  USER EXPLICIT      the ask the user actually typed/clicked
L1  TEMPLATE INTENT    what the doc AUTHORS (the render's own declarations)
L2  HOST DEFAULTS      hints the host seeds when the user said nothing
L3  ENGINE DEFAULTS    DEFAULT_DURATION_MS / DEFAULT_FPS / mp4 / silence
```

The recurring bug class of this sprint (gates 26, 27, 28) was always the same
shape: **an L2 value masquerading as L0** (hint-seeded target read as a pin;
host canvas clobbering authored size) or **an L1 value lost in the wrapper**
(stampDocOutput clobbering authored durationMs/size).

## Per-property trees (current, verified)

### durationMs
- **L0**: CLI `--durationMs` → `ctx.userIntent.durationMs` (assembleUserIntent)
  + plan `options.durationMs` (DURATION_MS_OVERRIDDEN_BY_CLI diagnostic).
  Make's Duration field → `userIntent.durationMs` when SET (Q1, 08-31).
  CLI `.mosaicx` path (`make <file.mosaicx>` / `resolve`): `--durationMs ??
  wrapper.durationMs` → `userIntent.durationMs` via `mosaicxUserIntent`
  (the CLI source (not published), 09-05) — the wrapper's `durationMs`
  was already the plan length, so it is an explicit ask; before 09-05 it only
  set the plan length and TRIMMED self-timing templates instead of pinning them.
- **L1**: doc authors `durationMs` → `stampDocOutput` preserves it (gate-26
  law). Pipelines: per-step `durationMs` is always authored (rule 4);
  `resolveStampedPipelineDurationMs`.
- **L2**: CLI seeds the render target from `outputHints.durationMs`
  (animated variants: `resolveUnpinnedDurationMs`). The hint-echo trap is
  CLOSED (Q1, 08-31): `resolvePinnedDurationMs` is `userIntent`-only, so a
  hint-seeded `output.durationMs` can never read as a user ask. Template side:
  never compare `ctx.output.durationMs` to your own default to detect a pin —
  that reads L2 as L0 (dsl-tutorial crammed every walk into its 12s hint, gate
  33, 09-05); call `resolvePinnedDurationMs(ctx)`, else author the natural
  length on `doc.durationMs` (L1).
- **L3**: `DEFAULT_DURATION_MS`.

### size (width × height)
- **L0**: explicit `-w/-h` / Make Device — ALWAYS wins. `make`'s dims are
  now OPTIONAL: absence IS the explicitness signal (no provenance
  introspection needed).
- **L1**: the doc's own `size` — **required on every ROOT document** (the
  boundary law: platform serializer + loader assert it; children stay
  optional — the stretch-vs-letterbox lever). Hosts default the plan to
  it: saved files reproduce ("open a .mosaic, render, get the same
  thing"), templates that author their canvas (brand marks at official
  dictionary dims) get it as the default. `stampDocOutput` preserves
  authored size; docs authoring nothing get the resolved target so every
  stamped root carries a canvas. Steps: `step.file.size` (rule 4) — same
  law, always had it.
- **L2**: template path seeds ctx from the template's hints when no explicit
  dims — the static `outputHints.width/height`, with the template's
  `resolveOutputHints(props)` merged over them (2026-09-15, the canvas-as-a-
  knob contract: a creator template's `platform` picks 1920×1080 vs
  1080×1920). ONE helper for every host: `resolveTemplateOutputHints(tmpl,
  props)` in `@m0saic/template-utils` (CLI `make` + the wireframe/tutorial
  paths, Electron preview/cover/renderToFile, the web design preview, and
  Make's Device anchor, which re-resolves on every prop change so a locked
  canvas follows the knob BEFORE the next preview). Tolerant: a throwing or
  junk resolver falls back to the static hints; width/height round to even.
  Fallback 1280×720.
- **L3**: none.
- **Guard law (2026-09-15):** the template-path feasibility guard measures the
  rendered doc at the size the PLAN uses — the doc's authored size when no
  `-w/-h` — never the hint-seeded target. It used to read the target and
  rejected a correctly authored 1080×1920 doc against a 1920×1080 hint
  ("below the minimum feasible") — the hint-read-as-ask bug class again.
- **Removed**: `sizePolicy` (existed for ~a day) — "size always present +
  default-not-command" dissolves the intent-vs-history ambiguity without
  a field.

### fps
- **L0**: CLI `--fps` (explicit only — threads to planOptions;
  FPS_OVERRIDDEN_BY_CLI). Make Output fps passes explicitly → wins (open
  founder call from gate 20).
- **L1**: pipeline-authored fps (gate-20: `resolveStampedPipelineFps`,
  fps-follow for recordings). Plain docs: stamped from resolved target.
- **L2**: `outputHints.fps` as ctx default. **L3**: DEFAULT_FPS.

### format (container/kind)
- **L0**: `-o` extension / `--format`.
- **L1**: doc `format` (gate-26 convention: every rendered doc declares it)
  + CLI rule-5 POST-RENDER enrichment (gate-22: authored mode-dependent
  detail reaches the resolver; explicit `--alpha` wins). `doc.target`
  presets resolve to format/audio/color defaults; per-field overrides win.
- **L2**: the template tier, two statements, the more specific first:
  1. a reserved prop named **`outputFormat`** holding a container name
     (`png` / `jpeg` / `webp` → image; `mp4` / `mov` / `webm` / `mkv` → video) —
     trickplay, screencap-grid, page-skeleton, qr/code, highlights. A prop is
     the template speaking *per render*, so it WINS over the static hint
     (the CLI source (not published) `handleTemplateMake`, flipped 2026-09-13 —
     before that the hint would have silenced the knob; Make's
     `outputFormat`-prop sync already behaved this way).
  2. `outputHints.format` — the static deliverable. **Every public template
     declares one** (the `outputFormat` convention, record posture — see
     [`philosophy-and-contract.md`](philosophy-and-contract.md) §Output
     contract); a knob template declares the knob's DEFAULT so the two agree
     at defaults.
- **L3**: mp4 — reached only by internal / deprecated templates now.

Why L2 matters beyond the extension: the Make share link carries an `f=` ask
only when the form's output kind differs from what the hint would set on the
receiver, and the modal maps an empty kind to video — so a hint-less template
put `f=video` on every link at defaults (the 2026-09-13 sweep: 33 public
templates gained a hint, 26 video / 7 image).

### audio
- **L0**: CLI `--no-audio` → `audio.mode:"off"` patch.
- **L1**: doc/encode `audio.mode` — the TRI-STATE law (Q2, founder-ruled
  2026-08-31; `enabled: boolean` is GONE from `MosaicAudioConfig`, hard
  swap, no deprecation):
  - `"off"` → never a track, even with real inputs (the mute knob);
  - `"on"` → always a track (real mix, or an anullsrc silence bed);
  - `"auto"`/absent → real mix when audio-bearing inputs exist, **NO track
    when none** — silent visuals ship video-only by default.
  Source-level `MosaicAudioProps.enabled` (per-tile mute) is a DIFFERENT
  type and keeps its boolean.
- **L3**: silence-by-default is RETIRED. The engine chain rule:
  - "Audio-bearing" = INTENT, not bindability: probed `hasAudio` streams
    count, and an unprobed `mediaType:"audio"` source still counts (its
    intent is unambiguous; the mix degrades to a bed, never to no-track).
  - Internal carriers still always mux `[outa]` (gate-21 binding), but a
    binding-only bed is stamped `audioIntent:false` on the command, and the
    node-output stamp skips `hasAudio` for it — a child's bed never becomes
    the parent's "audio input" (pre-fix every child-bearing composite
    shipped a phantom silent track).
  - Pipelines: `pipelineWantsAudio` resolves the same tri-state AFTER the
    step loop ("auto" = any step actually muxed); the xfade stitch now
    synths silence legs for audio-less steps exactly like the cut-concat
    path (the old KNOWN GAP, hit the moment silent steps stopped muxing).
  - Argv honesty on no-`-map` commands: `stepMuxesAudio`'s fallback reads
    "no -map, no -an" as "keeps the input's audio", so any command without
    maps that can end a nested plan MUST carry `-an` when its output is
    video-only — the loop-fit pass (`pipeline_duration_fit`) does now
    (a silent nested pipeline's fit output otherwise made the outer stitch
    bind a `[i:a:0]` that matched no streams).
  - Mixed compositions ("one source has audio, one doesn't" — the historic
    reason for authoring null-audio beds everywhere) are guarded at three
    levels: flat mixes probe-gate `[i:a:0]` refs to stamped streams; stitch
    legs synth silence per audio-less step; child carriers always mux beds
    so parent binding can't fail. Authored silence beds are no longer
    needed for composition safety.
  Locked by: `pipelineAudio.spec` ("Q2 tri-state law" describe),
  `ffmpegCommands`/`buildMosaicPlanFromFile` unit specs, the CLI contract
  matrix (57 silent-fixture rows now `acodec:null`, `audio-mode-on`
  fixture = the bed opt-in leg, `codec-matrix-audio` out-silent = the mute
  leg, `audio-montage-child` = real child audio survives).

## Open simplifications (proposed, awaiting founder ruling)

1. **Q1 — DONE (2026-08-31, founder-ruled).** Duration pinning is
   `userIntent`-only: `resolvePinnedDurationMs` reads ONLY
   `ctx.userIntent.durationMs`; the CLI populates it from an explicit
   `--durationMs`, Make (electron main) from its Duration field when SET —
   in both the real-render and design-preview ctx so they agree. The
   hint-echo trap is dead globally; search-typing's gate-27 local
   discriminator deleted. Fallback users verified: mermaid already fit to
   `?? ctx.output.durationMs` (unchanged); camera-debug + snippet-morph
   treat unpinned as natural cadence (the correct behavior their hint-pins
   were masking).
2. **Q2 — DONE (2026-08-31, founder-ruled).** Audio default flipped + the
   config went tri-state (`mode: "auto"|"on"|"off"`, `enabled` deleted with
   no deprecation — "we are pre launch", callers migrated, old docs may
   break). Full law + engine chain rule in the audio section above. The
   recurring gate-20 silent-track class is retired at the root: doc-level
   `audio:{enabled:false}` boilerplate is no longer needed on silent
   templates (existing `mode:"off"` sites are now pure intent, not
   bug-avoidance). Golden sweep done (command goldens re-minted: silence-
   bed mux siblings dropped, `-an` on silent deliverables).
3. **Q3 — one duration-follow helper.** subtitle-burn, search-typing,
   highlights each hand-roll "explicit ask wins, else follow natural/
   input" with different spellings. A template-utils
   `resolveOutputDurationMs(ctx, { naturalMs })` encoding L0>L1 would make
   the law one function. (Blocked on Q1 for the clean version.)
4. **DONE this gate:** the size tree is fully coherent (required-at-root
   boundary law + optional `-w/-h` + host defaults to doc size);
   `makeErrorMosaic` audio + size fixed fleet-wide; the stale
   pre-gate-26 duration expectation in defineMosaicTemplate.test aligned.

## Non-goals

`outputHints` stays static (L2 seeding only) and is the browse-time truth
(manifest, cards). Props-dependent dims need BOTH halves: author the doc for
the PLAN (L1), and declare `resolveOutputHints(props)` so hosts SEED the
right target too (L2) — the resolver is what removes the letterbox and the
wrong-canvas guard. The seam's `outputHintsResolve` convention (throw) keeps
it honest: an object, deterministic, and at `defaultProps` equal to the
static hints for every field it returns.
