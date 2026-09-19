/**
 * @m0saic/agents/trace-timeline/v1 — gate test.
 *
 * Locks the run totals in the subtitle, the axis ticks, the per-status bars
 * and legend, the token labels, determinism, fail-fast on bad spans, the
 * layout contract across canvases, and node-cleanliness.
 */
import * as fs from "fs";
import * as path from "path";
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { assertLayout } from "@m0saic/template-utils";
import { SAMPLE_SPANS, TraceTimelineV1, fmtSeconds, fmtTick, fmtTokens, tickStepMs, type TraceSpan } from "./trace-timeline";

const ID = "@m0saic/agents/trace-timeline/v1";

const ctxFor = (w: number, h: number, durationMs = 3000): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/trace-timeline-test" }, media: {} } as unknown as MosaicEngineContext;
};
const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus === "error";
const labelsOf = (doc: MosaicDocument): string[] =>
  doc.sources.map((s) => (s as { editor?: { label?: string } }).editor?.label).filter((l): l is string => !!l);
const textsOf = (doc: MosaicDocument, label: string): string[] =>
  doc.sources
    .filter((s) => (s as { editor?: { label?: string } }).editor?.label === label)
    .map((s) => (s as { layers?: Array<{ content?: { text?: string } }> }).layers?.[0]?.content?.text ?? "");
const render = async (props: Record<string, unknown>, ctx = ctxFor(1280, 800)): Promise<MosaicDocument> =>
  (await TraceTimelineV1.render({ ...TraceTimelineV1.defaultProps, ...props } as never, ctx)) as MosaicDocument;
