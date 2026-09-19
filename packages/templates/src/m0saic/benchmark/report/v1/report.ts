import * as fs from "fs";
import * as path from "path";
import { fileAsset } from "@m0saic/template-utils/dist/m0saic/assetPath";
import type {
  BenchmarkSession,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
  MosaicTextLayer,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import {
  definePropsSchema,
  makeErrorMosaic,
  registerTemplate,
  renderNestedTemplate,
} from "@m0saic/template-utils";
import { weightedSplit } from "@m0saic/dsl-stdlib";

/**
 * @m0saic/benchmark/report/v1 — the packager.
 *
 * Reads a benchmark session's `benchmark.json` (written by
 * @m0saic/benchmark/run/v1) and renders the STANDARD shareable results video:
 * a machine-specs header, three headline KPIs, and a per-scenario render-time
 * bar chart. KPIs and the chart are COMPOSED from the existing
 * `@m0saic/charts/stat-card/v1` and `@m0saic/charts/bar-graph/v1` templates
 * (reuse, not reinvention) — only the specs header is template-specific text.
 * Deterministic given the session file.
 */

export type BenchmarkReportProps = {
  /** Session folder (or path to a benchmark.json). Default: current directory. */
  dir: string;
  /**
   * Animation length as a fraction of the video duration (0.1–1). Drives BOTH
   * the KPI count-up and the bar growth — they're a single linked intro — then
   * the rest of the video holds the final frame.
   */
  introFrac?: number;
};

const propsSchema = definePropsSchema<BenchmarkReportProps>({
  dir: {
    type: "string",
    required: false,
    description:
      "Benchmark session folder to report on (the dir written by the benchmark runner). May also point directly at a benchmark.json.",
    meta: { control: { picker: "folder" }, ui: { label: "Session folder", order: 1 } },
  },
  introFrac: {
    type: "number",
    required: false,
    description:
      "Animation length as a fraction of the video duration. One slider drives both the KPI count-up and the bar growth (they're linked); the rest of the video holds.",
    meta: {
      constraints: { min: 0.1, max: 1 },
      control: { flavor: "slider", step: 0.05 },
      ui: { label: "Animation length (× duration)", order: 2 },
    },
  },
});

const BG = "#000000";
const CARD_BG = "#0a0a0a";
const ACCENT = "#f97316"; // m0saic brand orange

function resolveBenchmarkJson(input: string): string | null {
  const toJson = (p: string) => (p.toLowerCase().endsWith(".json") ? p : path.join(p, "benchmark.json"));
  const candidates: string[] = [];
  if (path.isAbsolute(input)) {
    candidates.push(toJson(input));
  } else {
    let dir = process.cwd();
    for (;;) {
      candidates.push(toJson(path.resolve(dir, input)));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function shortFfmpeg(version: string): string {
  const m = version.match(/version\s+(\S+)/i);
  return m ? m[1] : version.split(/\s+/)[0] ?? version;
}

const color = (c: string) => c as MosaicColor;

/** A solid-background cell with vertically-stacked, centered text lines. */
function textCell(lines: { text: string; size: number; color?: string }[], bg: string): MosaicSource {
  const n = lines.length;
  const gap = Math.round(Math.max(...lines.map((l) => l.size)) * 1.35);
  const layers: MosaicTextLayer[] = lines.map((ln, i) => {
    const offset = i - (n - 1) / 2;
    return {
      content: { kind: "literal", text: ln.text },
      style: { fontSize: ln.size, fontColor: color(ln.color ?? "#e8eef9"), fontFamily: "Arial" },
      placement: { hAlign: "center", vAlign: "middle", yExpr: `(h-text_h)/2 + (${offset}) * ${gap}` },
    };
  });
  return { type: "text", layers, visual: { backgroundColor: color(bg) }, renderMode: { kind: "image" } } as MosaicSource;
}

const headerLine = (text: string, size: number, c: string): MosaicSource => textCell([{ text, size, color: c }], BG);

export const BenchmarkReport: MosaicTemplate<BenchmarkReportProps> = {
  id: asTemplateId("@m0saic/benchmark/report/v1"),
  label: "Benchmark — Report",
  version: 1,
  description:
    "Renders the standard shareable benchmark results video from a session's benchmark.json: machine-specs header, score / total-time / scenarios KPIs (stat-card), and a per-scenario render-time bar chart (bar-graph). Pair with the benchmark runner.",
  capabilities: { tier: "core" },
  tags: ["developer", "benchmark", "report", "dashboard", "performance", "developers", "animated"],
  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 6000,
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  defaultProps: { dir: ".", introFrac: 0.6 },

  async render(
    props: BenchmarkReportProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const W = ctx.target.width;
    const H = ctx.target.height;
    const durationMs = ctx.target.durationMs;
    const errOpts = { width: W, height: H, title: "Benchmark Report" };

    const jsonPath = resolveBenchmarkJson(props.dir ?? ".");
    if (!jsonPath) {
      return makeErrorMosaic(
        "No benchmark.json found. Point me at a benchmark session folder (the dir written by @m0saic/benchmark/run/v1).",
        errOpts,
      );
    }
    let session: BenchmarkSession;
    try {
      session = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as BenchmarkSession;
    } catch (err) {
      return makeErrorMosaic(
        `Failed to read ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`,
        errOpts,
      );
    }
    const scen = session.scenarios ?? [];
    if (scen.length === 0) return makeErrorMosaic(`No scenarios in ${jsonPath}.`, errOpts);

    // ── Header (3 lines of specs text) ──
    const sys = session.system;
    const hw = sys.ffmpeg.hwEncoders.length ? sys.ffmpeg.hwEncoders.join(", ") : "none";
    const titleCell = headerLine(`m0saic benchmark · ${session.label}`, Math.round(W / 26), "#e8eef9");
    const specsCell = headerLine(`${sys.cpu.model} · ${sys.cpu.cores} cores · ${sys.ram.totalGb} GB`, Math.round(W / 56), "#aab6d6");
    const envCell = headerLine(`${sys.os.platform} ${sys.os.arch} · ffmpeg ${shortFfmpeg(sys.ffmpeg.version)} · hw: ${hw}`, Math.round(W / 72), "#8794b8");

    // ── KPIs: reuse @m0saic/charts/stat-card/v1 ──
    // Shared intro window so the KPI count-up and the bar growth start together
    // at t=0 and run over the same duration — one slider (introFrac) drives both.
    const introFrac = Math.min(1, Math.max(0.1, props.introFrac ?? 0.6));
    const introMs = Math.max(500, Math.round(durationMs * introFrac));
    const okCount = scen.filter((s) => s.ok).length;
    const kpiSlot = { width: Math.round(W * 0.29), height: Math.round(H * 0.2), durationMs };
    const statCard = (label: string, value: string, sublabel: string): Promise<MosaicRenderableFile> =>
      renderNestedTemplate(
        "@m0saic/charts/stat-card/v1",
        { label, value, sublabel, delta: "", backgroundColor: CARD_BG, anim: { countUp: true, slideIn: true, introMs } },
        ctx,
        { slot: kpiSlot },
      );
    const [kpiScore, kpiTime, kpiOk] = await Promise.all([
      statCard("Score", `${session.summary.score}`, "higher is faster"),
      statCard("Total render time", formatMs(session.summary.totalElapsedMs), session.label),
      statCard("Scenarios ok", `${okCount}/${scen.length}`, `${scen.length} workloads`),
    ]);

    // ── Per-scenario render-time bars: reuse @m0saic/charts/bar-graph/v1 ──
    // Cheap cost-scaling view: for a HEAVY session (captured real templates at
    // several durations), color each bar by its source template so each
    // workload's duration series reads as one colored cluster — its cost curve.
    // Standard sessions stay single-accent. (A real line chart is a separate,
    // not-yet-built template.)
    const heavy = scen.some((s) => s.templateIds && s.templateIds.length > 0);
    const BAR_PALETTE = ["#f97316", "#43c59e", "#a78bfa", "#60a5fa", "#f6c177", "#eb6f92"];
    const groupKeys: string[] = [];
    const barColors = scen.map((s) => {
      const k = (s.templateIds && s.templateIds[0]) || s.set;
      let i = groupKeys.indexOf(k);
      if (i < 0) { i = groupKeys.length; groupKeys.push(k); }
      return BAR_PALETTE[i % BAR_PALETTE.length];
    });
    const bars: MosaicRenderableFile = await renderNestedTemplate(
      "@m0saic/charts/bar-graph/v1",
      {
        values: scen.map((s) => Math.round(((s.elapsedMs ?? 0) / 1000) * 10) / 10),
        labels: scen.map((s) => s.label),
        orientation: "horizontal",
        preset: "terminal", // near-black card to match the black theme
        barColor: heavy ? barColors : ACCENT,
        valueLabels: { show: true, format: "raw", decimals: 1, suffix: "s" },
        grid: { show: false },
        valueAxis: { show: false },
        baseline: { show: false }, // drop the zero-line strip (it renders with a small gap before the bars)
        // Same intro window as the KPIs: start at t=0, run for introMs, tiny stagger.
        anim: { intro: { durationSec: introMs / 1000, delaySec: 0, staggerSec: 0.02, ease: "smoothstep" }, reduceMotion: false },
      },
      ctx,
      { slot: { width: W, height: Math.round(H * 0.58), durationMs } },
    );

    // ── Mosaic M logo stamp (bundled brand-orange PNG, left of the KPI row).
    //    A baked PNG (1 cheap image input) — far lighter than nesting the
    //    rect-based logo template, which mints dozens of sub-renders. ──
    const logoSource: MosaicSource = {
      type: "media",
      mediaType: "image",
      assetId: "mlogo",
      placement: { fit: "contain" },
    } as MosaicSource;
    const logoAsset = fileAsset(path.resolve(__dirname, "assets"), "m-logo.png", "image");

    // ── Layout: header band (3 rows) / KPI band (M + 3 cards) / bars band ──
    const headerM0 = weightedSplit([38, 30, 32], "row") as unknown as string;
    const kpiBandM0 = weightedSplit([13, 29, 29, 29], "col") as unknown as string;
    const m0 = weightedSplit([22, 20, 58], "row", { claimants: [headerM0, kpiBandM0, "1"] });

    return {
      kind: "mosaic_document",
      version: 1,
      assets: { mlogo: logoAsset } as never,
      m0,
      sources: [
        titleCell,
        specsCell,
        envCell,
        logoSource,
        { type: "mosaic", ref: "kpi-score" },
        { type: "mosaic", ref: "kpi-time" },
        { type: "mosaic", ref: "kpi-ok" },
        { type: "mosaic", ref: "bars" },
      ] as MosaicSource[],
      children: { "kpi-score": kpiScore, "kpi-time": kpiTime, "kpi-ok": kpiOk, bars },
      backgroundColor: color(BG),
      fps: ctx.target.fps,
      durationMs,
      size: { width: W, height: H },
    } as MosaicDocument;
  },
};

registerTemplate(BenchmarkReport);
