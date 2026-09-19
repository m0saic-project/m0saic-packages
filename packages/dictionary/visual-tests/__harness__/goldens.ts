/**
 * Golden PNG harness for @m0saic/dictionary visual tests.
 *
 * Renders m0saic DSL strings to wireframe PNGs via the `m0saic make-wireframe`
 * CLI and compares them byte-for-byte against committed golden PNGs.
 *
 * Goldens are per-platform (dual-platform-goldens plan): each machine
 * validates `__goldens__/<win32|darwin>/…`, minted by its pinned toolchain.
 * The harness preflights the golden-slot ffmpeg and forces the spawned CLI
 * onto it via M0SAIC_TOOLCHAIN; PATH ffmpeg is never used.
 *
 * ## Modes (controlled by env var)
 *
 *   M0SAIC_UPDATE_GOLDENS=1  →  Generate / overwrite goldens.
 *                                The rendered PNG is written directly to the
 *                                __goldens__ directory. Tests pass silently.
 *
 *   (unset / default)         →  Verify mode.
 *                                Renders to a temp file, byte-compares against
 *                                the golden. On mismatch an __actual__ PNG is
 *                                saved next to the golden and the test throws
 *                                with both paths for easy visual diffing.
 *
 * ## Verbose output
 *
 *   M0SAIC_GOLDEN_VERBOSE=1   →  Print progress logs and stream CLI output.
 *
 * ## How to run
 *
 *   # Verify (CI / normal):
 *   npm test -- --testPathPatterns dictionary/visual-tests
 *
 *   # Update goldens after an intentional change:
 *   M0SAIC_UPDATE_GOLDENS=1 npm test -- --testPathPatterns dictionary/visual-tests
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { serializeM0File } from "@m0saic/dsl-file-formats";
import {
  writeToolchainSidecar,
  resolveGoldenFfmpeg,
  goldenPlatformSlot,
} from "@m0saic/platform/toolchain";
import type { GoldenFfmpegResolution } from "@m0saic/platform/toolchain";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";

/** Fixed epoch for deterministic .m0 file headers in tests. */
const DETERMINISTIC_DATE = new Date("2026-01-01T00:00:00.000Z");

function isVerbose(): boolean {
  return process.env.M0SAIC_GOLDEN_VERBOSE === "1";
}

function log(msg: string): void {
  if (!isVerbose()) return;
  // Jest captures console output; that's fine—this is explicitly opt-in.
  // Prefix so it's easy to spot in noisy runs.
  console.log(`[m0saic-golden] ${msg}`);
}

/**
 * Goldens always live under visual-tests/__goldens__, even when tests execute
 * from dist/. We detect dist/ and redirect to the corresponding source path.
 */
function resolveGoldensDir(): string {
  // __dirname at runtime is either:
  //   .../visual-tests/__harness__   (ts-jest / source)
  //   .../dist/visual-tests/__harness__  (compiled)
  const srcBased = path.resolve(__dirname, "..", "__goldens__");
  const normalized = srcBased.replace(/[\\/]/g, "/");
  // If we're running from dist/, rewrite to source visual-tests/
  if (normalized.includes("/dist/")) {
    return srcBased.replace(/[\\/]dist[\\/]/, path.sep);
  }
  return srcBased;
}

// Pixel goldens live in a per-platform slot (dual-platform-goldens plan):
// each machine byte-compares against goldens minted by ITS pinned toolchain.
const GOLDENS_DIR = path.join(resolveGoldensDir(), goldenPlatformSlot());

/**
 * Golden-toolchain preflight: verify the pinned golden-slot ffmpeg exists
 * and matches the platform baseline, and force the spawned CLI onto it via
 * M0SAIC_TOOLCHAIN — never its PATH fallback. Resolved once per process.
 */
let goldenFfmpegCache: GoldenFfmpegResolution | undefined;
function requireGoldenFfmpeg(): Extract<GoldenFfmpegResolution, { ok: true }> {
  goldenFfmpegCache ??= resolveGoldenFfmpeg();
  if (!goldenFfmpegCache.ok) {
    throw new Error(
      `Golden toolchain preflight failed.\n${goldenFfmpegCache.message}`
    );
  }
  return goldenFfmpegCache;
}

function shouldUpdate(): boolean {
  return process.env.M0SAIC_UPDATE_GOLDENS === "1";
}

/**
 * Resolve the m0saic CLI binary. Prefer the locally-linked package.
 */
function resolveCliBin(): string {
  // Walk up from visual-tests/__harness__ to the repo root's node_modules/.bin
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const repoBin = path.join(repoRoot, "node_modules", ".bin", "m0saic");
  if (fs.existsSync(repoBin) || fs.existsSync(repoBin + ".cmd")) return repoBin;

  // Fallback: assume globally installed
  return "m0saic";
}

export type WireframeGoldenOpts = {
  /** Deterministic name for the golden file (without extension). */
  id: string;
  /** The m0 string to render. */
  m0: string;
  /** Output width in pixels. */
  width: number;
  /** Output height in pixels. */
  height: number;
};

/**
 * Render a m0saic string to a wireframe PNG and compare against a golden.
 *
 * Always uses `--mfile` to avoid shell quoting issues.
 * Uses `shell: true` on Windows so that `.cmd` wrappers resolve correctly.
 */
