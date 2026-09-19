import { resolveTemplateHintDims, resolveTemplateOutputHints } from "./resolveTemplateOutputHints";

type P = { platform?: string };
const base = {
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 15000, format: { kind: "image", container: "png" } },
  defaultProps: { platform: "wide" },
} as const;

describe("resolveTemplateOutputHints", () => {
  it("returns the static hints when the template has no resolver", () => {
    expect(resolveTemplateOutputHints<P>(base, { platform: "tall" })).toEqual(base.outputHints);
  });

  it("merges the resolver's fields over the static hints, defaults under the props", () => {
    const tmpl = {
      ...base,
      resolveOutputHints: (p: P) => (p.platform === "tall" ? { width: 1080, height: 1920 } : {}),
    };
    expect(resolveTemplateOutputHints<P>(tmpl, { platform: "tall" })).toEqual({ ...base.outputHints, width: 1080, height: 1920 });
    expect(resolveTemplateOutputHints<P>(tmpl, undefined)).toEqual(base.outputHints);
    expect(resolveTemplateHintDims<P>(tmpl, { platform: "tall" })).toEqual({ w: 1080, h: 1920 });
  });

  it("a hint never kills a render: throws, non-objects and junk fields fall back", () => {
    expect(resolveTemplateOutputHints<P>({ ...base, resolveOutputHints: () => { throw new Error("x"); } }, {})).toEqual(base.outputHints);
    expect(resolveTemplateOutputHints<P>({ ...base, resolveOutputHints: () => null as never }, {})).toEqual(base.outputHints);
    expect(
      resolveTemplateOutputHints<P>(
        { ...base, resolveOutputHints: () => ({ width: NaN, height: -4, fps: 0, durationMs: "5" as never, format: "mp4" as never }) },
        {},
      ),
    ).toEqual(base.outputHints);
  });

  it("rounds a resolved canvas to even pixels", () => {
    const tmpl = { ...base, resolveOutputHints: () => ({ width: 1081, height: 1919 }) };
    expect(resolveTemplateHintDims<P>(tmpl, {})).toEqual({ w: 1082, h: 1920 });
  });

  it("no size opinion → null dims", () => {
    expect(resolveTemplateHintDims<P>({ defaultProps: {} }, {})).toBeNull();
  });
});
