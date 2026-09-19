/**
 * @m0saic/github/year-card/v1 — gate test.
 *
 * Locks the calendar math (UTC, leap years, month columns), the buckets and
 * streak, the 7×53 cell matrix with equal cells (the lattice's promise), the
 * KPI tiles + bindings, determinism, fail-fast, the contract sweep, and
 * node-cleanliness.
 */
import * as fs from "fs";
import * as path from "path";
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { assertLayout, isSmooth, latticeViolations, resolvePropBindings } from "@m0saic/template-utils";
import { SAMPLE_CONTRIBUTIONS, YearCardV1, bucketOf, calendarLayout, fmtCount, longestStreak, parseContributions, smoothTileRow } from "./year-card";

const ID = "@m0saic/github/year-card/v1";

const ctxFor = (w: number, h: number, durationMs = 3000): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/year-card-test" }, media: {} } as unknown as MosaicEngineContext;
};
const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus === "error";
const labelsOf = (doc: MosaicDocument): string[] =>
  doc.sources.map((s) => (s as { editor?: { label?: string } }).editor?.label).filter((l): l is string => !!l);
const count = (doc: MosaicDocument, label: string) => labelsOf(doc).filter((l) => l === label).length;
const textsOf = (doc: MosaicDocument, label: string): string[] =>
  doc.sources
    .filter((s) => (s as { editor?: { label?: string } }).editor?.label === label)
    .map((s) => (s as { layers?: Array<{ content?: { text?: string } }> }).layers?.[0]?.content?.text ?? "");
const headerLayers = (doc: MosaicDocument): string[] =>
  ((doc.sources.find((s) => (s as { editor?: { label?: string } }).editor?.label === "card-header") as { layers?: Array<{ content?: { text?: string } }> })?.layers ?? []).map((l) => l.content?.text ?? "");
const render = async (props: Record<string, unknown>, ctx = ctxFor(1280, 720)): Promise<MosaicDocument> =>
  (await YearCardV1.render({ ...YearCardV1.defaultProps, ...props } as never, ctx)) as MosaicDocument;
