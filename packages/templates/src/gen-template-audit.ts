/**
 * Generate TEMPLATE-AUDIT.md — the positioning audit for the template shelf.
 *
 * Usage:  node dist/gen-template-audit.js
 *
 * A template is a function `(props, canvas) → m0`. You can't know its output
 * statically, but you can PROBE it: render `defaultProps` across a grid of
 * canvases (portrait / square / desktop × 240p → 4K) and watch how
 * `computeFeasibility` (min-feasible px) and `precision` (max split count per
 * axis) respond.
 *
 *   - precision that TRACKS the canvas (slope ≈ 1) ⇒ ABSOLUTE positioning
 *     (per-pixel basis, e.g. placeRects). Fine for a head/hero — it knows its
 *     canvas — but it does NOT nest: it eats whatever cell it's given and hits
 *     the feasibility wall.
 *   - precision that STAYS STABLE across canvases ⇒ RATIO positioning (weighted
 *     splits). Composes cleanly.
 *
 * A template marked `primitive` (meant to nest) that probes ABSOLUTE is a
 * composability warning (`PRIMITIVE_ABSOLUTE_POSITIONING`).
 *
 * The desktop-1080p probe also reads the template's LATTICE: its split counts
 * and their LCM per axis (`latticeReport`, @m0saic/template-utils). A split
 * count above 12 with a prime factor outside {2, 3, 5} is a composability
 * warning (`LATTICE_NOT_SMOOTH`) — the same fact the build gate's
 * `latticeSmooth` convention reports; here it is a column. See
 * the internal template-positioning-audit notes +
 * the internal ratio-vs-absolute-m0-drafting notes.
 *
 * Deterministic: renders `defaultProps` (no wall-clock/random), so the output
 * is reproducible across builds.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { MosaicDocument, MosaicEngineContext, MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";
import { computeFeasibility, getComplexityMetricsFast } from "@m0saic/dsl";
import { flattenMosaicDocument } from "@m0saic/platform";
import { getTemplate, latticeReport, listRegisteredTemplateIds } from "@m0saic/template-utils";
import type { LatticeReport } from "@m0saic/template-utils";

import "./m0saic"; // side-effect: register every template

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "TEMPLATE-AUDIT.md");

// Probe grid: three aspects (portrait constrains width, desktop constrains
// height, square is neutral) × a resolution sweep from 240p to 4K.
const ASPECTS: { name: string; ratio: number }[] = [
  { name: "square", ratio: 1 },
  { name: "portrait", ratio: 9 / 16 },
  { name: "desktop", ratio: 16 / 9 },
];
const HEIGHTS = [240, 540, 1080, 2160];
/** Max |slope| of precision-vs-canvas before we call it absolute. */
const ABSOLUTE_SLOPE = 0.3;
/** Skip the full probe above this default-props frame count (bitmap/sloth). */
const HEAVY_FRAMES = 4000;

/**
 * Only `capabilities.tier === "core"` templates are probed. **Capability-tier
 * templates are skipped by default** — they may hit APIs / do side effects
 * (fetchers, post-render wrappers, workload runners), which `render()`-probing
 * would trigger. On top of that, a few CORE templates are still unsafe to probe
 * — intrinsically heavy (bitmap rasters, atlas bakes) or media-source-dependent
 * (video probing) — and are skipped by id substring below.
 */
const SKIP_SUBSTRINGS = [
  "benchmark/", //         benchmark/report renders a heavy dashboard
  "media/video_to_png", "media/screencap", // probe/strip source video (need ctx.media)
  "brand/logo", //         bitmap raster (heavy m0)
  "/scatter-bake/", //     225-source atlas bake
];

type Row = { aspect: string; w: number; h: number; pX: number; pY: number; mW: number; mH: number };
type Verdict = "ratio" | "absolute";
type Status = "ok" | "render-failed" | "heavy" | "empty" | "skipped";
type Result = {
  id: string;
  role: string;
  primitive: boolean;
  status: Status;
  verdict?: Verdict;
  maxSlope?: number;
  nested?: boolean;
  flattenFails?: number;
  byAspect?: Record<string, Row[]>;
  /** Split-count census at the desktop 1080p probe (absent when that canvas did not render). */
  lattice?: { report: LatticeReport; bitmap: boolean; canvas: string };
  note?: string;
  warnings: string[];
};

/** The canvas whose probe feeds the lattice column — the modern core's landscape member. */
const LATTICE_PROBE = { aspect: "desktop", h: 1080 };

/** `X=120 · Y=30` (an LCM past 1e15 prints as ∞). */
function fmtLattice(r: LatticeReport): string {
  const n = (v: number): string => (Number.isFinite(v) ? v.toLocaleString("en-US") : "∞");
  return `X=${n(r.selfLattice.x)} · Y=${n(r.selfLattice.y)}`;
}