export function assertWireframeGolden(opts: WireframeGoldenOpts): void {
  const { id, m0, width, height } = opts;
  const update = shouldUpdate();

  const golden = requireGoldenFfmpeg();
  const goldenPath = path.join(GOLDENS_DIR, `${id}.png`);

  writeToolchainSidecar(GOLDENS_DIR, {
    ffmpegPath: golden.ffmpegPath,
    ffprobePath: golden.ffprobePath,
  });

  log(`id="${id}" mode=${update ? "update" : "verify"} size=${width}x${height}`);
  log(`goldensDir=${GOLDENS_DIR}`);
  log(`goldenPath=${goldenPath}`);

  // Write m0saic string to a temp .m0 file via DSL serializer
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("golden")));
  const mfilePath = path.join(tmpDir, `${id}.m0`);

  const m0Content = serializeM0File({
    m0,
    size: { width, height },
    created: DETERMINISTIC_DATE,
    app: "m0saic-golden-harness",
  });

  fs.writeFileSync(mfilePath, m0Content, "utf8");
  log(`wrote mfile=${mfilePath}`);

  // Goldens render with an opaque WHITE canvas (founder ruling 2026-07-19):
  // reviewable images instead of transparent ink-only, and it sidesteps the
  // transparent-bg × chunked-render engine bug (dense grids composite to
  // opaque black). Passed as a props FILE via readJsonArg's `@path` syntax —
  // inline JSON breaks under the Windows shell:true spawn.
  const propsPath = path.join(tmpDir, "wireframe-props.json");
  fs.writeFileSync(propsPath, JSON.stringify({ background: "white" }), "utf8");

  // Determine where to render
  const outputPath = update ? goldenPath : path.join(tmpDir, `${id}.png`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  log(`outputPath=${outputPath}`);

  // Invoke m0saic make-wireframe
  const bin = resolveCliBin();
  const args = [
    "make-wireframe",
    "--mfile",
    mfilePath,
    "-w",
    String(width),
    "-h",
    String(height),
    "-o",
    outputPath,
    "--props",
    `@${propsPath}`,
    "--format",
    "image",
    "--quiet",
  ];

  log(`spawn: ${bin} ${args.join(" ")}`);

  const isWin = process.platform === "win32";
  const verbose = isVerbose();

  const result = spawnSync(bin, args, {
    // In verbose mode, stream CLI output live so you see progress / ffmpeg logs.
    // Otherwise, capture output to attach on errors.
    stdio: verbose ? "inherit" : "pipe",
    timeout: 60_000,
    windowsHide: true,
    shell: isWin,
    // Force the CLI onto the pinned golden toolchain (its resolver honors
    // M0SAIC_TOOLCHAIN before config/golden/PATH fallbacks).
    // Goldens must never write telemetry records or spawn an upstream flush.
    env: { ...process.env, M0SAIC_TOOLCHAIN: golden.baseline.profile, M0SAIC_TELEMETRY: "ghost" },
  });

  // Clean up temp .m0 file
  try {
    fs.unlinkSync(mfilePath);
  } catch {
    /* ignore */
  }

  if (result.error) {
    cleanup(tmpDir);
    throw new Error(
      `Failed to spawn m0saic CLI: ${result.error.message}\n` +
        `  binary: ${bin}\n` +
        `  args: ${args.join(" ")}\n` +
        `If this is EACCES/ENOENT, the CLI is not built + linked: ` +
        `(cd packages/cli && npm run build && npm link)`
    );
  }

  if (result.status !== 0) {
    // If verbose=true, output was already streamed. Still provide best-effort details.
    const stderr = !verbose ? result.stderr?.toString("utf8") ?? "" : "";
    const stdout = !verbose ? result.stdout?.toString("utf8") ?? "" : "";
    cleanup(tmpDir);
    throw new Error(
      `m0saic make-wireframe exited with code ${result.status}\n` +
        (stderr ? `  stderr: ${stderr}\n` : "") +
        (stdout ? `  stdout: ${stdout}\n` : "") +
        (!stderr && !stdout && verbose
          ? `  (output was streamed; re-run without M0SAIC_GOLDEN_VERBOSE=1 to capture logs)\n`
          : "")
    );
  }

  if (!fs.existsSync(outputPath)) {
    cleanup(tmpDir);
    throw new Error(`Wireframe render produced no output at ${outputPath}`);
  }

  if (update) {
    log(`updated golden: ${goldenPath}`);
    cleanup(tmpDir);
    return;
  }

  // --- Verify mode ---

  if (!fs.existsSync(goldenPath)) {
    cleanup(tmpDir);
    throw new Error(
      `Missing golden: ${goldenPath}\n` +
        `This platform's golden slot has not been minted for this case. ` +
        `Re-run the failing suite with M0SAIC_UPDATE_GOLDENS=1 to mint it, ` +
        `then review the image and commit.`
    );
  }

  const actualBytes = fs.readFileSync(outputPath);
  const expectedBytes = fs.readFileSync(goldenPath);

  if (actualBytes.equals(expectedBytes)) {
    log(`match ✓ ${id}`);
    cleanup(tmpDir);
    return;
  }

  // Mismatch — save actual next to golden for easy visual diff
  const actualDebugPath = path.join(GOLDENS_DIR, `${id}.__actual__.png`);
  fs.copyFileSync(outputPath, actualDebugPath);
  cleanup(tmpDir);

  throw new Error(
    `Wireframe golden mismatch for "${id}".\n` +
      `  Expected: ${goldenPath}\n` +
      `  Actual:   ${actualDebugPath}\n` +
      `Compare visually and run with M0SAIC_UPDATE_GOLDENS=1 to update.`
  );
}

function cleanup(tmpDir: string): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
