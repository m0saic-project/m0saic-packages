import type { MosaicAudioConfig } from "../output/audio-config";

/**
 * Canonical audio presets for {@link MosaicAudioConfig}.
 *
 * The presets cover the "just make it work" persona: pick the one
 * that matches your container/use-case and the audio side of your
 * render is done. The engine applies these automatically based on
 * the chosen {@link MosaicOutputTarget} — authors only need to set
 * `MosaicOutput.audio` when they want to override a specific knob.
 *
 * Power users override individual fields on `MosaicOutput.audio`;
 * unset fields keep the preset's value. The engine substitutes the
 * codec automatically when the chosen codec is incompatible with
 * the target's container, emitting `AUDIO_CODEC_SUBSTITUTED`
 * (warning) so the substitution is observable.
 */

/**
 * Default audio config — AAC stereo 192k 48kHz.
 *
 * The "just make it work" preset for `web-mp4`, `alpha-mov`, and
 * any other mp4/mov/mkv/m4a-containerized output. AAC is the
 * widest-compatible video-audio codec; 192k is the standard YouTube
 * / podcast-quality bitrate for stereo; 48kHz matches the standard
 * for video (vs. 44.1kHz which is the CD standard).
 *
 * NOT compatible with webm — see {@link DEFAULT_WEBM_AUDIO_CONFIG}.
 */
export const DEFAULT_AUDIO_CONFIG: MosaicAudioConfig = {
  mode: "auto",
  codec: "aac",
  bitrate: "192k",
  sampleRate: 48000,
  channelLayout: "stereo",
};

/**
 * WebM audio — Opus stereo 128k 48kHz.
 *
 * WebM only accepts Opus or Vorbis; Opus is strictly newer and
 * better. 128k Opus is roughly equivalent to 192k AAC perceptually
 * (Opus is more efficient at low bitrates).
 */
export const DEFAULT_WEBM_AUDIO_CONFIG: MosaicAudioConfig = {
  mode: "auto",
  codec: "libopus",
  bitrate: "128k",
  sampleRate: 48000,
  channelLayout: "stereo",
};

/**
 * Podcast / voice — AAC mono 96k 44.1kHz.
 *
 * Mono saves ~50% file size with no perceived quality loss for
 * single-speaker speech. 96k is the standard podcast bitrate;
 * 44.1kHz is the standard for speech-only audio (broadcast and
 * music typically use 48kHz).
 */
export const DEFAULT_PODCAST_AUDIO_CONFIG: MosaicAudioConfig = {
  mode: "auto",
  codec: "aac",
  bitrate: "96k",
  sampleRate: 44100,
  channelLayout: "mono",
};

/**
 * Broadcast / cinema surround — AAC 5.1 384k 48kHz.
 *
 * For finished surround mixes destined for broadcast or cinema
 * delivery. 384k is the standard 5.1 AAC bitrate (proportional to
 * channel count). Use `channelLayout: "7.1"` and bump the bitrate
 * to ~512k for 7.1 sources.
 */
export const DEFAULT_SURROUND_AUDIO_CONFIG: MosaicAudioConfig = {
  mode: "auto",
  codec: "aac",
  bitrate: "384k",
  sampleRate: 48000,
  channelLayout: "5.1",
};

/**
 * Archival lossless — FLAC stereo 48kHz.
 *
 * For mastering / archival workflows where every encoder pass is
 * costly. FLAC ignores `bitrate` (it's lossless). Compatible with
 * mkv and flac containers; not compatible with mp4/webm.
 */
export const DEFAULT_LOSSLESS_AUDIO_CONFIG: MosaicAudioConfig = {
  mode: "auto",
  codec: "flac",
  sampleRate: 48000,
  channelLayout: "stereo",
};

/**
 * No audio — explicitly disables the audio stream. Engine emits
 * `-an`. Used for silent renders, motion-design outputs, and image
 * targets (which never get an audio stream regardless).
 */
export const DEFAULT_NO_AUDIO_CONFIG: MosaicAudioConfig = {
  mode: "off",
};
