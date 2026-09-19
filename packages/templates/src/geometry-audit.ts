/**
 * geometry-audit — the PURE, testable core shared by `gen-geometry-matrix`
 * (the curated everyday sweep) and `gen-geometry-proof` (the sloth-tier
 * exhaustive per-template proof).
 *
 * Everything here is deterministic and side-effect-free: canvas-set builders,
 * the estimator's projection math, verdict tiering, hostile-canvas
 * classification, §3c routing hints, and violation clustering. The gen-scripts
 * wire the impure parts (template resolve, wall-clock timing, file I/O) to
 * these; the logic lives here so it is unit-tested with synthetic data.
 *
 * See the internal template-geometry-contract notes and handbook
 * `feasibility-precision-quantization.md` §3c (the launder ladder the routing
 * hints point at) + `composition-arithmetic.md` §2 (the canvas families the
 * matrix tiers come from).
 */

import type { MosaicGeometryViolation } from "@m0saic/types";

// ── Matrix canvas tiers (composition-arithmetic §2) ──────────

export const MATRIX_TIERS: { tier: string; canvases: [number, number][] }[] = [
  // the modern family; exactness lifts by integer scaling — one ×2 member
  // (3840×2160) catches scale-dependent JS math.
  { tier: "modern-core", canvases: [[1920, 1080], [1080, 1920], [1080, 1080], [3840, 2160]] },
  // 720p pair (gcd 40), 4:5 social (gcd 10).
  { tier: "adjacent", canvases: [[1280, 720], [1080, 1350]] },
  // primes / coprime pairs; 386×277 is the stat-card audit aspect that bit.
  // Degradation is EXPECTED here — the contract asserts the DEGRADED (exact) intent.
  { tier: "hostile", canvases: [[997, 720], [1001, 733], [483, 379], [386, 277]] },
];

/** The matrix canvas set for a template: the fixed tiers + its own `outputHints`. */
export function matrixCanvases(
  outputHints?: { width?: number; height?: number },
): { w: number; h: number; tier: string }[] {
  const out: { w: number; h: number; tier: string }[] = [];
  const seen = new Set<string>();
  for (const t of MATRIX_TIERS) {
    for (const [w, h] of t.canvases) {
      const k = `${w}x${h}`;
      if (!seen.has(k)) { seen.add(k); out.push({ w, h, tier: t.tier }); }
    }
  }
  if (outputHints?.width && outputHints?.height) {
    const k = `${outputHints.width}x${outputHints.height}`;
    if (!seen.has(k)) out.push({ w: outputHints.width, h: outputHints.height, tier: "declared" });
  }
  return out;
}

// ── Proof canvas set: list | cartesian range | aspect × scale sweep ──

export type ProofSpec = {
  /** Explicit list: `"480x480,386x277,..."`. */
  canvases?: string;
  /** Cartesian range: `"wMin:wMax x hMin:hMax"` (step via `step`). */
  range?: string;
  step?: number;
  /** Aspect families `"16:9,9:16,1:1"` swept over `scales` (height range). */
  ar?: string;
  scales?: string;
  scaleStep?: number;
};

function parseList(s: string): [number, number][] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [w, h] = t.toLowerCase().split("x").map(Number);
      return [w, h] as [number, number];
    });
}

function parseRange(s: string): { wMin: number; wMax: number; hMin: number; hMax: number } {
  const [wPart, hPart] = s.toLowerCase().split("x");
  const [wMin, wMax] = wPart.split(":").map(Number);
  const [hMin, hMax] = hPart.split(":").map(Number);
  return { wMin, wMax, hMin, hMax };
}

/** Deterministic iterator over the proof canvas set (lazy — never materializes millions). */
export function* proofCanvases(spec: ProofSpec): Generator<[number, number]> {
  if (spec.canvases) {
    for (const c of parseList(spec.canvases)) yield c;
    return;
  }
  if (spec.range) {
    const { wMin, wMax, hMin, hMax } = parseRange(spec.range);
    const step = Math.max(1, spec.step ?? 1);
    for (let w = wMin; w <= wMax; w += step) for (let h = hMin; h <= hMax; h += step) yield [w, h];
    return;
  }
  if (spec.ar && spec.scales) {
    const ars = spec.ar.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(":").map(Number) as [number, number]);
    const [sMin, sMax] = spec.scales.split(":").map(Number);
    const step = Math.max(1, spec.scaleStep ?? 120);
    for (const [aw, ah] of ars) for (let h = sMin; h <= sMax; h += step) yield [Math.round((h * aw) / ah), h];
    return;
  }
  for (const c of matrixCanvases()) yield [c.w, c.h];
}

