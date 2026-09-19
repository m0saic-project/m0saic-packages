/**
 * The web app bundles `@m0saic/dictionary`'s BROWSER entry (package.json
 * `browser` field), not the node one jest resolves by default. Until
 * 2026-09-16 that entry shipped every brand m0 as `""`, and the templates
 * that read `entry.m0` synchronously — QR Code's centre M, Brand Marks,
 * community-m — rendered error mosaics on app.m0saic.io while every test
 * (node dictionary) stayed green. This suite renders them against the
 * browser entry so that gap cannot reopen.
 */
jest.mock("@m0saic/dictionary", () => jest.requireActual("../../dictionary/src/browser"));

import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { getTemplate } from "@m0saic/template-utils";
import "./web";

const ctx = (w = 1080, h = 1080): MosaicEngineContext =>
  ({
    mode: "design",
    target: { width: w, height: h, fps: 30, durationMs: 2000 },
    output: { width: w, height: h, fps: 30, durationMs: 2000 },
    media: {},
  }) as never;

const isError = (d: MosaicDocument) => JSON.stringify(d).toLowerCase().includes("error mosaic") || (d as { editor?: { label?: string } }).editor?.label === "error";

describe("web registry × browser dictionary", () => {
  it("the browser dictionary really is the one under test", async () => {
    const { entries } = await import("@m0saic/dictionary");
    expect(entries.byId["brand/m-33_bitmap"].m0).toBe("");
    expect(entries.byId["brand/m-33"].m0.length).toBeGreaterThan(100);
  });

  it("QR Code renders its default centre M from the inlined brand/m-33", async () => {
    const t = getTemplate("@m0saic/media/qr/code/v1")!;
    const doc = (await t.render(t.defaultProps as never, ctx())) as MosaicDocument;
    expect(isError(doc)).toBe(false);
    expect(isValidM0String(String(doc.m0))).toBe(true);
    const center = doc.children?.center as MosaicDocument;
    expect(center).toBeDefined();
    expect(center.sources.length).toBe(33);
    expect(String(center.m0).length).toBeGreaterThan(100);
  });

  it("Brand Marks v3 renders m-33, m0 and m0saic-pattern, and names Desktop for the lazy bitmap", async () => {
    const t = getTemplate("@m0saic/brand/logo/v3")!;
    for (const size of ["m-33", "m0", "m0saic-pattern"] as const) {
      const doc = (await t.render({ ...(t.defaultProps as object), size } as never, ctx())) as MosaicDocument;
      expect(isError(doc)).toBe(false);
      expect(isValidM0String(String(doc.m0))).toBe(true);
      expect(doc.sources.length).toBeGreaterThan(1);
    }
    const bitmap = (await t.render({ ...(t.defaultProps as object), size: "m-33_bitmap" } as never, ctx())) as MosaicDocument;
    expect(JSON.stringify(bitmap)).toContain("not bundled for the browser");
  });

  it("community-m (web entry) reads the M-33 geometry from the browser dictionary", async () => {
    const t = getTemplate("@m0saic/brand/community-m/v1")!;
    // Stand-in levers: no served piece / picture to fetch (jest has no network);
    // the M itself (33 tiles from brand/m-33) is what this proves.
    const out = (await t.render({ preview: { claims: 33, tile: 12, piece: "card", aspect: "16:9" } } as never, ctx(1280, 720))) as { kind: string; steps?: Array<{ file: MosaicDocument }> };
    expect(out.kind).toBe("mosaic_pipeline");
    const intro = out.steps![0].file;
    const tiles = ((intro.children?.stage as MosaicDocument).children?.mark as MosaicDocument).children?.tiles as MosaicDocument;
    expect(tiles.sources.length).toBe(33);
    expect(isValidM0String(String(tiles.m0))).toBe(true);
  });
});
