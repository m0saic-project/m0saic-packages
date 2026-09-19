import { spawnSync } from "child_process";
import { sanitizedFfmpegEnv, STRIPPED_FFMPEG_ENV_VARS } from "./childEnv";

describe("sanitizedFfmpegEnv", () => {
  const dirty: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/Users/someone",
    TMPDIR: "/private/tmp/x",
    LANG: "en_US.UTF-8",
    FONTCONFIG_FILE: "/etc/fonts/fonts.conf",
    FFREPORT: "file=/tmp/leak.log:level=48",
    ffreport: "file=/tmp/leak2.log",
    FFMPEG_DATADIR: "/tmp/presets",
    AV_LOG_FORCE_COLOR: "1",
    AV_LOG_FORCE_256COLOR: "1",
    http_proxy: "http://127.0.0.1:3128",
  };

  it("strips FFREPORT / FFMPEG_DATADIR / colour forcing, keeps PATH/HOME/TMPDIR/LANG/fontconfig/proxy", () => {
    const env = sanitizedFfmpegEnv(dirty);
    for (const k of STRIPPED_FFMPEG_ENV_VARS) expect(env).not.toHaveProperty(k);
    expect(env).not.toHaveProperty("ffreport");
    expect(env.PATH).toBe(dirty.PATH);
    expect(env.HOME).toBe(dirty.HOME);
    expect(env.TMPDIR).toBe(dirty.TMPDIR);
    expect(env.LANG).toBe(dirty.LANG);
    expect(env.FONTCONFIG_FILE).toBe(dirty.FONTCONFIG_FILE);
    expect(env.http_proxy).toBe(dirty.http_proxy);
    expect(env.AV_LOG_FORCE_NOCOLOR).toBe("1");
  });

  it("never mutates its input and defaults to process.env", () => {
    const before = { ...dirty };
    sanitizedFfmpegEnv(dirty);
    expect(dirty).toEqual(before);
    const prev = process.env.FFREPORT;
    process.env.FFREPORT = "file=/tmp/x.log";
    try {
      expect(sanitizedFfmpegEnv()).not.toHaveProperty("FFREPORT");
      expect(process.env.FFREPORT).toBe("file=/tmp/x.log");
    } finally {
      if (prev === undefined) delete process.env.FFREPORT;
      else process.env.FFREPORT = prev;
    }
  });

  it("a spawned child does not see FFREPORT (real child, prints its env)", () => {
    const r = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      { encoding: "utf8", env: sanitizedFfmpegEnv({ ...process.env, FFREPORT: "file=/tmp/leak.log" }) },
    );
    expect(r.status).toBe(0);
    const childEnv = JSON.parse(r.stdout) as Record<string, string>;
    expect(childEnv).not.toHaveProperty("FFREPORT");
    expect(childEnv).not.toHaveProperty("FFMPEG_DATADIR");
    expect(childEnv.AV_LOG_FORCE_NOCOLOR).toBe("1");
    expect(typeof childEnv.PATH).toBe("string");
  });
});
