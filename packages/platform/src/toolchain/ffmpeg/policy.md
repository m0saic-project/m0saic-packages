# FFmpeg Policy

> **2026-09-22 — one baseline, GPL, never redistributed.** The LGPL rail described
> below was removed. m0saic ships no ffmpeg binary at all; the single pinned
> baseline is the GPL build (libx264/libx265, full drawtext stack), fetched from
> its origin on the user's machine at the user's request — `m0saic setup`, the
> Desktop first-run gate, or Tools → Toolchain — sha256-verified against
> `baseline.json` and landed in `<m0saic-root>/toolchains/ffmpeg/1.0.0-gpl/`.
> Directing a user to a publisher's download is not redistribution, so the
> "legally safer non-GPL default" the older text argues for buys nothing and
> costs the standard encoder stack. The sections below are kept as the record
> of the original pair; read "LGPL baseline" as historical.

## m0saic v1.0.0 baseline (historical: the LGPL/GPL pair)

m0saic v1.0.0 standardized on a pinned FFmpeg baseline for official development, testing, and product integration.

Official baseline (now the ONLY baseline — GPL):
- Source: BtbN FFmpeg-Builds (Windows/Linux); ffmpeg.martin-riedl.de (macOS arm64, one commit later — see `baseline.json` `platforms`)
- Snapshot: `N-124278-gcc3ca17127-20260430` (macOS: `N-124279-g0f6ba39122`)
- Profile: GPL build
- GPL enabled: yes
- libx264 enabled: yes
- libx265 enabled: yes
- Pinned release tag: [`autobuild-2026-04-30-13-44`](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-04-30-13-44)
- Retention: pinned to BtbN's last-of-month autobuild — GitHub retains the artifacts through ~2028-04-30

m0saic does NOT redistribute this build. `m0saic setup` and the desktop app download it from the pinned release at the user's request and verify it against the sha256 in `baseline.json`.

---

## Purpose

This baseline exists to:
- provide a reproducible FFmpeg target for the project
- keep the default m0saic FFmpeg integration on a legally safer non-GPL path
- avoid accidental dependency on libx264/libx265 in core workflows
- ensure render reports, tests, and runtime detection can reference a known FFmpeg baseline

---

## Official vs user-installed FFmpeg

m0saic distinguishes between two FFmpeg categories:

### Official m0saic baseline

This is the FFmpeg build m0saic standardizes on internally for v1.0.0.

Properties:
- LGPL-oriented build
- no `--enable-gpl`
- no `libx264`
- no `libx265`

This is the version that should be referenced in:
- internal docs
- baseline render reports
- compatibility checks
- visual test expectations where FFmpeg behavior matters

---

### User-installed extended FFmpeg

Advanced users may choose to install a different FFmpeg build for their own workflows, including builds with GPL components such as `libx264`.

These builds are not part of the official m0saic baseline, but are fully supported at runtime.

If an alternate FFmpeg build is present:
- m0saic will automatically detect it
- available capabilities (e.g. `libx264`) may be used
- runtime differences will be reported in CLI output and render reports

Example:
- A GPL-enabled FFmpeg build may provide higher quality H.264 encoding via `libx264`

No additional configuration is required for detection.

---

## Legal stance

m0saic v1.0.0 uses an official baseline that avoids GPL-enabled FFmpeg builds and avoids `libx264` / `libx265`.

This policy is intended to keep the default project baseline aligned with a more conservative distribution posture.

m0saic does not bundle or require GPL-enabled FFmpeg builds.

Users who want additional codecs or encoders are responsible for installing their own FFmpeg builds where applicable.

---

## Baseline records

The official v1.0.0 baseline is recorded in:

- `packages/docs/src/ffmpeg/baseline.json` — machine-readable, both LGPL and GPL variants
- `packages/docs/src/ffmpeg/baseline.txt` — human-readable, LGPL variant
- `packages/docs/src/ffmpeg/baseline-gpl.txt` — human-readable, GPL counterpart

These files are the source of truth for the m0saic v1.0.0 FFmpeg standard.

---

## Future upgrades

Future m0saic releases may update the FFmpeg baseline.

When that happens:
- the new baseline must be recorded in docs (both LGPL and GPL variants)
- the exact FFmpeg version string must be captured for each variant
- the BtbN release tag MUST be a **last-of-month autobuild** (mid-month builds are pruned after 14 days; last-of-month builds are retained for 2 years, ensuring stable install URLs over the m0saic release lifecycle)
- the pinned release URL must be recorded in `baseline.json`'s `btbnReleaseTag` / `btbnReleaseUrl` fields
- capability changes must be documented
- tests and reports should reference the updated baseline
- the desktop Tools panel auto-picks up the new pin via `@m0saic/docs/baseline.json`; rebuild `@m0saic/docs` and `@m0saic/platform` to propagate changes

---

## Runtime reporting

Where practical, m0saic should report the active FFmpeg environment at runtime, including:
- FFmpeg version string
- build configuration (where available)
- whether GPL is enabled
- whether `libx264` is available
- whether `libx265` is available

This allows clear distinction between:
- the official m0saic baseline
- user-provided runtime environments

m0saic reports may also include capability differences between baseline and runtime for transparency.