import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { execFileSync } from "child_process";
import { installFfmpegToolchain, type FfmpegInstallEvent } from "./install";
import { ffmpegBaseline } from "./index";

// Tiny real archives, built at load time with the system tar (bsdtar on
// macOS/Windows — the same tool extractArchive uses), so extraction runs
// the true code path AND the stub binaries inside carry the
// platform-correct names (ffmpeg.exe on Windows, bare ffmpeg elsewhere).
// Pre-baked base64 fixtures used to hard-code the POSIX names, which made
// every happy-path install test fail on Windows — findBinary scans for
// binName(tool). combo.zip holds ffmpeg-test-lgpl/bin/{ffmpeg,ffprobe}
// stub shell scripts; bare.zip holds a single root-level `ffmpeg` file
// (the martin-riedl shape).
function fixtureBinName(tool: "ffmpeg" | "ffprobe"): string {
  return process.platform === "win32" ? `${tool}.exe` : tool;
}

function buildZipFixture(
  entries: Array<{ name: string; content: string }>,
): { buf: Buffer; sha256: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-install-fixture-"));
  try {
    const roots = new Set<string>();
    for (const e of entries) {
      const full = path.join(dir, e.name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, e.content, { mode: 0o755 });
      roots.add(e.name.split("/")[0]);
    }
    const zipPath = path.join(dir, "fixture.zip");
    execFileSync("tar", ["-a", "-cf", zipPath, "-C", dir, ...roots]);
    const buf = fs.readFileSync(zipPath);
    return {
      buf,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const combo = buildZipFixture([
  {
    name: `ffmpeg-test-lgpl/bin/${fixtureBinName("ffmpeg")}`,
    content: "#!/bin/sh\necho ffmpeg test stub\n",
  },
  {
    name: `ffmpeg-test-lgpl/bin/${fixtureBinName("ffprobe")}`,
    content: "#!/bin/sh\necho ffprobe test stub\n",
  },
]);
const COMBO_ZIP = combo.buf;
const COMBO_ZIP_SHA256 = combo.sha256;

const bare = buildZipFixture([
  { name: fixtureBinName("ffmpeg"), content: "#!/bin/sh\necho ffmpeg bare stub\n" },
]);
const BARE_ZIP = bare.buf;
const BARE_ZIP_SHA256 = bare.sha256;

/** fetch stub serving Buffers by URL; anything else 404s. */
function fakeFetch(routes: Record<string, Buffer>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const body = routes[url];
    if (!body) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { "content-length": String(body.byteLength) },
    });
  }) as typeof fetch;
}

const PLATFORM_KEY = "test-arch";
const testTarget = (over?: Partial<Record<string, unknown>>) => ({
  available: true as const,
  snapshot: "N-TEST",
  date: "2026-01-01",
  profile: "lgpl" as const,
  source: "unit-test",
  vendored: true,
  redistributable: true,
  infoUrl: "https://example.test/info",
  licenseNote: "test",
  artifacts: [
    {
      tools: ["ffmpeg", "ffprobe"] as Array<"ffmpeg" | "ffprobe">,
      archive: "zip" as const,
      url: "https://mirror.test/combo.zip",
      upstreamUrl: "https://origin.test/combo.zip",
      sha256: COMBO_ZIP_SHA256,
    },
  ],
  ...over,
});

