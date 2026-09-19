import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
// Side-effect: registers the whole bar-graph chain (bar-cell, bar-fill, …) so
// BarsStack's renderNestedTemplate calls resolve.
import "../index";
import { BarsStack } from "./bars-stack";

function makeCtx(): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 2000, workspaceDir: "/tmp/bars" },
    media: {},
  } as unknown as MosaicEngineContext;
}

type BoxInset = { top: number; right: number; bottom: number; left: number };
const insetOf = (s: MosaicSource): BoxInset | undefined =>
  (s as { placement?: { inset?: BoxInset } }).placement?.inset;

const baseProps = () => ({
  ...(BarsStack.defaultProps as Record<string, unknown>),
  values: [10, 20, 30, 40, 50],
  fractions: [0.2, 0.4, 0.6, 0.8, 1.0],
  minValue: 0,
  maxValue: 50,
});

describe("BarsStack — gutterless layout + per-bar inset gap", () => {
  it("emits a gutterless N-cell split (no '-' spacer tokens)", async () => {
    const doc = (await BarsStack.render({ ...baseProps(), gap: 12 } as never, makeCtx())) as MosaicDocument;
    const m0 = String(doc.m0);
    expect(isValidM0String(m0)).toBe(true);
    expect(m0).not.toContain("-"); // gaps live in the inset, not spacer tiles
    expect(doc.sources?.length).toBe(5);
  });

  it("insets each bar horizontally only (x-layout: equal widths, full height)", async () => {
    const doc = (await BarsStack.render({ ...baseProps(), gap: 12 } as never, makeCtx())) as MosaicDocument;
    const inset = insetOf(doc.sources![0]);
    expect(inset).toBeDefined();
    // Layout axis (x) is inset; cross axis (y) keeps the bar's full height.
    expect(inset!.left).toBeGreaterThan(0);
    expect(inset!.right).toBeGreaterThan(0);
    expect(inset!.top).toBe(0);
    expect(inset!.bottom).toBe(0);
  });

  it("gap 0 leaves bars inset-free", async () => {
    const doc = (await BarsStack.render({ ...baseProps(), gap: 0 } as never, makeCtx())) as MosaicDocument;
    expect(insetOf(doc.sources![0])).toBeUndefined();
    expect(String(doc.m0)).not.toContain("-");
  });
});
