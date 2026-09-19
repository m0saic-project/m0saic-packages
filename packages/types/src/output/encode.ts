import type { MosaicAudioConfig } from "./audio-config";
import type { MosaicColorConfig } from "./color-config";
import type { MosaicContainerMetadata } from "./container-metadata";
import type { MosaicOutputFormat } from "./format";

/**
 * One entry in a {@link MosaicOutput.encodes} map — a post-process
 * transcode pass over the master render.
 *
 * Multi-encode is `1 render → N encodes`: the engine renders the
 * master once, then runs `ffmpeg -i master.<ext> ...` per encode
 * entry to produce each codec / container variant. No re-layout,
 * no re-frame-generation; just transcoding.
 *
 * # What an encode CAN change
 *
 * - **Codec / container / pixel format / encoder tuning** — the
 *   primary axis. Use a different `format.videoCodec`,
 *   `format.audioCodec`, `format.bitrate`, encoder preset, etc.
 * - **Width / height** ({@link size}) — optional ffmpeg `scale`
 *   filter pass. **Will stretch content** (no aspect-aware padding,
 *   no re-layout). If the aspect ratio changes, you almost
 *   certainly want a sibling {@link MosaicOutput} entry
 *   (multi-output = re-render) instead.
 * - **Audio knobs**, **color tagging** (often needed for codec
 *   compatibility, e.g. bt709 → bt2020), **container metadata**.
 *
 * # What an encode CANNOT change
 *
 * - `fps` — inherited from the master.
 * - `durationMs` — inherited from the master.
 * - The parent output's `target` preset and `emit` mode.
 *
 * See the internal rendering-model-contract notes
 * (rule 11) for the full contract.
 */
export type MosaicOutputEncode = {
  /**
   * Optional ffmpeg `scale=W:H` filter pass. STRETCHES content —
   * no aspect-aware padding, no re-layout. Skip when you only want
   * a codec/container swap (the common case).
   */
  size?: { width: number; height: number };

  /** Container / codec / pixel-format / encoder-tuning knobs. */
  format?: MosaicOutputFormat;

  /** Audio-stream knobs (codec, bitrate, sample rate, channels). */
  audio?: MosaicAudioConfig;

  /**
   * Color tagging (space, range, primaries, transfer). Frequently
   * needs updating per encode for codec compatibility (e.g., a
   * bt2020 master transcoded to a bt709-tagged output for an SDR
   * codec).
   */
  color?: MosaicColorConfig;

  /** Container metadata atoms (title, author, copyright, …). */
  metadata?: MosaicContainerMetadata;
};
