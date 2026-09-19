import type { AudioCodec } from "./format";

/**
 * Audio-stream knobs for a {@link MosaicOutput}.
 *
 * # Two personas
 *
 * - **"Just make it work"** — leave this field unset (or set only
 *   `enabled: true`). The engine applies a sensible preset based on
 *   the target's container (typically
 *   {@link DEFAULT_AUDIO_CONFIG} — AAC stereo 192k 48kHz — except
 *   for `web-webm` which uses {@link DEFAULT_WEBM_AUDIO_CONFIG}).
 *   See `@m0saic/types/defaults` for the full preset list.
 *
 * - **"Power user / specific workflow"** — set individual fields to
 *   override. Unset fields keep their preset value. Mix and match:
 *   `{ bitrate: "320k" }` upgrades the bitrate; everything else
 *   stays at the preset.
 *
 * # Smart fallback (engine-side)
 *
 * Container/codec compatibility matters: webm only accepts opus or
 * vorbis, mp3 containers only accept mp3, etc. If the chosen codec
 * is incompatible with the target's container, the engine
 * substitutes the closest compatible codec and emits
 * `AUDIO_CODEC_SUBSTITUTED` (warning) so the author sees what
 * happened. Power users who explicitly opt into a substitution can
 * silence the warning by using a target whose container accepts
 * their codec.
 *
 * # Engine wiring status (post-F3, 2026-07-06)
 *
 * Fields are honored across the render path now:
 *
 * - **Encode / deliverable path** (`buildEncodeCommands`) honors ALL
 *   fields — `-an` on `enabled:false`, `codec` / `bitrate` /
 *   `sampleRate` / `channelLayout`, webm→opus default, else `-c:a copy`.
 * - **Document mix** honors the new {@link MosaicAudioConfig.volume}
 *   (a single global multiplier applied once after the mix) on
 *   `doc.audio` / `pipeline.audio`.
 * - **Flat-render mux** honors `codec` / `bitrate` / `sampleRate` /
 *   `channelLayout` / `enabled` when the flat render IS the deliverable
 *   (no `encodes` map). Internal carriers (concat rounds, child
 *   stitches, `__master.*` when encodes exist) stay hardcoded-AAC by
 *   design — the encode path decides the final codec.
 *
 * The canonical preset constants (`DEFAULT_AUDIO_CONFIG`,
 * `DEFAULT_WEBM_AUDIO_CONFIG`, `DEFAULT_PODCAST_AUDIO_CONFIG`, etc.)
 * live in {@link "./defaults/audio"}.
 */
export type MosaicAudioConfig = {
  /**
   * The audio-track policy for the DELIVERABLE (Q2, output-resolution
   * tree, 2026-08-31) — the first-class spelling of what `enabled` used
   * to express as a documented tri-state boolean:
   * - `"auto"` (default when absent) — the real mix when audio-bearing
   *   inputs exist; NO track when none do. (Silence used to be the
   *   no-input default — every silent-visual template had to remember
   *   to opt out or it shipped a silent AAC track.)
   * - `"on"` — always a track: the real mix, or an explicit SILENCE BED
   *   when no inputs carry audio.
   * - `"off"` — never a track, even with audio inputs (the doc-level
   *   mute; deliverables mux `-an`).
   * Internal carriers always keep an audio leg regardless, for
   * downstream stream binding.
   */
  mode?: "auto" | "on" | "off";

  /**
   * Audio codec name. Common values: `"aac"`, `"libmp3lame"`,
   * `"libopus"`, `"flac"`, `"pcm_s16le"`, `"pcm_s24le"`.
   *
   * Accepts strings outside the {@link AudioCodec} union so future
   * codecs and platform-specific encoders work without a type change.
   */
  codec?: AudioCodec | (string & {});

  /**
   * Bitrate string in ffmpeg notation, e.g. `"192k"`, `"320k"`.
   * Ignored by lossless codecs (PCM, FLAC). Maps to ffmpeg `-b:a`.
   */
  bitrate?: string;

  /**
   * Sample rate in Hz. Common values: `44100`, `48000`, `96000`.
   * Maps to ffmpeg `-ar`.
   */
  sampleRate?: number;

  /**
   * Channel layout. Common values: `"mono"`, `"stereo"`, `"5.1"`,
   * `"7.1"`. Maps to ffmpeg `-ac` (channel count) or
   * `-channel_layout` (named layout).
   */
  channelLayout?: string;

  /**
   * Global (master) volume — a linear multiplier applied ONCE to the
   * fully-mixed audio track, after per-source volumes and `amix`.
   * Default: `1` (unchanged). `2` doubles, `0.5` halves; `<= 0`
   * silences the mix.
   *
   * **Mix-level knob only.** Honored on `doc.audio` (the flat-render
   * document mix) and `pipeline.audio` (applied once at the FINAL
   * pipeline stitch — never per reduction round, which would compound).
   * **Ignored on per-encode configs**: encoding copies or transcodes an
   * already-mixed master track, so a per-deliverable re-mix is not a
   * thing the engine does. Set global volume on the document, not on an
   * `encodes.<key>.audio`.
   *
   * Emitted as ffmpeg `volume=<v>` only when set and `!= 1`, so a doc
   * that never touches this field produces byte-identical filtergraphs.
   */
  volume?: number;
};