describe("installFfmpegToolchain", () => {
  let m0saicRoot: string;
  const originalRoot = process.env.M0SAIC_ROOT;

  beforeEach(() => {
    m0saicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-install-test-"));
    process.env.M0SAIC_ROOT = m0saicRoot;
    // Point the manifest at the test target without touching baseline.json.
    (ffmpegBaseline.platforms as Record<string, unknown>)[PLATFORM_KEY] = {
      lgpl: testTarget(),
      gpl: {
        available: false,
        reason: "unit-test gap",
        trackingUrl: "https://example.test/tracking",
      },
    };
  });

  afterEach(() => {
    delete (ffmpegBaseline.platforms as Record<string, unknown>)[PLATFORM_KEY];
    if (originalRoot === undefined) delete process.env.M0SAIC_ROOT;
    else process.env.M0SAIC_ROOT = originalRoot;
    fs.rmSync(m0saicRoot, { recursive: true, force: true });
  });

  const slotBin = (variant: string, tool: string) =>
    path.join(
      m0saicRoot,
      "toolchains",
      "ffmpeg",
      `${ffmpegBaseline.m0saicVersion}-${variant}`,
      "bin",
      process.platform === "win32" ? `${tool}.exe` : tool,
    );

  test("downloads, verifies, extracts, and installs into the golden slot", async () => {
    const events: FfmpegInstallEvent[] = [];
    const result = await installFfmpegToolchain({
      variant: "lgpl",
      platformKey: PLATFORM_KEY,
      fetchImpl: fakeFetch({ "https://mirror.test/combo.zip": COMBO_ZIP }),
      onEvent: (e) => events.push(e),
    });

    expect(result.kind).toBe("done");
    expect(fs.existsSync(slotBin("lgpl", "ffmpeg"))).toBe(true);
    expect(fs.existsSync(slotBin("lgpl", "ffprobe"))).toBe(true);
    // Provenance sidecar records what was actually served.
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(slotBin("lgpl", "ffmpeg")), "..", "install-manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.artifacts[0].url).toBe("https://mirror.test/combo.zip");
    expect(manifest.artifacts[0].sha256).toBe(COMBO_ZIP_SHA256);
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["started", "downloading", "verifying", "extracting", "done"]),
    );
    // No staging litter left behind.
    const litter = fs
      .readdirSync(path.join(m0saicRoot, "toolchains", "ffmpeg"))
      .filter((n) => n.startsWith(".staging-"));
    expect(litter).toEqual([]);
  });

  test("falls back to upstreamUrl when the mirror 404s", async () => {
    const result = await installFfmpegToolchain({
      variant: "lgpl",
      platformKey: PLATFORM_KEY,
      fetchImpl: fakeFetch({ "https://origin.test/combo.zip": COMBO_ZIP }),
    });
    expect(result.kind).toBe("done");
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(
          m0saicRoot,
          "toolchains",
          "ffmpeg",
          `${ffmpegBaseline.m0saicVersion}-lgpl`,
          "install-manifest.json",
        ),
        "utf8",
      ),
    );
    expect(manifest.artifacts[0].url).toBe("https://origin.test/combo.zip");
  });

  test("sha256 mismatch installs nothing and reports the URL", async () => {
    (ffmpegBaseline.platforms as Record<string, any>)[PLATFORM_KEY].lgpl =
      testTarget({
        artifacts: [
          {
            tools: ["ffmpeg", "ffprobe"],
            archive: "zip",
            url: "https://mirror.test/combo.zip",
            sha256: "0".repeat(64),
          },
        ],
      });
    const result = await installFfmpegToolchain({
      variant: "lgpl",
      platformKey: PLATFORM_KEY,
      fetchImpl: fakeFetch({ "https://mirror.test/combo.zip": COMBO_ZIP }),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toMatch(/sha256 mismatch/);
      expect(result.failedUrl).toBe("https://mirror.test/combo.zip");
    }
    expect(fs.existsSync(slotBin("lgpl", "ffmpeg"))).toBe(false);
  });

  test("multi-artifact target (martin-riedl shape: one bare zip per tool)", async () => {
    (ffmpegBaseline.platforms as Record<string, any>)[PLATFORM_KEY].lgpl =
      testTarget({
        artifacts: [
          {
            tools: ["ffmpeg"],
            archive: "zip",
            url: "https://mirror.test/bare.zip",
            sha256: BARE_ZIP_SHA256,
          },
        ],
      });
    const result = await installFfmpegToolchain({
      variant: "lgpl",
      platformKey: PLATFORM_KEY,
      fetchImpl: fakeFetch({ "https://mirror.test/bare.zip": BARE_ZIP }),
    });
    expect(result.kind).toBe("done");
    if (result.kind === "done") {
      expect(result.ffprobePath).toBeNull();
    }
    expect(fs.existsSync(slotBin("lgpl", "ffmpeg"))).toBe(true);
  });

  test("gap entries produce an unavailable error with the documented reason", async () => {
    const result = await installFfmpegToolchain({
      variant: "gpl",
      platformKey: PLATFORM_KEY,
      fetchImpl: fakeFetch({}),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toMatch(/unit-test gap/);
      expect(result.reason).toMatch(/tracking/);
    }
  });

  test("unknown platform key resolves to a synthetic gap", async () => {
    const result = await installFfmpegToolchain({
      variant: "lgpl",
      platformKey: "beos-ppc",
      fetchImpl: fakeFetch({}),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toMatch(/beos-ppc/);
    }
  });

  test("abort mid-download reports cancelled and installs nothing", async () => {
    const controller = new AbortController();
    const slowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      // Abort after headers, before the body finishes streaming.
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new Uint8Array(COMBO_ZIP.subarray(0, 64)));
          controller.abort();
          const signal = init?.signal;
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          if (signal?.aborted) streamController.error(err);
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    const result = await installFfmpegToolchain({
      variant: "lgpl",
      platformKey: PLATFORM_KEY,
      signal: controller.signal,
      fetchImpl: slowFetch,
    });
    expect(result.kind).toBe("cancelled");
    expect(fs.existsSync(slotBin("lgpl", "ffmpeg"))).toBe(false);
  });
});
