// Downloader/installer for the pinned ffmpeg toolchains. Node-only (fs,
// crypto, child_process) — exported via the dedicated
// `@m0saic/platform/toolchain/ffmpeg/install` subpath so the browser-safe
// `toolchain/ffmpeg` manifest module stays importable from the web app.
//
// Both hosts wrap this one engine:
//   - CLI:      `m0saic setup` (packages/cli)
//   - Desktop:  `ffmpeg:installToolchain` IPC (apps/mosaic/electron/main.js)
//
// Flow (mirrors the Momo model downloader's contract — terminal event,
// never rejects):
//   1. Resolve the platform target from baseline.json (`platforms` map).
//      Gap entries (e.g. macOS LGPL today) return an `unavailable` error
//      event with the documented reason.
//   2. Download every artifact into a staging dir, hashing as we stream.
//      Vendored artifacts try the m0saic-ffmpeg-base mirror URL first and
//      fall back to the upstream origin (BtbN) when the mirror asset isn't
//      published. A browser-like User-Agent is always sent —
//      ffmpeg.martin-riedl.de rejects non-browser agents with 403.
//   3. Verify each artifact against its PINNED sha256 (mismatch = hard
//      error; nothing is installed).
//   4. Extract with the system `tar` (bsdtar on macOS/Windows reads zip;
//      GNU/bsd tar reads tar.xz), locate the ffmpeg/ffprobe binaries, and
//      copy them into the golden slot `<m0saic-root>/toolchains/ffmpeg/
//      <m0saicVersion>-<variant>/bin/` (chmod 755 on POSIX).
//   5. Write an `install-manifest.json` provenance sidecar into the slot
//      and re-probe the installed binary for its version string.
//
// License posture (see baseline.json + m0saic-ffmpeg-base): LGPL builds are
// vendored/redistributable; GPL builds are ALWAYS fetched from their origin
// at the user's explicit request — m0saic never redistributes them.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import {
  ensureDir,
  getGoldenFfmpegSlotDir,
  getFfmpegToolchainsRoot,
} from "../../paths";
import { probeFfmpegRuntime } from "../probe";
import {
  ffmpegBaseline,
  getFfmpegPlatformEntry,
  getPlatformKey,
  type FfmpegArtifact,
  type FfmpegPlatformTarget,
} from "./index";

/**
 * Sent on every fetch: some pinned sources (ffmpeg.martin-riedl.de) 403
 * plain library user agents. Identifies us honestly while satisfying the
 * browser-UA gate.
 */
const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (compatible; m0saic-toolchain-fetch) AppleWebKit/537.36";

/** ~10 progress events per second is plenty for a UI. */
const PROGRESS_THROTTLE_MS = 100;

export type FfmpegInstallEvent =
  | {
      kind: "started";
      variant: "lgpl" | "gpl";
      platformKey: string;
      snapshot: string;
      slotDir: string;
      artifactCount: number;
    }
  | {
      kind: "downloading";
      artifactIndex: number;
      artifactCount: number;
      url: string;
      tools: string[];
    }
  | {
      kind: "progress";
      artifactIndex: number;
      artifactCount: number;
      bytesReceived: number;
      /** 0 when the server didn't send a usable Content-Length. */
      totalBytes: number;
    }
  | { kind: "verifying"; artifactIndex: number; artifactCount: number }
  | { kind: "extracting"; artifactIndex: number; artifactCount: number }
  | {
      kind: "done";
      variant: "lgpl" | "gpl";
      slotDir: string;
      ffmpegPath: string;
      ffprobePath: string | null;
      /** First line of `ffmpeg -version` from the installed binary. */
      version: string | null;
    }
  | { kind: "cancelled" }
  | { kind: "error"; reason: string; failedUrl?: string };