const expectValid = (doc: MosaicDocument, W: number, H: number) => {
  expect(isErrorMosaic(doc)).toBe(false);
  expect(validateM0String(String(doc.m0)).ok).toBe(true);
  const parsed = parseM0StringComplete(String(doc.m0), W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
  expect(doc.size).toEqual({ width: W, height: H });
};

describe(`${ID} — helpers`, () => {
  it("formats tokens, seconds and ticks compactly (ASCII)", () => {
    expect(fmtTokens(400)).toBe("400");
    expect(fmtTokens(1900)).toBe("1.9k");
    expect(fmtTokens(2_400_000)).toBe("2.4M");
    expect(fmtSeconds(35500)).toBe("35.5s");
    expect(fmtSeconds(900)).toBe("0.90s");
    expect(fmtSeconds(120000)).toBe("120s");
    expect(fmtTick(0, 10000)).toBe("0");
    expect(fmtTick(10000, 10000)).toBe("10s");
    expect(fmtTick(500, 500)).toBe("500ms");
  });
  it("picks a 1·2·5·10 tick step giving 4–7 ticks", () => {
    for (const total of [1500, 8000, 35500, 120000, 900000]) {
      const step = tickStepMs(total);
      const n = Math.floor(total / step) + 1;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(7);
      expect([1, 2, 5, 10].some((m) => step / m === Math.pow(10, Math.round(Math.log10(step / m))))).toBe(true);
    }
    expect(tickStepMs(35500)).toBe(10000);
  });
});

describe(`${ID} — template shell`, () => {
  it("metadata: id, core tier, video hints at 1280×800; the sample run has 10 spans", () => {
    expect(String(TraceTimelineV1.id)).toBe(ID);
    expect(TraceTimelineV1.capabilities).toEqual({ tier: "core" });
    expect(TraceTimelineV1.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
    expect([TraceTimelineV1.outputHints?.width, TraceTimelineV1.outputHints?.height]).toEqual([1280, 800]);
    expect(SAMPLE_SPANS.length).toBe(10);
  });

  it("defaults: a valid card — derived subtitle, 4 ticks, one lane per span, status bars, token labels, legend", async () => {
    const doc = await render({});
    expectValid(doc, 1280, 800);
    expect(textsOf(doc, "card-header").length).toBe(1);
    const header = doc.sources.find((s) => (s as { editor?: { label?: string } }).editor?.label === "card-header") as { layers: Array<{ content: { text: string } }> };
    expect(header.layers[1].content.text).toBe("10 tool calls · 35.5s wall time · 12.5k tokens");
    expect(textsOf(doc, "axis-tick")).toEqual(["0", "10s", "20s", "30s"]);
    expect(textsOf(doc, "span-tool").length).toBe(10);
    expect(labelsOf(doc).filter((l) => l === "lane-wash").length).toBe(10);
    expect(labelsOf(doc).filter((l) => l === "span-bar-ok").length).toBe(7);
    expect(labelsOf(doc).filter((l) => l === "span-bar-error").length).toBe(1);
    expect(labelsOf(doc).filter((l) => l === "span-bar-retry").length).toBe(1);
    expect(labelsOf(doc).filter((l) => l === "span-bar-cached").length).toBe(1);
    expect(textsOf(doc, "span-tokens")).toContain("1.9k");
    for (const st of ["ok", "error", "retry", "cached"]) expect(labelsOf(doc)).toContain(`legend-${st}-dot`);
    expect(doc.editor?.label).toContain("10 calls");
  });

  it("legend lists only the statuses that appear; showTokens:false drops the token labels; an explicit subtitle wins", async () => {
    const ok: TraceSpan[] = SAMPLE_SPANS.map(({ status: _s, ...sp }) => sp);
    const doc = await render({ spans: ok, showTokens: false, subtitle: "run 8f3a · claude-code" });
    const labels = labelsOf(doc);
    expect(labels).toContain("legend-ok-dot");
    expect(labels).not.toContain("legend-error-dot");
    expect(labels).not.toContain("span-tokens");
    const header = doc.sources.find((s) => (s as { editor?: { label?: string } }).editor?.label === "card-header") as { layers: Array<{ content: { text: string } }> };
    expect(header.layers[1].content.text).toBe("run 8f3a · claude-code");
  });

  it("caps at 10 lanes, ignores malformed spans, fails fast on none", async () => {
    const many: TraceSpan[] = [...SAMPLE_SPANS, ...SAMPLE_SPANS.map((s) => ({ ...s, startMs: s.startMs + 40000 }))];
    expect(textsOf(await render({ spans: many }), "span-tool").length).toBe(10);
    const junk = [{ tool: "", startMs: 0, durMs: 1 }, { tool: "x", startMs: -1, durMs: 1 }, { tool: "y", startMs: 0, durMs: Number.NaN }];
    expect(isErrorMosaic(await render({ spans: junk }))).toBe(true);
    expect(isErrorMosaic(await render({ spans: [] }))).toBe(true);
  });

  it("determinism: double render is JSON-identical", async () => {
    expect(JSON.stringify(await render({}))).toBe(JSON.stringify(await render({})));
  });

  it("animated, light and dark paths render", async () => {
    expectValid(await render({ anim: { reduceMotion: false, renderMode: "premium", introFrac: 0.7 } }), 1280, 800);
    expectValid(await render({ anim: { reduceMotion: false, renderMode: "light", introFrac: 0.5 } }), 1280, 800);
    expectValid(await render({ preset: "dark" }), 1280, 800);
  });
});

describe(`${ID} — layout contract (canvas sweep)`, () => {
  const CANVASES: ReadonlyArray<readonly [number, number]> = [[1280, 800], [1920, 1080], [1280, 720], [1080, 1080], [1600, 900]];
  it.each(CANVASES)("defaults hold at %d×%d", async (w, h) => {
    const ctx = ctxFor(w, h);
    const doc = await render({}, ctx);
    expectValid(doc, w, h);
    const stamp = (await render({ debugLayout: true }, ctx)).editor as { layoutContract?: { ok: boolean; violations: Array<{ detail: string }> } } | undefined;
    expect(stamp?.layoutContract?.violations.map((v) => v.detail)).toEqual([]);
    expect(() => assertLayout(doc, ctx, ID, { constraints: [{ label: "span-tool", textFits: {} }, { label: "axis-tick", textFits: {} }, { label: "legend-ok-dot", aspect: 1, aspectTolerance: 0.5 }] })).not.toThrow();
  });
});

describe(`${ID} — ships in the web build`, () => {
  it("imports no node builtins", () => {
    for (const f of ["trace-timeline.ts", "index.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/from\s+["'](node:|fs["']|path["']|child_process|os["'])/);
      expect(src).not.toMatch(/__dirname/);
    }
  });
});
