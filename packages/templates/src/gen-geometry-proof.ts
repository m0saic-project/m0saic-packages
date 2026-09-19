/**
 * gen-geometry-proof — the sloth-tier, one-template EXHAUSTIVE geometry proof.
 *
 * The matrix (`gen-geometry-matrix`) is the curated everyday sweep. This is its
 * opt-in counterpart (like `test:cli:sloth` — NEVER in the merge gate): ONE
 * template id, a caller-defined canvas SET, EVERY member checked, one clustered
 * report that PROVES the contract across the whole set.
 *
 *   npm run audit:geometry-proof -- --template @m0saic/alpine/stat-card/v1 \
 *     [--canvases 480x480,386x277,...]      # explicit list
 *     [--range 240:3840x240:2160 --step 1]  # cartesian range (step 1 = exhaustive)
 *     [--ar 16:9,9:16,1:1 --scales 240:2160]# aspect families × scale sweep
 *     [--props '{"...":"..."}']             # merged over defaultProps; debug forced on
 *     [--seeds seeds.json]                  # ProofEstimateSeed[] for the estimator
 *     [--estimate]                          # probe only — print the projection, run nothing
 *     [--yes]                               # accept a sloth-scale projection without prompting
 *     [--out packages/templates/geometry-proofs/]
 *
 * Resolve-only (JS + one parse per canvas) — NO ffmpeg. The estimator probe runs
 * FIRST, always, and refuses a sloth-scale set without `--yes`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplate,
  MosaicTemplateProps,
  MosaicGeometryContractStamp,
} from "@m0saic/types";
import { parseM0StringComplete } from "@m0saic/dsl";
import { getTemplate } from "@m0saic/template-utils";
import {
  proofCanvases,
  proofCanvasCount,
  proofSeedCanvases,
  projectProofTime,
  verdictTier,
  isHostileCanvas,
  buildProofReport,
  type ProofSpec,
  type CanvasResult,
} from "./geometry-audit";

import "./m0saic"; // side-effect: register every template

const ROOT = path.resolve(__dirname, "..");

// ── args ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const hasFlag = (name: string): boolean => argv.includes(name);

type ProofEstimateSeed = { m0: string; w: number; h: number; label?: string };

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
function slugify(id: string): string {
  return id.replace(/^@/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
function hashProps(obj: unknown): string {
  const s = JSON.stringify(obj) ?? "";
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function ctxFor(w: number, h: number): MosaicEngineContext {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/geom-proof" }, media: {} } as unknown as MosaicEngineContext;
}

async function main(): Promise<void> {
  const templateId = argVal("--template");
  if (!templateId) {
    console.error("gen-geometry-proof: --template <id> is required.");
    process.exit(2);
  }
  const tpl = getTemplate<MosaicTemplateProps>(templateId);
  if (!tpl) {
    console.error(`gen-geometry-proof: template not registered: ${templateId}`);
    process.exit(2);
  }
  const schema = (tpl as { propsSchema?: Record<string, unknown> }).propsSchema;
  if (!schema || !("debugGeometry" in schema)) {
    console.error(`gen-geometry-proof: ${templateId} does not adopt the geometry contract (no debugGeometry prop). Nothing to prove.`);
    process.exit(2);
  }

  const extraProps = argVal("--props") ? (JSON.parse(argVal("--props")!) as MosaicTemplateProps) : ({} as MosaicTemplateProps);
  const baseProps = { ...((tpl.defaultProps as MosaicTemplateProps) ?? {}), ...extraProps };

  const spec: ProofSpec = {
    canvases: argVal("--canvases"),
    range: argVal("--range"),
    step: argVal("--step") ? Number(argVal("--step")) : undefined,
    ar: argVal("--ar"),
    scales: argVal("--scales"),
    scaleStep: argVal("--scale-step") ? Number(argVal("--scale-step")) : undefined,
  };
  const count = proofCanvasCount(spec);
  if (count <= 0) {
    console.error("gen-geometry-proof: empty canvas set — pass --canvases / --range / --ar+--scales.");
    process.exit(2);
  }

  // Resolve with debug OFF → the real geometry m0 (not an error mosaic) for timing.
  const resolveM0 = async (w: number, h: number): Promise<string | null> => {
    try {
      const doc = (await tpl.render({ ...baseProps, debugGeometry: false } as MosaicTemplateProps, ctxFor(w, h))) as MosaicDocument;
      return doc?.m0 != null ? String(doc.m0) : null;
    } catch {
      return null;
    }
  };
  // Resolve with debug ON → the stamped contract result.
  const stampAt = async (w: number, h: number): Promise<{ stamp?: MosaicGeometryContractStamp; error?: string }> => {
    try {
      const doc = (await tpl.render({ ...baseProps, debugGeometry: true } as MosaicTemplateProps, ctxFor(w, h))) as MosaicDocument;
      const stamp = doc?.editor?.geometryContract;
      return stamp ? { stamp } : { error: "no geometryContract stamp" };
    } catch (e) {
      return { error: String((e as Error)?.message ?? e).slice(0, 120) };
    }
  };

  // ── Estimator probe (always first) ──
  const seedsFile = argVal("--seeds");
  const seeds: ProofEstimateSeed[] = [];
  const resolveTimes: number[] = [];
  if (seedsFile) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(seedsFile), "utf8")) as ProofEstimateSeed[];
    for (const s of parsed) {
      seeds.push(s);
      const t0 = performance.now();
      await resolveM0(s.w, s.h);
      resolveTimes.push(performance.now() - t0);
    }
  } else {
    for (const [w, h] of proofSeedCanvases(spec)) {
      const t0 = performance.now();
      const m0 = await resolveM0(w, h);
      resolveTimes.push(performance.now() - t0);
      if (m0) seeds.push({ m0, w, h, label: "auto" });
    }
  }
  const resolveMed = median(resolveTimes);
  // Worst seed's median parse (the estimate errs long, never short).
  const K = 5;
  let worstParseMed = 0;
  for (const s of seeds) {
    const reps: number[] = [];
    for (let k = 0; k < K; k++) {
      const t0 = performance.now();
      parseM0StringComplete(s.m0, s.w, s.h);
      reps.push(performance.now() - t0);
    }
    worstParseMed = Math.max(worstParseMed, median(reps));
  }
  const projectedMs = projectProofTime(resolveMed, worstParseMed, count);
  const verdict = verdictTier(projectedMs);
  console.log(
    `[geometry-proof] ${templateId} · ${count.toLocaleString()} canvases · ` +
      `~${(resolveMed + worstParseMed).toFixed(2)}ms/canvas → projected ${(projectedMs / 1000).toFixed(1)}s · ${verdict.label}`,
  );

  if (hasFlag("--estimate")) return;
  if (verdict.tier === "sloth" && !hasFlag("--yes")) {
    console.error(`[geometry-proof] REFUSING a sloth-scale run (~${(projectedMs / 60000).toFixed(1)} min). Re-run with --yes to accept.`);
    process.exit(3);
  }

  // ── Run: resolve + read stamp per canvas; store only failures (bounded). ──
  const started = performance.now();
  const failures: CanvasResult[] = [];
  let total = 0, passes = 0, hostileTotal = 0, hostilePass = 0;
  let firstInfeasible: string | null = null, firstSubPrec: string | null = null;
  let maxSpread = 0, maxSpreadCanvas = "";
  const hostileExamples: string[] = [];

  for (const [w, h] of proofCanvases(spec)) {
    total++;
    const hostile = isHostileCanvas(w, h);
    if (hostile) { hostileTotal++; if (hostileExamples.length < 8) hostileExamples.push(`${w}x${h}`); }
    const { stamp, error } = await stampAt(w, h);
    if (error) { failures.push({ w, h, error }); continue; }
    const f = stamp!.floors;
    if (!f.feasible && !firstInfeasible) firstInfeasible = `${w}x${h}`;
    if (!f.meetsPrecision && !firstSubPrec) firstSubPrec = `${w}x${h}`;
    if (f.maxSpreadPx !== Infinity && f.maxSpreadPx > maxSpread) { maxSpread = f.maxSpreadPx; maxSpreadCanvas = `${w}x${h}`; }
    if (stamp!.ok) { passes++; if (hostile) hostilePass++; }
    else failures.push({ w, h, ok: false, violations: stamp!.violations, floors: f });
    if (total % 1000 === 0) process.stderr.write(`[geometry-proof] ${total.toLocaleString()}/${count.toLocaleString()} …\n`);
  }
  const wallMs = performance.now() - started;

  // ── Report (shared, tested builder) ──
  const specStr = spec.canvases ? `list ${spec.canvases}` : spec.range ? `range ${spec.range} step ${spec.step ?? 1}` : spec.ar ? `ar ${spec.ar} × scales ${spec.scales}` : "matrix";
  const { md, proven } = buildProofReport({
    templateId,
    specStr,
    total,
    propsHash: hashProps(baseProps),
    wallMs,
    projectedMs,
    tier: verdict.tier,
    passes,
    failures,
    floors: { firstInfeasible, firstSubPrec, maxSpread, maxSpreadCanvas },
    hostile: { total: hostileTotal, passed: hostilePass, examples: hostileExamples },
  });

  const outDir = argVal("--out") ? path.resolve(argVal("--out")!) : path.join(ROOT, "geometry-proofs");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${slugify(templateId)}.md`);
  fs.writeFileSync(outFile, md, "utf8");
  console.log(
    `[geometry-proof] ${proven ? "PROVEN" : "FAILED"} — ${passes.toLocaleString()}/${total.toLocaleString()} passed · ` +
      `wrote ${path.relative(ROOT, outFile)} in ${(wallMs / 1000).toFixed(1)}s`,
  );
  if (!proven) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
