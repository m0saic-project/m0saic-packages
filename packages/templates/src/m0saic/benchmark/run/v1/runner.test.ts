import * as fs from "fs";
import * as path from "path";
import type { MosaicEngineContext } from "@m0saic/types";
import { BenchmarkRun } from "./runner";

function ctx(mode: "render" | "design"): MosaicEngineContext {
  return {
    mode,
    target: { width: 640, height: 360, fps: 30, durationMs: 4000 },
    output: {
      target: undefined,
      format: undefined,
      audio: undefined,
      color: undefined,
    },
  } as unknown as MosaicEngineContext;
}

describe("BenchmarkRun preview / lite behavior", () => {
  it("exposes renderLite (the preview hot-path stand-in)", () => {
    expect(typeof BenchmarkRun.renderLite).toBe("function");
  });

  it("renderLite returns an instructional card with no side effects", () => {
    const before = new Set(fs.readdirSync(process.cwd()));
    const doc = BenchmarkRun.renderLite!({}, ctx("design")) as {
      kind: string;
      sources: unknown[];
    };
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.sources.length).toBe(2); // two-row title/instruction card
    // No session folder was created just from a preview.
    const after = fs.readdirSync(process.cwd());
    for (const entry of after) {
      if (!before.has(entry)) {
        expect(entry.startsWith("benchmark-")).toBe(false);
      }
    }
  });

  it("render() in design mode returns the lite card and never runs the battery", async () => {
    const doc = (await BenchmarkRun.render({}, ctx("design"))) as { kind: string };
    expect(doc.kind).toBe("mosaic_document");
    // Defense-in-depth guard fired — no benchmark session dir written.
    expect(fs.existsSync(path.join(process.cwd(), "benchmark-run"))).toBe(false);
  });

  it("render() with an empty test selection returns the card (no battery)", async () => {
    const doc = (await BenchmarkRun.render({ tests: [] }, ctx("render"))) as {
      kind: string;
    };
    expect(doc.kind).toBe("mosaic_document");
    expect(fs.existsSync(path.join(process.cwd(), "benchmark-run"))).toBe(false);
  });
});
