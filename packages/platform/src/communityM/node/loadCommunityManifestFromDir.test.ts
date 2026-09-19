import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadCommunityManifestFromDir, resolveCommunityPath } from "./loadCommunityManifestFromDir";

describe("loadCommunityManifestFromDir", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-cm-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("reports MISSING / UNREADABLE / INVALID without throwing", () => {
    expect(loadCommunityManifestFromDir(dir)).toMatchObject({ ok: false, code: "MISSING" });
    fs.writeFileSync(path.join(dir, "index.json"), "{not json");
    expect(loadCommunityManifestFromDir(dir)).toMatchObject({ ok: false, code: "UNREADABLE" });
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ schemaVersion: 7 }));
    expect(loadCommunityManifestFromDir(dir)).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("joins repo-relative paths with the platform separator", () => {
    expect(resolveCommunityPath("/root", "ms/001/slots/01/tile.png")).toBe(
      path.join("/root", "ms", "001", "slots", "01", "tile.png"),
    );
  });
});