function ctxFor(w: number, h: number): MosaicEngineContext {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/tpl-audit" }, media: {} } as unknown as MosaicEngineContext;
}

/**
 * Render defaultProps at (w,h) and return the m0 that actually describes the
 * spatial layout. Flat leaf → `doc.m0`; nested → the FLATTENED m0 (the trivial
 * top-level m0 of a composite hides its children's positioning). A flatten that
 * fails (`SPLIT_EXCEEDS_AXIS`) is itself an absolute/infeasible signal.
 */
async function m0For(tpl: MosaicTemplate<MosaicTemplateProps>, w: number, h: number): Promise<{ m0: string; nested: boolean } | null | "flatten-fail"> {
  const doc = await tpl.render({ ...((tpl.defaultProps as MosaicTemplateProps) ?? {}) }, ctxFor(w, h));
  if (!doc || (doc as MosaicDocument).kind !== "mosaic_document") return null;
  const mdoc = doc as MosaicDocument;
  const nested = !!(mdoc.children && Object.keys(mdoc.children).length > 0);
  if (!nested) return { m0: String(mdoc.m0), nested: false };
  const flat = flattenMosaicDocument({ file: mdoc, width: w, height: h, resolveRef: () => null });
  if (!flat.ok) return "flatten-fail";
  return { m0: String(flat.file.m0), nested: true };
}

/** Least-squares slope of y over x. */
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const d = n * sxx - sx * sx;
  return d === 0 ? 0 : (n * sxy - sx * sy) / d;
}

async function probe(id: string): Promise<Result> {
  const tpl = getTemplate<MosaicTemplateProps>(id);
  const primitive = !!(tpl as MosaicTemplate<MosaicTemplateProps> & { primitive?: boolean })?.primitive;
  const role = primitive ? "primitive" : ((tpl?.capabilities?.tier as string) ?? "");
  const base: Result = { id, role, primitive, status: "ok", warnings: [] };
  if (!tpl) return { ...base, status: "render-failed", note: "not registered" };

  // Heavy guard — render once small and weigh; skip the sweep if it's a bitmap.
  try {
    const first = await m0For(tpl, 240, 240);
    if (first && first !== "flatten-fail") {
      const fc = getComplexityMetricsFast(first.m0).frameCount;
      if (fc > HEAVY_FRAMES) return { ...base, status: "heavy", note: `${fc.toLocaleString()} frames at 240p` };
    }
  } catch (e) {
    return { ...base, status: "render-failed", note: String((e as Error)?.message ?? e).slice(0, 90) };
  }

  const byAspect: Record<string, Row[]> = {};
  let nested = false;
  let flattenFails = 0;
  let total = 0;
  let latticeAt: Result["lattice"];
  for (const a of ASPECTS) {
    byAspect[a.name] = [];
    for (const h of HEIGHTS) {
      const w = Math.max(1, Math.round(h * a.ratio));
      try {
        const r = await m0For(tpl, w, h);
        if (r === "flatten-fail") { flattenFails++; continue; }
        if (!r) continue;
        nested = nested || r.nested;
        if (a.name === LATTICE_PROBE.aspect && h === LATTICE_PROBE.h) {
          const decl = tpl.lattice;
          const report = latticeReport([r.m0], { allow: (decl?.allow ?? []).map((x) => x.count) });
          latticeAt = { report, bitmap: decl?.mode === "bitmap", canvas: `${w}×${h}` };
        }
        const f = computeFeasibility(r.m0);
        const p = getComplexityMetricsFast(r.m0).precision;
        byAspect[a.name].push({ aspect: a.name, w, h, pX: p.maxSplitX, pY: p.maxSplitY, mW: f.minWidthPx, mH: f.minHeightPx });
        total++;
      } catch {
        /* skip a bad canvas */
      }
    }
  }
  if (total < 3 && flattenFails === 0) return { ...base, status: "empty", note: "no probeable canvases" };

  let maxSlope = 0;
  for (const rows of Object.values(byAspect)) {
    if (rows.length < 3) continue;
    maxSlope = Math.max(
      maxSlope,
      Math.abs(slope(rows.map((r) => r.h), rows.map((r) => r.pY))),
      Math.abs(slope(rows.map((r) => r.w), rows.map((r) => r.pX))),
    );
  }
  // Frequent flatten failures across the sweep are a strong absolute/infeasible signal.
  const verdict: Verdict = maxSlope > ABSOLUTE_SLOPE || flattenFails >= HEIGHTS.length ? "absolute" : "ratio";
  const warnings: string[] = [];
  if (primitive && verdict === "absolute") {
    warnings.push(
      `PRIMITIVE_ABSOLUTE_POSITIONING — precision scales with the canvas (slope ${maxSlope.toFixed(2)}` +
        `${flattenFails ? `, ${flattenFails} flatten-fails` : ""}). Marked a primitive but won't compose: it eats its cell and hits the feasibility wall when nested. Fix by returning a ratio m0 (not placeRects).`,
    );
  }
  if (latticeAt && !latticeAt.bitmap && latticeAt.report.offenders.length > 0) {
    const offenders = latticeAt.report.offenders;
    const list = offenders.map((c) => `${c.n} (${c.factors})`).join(", ");
    warnings.push(
      `LATTICE_NOT_SMOOTH — split count${offenders.length > 1 ? "s" : ""} ${list} at ${latticeAt.canvas} ` +
        `carry a prime factor outside {2, 3, 5}; composing this template costs the LCM (self-lattice ${fmtLattice(latticeAt.report)}). ` +
        `Cap weighted bands with weightedSplit(…, { precision: 120 }) or place rects with placeInsetPieces — never per-weight rounding to a cap (the 119/121 fencepost).`,
    );
  }
  return { ...base, verdict, maxSlope, nested, flattenFails, byAspect, lattice: latticeAt, warnings };
}

