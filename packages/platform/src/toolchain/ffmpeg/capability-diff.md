# FFmpeg Capability Diff

## Overview

m0saic compares the official LGPL baseline FFmpeg capabilities against the
runtime FFmpeg binary at render time.  When capabilities differ, the render
report includes an informational diagnostic — **not** necessarily a warning
or error.

Diagnostic code: `ffmpeg-capability-diff`

## Why this exists

The m0saic v1.0.0 baseline is an LGPL build with no `libx264`.  Users who
install a GPL FFmpeg build (with libx264) get a runtime that is *more capable*
than the baseline.  This is expected and desirable for consumer output — it
should not be flagged as a problem.

Only the reverse case (baseline expects libx264 but runtime lacks it) is a
genuine concern, because renders may fall back to a lower-quality encoder.

## Interpretation values

The `interpretation` field in the diagnostic details tells you what the diff
means:

| interpretation     | meaning                                                | severity |
|--------------------|--------------------------------------------------------|----------|
| `runtime-enhanced` | Runtime has capabilities the baseline lacks (e.g. x264) | `info`   |
| `runtime-reduced`  | Runtime is missing capabilities the baseline expects    | `warn`   |
| `unknown`          | Runtime capability could not be determined (probe failed)| `info`  |

## Report JSON examples

### runtime-enhanced (LGPL baseline + GPL runtime)

```json
{
  "code": "ffmpeg-capability-diff",
  "message": "Runtime FFmpeg capabilities differ from the m0saic baseline.",
  "details": {
    "baselineLibx264": false,
    "runtimeLibx264": true,
    "interpretation": "runtime-enhanced",
    "severity": "info"
  }
}
```

### runtime-reduced (GPL baseline + LGPL runtime)

```json
{
  "code": "ffmpeg-capability-diff",
  "message": "Runtime FFmpeg capabilities differ from the m0saic baseline.",
  "details": {
    "baselineLibx264": true,
    "runtimeLibx264": false,
    "interpretation": "runtime-reduced",
    "severity": "warn"
  }
}
```

### No diagnostic emitted

When baseline and runtime capabilities match, no `ffmpeg-capability-diff`
diagnostic is emitted at all.

## Toolchain interaction

When using named toolchains via `m0saic.local.json` and `--toolchain`, the
capability diff reflects the *selected* toolchain's FFmpeg binary, not
necessarily whatever is first on PATH.  This means switching from an LGPL dev
toolchain to a GPL consumer toolchain will change the diff interpretation
from absent to `runtime-enhanced`.

## Implementation

The capability diff logic lives in:

- `packages/cli/src/utils/renderReport.ts` — `getFfmpegWarnings()`

It is emitted as part of the `warnings` array in `RenderReportV2`.