/** Count without materializing — for the estimator projection. */
export function proofCanvasCount(spec: ProofSpec): number {
  if (spec.canvases) return parseList(spec.canvases).length;
  if (spec.range) {
    const { wMin, wMax, hMin, hMax } = parseRange(spec.range);
    const step = Math.max(1, spec.step ?? 1);
    return Math.max(0, Math.floor((wMax - wMin) / step) + 1) * Math.max(0, Math.floor((hMax - hMin) / step) + 1);
  }
  if (spec.ar && spec.scales) {
    const ars = spec.ar.split(",").map((s) => s.trim()).filter(Boolean).length;
    const [sMin, sMax] = spec.scales.split(":").map(Number);
    const step = Math.max(1, spec.scaleStep ?? 120);
    return ars * Math.max(0, Math.floor((sMax - sMin) / step) + 1);
  }
  return matrixCanvases().length;
}

/** Three representative canvases (smallest / mid / largest) for auto-seeding the
 *  estimator — computed from the spec BOUNDS, so it never iterates a huge set. */
export function proofSeedCanvases(spec: ProofSpec): [number, number][] {
  const uniq = (arr: [number, number][]): [number, number][] => {
    const seen = new Set<string>();
    const out: [number, number][] = [];
    for (const c of arr) {
      const k = `${c[0]}x${c[1]}`;
      if (!seen.has(k)) { seen.add(k); out.push(c); }
    }
    return out;
  };
  if (spec.canvases) {
    const list = [...proofCanvases(spec)].sort((a, b) => a[0] * a[1] - b[0] * b[1]);
    if (list.length === 0) return [];
    return uniq([list[0], list[Math.floor(list.length / 2)], list[list.length - 1]]);
  }
  if (spec.range) {
    const { wMin, wMax, hMin, hMax } = parseRange(spec.range);
    return uniq([[wMin, hMin], [Math.round((wMin + wMax) / 2), Math.round((hMin + hMax) / 2)], [wMax, hMax]]);
  }
  if (spec.ar && spec.scales) {
    const [aw, ah] = (spec.ar.split(",")[0] ?? "1:1").split(":").map(Number);
    const [sMin, sMax] = spec.scales.split(":").map(Number);
    const mid = Math.round((sMin + sMax) / 2);
    return uniq([sMin, mid, sMax].map((h) => [Math.round((h * aw) / ah), h] as [number, number]));
  }
  const m = matrixCanvases();
  const byArea = [...m].sort((a, b) => a.w * a.h - b.w * b.h);
  return uniq([byArea[0], byArea[Math.floor(byArea.length / 2)], byArea[byArea.length - 1]].map((c) => [c.w, c.h] as [number, number]));
}

// ── Estimator projection (pure; timing is measured by the script) ──

/** projectedMs ≈ count × (resolve + parse) + overhead. Uses the WORST seed's parse. */
export function projectProofTime(resolveMs: number, parseMs: number, count: number, overheadMs = 50): number {
  return count * (Math.max(0, resolveMs) + Math.max(0, parseMs)) + overheadMs;
}

export type ProofTier = "quick" | "minutes" | "sloth";
/** quick <60s (just run) · minutes <10min (notice) · sloth ≥10min (refuses without --yes). */
export function verdictTier(projectedMs: number): { tier: ProofTier; label: string } {
  if (projectedMs < 60_000) return { tier: "quick", label: "quick (<60s) — just run it" };
  if (projectedMs < 600_000) return { tier: "minutes", label: "minutes (<10min) — runs with a notice" };
  return { tier: "sloth", label: "sloth (≥10min) — prints the projection and refuses without --yes" };
}

// ── Hostile-canvas classification (heuristic; prime / coprime axis) ──

function gcd2(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}
/** An axis is hostile when it shares little with the modern lattice (gcd(dim,120) < 8):
 *  primes and coprime strays — where placeInsetPieces degrades to exact placement. */
