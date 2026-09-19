import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CORE_MEDIA,
  STARTER_MEDIA_ROLES,
  packageAssetsDir,
  starterAssetsDir,
  starterMedia,
  starterMediaFrom,
  starterMediaPath,
  type StarterMediaRole,
} from "./defaultMedia";

const PKG_ROOT = path.resolve(__dirname, "..", "..");

describe("starter media — the included SVG defaults", () => {
  it("resolves the package-root assets dir from wherever this module compiles to", () => {
    expect(packageAssetsDir()).toBe(path.join(PKG_ROOT, "assets"));
    expect(starterAssetsDir()).toBe(path.join(PKG_ROOT, "assets", "starter"));
  });

  it.each(STARTER_MEDIA_ROLES)("%s → an existing .svg file asset (image)", (role) => {
    const p = starterMediaPath(role);
    expect(p).toBe(path.join(PKG_ROOT, "assets", "starter", `${role}.svg`));
    expect(fs.existsSync(p)).toBe(true);
    expect(starterMedia(role)).toEqual({ kind: "file", path: p, mediaType: "image" });
  });

  it.each(STARTER_MEDIA_ROLES)("%s is a viewBox-only, text-free, small SVG the rasterizer scales to the cell", (role) => {
    const text = fs.readFileSync(starterMediaPath(role), "utf8");
    expect(text.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ")).toBe(true);
    // No intrinsic size: the plan-time rasterizer picks the density.
    expect(/<svg[^>]*\s(width|height)=/.test(text)).toBe(false);
    // No text: the rasterizer's font fallback is not ours, and a stand-in
    // reads as media, not as a label.
    expect(/<text[\s>]/.test(text)).toBe(false);
    expect(Buffer.byteLength(text)).toBeLessThan(8 * 1024);
  });

  it("the roles keep their aspect: portrait / facecam tall, landscape wide, square / avatar / logo square", () => {
    const aspect = (role: StarterMediaRole) => {
      const m = /viewBox="0 0 (\d+) (\d+)"/.exec(fs.readFileSync(starterMediaPath(role), "utf8"))!;
      return Number(m[1]) / Number(m[2]);
    };
    expect(aspect("portrait")).toBeCloseTo(9 / 16, 2);
    expect(aspect("facecam")).toBeCloseTo(9 / 16, 2);
    expect(aspect("landscape")).toBeCloseTo(16 / 9, 2);
    expect(aspect("square")).toBe(1);
    expect(aspect("avatar")).toBe(1);
    expect(aspect("logo")).toBe(1);
  });

  it("an unknown role, or a missing file, degrades to null — never a throw", () => {
    expect(starterMedia("banner" as StarterMediaRole)).toBeNull();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "starter-empty-"));
    try {
      expect(starterMediaFrom(empty, "facecam")).toBeNull();
      expect(starterMediaFrom(empty, "banner" as StarterMediaRole)).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("the asar twin: a starters dir inside app.asar resolves to app.asar.unpacked", () => {
    const inAsar = path.join("C:", "app", "resources", "app.asar", "node_modules", "@m0saic", "template-utils", "assets", "starter");
    // Nothing exists there, so the asset is null — but the PATH it probed is
    // the unpacked twin (what a spawned ffmpeg can open).
    expect(starterMediaFrom(inAsar, "logo")).toBeNull();
    expect(starterMediaPath("logo")).not.toContain(`${path.sep}app.asar${path.sep}`);
  });

  it("CORE_MEDIA now points at the package-root assets (it used to name a dist/assets that never existed)", () => {
    for (const p of Object.values(CORE_MEDIA)) {
      expect(p.startsWith(path.join(PKG_ROOT, "assets", "core"))).toBe(true);
      expect(fs.existsSync(p)).toBe(true);
    }
  });
});