/** Smallest canvas at which NEITHER precision nor feasibility bites, per axis:
 *  max(precisionX, feasW) × max(precisionY, feasH). The one number to glance at. */
function safeW(r: Row): number {
  return Math.max(r.pX, r.mW);
}
function safeH(r: Row): number {
  return Math.max(r.pY, r.mH);
}

/** Aspect × resolution table with a per-Row cell formatter. Header row = the
 *  probed heights; rows = aspects. Missing samples render as `—`. */
function fmtGrid(byAspect: Record<string, Row[]>, cell: (r: Row) => string): string[] {
  const lines: string[] = [];
  lines.push(`| aspect | ${HEIGHTS.map((h) => `${h}p`).join(" | ")} |`);
  lines.push(`|---|${HEIGHTS.map(() => "---:").join("|")}|`);
  for (const a of ASPECTS) {
    const byH = new Map((byAspect[a.name] ?? []).map((r) => [r.h, r] as const));
    const cells = HEIGHTS.map((h) => {
      const r = byH.get(h);
      return r ? cell(r) : "—";
    });
    lines.push(`| ${a.name} | ${cells.join(" | ")} |`);
  }
  return lines;
}

function renderMd(results: Result[]): string {
  const warned = results.filter((r) => r.warnings.length > 0);
  const skipped = results.filter((r) => r.status !== "ok");
  const out: string[] = [];
  out.push("# Template positioning audit");
  out.push("");
  out.push(
    "> Auto-generated by `gen-template-audit` (do NOT edit by hand). Probes each " +
      "**core-tier** template's `defaultProps` across canvases (portrait / square / desktop × " +
      "240p→4K) — capability-tier templates are skipped (they may hit APIs / do side effects). " +
      "Precision that **scales with the canvas** ⇒ **absolute** positioning (won't nest); " +
      "**stable** ⇒ **ratio** (composes). A `primitive` that probes absolute is a warning. " +
      "The **lattice** line is the split-count census at the desktop 1080p probe: the LCM of the counts per axis, the largest count, " +
      "and any count above 12 with a prime factor outside {2, 3, 5} (`LATTICE_NOT_SMOOTH` — the build gate's `latticeSmooth` convention). " +
      "See the internal template-positioning-audit notes and the handbook's `composition-arithmetic.md`.",
  );
  out.push("");

  // ── ToC: warnings first ──
  out.push(`## ⚠ Warnings (${warned.length})`);
  out.push("");
  if (warned.length === 0) {
    out.push("_None._");
  } else {
    out.push("| template | role | warning |");
    out.push("|---|---|---|");
    for (const r of warned) {
      for (const w of r.warnings) {
        const code = w.split(" — ")[0];
        const extra =
          code === "PRIMITIVE_ABSOLUTE_POSITIONING" ? ` (slope ${r.maxSlope?.toFixed(2)})` : r.lattice ? ` (${fmtLattice(r.lattice.report)})` : "";
        out.push(`| [\`${r.id}\`](#${anchor(r.id)}) | ${r.role} | ${code}${extra} |`);
      }
    }
  }
  out.push("");

  // ── Skipped ──
  if (skipped.length > 0) {
    out.push(`## Not probed (${skipped.length})`);
    out.push("");
    out.push("| template | reason |");
    out.push("|---|---|");
    for (const r of skipped) out.push(`| \`${r.id}\` | ${r.status}${r.note ? ` — ${r.note}` : ""} |`);
    out.push("");
  }

  // ── Summary counts ──
  const ok = results.filter((r) => r.status === "ok");
  const abs = ok.filter((r) => r.verdict === "absolute");
  const ratio = ok.filter((r) => r.verdict === "ratio");
  const measured = ok.filter((r) => r.lattice && !r.lattice.bitmap);
  const onLattice = measured.filter((r) => r.lattice!.report.offenders.length === 0);
  out.push(
    `**${ok.length} probed** · ${ratio.length} ratio · ${abs.length} absolute · ${warned.length} warnings · ${skipped.length} skipped · ` +
      `lattice: ${onLattice.length}/${measured.length} on the 5-smooth lattice (${ok.length - measured.length} bitmap-declared or not probed at 1080p).`,
  );
  out.push("");

  // ── Per-template, by slug ──
  out.push("## All templates (by slug)");
  out.push("");
  for (const r of results) {
    out.push(`### ${r.id}`);
    out.push("");
    if (r.status !== "ok") {
      out.push(`- **${r.status}**${r.note ? ` — ${r.note}` : ""}`);
      out.push("");
      continue;
    }
    const verdictBadge = r.verdict === "absolute" ? "**ABSOLUTE**" : "ratio";
    out.push(
      `- role: \`${r.role}\` · verdict: ${verdictBadge} · max precision slope ${r.maxSlope?.toFixed(2)}` +
        `${r.nested ? " · nested (flattened to probe)" : ""}` +
        `${r.flattenFails ? ` · ${r.flattenFails} flatten-fails` : ""}`,
    );
    if (r.lattice) {
      const rep = r.lattice.report;
      const verdict = r.lattice.bitmap
        ? "bitmap (declared `lattice.mode`; not held to the lattice)"
        : rep.offenders.length === 0
          ? `5-smooth ✓${rep.allowed.length ? ` (allowed content counts ${rep.allowed.map((c) => c.n).join(", ")})` : ""}`
          : `✗ ${rep.offenders.map((c) => `${c.n} (${c.factors})`).join(", ")}`;
      out.push(`- lattice @${r.lattice.canvas}: ${fmtLattice(rep)} · max N ${rep.maxN} · ${verdict}`);
    }
    for (const w of r.warnings) out.push(`- ⚠ ${w}`);
    const byAspect = r.byAspect ?? {};
    out.push("");
    out.push("**Safe canvas** — smallest w×h where neither precision nor feasibility bites:");
    out.push("");
    out.push(...fmtGrid(byAspect, (row) => `${safeW(row)}×${safeH(row)}`));
    out.push("");
    out.push("_A safe canvas that climbs across a row scales with the canvas ⇒ absolute; one that stays flat ⇒ ratio._");
    out.push("");
    out.push("<details><summary>precision · feasibility breakdown</summary>");
    out.push("");
    out.push(...fmtGrid(byAspect, (row) => `${row.pX}×${row.pY} · ${row.mW}×${row.mH}`));
    out.push("");
    out.push(
      "_Cell = precision (maxSplitX×maxSplitY) · min-feasibility (px). Safe canvas above = the per-axis max of the two. Usually precision > feasibility, but not always._",
    );
    out.push("");
    out.push("</details>");
    out.push("");
  }
  return out.join("\n") + "\n";
}

