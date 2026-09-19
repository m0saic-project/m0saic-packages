/**
 * Environment for every ffmpeg / ffprobe child m0saic spawns.
 *
 * ffmpeg reads a handful of environment variables that change what it
 * LOGS or WHERE it reads configuration from. Left in place they let the
 * caller's shell turn a render into an engine dump without touching any
 * m0saic flag:
 *
 *   - `FFREPORT` — `FFREPORT=file=x.log:level=48` makes ffmpeg write its
 *     own full log, headed by `Command line:` + the complete argv and
 *     followed by every filter parameter at trace level. The single most
 *     direct leak of the compiled plan. STRIPPED.
 *   - `FFMPEG_DATADIR` — where ffmpeg looks for its preset files
 *     (`libx264-*.ffpreset` …). A preset dir is user-controlled option
 *     injection into every encode. STRIPPED.
 *   - `AV_LOG_FORCE_COLOR` / `AV_LOG_FORCE_256COLOR` — ANSI colour in the
 *     stderr we capture would defeat the line-based redaction and the
 *     failure classifier's substring matches. STRIPPED, and
 *     `AV_LOG_FORCE_NOCOLOR=1` is SET so the capture is plain text on
 *     every host (a caller-provided NOCOLOR is kept as is — it agrees).
 *
 * Everything else passes through untouched: `PATH` (the binary lookup),
 * `HOME`, `TMPDIR`/`TMP`/`TEMP` (ffmpeg's own temp files), `LANG`/`LC_*`,
 * `FONTCONFIG_FILE`/`FONTCONFIG_PATH` (drawtext font discovery must keep
 * working), proxy variables for http inputs, and any GPU/driver selectors.
 *
 * This is one layer of the engine-IP posture, not the whole of it: an
 * `ffmpeg` shim first on `PATH`, or `ps` on the running child, still sees
 * the argv — out-of-process is out-of-process. See the agent contract §7.4.
 */

/** Variables deleted from the child environment (see module doc). */
export const STRIPPED_FFMPEG_ENV_VARS: readonly string[] = [
  "FFREPORT",
  "FFMPEG_DATADIR",
  "AV_LOG_FORCE_COLOR",
  "AV_LOG_FORCE_256COLOR",
];

/**
 * A copy of `env` (default: `process.env`) with the ffmpeg logging /
 * configuration variables removed and colour output disabled. Never
 * mutates its input. Pass as `spawn(bin, args, { env })`.
 */
export function sanitizedFfmpegEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    // Case-insensitive on purpose: Windows environments are case-insensitive
    // and `ffreport` would still be honoured there.
    if (STRIPPED_FFMPEG_ENV_VARS.includes(key.toUpperCase())) delete out[key];
  }
  out.AV_LOG_FORCE_NOCOLOR = "1";
  return out;
}
