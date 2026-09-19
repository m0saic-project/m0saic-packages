import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { serializeM0cFile, serializeM0File } from "@m0saic/dsl-file-formats";

import { loadEntryM0 } from "./loadEntryM0";

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "m0-loadEntry-"));
}

function rmRf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const M0 = "2(1,1)";

describe("loadEntryM0", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTempDir();
  });

  afterEach(() => {
    rmRf(dir);
  });

  it("returns labels=null and masks=null for plain .m0 entries", () => {
    fs.writeFileSync(
      path.join(dir, "m0saic.m0"),
      serializeM0File({ m0: M0, size: { width: 16, height: 16 } }),
    );

    const result = loadEntryM0(dir);

    expect(result.m0).toBe(M0);
    expect(result.size).toEqual({ width: 16, height: 16 });
    expect(result.labels).toBeNull();
    expect(result.masks).toBeNull();
  });

  it("returns labels and masks from .m0c entries", () => {
    const labels = { f0: { text: "hero" } };
    const masks = {
      f0: {
        localPath: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      },
    };
    fs.writeFileSync(
      path.join(dir, "m0saic.m0c"),
      serializeM0cFile({
        m0: M0,
        size: { width: 16, height: 16 },
        labels,
        masks,
      }),
    );

    const result = loadEntryM0(dir);

    expect(result.m0).toBe(M0);
    expect(result.size).toEqual({ width: 16, height: 16 });
    expect(result.labels).toEqual(labels);
    expect(result.masks).toEqual(masks);
  });

  it("returns masks=null when .m0c has no masks", () => {
    fs.writeFileSync(
      path.join(dir, "m0saic.m0c"),
      serializeM0cFile({
        m0: M0,
        size: { width: 16, height: 16 },
        labels: { f0: { text: "hero" } },
      }),
    );

    const result = loadEntryM0(dir);

    expect(result.labels).toEqual({ f0: { text: "hero" } });
    expect(result.masks).toBeNull();
  });

  it("throws when both m0saic.m0 and m0saic.m0c exist", () => {
    fs.writeFileSync(
      path.join(dir, "m0saic.m0"),
      serializeM0File({ m0: M0, size: { width: 16, height: 16 } }),
    );
    fs.writeFileSync(
      path.join(dir, "m0saic.m0c"),
      serializeM0cFile({ m0: M0, size: { width: 16, height: 16 } }),
    );

    expect(() => loadEntryM0(dir)).toThrow(/BOTH m0saic.m0c and m0saic.m0/);
  });

  it("throws when neither m0saic.m0 nor m0saic.m0c exists", () => {
    expect(() => loadEntryM0(dir)).toThrow(/Missing dictionary asset/);
  });
});