function anchor(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function main(): Promise<void> {
  const ids = listRegisteredTemplateIds()
    .map(String)
    .filter((id) => !(getTemplate(id) as MosaicTemplate<MosaicTemplateProps> & { deprecated?: unknown })?.deprecated)
    .sort();
  const results: Result[] = [];
  for (const id of ids) {
    const t = getTemplate(id) as MosaicTemplate<MosaicTemplateProps> & { primitive?: boolean };
    const tier = (t?.capabilities?.tier as string) ?? "(none)";
    const meta = { id, role: t?.primitive ? "primitive" : tier, primitive: !!t?.primitive, warnings: [] as string[] };
    // Only probe core templates — capability-tier may hit APIs / do side effects.
    if (tier !== "core") {
      results.push({ ...meta, status: "skipped", note: `${tier} tier (not core — may hit APIs / side effects)` });
      continue;
    }
    const skip = SKIP_SUBSTRINGS.find((s) => id.includes(s));
    if (skip) {
      results.push({ ...meta, status: "skipped", note: `core, but skip-list (${skip})` });
      continue;
    }
    process.stderr.write(`[template-audit] probing ${id} …\n`);
    results.push(await probe(id));
  }

  fs.writeFileSync(OUT, renderMd(results));

  const warned = results.filter((r) => r.warnings.length > 0);
  for (const r of warned) for (const w of r.warnings) console.warn(`[template-audit] ⚠ ${r.id}: ${w.split(" — ")[0]}`);
  console.log(
    `[template-audit] wrote ${path.relative(ROOT, OUT)} — ${results.length} templates, ${warned.length} with warnings`,
  );
}

void main();
