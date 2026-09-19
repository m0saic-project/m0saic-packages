export {
  probeFfmpegRuntime,
  probeFfmpegVersion,
  probeFfprobeRuntime,
  detectRuntimeEncoders,
  detectRuntimeFilters,
  detectFfmpegCliOption,
  compareFfmpegVersionToEpoch,
  describeFfmpegVersion,
  parseFfmpegMajorVersion,
} from "./probe";
export type {
  FfmpegRuntime,
  FfmpegVersionInfo,
  FfprobeRuntime,
  EpochVerdict,
  EpochCompareOptions,
  FfmpegVersionDescription,
} from "./probe";

export {
  buildToolchainMetadata,
  buildToolchainSidecar,
  serializeToolchainSidecar,
  formatToolchainSummary,
  writeToolchainSidecar,
} from "./metadata";
export type { ToolchainMetadata, ToolchainSidecar } from "./metadata";

export {
  setDefaultToolchainBinaries,
  resetDefaultToolchainBinaries,
  getDefaultToolchainBinaries,
  resolveFfmpegPath,
  resolveFfprobePath,
} from "./defaultBinaries";

export { sanitizedFfmpegEnv, STRIPPED_FFMPEG_ENV_VARS } from "./childEnv";

export {
  trackLiveChild,
  liveChildCount,
  isChildAlive,
  killChildWithEscalation,
  abortLiveChildren,
  CHILD_KILL_GRACE_MS,
  __resetLiveChildrenForTests,
} from "./liveChildren";

export {
  runProbeChild,
  ProbeTimeoutError,
  PROBE_TIMEOUT,
  DEFAULT_PROBE_TIMEOUT_MS,
} from "./probeChild";
export type { ProbeChildOptions, ProbeChildResult } from "./probeChild";
export { SYNC_PROBE_TIMEOUT_MS } from "./probe";

export { resolveGoldenFfmpeg, goldenPlatformSlot } from "./goldenFfmpeg";
export type { GoldenFfmpegResolution } from "./goldenFfmpeg";