export function isHostileCanvas(w: number, h: number, basis = 120): boolean {
  const axisHostile = (n: number) => gcd2(n, basis) < 8;
  return axisHostile(w) || axisHostile(h);
}

// ── §3c routing hints (the ladder comes first; branching is the last rung) ──

export function routingHint(kind: MosaicGeometryViolation["kind"], allHostile: boolean): string {
  switch (kind) {
    case "size":
    case "position":
      return allHostile
        ? "hostile canvas — if persistent, add a §3c fix#1 per-canvas ratio branch (return a cleanly-dividing m0 for this dim)."
        : "off-grid placement — launder ladder: uniform grid → gutterless grid() + latticeCellInset (retargeted exact insets; gridCellInset is deprecated — ideal-cell fractions wobble ±1px); independent chrome → placeInsetPieces (inset-recovery) or placeOptimizedPieces (drift).";
    case "inset-recovery":
      return "inset recovery did NOT reproduce intent — an ENGINE (applyInsetToRect) or EMITTER (placeInsetRects half-pixel-centering) bug. File it; do not paper over.";
    case "mask-scale":
      return "mask bounds distort into the painted box — author the mark as a mask-in-a-cell with bounds = the cell aspect (§3c), or fix the rect aspect.";
    case "min-size":
      return "element clipped below its min — enlarge its cell / raise the font floor; a fixed-font band must not shrink below its glyph run.";
    case "aspect":
      return "realized aspect ≠ intended — pin the cell aspect via the ratio structure, or check the source's fit/pad.";
    case "missing-frame":
      return "no frame matched — expectations drifted from the m0 (paint order / count changed) or a piece was dropped; re-derive expectations from the front door.";
    default:
      return "see feasibility §3c (the launder ladder).";
  }
}

// ── Violation clustering (report by cluster, never row-spam) ──

/** One resolved canvas result (from reading `editor.geometryContract`). */
export type CanvasResult = {
  w: number;
  h: number;
  tier?: string;
  ok?: boolean;
  violations?: MosaicGeometryViolation[];
  floors?: { feasible: boolean; meetsPrecision: boolean; maxSpreadPx: number };
  error?: string;
};

export type ViolationCluster = {
  name?: string;
  kind: MosaicGeometryViolation["kind"];
  axis?: "x" | "y";
  /** Canvases affected by this (piece, kind, axis). */
  count: number;
  maxDeltaPx: number;
  maxCanvas: string;
  minDeltaPx: number;
  minCanvas: string;
  /** Up to 8 example canvases. */
  examples: string[];
  hint: string;
};

/** Group violations across canvases by (piece, kind, axis) — the point is to
 *  PROVE the contract without emitting a row per canvas over a million-pair run. */
export function clusterViolations(results: CanvasResult[]): ViolationCluster[] {
  type G = { name?: string; kind: MosaicGeometryViolation["kind"]; axis?: "x" | "y"; canvases: { wh: string; delta: number; hostile: boolean }[] };
  const map = new Map<string, G>();
  for (const r of results) {
    if (!r.violations || r.violations.length === 0) continue;
    const wh = `${r.w}x${r.h}`;
    const hostile = isHostileCanvas(r.w, r.h);
    for (const v of r.violations) {
      const key = `${v.name ?? "?"}|${v.kind}|${v.axis ?? "-"}`;
      let g = map.get(key);
      if (!g) { g = { name: v.name, kind: v.kind, axis: v.axis, canvases: [] }; map.set(key, g); }
      g.canvases.push({ wh, delta: Math.abs(v.deltaPx ?? 0), hostile });
    }
  }
  const clusters: ViolationCluster[] = [];
  for (const g of map.values()) {
    const bySeverity = [...g.canvases].sort((a, b) => b.delta - a.delta || a.wh.localeCompare(b.wh));
    clusters.push({
      name: g.name,
      kind: g.kind,
      axis: g.axis,
      count: g.canvases.length,
      maxDeltaPx: bySeverity[0].delta,
      maxCanvas: bySeverity[0].wh,
      minDeltaPx: bySeverity[bySeverity.length - 1].delta,
      minCanvas: bySeverity[bySeverity.length - 1].wh,
      examples: g.canvases.slice(0, 8).map((c) => c.wh),
      hint: routingHint(g.kind, g.canvases.every((c) => c.hostile)),
    });
  }
  clusters.sort(
    (a, b) => b.count - a.count || (a.name ?? "").localeCompare(b.name ?? "") || a.kind.localeCompare(b.kind) || (a.axis ?? "").localeCompare(b.axis ?? ""),
  );
  return clusters;
}

