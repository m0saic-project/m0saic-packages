import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serializeM0File, serializeM0cFile, serializeM0pFile } from "@m0saic/dsl-file-formats";

import { readLayoutFile, parseLayoutContent } from "./readLayoutFile";

const FIXED = new Date("2026-06-23T00:00:00.000Z");
const m0Str = serializeM0File({ m0: "2[F,F]", size: { width: 100, height: 100 }, created: FIXED, app: "t", appVersion: "0", meta: { title: "a" } });
const m0cStr = serializeM0cFile({ m0: "2[F,F]", size: { width: 100, height: 100 }, created: FIXED, app: "t", appVersion: "0", meta: { title: "b" } });
const m0pStr = serializeM0pFile({
  created: FIXED, app: "t", appVersion: "0", meta: { title: "pack" },
  variants: {
    desktop: { size: { width: 1920, height: 1080 }, m0: "2[F,F]" },
    mobile: { size: { width: 1080, height: 1920 }, m0: "2(F,F)" },
  },
});

describe("parseLayoutContent", () => {
  it("detects format from the extension hint", () => {
    expect(parseLayoutContent(m0Str, "x.m0").kind).toBe("m0");
    expect(parseLayoutContent(m0cStr, "x.m0c").kind).toBe("m0c");
    expect(parseLayoutContent(m0pStr, "x.m0p").kind).toBe("m0p");
  });

  it("sniffs format from content when no hint", () => {
    expect(parseLayoutContent(m0cStr).kind).toBe("m0c");
    expect(parseLayoutContent(m0pStr).kind).toBe("m0p");
    expect(parseLayoutContent(m0Str).kind).toBe("m0");
  });

  it("returns the parsed pack with its variants", () => {
    const r = parseLayoutContent(m0pStr, "chrome.m0p");
    if (r.kind !== "m0p") throw new Error("expected m0p");
    expect(Object.keys(r.file.variants).sort()).toEqual(["desktop", "mobile"]);
    expect(r.file.variants.desktop.size).toEqual({ width: 1920, height: 1080 });
  });
});

describe("readLayoutFile", () => {
  it("reads + parses a sidecar pack from disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0p-"));
    const p = path.join(dir, "chrome.m0p");
    fs.writeFileSync(p, m0pStr);
    const r = readLayoutFile(p);
    expect(r.kind).toBe("m0p");
    if (r.kind === "m0p") expect(Object.keys(r.file.variants)).toContain("desktop");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
