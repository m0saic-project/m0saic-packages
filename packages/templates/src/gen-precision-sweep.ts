/**
 * Generate PRECISION-SWEEP.md — the DENSE precision probe.
 *
 * `gen-template-audit` samples ~12 "standard" canvases per template and reports
 * a ratio/absolute verdict from the precision slope. That's cheap but BLIND to
 * the specific canvases where a template's baked edges are coprime with the
 * canvas and its m0 pins to 100% precision (`maxSplit === axisLen`). A template
 * can read "ratio" on the sampled canvases yet still blow up on the ones in
 * between.
 *
 * This heavier probe sweeps EVERY integer dimension over a range, per axis
 * (holding the other axis at a fixed reference — placeRects X-edges depend on W,
 * Y on H), and reports for each template the FRACTION and EXAMPLES of canvases
 * that hit 100% precision. Use it to see how "spotty" an absolute leaf is, and
 * to verify a drift-snap migration actually flattened the pin surface (not just
 * dodged the sampled canvases).
 *
 * SLOW by design (minutes for the full shelf). Scope it while iterating:
 *   SWEEP_IDS=@m0saic/alpine/stat-card/v1,@m0saic/alpine/kpi-card/v1 \
 *     SWEEP_MIN=240 SWEEP_MAX=1280 SWEEP_STEP=1 SWEEP_FIXED=720 \
 *     node dist/gen-precision-sweep.js
 *
 * Deterministic: renders `defaultProps` (no wall-clock/random).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { MosaicDocument, MosaicEngineContext, MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";
import { getComplexityMetricsFast } from "@m0saic/dsl";
import { flattenMosaicDocument } from "@m0saic/platform";
import { getTemplate, listRegisteredTemplateIds } from "@m0saic/template-utils";

import "./m0saic"; // side-effect: register every template

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "PRECISION-SWEEP.md");

const MIN = Number(process.env.SWEEP_MIN ?? 240);
const MAX = Number(process.env.SWEEP_MAX ?? 1280);
const STEP = Math.max(1, Number(process.env.SWEEP_STEP ?? 1));
const FIXED = Number(process.env.SWEEP_FIXED ?? 720);
/** precision ÷ axis ≥ this ⇒ a 100% pin. */
const PIN = 0.999;
/** Only these ids (comma-separated) when set — otherwise all core templates. */
const ONLY = (process.env.SWEEP_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/** Same heavy/side-effecting skips as the audit. */
const SKIP_SUBSTRINGS = ["benchmark/", "media/video_to_png", "media/screencap", "brand/logo", "/scatter-bake/"];
const HEAVY_FRAMES = 4000;
/** Skip a template whose representative render is slower than this (ms) — the
 *  sweep does ~2×(MAX−MIN)/STEP renders, so a slow-per-canvas template would
 *  take minutes. Raise it (`SWEEP_SLOW_MS`) to include heavier templates. */
const SLOW_MS = Number(process.env.SWEEP_SLOW_MS ?? 120);
/** Hard wall per axis (ms). If a template turns slow only at some canvases, cut
 *  the sweep short and report a partial (truncated) result rather than hang. */
const AXIS_BUDGET_MS = Number(process.env.SWEEP_AXIS_BUDGET_MS ?? 20000);

function ctxFor(w: number, h: number): MosaicEngineContext {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/tpl-sweep" }, media: {} } as unknown as MosaicEngineContext;
}

/** Render defaultProps at (w,h) → the m0 that describes the layout (flattened if nested). */
async function m0For(tpl: MosaicTemplate<MosaicTemplateProps>, w: number, h: number): Promise<string | null> {
  const doc = await tpl.render({ ...((tpl.defaultProps as MosaicTemplateProps) ?? {}) }, ctxFor(w, h));
  if (!doc || (doc as MosaicDocument).kind !== "mosaic_document") return null;
  const mdoc = doc as MosaicDocument;
  const nested = !!(mdoc.children && Object.keys(mdoc.children).length > 0);
  if (!nested) return String(mdoc.m0);
  const flat = flattenMosaicDocument({ file: mdoc, width: w, height: h, resolveRef: () => null });
  return flat.ok ? String(flat.file.m0) : null;
}

type AxisSweep = { n: number; pins: number[]; maxPct: number; truncated: boolean };

async function sweepAxis(tpl: MosaicTemplate<MosaicTemplateProps>, axis: "W" | "H"): Promise<AxisSweep> {
  const pins: number[] = [];
  let n = 0;
  let maxPct = 0;
  let truncated = false;
  const deadline = Date.now() + AXIS_BUDGET_MS;
  for (let v = MIN; v <= MAX; v += STEP) {
    if (Date.now() > deadline) { truncated = true; break; }
    const w = axis === "W" ? v : FIXED;
    const h = axis === "H" ? v : FIXED;
    let m0: string | null;
    try {
      m0 = await m0For(tpl, w, h);
    } catch {
      continue;
    }
    if (!m0) continue;
    const p = getComplexityMetricsFast(m0).precision;
    const pct = axis === "W" ? p.maxSplitX / w : p.maxSplitY / h;
    n++;
    maxPct = Math.max(maxPct, pct);
    if (pct >= PIN) pins.push(v);
  }
  return { n, pins, maxPct, truncated };
}

type Verdict = "clean" | "spotty" | "pinned";
function verdict(wPct: number, hPct: number): Verdict {
  const worst = Math.max(wPct, hPct);
  if (worst < 0.02) return "clean"; //   <2% of canvases pin — safe to nest anywhere
  if (worst < 0.4) return "spotty"; //   pins on some canvases — a drift/ratio fix helps
  return "pinned"; //                    pins on ~half+ — a raw absolute leaf
}

type Row = { id: string; role: string; wPins: number; wN: number; hPins: number; hN: number; verdict: Verdict; wEx: number[]; hEx: number[] };

async function main(): Promise<void> {
  let ids = ONLY.length > 0 ? ONLY : listRegisteredTemplateIds();
  ids = ids.filter((id) => !SKIP_SUBSTRINGS.some((s) => id.includes(s)));
  ids.sort();

  const rows: Row[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const tpl = getTemplate<MosaicTemplateProps>(id);
    if (!tpl) continue;
    // Core-tier only (capability-tier may hit APIs / side effects), unless explicitly asked.
    if (ONLY.length === 0 && tpl.capabilities?.tier !== "core") continue;
    // Heavy + SLOW guard: time a representative render; skip bitmaps and
    // anything too slow to render thousands of times.
    let probeMs = 0;
    try {
      const t0 = Date.now();
      const first = await m0For(tpl, FIXED, FIXED);
      probeMs = Date.now() - t0;
      if (!first) continue;
      if (getComplexityMetricsFast(first).frameCount > HEAVY_FRAMES) {
        skipped.push(`${id} (heavy)`);
        console.log(`[precision-sweep] ${id}: skip (heavy)`);
        continue;
      }
      if (probeMs > SLOW_MS) {
        skipped.push(`${id} (slow ~${probeMs}ms)`);
        console.log(`[precision-sweep] ${id}: skip (slow ~${probeMs}ms/render; raise SWEEP_SLOW_MS to include)`);
        continue;
      }
    } catch {
      continue;
    }
    const role = (tpl as { primitive?: boolean }).primitive ? "primitive" : (tpl.capabilities?.tier ?? "");
    const swept0 = Date.now();
    const w = await sweepAxis(tpl, "W");
    const h = await sweepAxis(tpl, "H");
    if (w.n === 0 && h.n === 0) continue;
    const wPct = w.n ? w.pins.length / w.n : 0;
    const hPct = h.n ? h.pins.length / h.n : 0;
    const r: Row = { id, role, wPins: w.pins.length, wN: w.n, hPins: h.pins.length, hN: h.n, verdict: verdict(wPct, hPct), wEx: w.pins.slice(0, 10), hEx: h.pins.slice(0, 10) };
    rows.push(r);
    const trunc = w.truncated || h.truncated ? " ⚠ TRUNCATED (slow at some canvases)" : "";
    // eslint-disable-next-line no-console
    console.log(`[precision-sweep] ${id}: W ${r.wPins}/${r.wN} · H ${r.hPins}/${r.hN} · ${r.verdict} · ${((Date.now() - swept0) / 1000).toFixed(1)}s (${probeMs}ms/render)${trunc}`);
  }

  rows.sort((a, b) => b.wPins / Math.max(1, b.wN) + b.hPins / Math.max(1, b.hN) - (a.wPins / Math.max(1, a.wN) + a.hPins / Math.max(1, a.hN)));

  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
  const lines: string[] = [];
  lines.push("# Template precision sweep\n");
  lines.push(`> Auto-generated by \`gen-precision-sweep\` (do NOT edit by hand). Sweeps every integer dimension in **${MIN}–${MAX} step ${STEP}** per axis (other axis fixed at **${FIXED}**), and reports the fraction of canvases where the flattened m0 hits **100% precision** (\`maxSplit === axisLen\` — the coprime-edge pin). Unlike \`TEMPLATE-AUDIT.md\` (which samples ~12 canvases), this sees the pins BETWEEN the sampled sizes. Verdict: **clean** <2% · **spotty** <40% · **pinned** ≥40%. Sorted worst-first.\n`);
  lines.push(`_${rows.length} templates swept._\n`);
  lines.push("| template | role | verdict | W 100%-pins | H 100%-pins | example pin widths |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| \`${r.id}\` | ${r.role} | **${r.verdict}** | ${r.wPins}/${r.wN} (${pct(r.wPins, r.wN)}) | ${r.hPins}/${r.hN} (${pct(r.hPins, r.hN)}) | ${r.wEx.length ? r.wEx.join(", ") : "—"} |`);
  }
  lines.push("");
  lines.push("_A **clean** template composes at any canvas; **spotty** / **pinned** ones pin their parent to 100% precision on the listed dims — migrate them onto `placeOptimizedPieces` (lock only animation-critical geometry). Note even a drift-snapped leaf stays **spotty** at small canvases where the % budget is only a pixel or two._");
  if (skipped.length) {
    lines.push("");
    lines.push(`**Skipped (${skipped.length})** — too heavy / slow to sweep thousands of times (raise \`SWEEP_SLOW_MS\` to include): ${skipped.map((s) => `\`${s}\``).join(", ")}.`);
  }

  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(`[precision-sweep] wrote PRECISION-SWEEP.md — ${rows.length} templates`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