// ── Proof report (pure; shared by the gen-script and tested directly) ──

export type ProofFloors = { firstInfeasible: string | null; firstSubPrec: string | null; maxSpread: number; maxSpreadCanvas: string };
export type ProofHostile = { total: number; passed: number; examples: string[] };
export type ProofReportInput = {
  templateId: string;
  specStr: string;
  total: number;
  propsHash: string;
  wallMs: number;
  projectedMs: number;
  tier: ProofTier;
  passes: number;
  /** Only the canvases that violated or errored (a PROVEN run passes an empty array). */
  failures: CanvasResult[];
  floors: ProofFloors;
  hostile: ProofHostile;
};

/** Build the clustered PROVEN/FAILED report markdown. Pure — the gen-script wires
 *  the resolve loop + timing to it; tested directly with synthetic failures. */
export function buildProofReport(input: ProofReportInput): { md: string; proven: boolean } {
  const { templateId, specStr, total, propsHash, wallMs, projectedMs, tier, failures, floors, hostile } = input;
  const proven = failures.length === 0;
  const errored = failures.filter((f) => f.error);
  const clusters = clusterViolations(failures);

  const out: string[] = [];
  out.push(`# Geometry proof — ${templateId}\n`);
  out.push("> Auto-generated by `gen-geometry-proof` (sloth tier; NOT in the merge gate).\n");
  out.push(`- **set:** ${specStr} · **|canvases|** ${total.toLocaleString()}`);
  out.push(`- **props hash:** \`${propsHash}\``);
  out.push(`- **wall:** ${(wallMs / 1000).toFixed(1)}s · **estimator projected** ${(projectedMs / 1000).toFixed(1)}s (${tier})`);
  out.push("");
  if (proven) out.push(`## ✅ PROVEN — all ${total.toLocaleString()} canvases meet the contract\n`);
  else out.push(`## ❌ FAILED — ${failures.length.toLocaleString()} of ${total.toLocaleString()} canvases violate\n`);

  if (clusters.length > 0) {
    out.push("### Failure clusters (grouped by piece · kind · axis)\n");
    out.push("| piece | kind | axis | canvases | Δpx (min…max) | example canvases | routing |");
    out.push("|---|---|---|---:|---|---|---|");
    for (const c of clusters) {
      out.push(
        `| ${c.name ? `\`${c.name}\`` : "—"} | ${c.kind} | ${c.axis ?? "—"} | ${c.count} | ${c.minDeltaPx}…${c.maxDeltaPx} (worst @ ${c.maxCanvas}) | ${c.examples.join(", ")}${c.count > c.examples.length ? " …" : ""} | ${c.hint} |`,
      );
    }
    out.push("");
  }
  if (errored.length > 0) {
    out.push(`### Resolve errors (${errored.length})\n`);
    for (const e of errored.slice(0, 12)) out.push(`- \`${e.w}x${e.h}\` — ${e.error}`);
    if (errored.length > 12) out.push(`- …and ${errored.length - 12} more`);
    out.push("");
  }

  out.push("### Floors summary\n");
  out.push(`- **infeasible canvases:** ${floors.firstInfeasible ? `first at ${floors.firstInfeasible}` : "none"}`);
  out.push(`- **sub-precision canvases:** ${floors.firstSubPrec ? `first at ${floors.firstSubPrec}` : "none"}`);
  out.push(`- **max quantization spread:** ${floors.maxSpread.toFixed(1)}px${floors.maxSpreadCanvas ? ` @ ${floors.maxSpreadCanvas}` : ""}`);
  out.push("");

  out.push("### Hostile-degradation ledger\n");
  out.push(
    `- ${hostile.total.toLocaleString()} hostile canvas(es) (prime / coprime axis; heuristic gcd(dim,120)<8) — ` +
      `${hostile.passed.toLocaleString()} passed via exact-placement degradation (expected).`,
  );
  if (hostile.examples.length) out.push(`- examples: ${hostile.examples.join(", ")}${hostile.total > hostile.examples.length ? " …" : ""}`);
  out.push("");

  return { md: out.join("\n") + "\n", proven };
}

// ── Layout envelope — per-invariant "where does it hold?" (pure) ──

/** One swept canvas: which `label|rule` invariants were violated there. */
export type EnvelopeSample = { w: number; h: number; violated: string[] };

export type InvariantEnvelope = {
  /** `label|rule`. */
  key: string;
  label: string;
  rule: string;
  /** Canvases (by ascending min-dim) where it holds / breaks. */
  holdCount: number;
  breakCount: number;
  /** Monotone "breaks below/above a scale" boundary when detectable; else null. */
  boundary: string | null;
  /** Up to 6 example break canvases. */
  examples: string[];
};

const minDim = (s: { w: number; h: number }): number => Math.min(s.w, s.h);
const wh = (s: { w: number; h: number }): string => `${s.w}x${s.h}`;

/**
 * From per-canvas violation samples, compute — for every invariant that broke
 * anywhere — the canvas range where it holds vs breaks, with a boundary when the
 * break region is monotone (breaks below/above a scale). PURE.
 */
export function computeEnvelopes(samples: EnvelopeSample[]): InvariantEnvelope[] {
  const sorted = [...samples].sort((a, b) => minDim(a) - minDim(b) || a.w - b.w || a.h - b.h);
  const keys = new Set<string>();
  for (const s of samples) for (const k of s.violated) keys.add(k);

  const envs: InvariantEnvelope[] = [];
  for (const key of keys) {
    const sep = key.indexOf("|");
    const label = sep >= 0 ? key.slice(0, sep) : key;
    const rule = sep >= 0 ? key.slice(sep + 1) : "";
    const breaks = sorted.filter((s) => s.violated.includes(key));
    const holds = sorted.filter((s) => !s.violated.includes(key));

    let boundary: string | null = null;
    if (breaks.length && holds.length) {
      const maxBreak = Math.max(...breaks.map(minDim));
      const minBreak = Math.min(...breaks.map(minDim));
      const maxHold = Math.max(...holds.map(minDim));
      const minHold = Math.min(...holds.map(minDim));
      if (maxBreak < minHold) boundary = `breaks ≤ ${maxBreak}px, holds ≥ ${minHold}px`;
      else if (minBreak > maxHold) boundary = `holds ≤ ${maxHold}px, breaks ≥ ${minBreak}px`;
    } else if (holds.length === 0) {
      boundary = "breaks across the whole sweep";
    }

    envs.push({
      key, label, rule,
      holdCount: holds.length,
      breakCount: breaks.length,
      boundary,
      examples: breaks.slice(0, 6).map(wh),
    });
  }
  return envs.sort((a, b) => b.breakCount - a.breakCount || a.key.localeCompare(b.key));
}

/** The `LAYOUT-ENVELOPE.md` body for one template's sweep. Pure. */
export function buildEnvelopeReport(templateId: string, sweepDesc: string, samples: EnvelopeSample[]): string {
  const envs = computeEnvelopes(samples);
  const fullyOk = samples.filter((s) => s.violated.length === 0).length;
  const out: string[] = [];
  out.push(`# Layout envelope — ${templateId}\n`);
  out.push(`> Auto-generated by \`gen-layout-envelope\`. Sweep: ${sweepDesc} · ${samples.length} canvases · resolve-only, no ffmpeg.\n`);
  out.push(`- **Fully satisfied** at ${fullyOk}/${samples.length} swept canvases.\n`);

  if (envs.length === 0) {
    out.push(`## ✅ Every declared invariant held at every swept canvas.\n`);
    return out.join("\n") + "\n";
  }

  out.push(`## ⚠ Invariants that break somewhere (${envs.length})\n`);
  out.push("| invariant | holds | breaks | boundary | example break canvases |");
  out.push("|---|---:|---:|---|---|");
  for (const e of envs) {
    out.push(
      `| \`${e.label}\` · ${e.rule} | ${e.holdCount} | ${e.breakCount} | ${e.boundary ?? "mixed (see examples)"} | ${e.examples.join(", ")}${e.breakCount > e.examples.length ? " …" : ""} |`,
    );
  }
  out.push("");
  out.push("_A monotone boundary (`breaks ≤ Npx`) means: restrict the template's declared output range to the holding side, or fix the geometry math for the range you need._");
  out.push("");
  return out.join("\n") + "\n";
}
