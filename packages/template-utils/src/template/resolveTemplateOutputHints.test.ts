import { formatFromOutputFormatKnob, resolveTemplateHintDims, resolveTemplateOutputHints } from "./resolveTemplateOutputHints";

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


// Founder, 2026-10-01 (Trickplay in Desktop): with the knob on mp4 the render
// was refused — "Output extension implies container "mp4" but resolved
// container is "png"" — because only the CLI let the knob beat the static hint.
describe("the reserved `outputFormat` knob wins over the static format hint", () => {
  type K = { outputFormat?: string };
  const trickplay = {
    outputHints: { width: 1920, height: 1080, format: { kind: "image", container: "png", pixelFormat: "rgba" } },
    defaultProps: { outputFormat: "png" },
  } as const;

  it("at the knob's default the static hint stands WHOLE (pixelFormat and all)", () => {
    expect(resolveTemplateOutputHints<K>(trickplay as never, undefined).format).toEqual(trickplay.outputHints.format);
    expect(resolveTemplateOutputHints<K>(trickplay as never, { outputFormat: "png" }).format).toEqual(trickplay.outputHints.format);
  });

  it("a knob off its default moves the format: mp4 → video, jpeg / jpg → image jpeg, bare of the other container's fields", () => {
    expect(resolveTemplateOutputHints<K>(trickplay as never, { outputFormat: "mp4" }).format).toEqual({ kind: "video", container: "mp4" });
    expect(resolveTemplateOutputHints<K>(trickplay as never, { outputFormat: "jpeg" }).format).toEqual({ kind: "image", container: "jpeg" });
    expect(resolveTemplateOutputHints<K>(trickplay as never, { outputFormat: "JPG" }).format).toEqual({ kind: "image", container: "jpeg" });
    // the rest of the hints are untouched
    expect(resolveTemplateOutputHints<K>(trickplay as never, { outputFormat: "mp4" }).width).toBe(1920);
  });

  it("the default lives in defaultProps: a template whose knob DEFAULTS off its hint follows the knob", () => {
    const t = { outputHints: { format: { kind: "video", container: "mp4" } }, defaultProps: { outputFormat: "webm" } } as const;
    expect(resolveTemplateOutputHints<K>(t as never, undefined).format).toEqual({ kind: "video", container: "webm" });
  });

  it("an unknown or non-string knob leaves the hint alone; a template with no hint still gets the knob's format", () => {
    expect(resolveTemplateOutputHints<K>(trickplay as never, { outputFormat: "match" }).format).toEqual(trickplay.outputHints.format);
    expect(resolveTemplateOutputHints<K>(trickplay as never, { outputFormat: 3 as never }).format).toEqual(trickplay.outputHints.format);
    expect(resolveTemplateOutputHints<K>({ defaultProps: {} } as never, { outputFormat: "mp4" }).format).toEqual({ kind: "video", container: "mp4" });
    expect(formatFromOutputFormatKnob("gif", undefined)).toBeUndefined();
  });

  it("a `format` the template's own resolver returns wins over the knob", () => {
    const t = { ...trickplay, resolveOutputHints: () => ({ format: { kind: "image", container: "webp" } }) };
    expect(resolveTemplateOutputHints<K>(t as never, { outputFormat: "mp4" }).format).toEqual({ kind: "image", container: "webp" });
    // …and a resolver that returns no format leaves the knob's in force
    const sized = { ...trickplay, resolveOutputHints: () => ({ width: 640 }) };
    expect(resolveTemplateOutputHints<K>(sized as never, { outputFormat: "mp4" })).toMatchObject({ width: 640, format: { kind: "video", container: "mp4" } });
  });
});
