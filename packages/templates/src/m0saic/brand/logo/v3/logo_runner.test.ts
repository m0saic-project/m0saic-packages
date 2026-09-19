/**
 * Gate-28 locks for @m0saic/brand/logo/v3 — the template had NO unit tests
 * (coverage lived only in CLI e2e + dsl-visual goldens). Everything renders
 * through the REGISTERED instance (gate-20 keeper: raw-object tests prove
 * nothing about production).
 */
import { isValidM0String } from "@m0saic/dsl";
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { requireTemplate } from "@m0saic/template-utils";
import "../../../index";

const T = requireTemplate("@m0saic/brand/logo/v3");

function makeCtx(w = 1080, h = 1080, durationMs = 3200): MosaicEngineContext {
  const target = { width: w, height: h, fps: 30, durationMs };
  return {
    mode: "render",
    target,
    output: { ...target, workspaceDir: "/tmp/brand-logo-test" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = (props: Record<string, unknown>, ctx = makeCtx()) =>
  T.render(props as never, ctx) as Promise<MosaicDocument>;

describe("brand marks — official canvas (founder ruling, gate 28)", () => {
  it("each mark declares its dictionary-locked resolution regardless of the host canvas", async () => {
    const cases: Array<[string, number, number]> = [
      ["m-33", 544, 544],
      ["m0", 384, 512],
      ["m0saic-pattern", 4354, 2016],
    ];
    for (const [size, w, h] of cases) {
      // Host asks 1920×1080 — the doc wins with the official dims.
      const doc = await render({ size }, makeCtx(1920, 1080));
      expect(doc.size).toEqual({ width: w, height: h });
    }
  });
});

describe("brand marks — output conventions (gate 28)", () => {
  it("fast marks: video/mp4 format, audio disabled, valid m0, masked tiles survive the wrapped path", async () => {
    const doc = await render({ size: "m-33" });
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect((doc as { audio?: { mode?: string } }).audio?.mode).toBe("off");
    expect(isValidM0String(String(doc.m0))).toBe(true);
    const masked = (doc.sources ?? []).filter(
      (s) => (s as { mask?: { kind?: string } }).mask?.kind === "inline-mask",
    );
    expect(masked.length).toBeGreaterThan(0);
  });

  it("error path (composite blendInSec 0) is a visible card with audio disabled (fleet makeErrorMosaic fix)", async () => {
    const doc = await render({ size: "composite", blendInSec: 0 });
    expect(JSON.stringify(doc.sources)).toContain("blendInSec must be > 0");
    expect((doc as { audio?: { mode?: string } }).audio?.mode).toBe("off");
  });
});

describe("brand marks — rankSet exposure (audit-every-knob, gate 28)", () => {
  it("the registered runner forwards rankSet to the base (cascade ≠ diag enable exprs)", async () => {
    const diag = await render({ size: "m-33", animation: "logo_loop" });
    const cascade = await render({ size: "m-33", animation: "logo_loop", rankSet: "cascade" });
    const exprs = (d: MosaicDocument) =>
      JSON.stringify((d.sources ?? []).map((s) => (s as { overlay?: { enable?: string } }).overlay?.enable));
    expect(exprs(cascade)).not.toBe(exprs(diag));
  });

  it("rankSet is a declared schema knob on the registered surface", () => {
    expect((T.propsSchema as Record<string, unknown>).rankSet).toBeDefined();
  });
});

describe("brand marks — first-open cover (mosaic-branding band)", () => {
  it("brand band + the STATIC rect M hero (frame 0 of every animation is gated blank)", async () => {
    expect(typeof T.renderCover).toBe("function");
    const a = (await T.renderCover!({} as never, makeCtx(1920, 1080))) as MosaicDocument;
    const b = (await T.renderCover!({} as never, makeCtx(1920, 1080))) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
    expect(isValidM0String(String(a.m0))).toBe(true);
    const s = JSON.stringify(a.sources);
    expect(s).toContain("Brand Marks");
    expect(s).not.toContain("START HERE");
    // The hero carries the mark's masked tiles inline (no cover children).
    expect(s).toContain("inline-mask");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });
});

describe("brand marks — default is the FAST mark (founder ruling)", () => {
  it("defaults render the m-33 rect mark — no composite children, official 544²", async () => {
    const doc = await render({});
    expect((doc as { children?: unknown }).children).toBeUndefined();
    expect(doc.size).toEqual({ width: 544, height: 544 });
    expect(
      (doc.sources ?? []).some((s) => (s as { mask?: { kind?: string } }).mask?.kind === "inline-mask"),
    ).toBe(true);
  });
});

describe("brand marks — composite structure (opt-in)", () => {
  it("composite = bitmap base + rects overlay children at the m-33 official canvas", async () => {
    const doc = await render({ size: "composite" });
    const kids = (doc as { children?: Record<string, MosaicDocument> }).children ?? {};
    expect(Object.keys(kids).sort()).toEqual(["bitmap", "rects"]);
    expect(doc.size).toEqual({ width: 544, height: 544 });
    // Children declare their size too (child-declare-size law).
    expect(kids.bitmap.size).toEqual({ width: 544, height: 544 });
    const rectsRef = (doc.sources ?? [])[1] as { overlay?: { alpha?: string } };
    expect(typeof rectsRef.overlay?.alpha).toBe("string");
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect((doc as { audio?: { mode?: string } }).audio?.mode).toBe("off");
  });
});