const expectValid = (doc: MosaicDocument, W: number, H: number) => {
  expect(isErrorMosaic(doc)).toBe(false);
  expect(validateM0String(String(doc.m0)).ok).toBe(true);
  const parsed = parseM0StringComplete(String(doc.m0), W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
  expect(doc.size).toEqual({ width: W, height: H });
};

describe(`${ID} — calendar math`, () => {
  it("2026 starts on a Thursday, 365 days; months land on their week columns", () => {
    const cal = calendarLayout(2026);
    expect(cal.days).toBe(365);
    expect(cal.firstDow).toBe(4);
    expect(cal.monthCols[0]).toEqual({ label: "Jan", col: 0 });
    expect(cal.monthCols[1]).toEqual({ label: "Feb", col: 5 }); // (31 + 4) / 7
    expect(cal.monthCols[11].col).toBeLessThan(53);
    // the last day of the year fits in 53 columns
    expect(Math.floor((cal.days - 1 + cal.firstDow) / 7)).toBeLessThan(53);
  });
  it("leap years have 366 days", () => {
    expect(calendarLayout(2024).days).toBe(366);
    expect(calendarLayout(2024).firstDow).toBe(1); // Monday
  });
  it("parses arrays and comma strings, zeroes junk; buckets and streaks", () => {
    expect(parseContributions([1, 0, "3" as never, -2, Number.NaN])).toEqual([1, 0, 3, 0, 0]);
    expect(parseContributions("4, 0,x,7")).toEqual([4, 0, 0, 7]);
    expect(parseContributions(undefined)).toEqual([]);
    expect(bucketOf(0, 10)).toBe(0);
    expect(bucketOf(1, 10)).toBe(1);
    expect(bucketOf(10, 10)).toBe(4);
    expect(bucketOf(5, 10)).toBe(2); // quartiles: 25% → 1, 50% → 2, 75% → 3, top → 4
    expect(bucketOf(8, 10)).toBe(4);
    expect(longestStreak([1, 1, 0, 1, 1, 1, 0])).toBe(3);
    expect(longestStreak(parseContributions(SAMPLE_CONTRIBUTIONS))).toBe(12);
    expect(fmtCount(905)).toBe("905");
    expect(fmtCount(1102)).toBe("1,102");
    expect(fmtCount(12400)).toBe("12.4k");
  });
});

describe(`${ID} — the lattice`, () => {
  it("smoothTileRow: equal tiles, ~2 % gutters, a 5-smooth total for every tile count", () => {
    for (const n of [1, 2, 3, 4]) {
      const r = smoothTileRow(n, 0.02);
      expect(isSmooth(r.total)).toBe(true);
      expect(r.tile * n + r.gap * (n - 1)).toBe(r.total);
      if (n > 1) expect(Math.abs(r.gap / r.total - 0.02)).toBeLessThan(0.01);
    }
    // 4 KPI tiles: 4×21 + 3×2 = 90 = 2·3²·5 (per-band percents gave 4×24 + 3×2 = 102 → 51 = 3·17).
    expect(smoothTileRow(4, 0.02)).toEqual({ tile: 21, gap: 2, total: 90 });
    expect(smoothTileRow(1, 0.02)).toEqual({ tile: 1, gap: 0, total: 1 });
  });

  it("declares the 53 week columns as content and has no other rough split at the hinted canvas", async () => {
    expect(YearCardV1.lattice?.allow?.map((a) => a.count)).toEqual([53]);
    const doc = await render({});
    const rough = latticeViolations([String(doc.m0)], { allow: [53] });
    expect(rough).toEqual([]);
  });
});

describe(`${ID} — template shell`, () => {
  it("metadata: id, core tier, video hints at 1280×720; the sample year sums to 905", () => {
    expect(String(YearCardV1.id)).toBe(ID);
    expect(YearCardV1.capabilities).toEqual({ tier: "core" });
    expect(YearCardV1.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
    expect(parseContributions(SAMPLE_CONTRIBUTIONS).reduce((a, b) => a + b, 0)).toBe(905);
  });

  it("defaults: header with handle + year, derived subtitle, 4 KPI tiles, 7×53 cells (365 in-year), 12 months, 3 weekdays, 5 swatches", async () => {
    const doc = await render({});
    expectValid(doc, 1280, 720);
    expect(headerLayers(doc)).toEqual(["@qsbuilds · 2026 on GitHub", "905 contributions · longest streak 12 days"]);
    expect(textsOf(doc, "kpi-commits-value")).toEqual(["1,102"]);
    expect(textsOf(doc, "kpi-prs-value")).toEqual(["96"]);
    expect(textsOf(doc, "kpi-stars-value")).toEqual(["412"]);
    expect(textsOf(doc, "kpi-lang-value")).toEqual(["TypeScript"]);
    expect(count(doc, "cell")).toBe(365);
    expect(count(doc, "cell") + count(doc, "cell-outside")).toBe(7 * 53);
    expect(textsOf(doc, "month-label")).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(textsOf(doc, "day-label")).toEqual(["Mon", "Wed", "Fri"]);
    expect(count(doc, "legend-swatch")).toBe(5);
    // every in-year cell carries the lattice inset (exact gaps)
    const cells = doc.sources.filter((s) => (s as { editor?: { label?: string } }).editor?.label === "cell") as Array<{ placement?: { inset?: unknown } }>;
    expect(cells.every((c) => c.placement?.inset != null)).toBe(true);
  });

  it("binds the handle (header) and the four KPI values; nothing rejected", async () => {
    const doc = await render({});
    const r = resolvePropBindings(doc, 1280, 720, { propsSchema: YearCardV1.propsSchema! });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["commits", "handle", "pullRequests", "stars", "topLanguage"]);
  });

  it("no handle → year-only title; showKpis:false drops the tiles; a string and an array are the same year", async () => {
    const a = await render({ handle: "" });
    expect(headerLayers(a)[0]).toBe("2026 on GitHub");
    const b = await render({ showKpis: false });
    expect(labelsOf(b).some((l) => l.startsWith("kpi-"))).toBe(false);
    const arr = parseContributions(SAMPLE_CONTRIBUTIONS);
    expect(JSON.stringify(await render({ contributions: arr }))).toBe(JSON.stringify(await render({ contributions: SAMPLE_CONTRIBUTIONS })));
  });

  it("a different year moves the weeks (2024 starts Monday, 366 in-year cells)", async () => {
    const doc = await render({ year: 2024, contributions: Array(366).fill(1) });
    expect(count(doc, "cell")).toBe(366);
    expect(headerLayers(doc)[1]).toBe("366 contributions · longest streak 366 days");
  });

  it("determinism: double render is JSON-identical", async () => {
    expect(JSON.stringify(await render({}))).toBe(JSON.stringify(await render({})));
  });

  it("fails fast without contributions; renders the animated, light and dark paths", async () => {
    expect(isErrorMosaic(await render({ contributions: "" }))).toBe(true);
    expectValid(await render({ anim: { reduceMotion: false, renderMode: "premium", introFrac: 0.7 } }), 1280, 720);
    expectValid(await render({ anim: { reduceMotion: false, renderMode: "light", introFrac: 0.5 } }), 1280, 720);
    expectValid(await render({ preset: "dark" }), 1280, 720);
  });
});

describe(`${ID} — layout contract (canvas sweep)`, () => {
  const CANVASES: ReadonlyArray<readonly [number, number]> = [[1280, 720], [1920, 1080], [1600, 900], [1280, 800], [1080, 720]];
  it.each(CANVASES)("defaults hold at %d×%d — equal cells, labels fit", async (w, h) => {
    const ctx = ctxFor(w, h);
    const doc = await render({}, ctx);
    expectValid(doc, w, h);
    const stamp = (await render({ debugLayout: true }, ctx)).editor as { layoutContract?: { ok: boolean; violations: Array<{ detail: string }> } } | undefined;
    expect(stamp?.layoutContract?.violations.map((v) => v.detail)).toEqual([]);
    expect(() =>
      assertLayout(doc, ctx, ID, {
        constraints: [{ label: "month-label", textFits: {} }, { label: "day-label", textFits: {} }],
        relations: [{ label: "cell", equal: "size", tolerance: 0.02, tolerancePx: 1 }],
      }),
    ).not.toThrow();
  });
});

describe(`${ID} — ships in the web build`, () => {
  it("imports no node builtins", () => {
    for (const f of ["year-card.ts", "index.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/from\s+["'](node:|fs["']|path["']|child_process|os["'])/);
      expect(src).not.toMatch(/__dirname/);
    }
  });
});
