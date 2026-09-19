import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

import { bundledAssetPath } from "@m0saic/template-utils/dist/m0saic/assetPath";

import { PostMortem } from "./post-mortem";

const ASSETS_DIR = resolve(__dirname, "assets");

describe("PostMortem template metadata", () => {
  it("declares its versioned id and core tier", () => {
    expect(PostMortem.id).toBe("@m0saic/meta/post-mortem/v1");
    expect(PostMortem.version).toBe(1);
    expect(PostMortem.capabilities?.tier).toBe("core");
  });

  it("has deterministic default props", () => {
    expect(PostMortem.defaultProps).toEqual({
      sessionPath: "packages/sandbox/sessions",
      canvasWeightSlots: 3,
      chatWeightSlots: 2,
      msTitleCard: 2500,
      msPerCandidate: 4000,
      msEndCard: 2500,
    });
  });

  it("declares landscape output hints", () => {
    expect(PostMortem.outputHints?.width).toBe(1920);
    expect(PostMortem.outputHints?.height).toBe(1080);
    expect(PostMortem.outputHints?.fps).toBe(30);
  });
});

// The template draws speaker avatars from media it SHIPS. These lock the two
// halves of that contract: the files are actually bundled, and the path handed
// to the renderer survives asar packaging (see assetPath — an in-asar path
// passes existsSync but ffmpeg cannot open it).
describe("PostMortem bundled avatars", () => {
  it.each(["robot.png", "human.png"])("ships %s alongside the template", (name) => {
    expect(existsSync(resolve(ASSETS_DIR, name))).toBe(true);
  });

  it.each(["robot.png", "human.png"])("resolves %s unchanged outside Electron", (name) => {
    expect(bundledAssetPath(ASSETS_DIR, name)).toBe(resolve(ASSETS_DIR, name));
  });

  it.each(["robot.png", "human.png"])("redirects %s out of app.asar when packaged", (name) => {
    const packed = ["", "App.app", "Contents", "Resources", "app.asar", "assets"].join(sep);
    const out = bundledAssetPath(packed, name);
    expect(out).toContain("app.asar.unpacked");
    expect(out.endsWith(name)).toBe(true);
  });
});