export interface InstallFfmpegOpts {
  variant: "lgpl" | "gpl";
  /** Defaults to `${process.platform}-${process.arch}`. */
  platformKey?: string;
  onEvent?: (event: FfmpegInstallEvent) => void;
  /** Abort mid-download. Nothing is installed on cancel. */
  signal?: AbortSignal;
  /** Injection for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

function binName(tool: "ffmpeg" | "ffprobe"): string {
  return process.platform === "win32" ? `${tool}.exe` : tool;
}

/** Depth-first search for a file named exactly like the tool binary. */
function findBinary(rootDir: string, tool: "ffmpeg" | "ffprobe"): string | null {
  const wanted = binName(tool);
  const queue: string[] = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.name === wanted) return full;
    }
  }
  return null;
}

async function downloadToFile(
  url: string,
  destPath: string,
  opts: {
    fetchImpl: typeof fetch;
    signal?: AbortSignal;
    onProgress: (bytesReceived: number, totalBytes: number) => void;
  },
): Promise<{ sha256: string }> {
  const res = await opts.fetchImpl(url, {
    signal: opts.signal,
    headers: { "User-Agent": DOWNLOAD_USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Response has no body stream");
  }

  const totalBytes = Number(res.headers.get("content-length") ?? 0) || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(destPath);
  let bytesReceived = 0;
  let lastEmit = 0;

  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      bytesReceived += value.byteLength;
      await new Promise<void>((resolve, reject) => {
        out.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      const now = Date.now();
      if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
        lastEmit = now;
        opts.onProgress(bytesReceived, totalBytes);
      }
    }
    opts.onProgress(bytesReceived, totalBytes);
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }

  return { sha256: hash.digest("hex") };
}

/** Extract with the system tar — bsdtar (macOS/Windows) also reads zip. */
function extractArchive(archivePath: string, destDir: string): void {
  ensureDir(destDir);
  const result = spawnSync("tar", ["-xf", archivePath, "-C", destDir], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 120_000,
  });
  if (result.error) {
    throw new Error(`tar failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().slice(0, 400) ?? "";
    throw new Error(`tar exited ${result.status}: ${stderr}`);
  }
}

/**
 * Download, verify, and install the pinned ffmpeg toolchain for this
 * platform into the golden slot. Resolves with the terminal event —
 * never rejects. The slot becomes visible to the CLI's implicit golden
 * resolution and the desktop's toolchain pointer the moment it lands.
 */
export async function installFfmpegToolchain(
  opts: InstallFfmpegOpts,
): Promise<FfmpegInstallEvent> {
  const { variant, signal } = opts;
  const onEvent = opts.onEvent ?? (() => {});
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const platformKey = opts.platformKey ?? getPlatformKey();

  const emit = (e: FfmpegInstallEvent): FfmpegInstallEvent => {
    onEvent(e);
    return e;
  };

  const entry = getFfmpegPlatformEntry(variant, platformKey);
  if (!entry.available) {
    return emit({
      kind: "error",
      reason:
        `No ${variant.toUpperCase()} build is pinned for ${platformKey}: ${entry.reason}` +
        (entry.trackingUrl ? ` (tracking: ${entry.trackingUrl})` : ""),
    });
  }
  const target: FfmpegPlatformTarget = entry;

  const slotDir = getGoldenFfmpegSlotDir(ffmpegBaseline.m0saicVersion, variant);
  const slotBinDir = path.join(slotDir, "bin");
  ensureDir(getFfmpegToolchainsRoot());
  const stagingDir = fs.mkdtempSync(
    path.join(getFfmpegToolchainsRoot(), `.staging-${variant}-`),
  );

  const cleanupStaging = () => {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // best-effort — a stray staging dir is harmless and visible
    }
  };

  emit({
    kind: "started",
    variant,
    platformKey,
    snapshot: target.snapshot,
    slotDir,
    artifactCount: target.artifacts.length,
  });

  try {
    const extractedRoots: string[] = [];
    const provenance: Array<{
      url: string;
      sha256: string;
      tools: string[];
    }> = [];

    for (let i = 0; i < target.artifacts.length; i++) {
      const artifact: FfmpegArtifact = target.artifacts[i];
      const archivePath = path.join(stagingDir, `artifact-${i}.${artifact.archive}`);

      // Preferred URL first (the vendor mirror for vendored builds), then
      // the upstream origin. Track which one actually served the bytes.
      const candidateUrls = [artifact.url, artifact.upstreamUrl].filter(
        (u): u is string => !!u,
      );
      let servedFrom: string | null = null;
      let sha256 = "";
      let lastError: Error | null = null;

      for (const url of candidateUrls) {
        emit({
          kind: "downloading",
          artifactIndex: i,
          artifactCount: target.artifacts.length,
          url,
          tools: artifact.tools,
        });
        try {
          const result = await downloadToFile(url, archivePath, {
            fetchImpl,
            signal,
            onProgress: (bytesReceived, totalBytes) =>
              emit({
                kind: "progress",
                artifactIndex: i,
                artifactCount: target.artifacts.length,
                bytesReceived,
                totalBytes,
              }),
          });
          servedFrom = url;
          sha256 = result.sha256;
          break;
        } catch (err) {
          if (signal?.aborted) {
            cleanupStaging();
            return emit({ kind: "cancelled" });
          }
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      if (!servedFrom) {
        cleanupStaging();
        return emit({
          kind: "error",
          reason: `Download failed for ${artifact.tools.join("+")}: ${lastError?.message ?? "unknown"}`,
          failedUrl: candidateUrls[candidateUrls.length - 1],
        });
      }

      emit({
        kind: "verifying",
        artifactIndex: i,
        artifactCount: target.artifacts.length,
      });
      if (sha256 !== artifact.sha256) {
        cleanupStaging();
        return emit({
          kind: "error",
          reason:
            `sha256 mismatch for ${servedFrom}: expected ${artifact.sha256}, got ${sha256}. ` +
            "Nothing was installed — the download may be corrupt or tampered with.",
          failedUrl: servedFrom,
        });
      }

      emit({
        kind: "extracting",
        artifactIndex: i,
        artifactCount: target.artifacts.length,
      });
      const extractDir = path.join(stagingDir, `extracted-${i}`);
      extractArchive(archivePath, extractDir);
      extractedRoots.push(extractDir);
      provenance.push({ url: servedFrom, sha256, tools: artifact.tools });
    }

    // Locate every promised tool across the extracted trees, then land
    // them in the slot in one pass.
    const located = new Map<"ffmpeg" | "ffprobe", string>();
    for (const tool of ["ffmpeg", "ffprobe"] as const) {
      if (!target.artifacts.some((a) => a.tools.includes(tool))) continue;
      for (const root of extractedRoots) {
        const found = findBinary(root, tool);
        if (found) {
          located.set(tool, found);
          break;
        }
      }
      if (!located.has(tool)) {
        cleanupStaging();
        return emit({
          kind: "error",
          reason: `Archive extracted but no ${binName(tool)} binary was found inside.`,
        });
      }
    }

    ensureDir(slotBinDir);
    for (const [tool, srcPath] of located) {
      const destPath = path.join(slotBinDir, binName(tool));
      fs.rmSync(destPath, { force: true });
      fs.copyFileSync(srcPath, destPath);
      if (process.platform !== "win32") fs.chmodSync(destPath, 0o755);
    }

    const installManifest = {
      variant,
      platformKey,
      snapshot: target.snapshot,
      profile: target.profile,
      source: target.source,
      vendored: target.vendored,
      redistributable: target.redistributable,
      licenseNote: target.licenseNote,
      infoUrl: target.infoUrl,
      artifacts: provenance,
      installedAtIso: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(slotDir, "install-manifest.json"),
      JSON.stringify(installManifest, null, 2) + "\n",
      "utf8",
    );

    cleanupStaging();

    const ffmpegPath = path.join(slotBinDir, binName("ffmpeg"));
    const ffprobePath = located.has("ffprobe")
      ? path.join(slotBinDir, binName("ffprobe"))
      : null;
    const runtime = probeFfmpegRuntime(ffmpegPath);

    return emit({
      kind: "done",
      variant,
      slotDir,
      ffmpegPath,
      ffprobePath,
      version: runtime.found ? (runtime.version ?? null) : null,
    });
  } catch (err) {
    cleanupStaging();
    if (signal?.aborted) {
      return emit({ kind: "cancelled" });
    }
    return emit({
      kind: "error",
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
