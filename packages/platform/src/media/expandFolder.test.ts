import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  IMAGE_FILE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
} from "@m0saic/types";

import { M0SAIC_TMP_PREFIX } from "../paths";
import {
  expandFolder,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
} from "./expandFolder";

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${M0SAIC_TMP_PREFIX}expandFolder-${prefix}-`));
}

function touch(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "");
}

describe("expandFolder — extension sets", () => {
  it("video set mirrors @m0saic/types VIDEO_FILE_EXTENSIONS (dotted, lowercase)", () => {
    const expected = new Set(
      VIDEO_FILE_EXTENSIONS.map((e) => `.${e.toLowerCase()}`),
    );
    expect(new Set(VIDEO_EXTENSIONS)).toEqual(expected);
  });

  it("image set mirrors @m0saic/types IMAGE_FILE_EXTENSIONS (dotted, lowercase)", () => {
    const expected = new Set(
      IMAGE_FILE_EXTENSIONS.map((e) => `.${e.toLowerCase()}`),
    );
    expect(new Set(IMAGE_EXTENSIONS)).toEqual(expected);
  });
});

describe("expandFolder — listing", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTmp("listing");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns absolute video paths sorted alphabetically", () => {
    touch(path.join(dir, "c.mp4"));
    touch(path.join(dir, "a.mov"));
    touch(path.join(dir, "b.mkv"));

    const out = expandFolder(dir);
    expect(out.map((p) => path.basename(p))).toEqual([
      "a.mov",
      "b.mkv",
      "c.mp4",
    ]);
    for (const p of out) expect(path.isAbsolute(p)).toBe(true);
  });

  it("filters out non-media files by default (video kind)", () => {
    touch(path.join(dir, "clip.mp4"));
    touch(path.join(dir, "notes.txt"));
    touch(path.join(dir, "image.png"));
    touch(path.join(dir, "doc.pdf"));

    const out = expandFolder(dir);
    expect(out.map((p) => path.basename(p))).toEqual(["clip.mp4"]);
  });

  it("respects kinds: ['image']", () => {
    touch(path.join(dir, "clip.mp4"));
    touch(path.join(dir, "shot.png"));

    const out = expandFolder(dir, { kinds: ["image"] });
    expect(out.map((p) => path.basename(p))).toEqual(["shot.png"]);
  });

  it("respects kinds: ['video', 'image']", () => {
    touch(path.join(dir, "clip.mp4"));
    touch(path.join(dir, "shot.png"));
    touch(path.join(dir, "notes.txt"));

    const out = expandFolder(dir, { kinds: ["video", "image"] });
    expect(out.map((p) => path.basename(p))).toEqual(["clip.mp4", "shot.png"]);
  });

  it("skips hidden files (leading dot)", () => {
    touch(path.join(dir, ".hidden.mp4"));
    touch(path.join(dir, "visible.mp4"));

    const out = expandFolder(dir);
    expect(out.map((p) => path.basename(p))).toEqual(["visible.mp4"]);
  });

  it("is case-insensitive on extensions", () => {
    touch(path.join(dir, "A.MP4"));
    touch(path.join(dir, "B.MoV"));

    const out = expandFolder(dir);
    expect(out.map((p) => path.basename(p))).toEqual(["A.MP4", "B.MoV"]);
  });

  it("returns empty array when no matching files", () => {
    touch(path.join(dir, "notes.txt"));
    expect(expandFolder(dir)).toEqual([]);
  });

  it("is non-recursive by default", () => {
    touch(path.join(dir, "top.mp4"));
    touch(path.join(dir, "sub", "nested.mp4"));

    const out = expandFolder(dir);
    expect(out.map((p) => path.basename(p))).toEqual(["top.mp4"]);
  });

  it("recurses when recursive: true", () => {
    touch(path.join(dir, "top.mp4"));
    touch(path.join(dir, "sub", "nested.mp4"));
    touch(path.join(dir, "sub", "deep", "deeper.mov"));

    const out = expandFolder(dir, { recursive: true });
    expect(out.map((p) => path.basename(p)).sort()).toEqual([
      "deeper.mov",
      "nested.mp4",
      "top.mp4",
    ]);
  });
});

describe("expandFolder — error cases", () => {
  it("throws on nonexistent path", () => {
    expect(() =>
      expandFolder("/definitely/does/not/exist/aslkjdf"),
    ).toThrow(/does not exist/);
  });

  it("throws when path is a file, not a directory", () => {
    const dir = mkTmp("not-a-dir");
    try {
      const filePath = path.join(dir, "lonely.mp4");
      touch(filePath);
      expect(() => expandFolder(filePath)).toThrow(/not a directory/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
