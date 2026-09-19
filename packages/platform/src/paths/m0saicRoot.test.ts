import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  getM0saicRoot,
  getFfmpegToolchainsRoot,
  getGoldenFfmpegSlotDir,
  getGoldenFfmpegBinaryPath,
  getCustomFfmpegRoot,
  ensureDir,
} from "./m0saicRoot";
import { M0SAIC_TMP_PREFIX } from "./tempPrefix";

describe("getM0saicRoot", () => {
  const originalEnv = process.env.M0SAIC_ROOT;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.M0SAIC_ROOT;
    else process.env.M0SAIC_ROOT = originalEnv;
  });

  it("returns ~/m0saic by default", () => {
    delete process.env.M0SAIC_ROOT;
    expect(getM0saicRoot()).toBe(path.join(os.homedir(), "m0saic"));
  });

  it("honors M0SAIC_ROOT env override", () => {
    process.env.M0SAIC_ROOT = "/tmp/m0test";
    expect(getM0saicRoot()).toBe(path.resolve("/tmp/m0test"));
  });

  it("trims and resolves the override", () => {
    process.env.M0SAIC_ROOT = "  /tmp/m0test  ";
    expect(getM0saicRoot()).toBe(path.resolve("/tmp/m0test"));
  });

  it("falls back to default when override is empty", () => {
    process.env.M0SAIC_ROOT = "";
    expect(getM0saicRoot()).toBe(path.join(os.homedir(), "m0saic"));
  });

  it("does NOT create the directory on import or call", () => {
    process.env.M0SAIC_ROOT = path.join(
      os.tmpdir(),
      `${M0SAIC_TMP_PREFIX}root-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const root = getM0saicRoot();
    expect(fs.existsSync(root)).toBe(false);
  });
});

describe("ffmpeg toolchain path helpers", () => {
  const fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}root-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  beforeAll(() => {
    process.env.M0SAIC_ROOT = fixture;
  });

  afterAll(() => {
    delete process.env.M0SAIC_ROOT;
  });

  it("getFfmpegToolchainsRoot is <root>/toolchains/ffmpeg", () => {
    expect(getFfmpegToolchainsRoot()).toBe(
      path.join(fixture, "toolchains", "ffmpeg"),
    );
  });

  it("getGoldenFfmpegSlotDir composes <root>/toolchains/ffmpeg/<version>-<variant>", () => {
    expect(getGoldenFfmpegSlotDir("1.0.0", "lgpl")).toBe(
      path.join(fixture, "toolchains", "ffmpeg", "1.0.0-lgpl"),
    );
    expect(getGoldenFfmpegSlotDir("1.1.0", "gpl")).toBe(
      path.join(fixture, "toolchains", "ffmpeg", "1.1.0-gpl"),
    );
  });

  it("getGoldenFfmpegBinaryPath uses .exe on Windows, plain on others", () => {
    const p = getGoldenFfmpegBinaryPath("1.0.0", "gpl");
    const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    expect(p).toBe(
      path.join(fixture, "toolchains", "ffmpeg", "1.0.0-gpl", "bin", exe),
    );
  });

  it("getCustomFfmpegRoot is <root>/toolchains/ffmpeg/custom", () => {
    expect(getCustomFfmpegRoot()).toBe(
      path.join(fixture, "toolchains", "ffmpeg", "custom"),
    );
  });
});

describe("momo path helpers", () => {
  const fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}momo-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  beforeAll(() => {
    process.env.M0SAIC_ROOT = fixture;
  });

  afterAll(() => {
    delete process.env.M0SAIC_ROOT;
  });

  // Lazy require so the helpers see the M0SAIC_ROOT env we just set.
  // (m0saicRoot.ts reads the env on every call so a fresh require isn't
  // strictly needed — we just import normally.)
  const {
    getMomoRoot,
    getMomoModelsRoot,
    getMomoModelPath,
  } = require("./m0saicRoot") as typeof import("./m0saicRoot");

  it("getMomoRoot is <root>/momo", () => {
    expect(getMomoRoot()).toBe(path.join(fixture, "momo"));
  });

  it("getMomoModelsRoot is <root>/momo/models", () => {
    expect(getMomoModelsRoot()).toBe(path.join(fixture, "momo", "models"));
  });

  it("getMomoModelPath joins the bare filename under models root", () => {
    expect(getMomoModelPath("qwen2.5-coder-7b-q4.gguf")).toBe(
      path.join(fixture, "momo", "models", "qwen2.5-coder-7b-q4.gguf"),
    );
  });

  it("getMomoModelPath leaves the filename unchanged (no normalization)", () => {
    // The downloader is responsible for validating filename shape; the path
    // helper just joins. This test guards against accidental slug/slashing
    // creeping into the helper layer.
    expect(getMomoModelPath("something.with.dots.gguf")).toBe(
      path.join(fixture, "momo", "models", "something.with.dots.gguf"),
    );
  });
});

describe("ensureDir", () => {
  const fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}ensure-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  afterAll(() => {
    if (fs.existsSync(fixture)) fs.rmSync(fixture, { recursive: true, force: true });
  });

  it("creates the directory recursively", () => {
    const nested = path.join(fixture, "a", "b", "c");
    expect(fs.existsSync(nested)).toBe(false);
    ensureDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("is idempotent", () => {
    const nested = path.join(fixture, "a", "b", "c");
    ensureDir(nested);
    ensureDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });
});
