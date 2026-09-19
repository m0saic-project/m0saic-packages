import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { SpreadGridMock } from "./spread-grid-mock";

const ctxFor = (w: number, h: number): MosaicEngineContext =>
  ({ mode: "render", target: { width: w, height: h, fps: 30, durationMs: 2000 }, output: { width: w, height: h, fps: 30, durationMs: 2000 } } as unknown as MosaicEngineContext);
const render = (w: number, h: number, props: Record<string, unknown> = {}) =>
  SpreadGridMock.render({ ...(SpreadGridMock.defaultProps as object), ...props } as never, ctxFor(w, h)) as Promise<MosaicDocument>;

const stampOf = (doc: MosaicDocument) =>
  (doc as { editor?: { layoutContract?: { ok: boolean; violations: Array<{ rule: string }> } } }).editor?.layoutContract;

describe("collage/spread-grid-mock/v1 — layout-contract dogfood", () => {
  it("registered, internal, adopts debugLayout", () => {
    expect(SpreadGridMock.id).toBe("@m0saic/collage/spread-grid-mock/v1");
    expect((SpreadGridMock as { internal?: boolean }).internal).toBe(true);
    expect("debugLayout" in (SpreadGridMock.propsSchema as Record<string, unknown>)).toBe(true);
  });

  it("off by default — returns the grid doc, 24 cells tagged, no stamp", async () => {
    const doc = await render(1920, 1080);
    expect(stampOf(doc)).toBeUndefined();
    expect(doc.sources.length).toBe(24);
    expect(doc.sources.every((s) => (s as { editor?: { label?: string } }).editor?.label === "cell")).toBe(true);
  });

  it("debugLayout — the layout contract catches the quantization spread", async () => {
    const doc = await render(1920, 1080, { debugLayout: true });
    const stamp = stampOf(doc);
    expect(stamp).toBeDefined();
    expect(stamp!.ok).toBe(false);
    expect(stamp!.violations.some((v) => v.rule === "equal-width")).toBe(true);
    expect(stamp!.violations.some((v) => v.rule === "equal-height")).toBe(true);
  });

  it("a loose tolerance passes — the spread is a real threshold", async () => {
    const doc = await render(1920, 1080, { debugLayout: true, equalTolerance: 0.2 });
    expect(stampOf(doc)?.ok).toBe(true);
  });
});
