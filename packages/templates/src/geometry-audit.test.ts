import type { MosaicGeometryViolation } from "@m0saic/types";
import {
  matrixCanvases,
  proofCanvases,
  proofCanvasCount,
  proofSeedCanvases,
  projectProofTime,
  verdictTier,
  isHostileCanvas,
  routingHint,
  clusterViolations,
  buildProofReport,
  computeEnvelopes,
  buildEnvelopeReport,
  type CanvasResult,
  type ProofReportInput,
  type EnvelopeSample,
} from "./geometry-audit";

describe("geometry-audit — matrix canvases", () => {
  it("includes the hostile tier + dedupes, and appends declared outputHints", () => {
    const set = matrixCanvases({ width: 480, height: 480 });
    const has = (w: number, h: number) => set.some((c) => c.w === w && c.h === h);
    expect(has(1920, 1080)).toBe(true);
    expect(has(386, 277)).toBe(true); // the audit aspect that bit
    expect(has(480, 480)).toBe(true); // declared
    expect(set.find((c) => c.w === 480)?.tier).toBe("declared");
    // no duplicates
    expect(new Set(set.map((c) => `${c.w}x${c.h}`)).size).toBe(set.length);
  });

  it("declared outputHints already in a tier is not duplicated", () => {
    const set = matrixCanvases({ width: 1920, height: 1080 });
    expect(set.filter((c) => c.w === 1920 && c.h === 1080).length).toBe(1);
  });
});

describe("geometry-audit — proof canvas set", () => {
  it("explicit list", () => {
    expect([...proofCanvases({ canvases: "480x480,386x277" })]).toEqual([[480, 480], [386, 277]]);
    expect(proofCanvasCount({ canvases: "480x480,386x277" })).toBe(2);
  });

  it("cartesian range with step", () => {
    const got = [...proofCanvases({ range: "240:480x240:480", step: 120 })];
    expect(got).toEqual([
      [240, 240], [240, 360], [240, 480],
      [360, 240], [360, 360], [360, 480],
      [480, 240], [480, 360], [480, 480],
    ]);
    expect(proofCanvasCount({ range: "240:480x240:480", step: 120 })).toBe(9);
  });

  it("count matches iteration for a big range (no materialization)", () => {
    const spec = { range: "240:3840x240:2160", step: 1 };
    // 3601 × 1921 — never iterated here, just projected.
    expect(proofCanvasCount(spec)).toBe(3601 * 1921);
  });

  it("aspect × scale sweep", () => {
    const got = [...proofCanvases({ ar: "16:9,1:1", scales: "1080:1080", scaleStep: 120 })];
    expect(got).toEqual([[1920, 1080], [1080, 1080]]);
    expect(proofCanvasCount({ ar: "16:9,1:1", scales: "1080:1080", scaleStep: 120 })).toBe(2);
  });

  it("auto-seed picks smallest/mid/largest from the bounds (no full iteration)", () => {
    // Range bounds → corners + midpoint, cheaply.
    expect(proofSeedCanvases({ range: "240:3840x240:2160", step: 1 })).toEqual([
      [240, 240], [2040, 1200], [3840, 2160],
    ]);
    // List → by area.
    expect(proofSeedCanvases({ canvases: "480x480,386x277,1920x1080" })).toEqual([
      [386, 277], [480, 480], [1920, 1080],
    ]);
  });
});

describe("geometry-audit — estimator projection", () => {
  it("projects count × (resolve + parse) + overhead", () => {
    expect(projectProofTime(5, 3, 1000, 50)).toBe(1000 * 8 + 50);
    expect(projectProofTime(5, 3, 0)).toBe(50); // default overhead
  });

  it("tiers the projection: quick < 60s ≤ minutes < 10min ≤ sloth", () => {
    expect(verdictTier(projectProofTime(5, 3, 1000)).tier).toBe("quick"); // 8.05s
    expect(verdictTier(projectProofTime(5, 3, 20_000)).tier).toBe("minutes"); // 160s
    expect(verdictTier(projectProofTime(5, 3, 200_000)).tier).toBe("sloth"); // 1600s
    // exact boundaries
    expect(verdictTier(59_999).tier).toBe("quick");
    expect(verdictTier(60_000).tier).toBe("minutes");
    expect(verdictTier(599_999).tier).toBe("minutes");
    expect(verdictTier(600_000).tier).toBe("sloth");
  });
});

describe("geometry-audit — hostile classification", () => {
  it("flags prime / coprime axes, clears the modern lattice", () => {
    expect(isHostileCanvas(386, 277)).toBe(true); // 277 prime
    expect(isHostileCanvas(383, 379)).toBe(true); // both prime
    expect(isHostileCanvas(997, 720)).toBe(true); // 997 prime
    expect(isHostileCanvas(1001, 733)).toBe(true); // coprime pair
    expect(isHostileCanvas(1920, 1080)).toBe(false);
    expect(isHostileCanvas(1080, 1350)).toBe(false); // gcd(1350,120)=30
    expect(isHostileCanvas(1280, 720)).toBe(false); // gcd(1280,120)=40
  });
});

describe("geometry-audit — routing hints", () => {
  it("routes each kind to a §3c rung; hostile size/position → per-canvas branch", () => {
    expect(routingHint("size", false)).toMatch(/launder ladder/);
    expect(routingHint("size", true)).toMatch(/per-canvas ratio branch/);
    expect(routingHint("inset-recovery", false)).toMatch(/ENGINE .* or EMITTER .* bug/);
    expect(routingHint("mask-scale", false)).toMatch(/mask-in-a-cell/);
    expect(routingHint("min-size", false)).toMatch(/clipped below/);
    expect(routingHint("missing-frame", false)).toMatch(/re-derive expectations/);
  });
});

describe("geometry-audit — violation clustering", () => {
  const v = (name: string, kind: MosaicGeometryViolation["kind"], axis: "x" | "y", deltaPx: number): MosaicGeometryViolation => ({
    index: 0, name, kind, axis, intended: { x: 0, y: 0, w: 1, h: 1 }, deltaPx, detail: "",
  });

  it("groups by (piece, kind, axis) with count / severity range / examples / hint", () => {
    const results: CanvasResult[] = [
      { w: 386, h: 277, violations: [v("value-band", "size", "y", -21)] },
      { w: 383, h: 379, violations: [v("value-band", "size", "y", -18)] },
      { w: 480, h: 480, violations: [v("chip", "position", "x", 3)] },
    ];
    const clusters = clusterViolations(results);
    expect(clusters.length).toBe(2);
    // most-affected first: value-band size/y (2 canvases)
    const vb = clusters[0];
    expect(vb.name).toBe("value-band");
    expect(vb.kind).toBe("size");
    expect(vb.axis).toBe("y");
    expect(vb.count).toBe(2);
    expect(vb.maxDeltaPx).toBe(21);
    expect(vb.maxCanvas).toBe("386x277");
    expect(vb.minDeltaPx).toBe(18);
    expect(vb.examples).toEqual(["386x277", "383x379"]);
    // 386×277 and 383×379 are both hostile → per-canvas branch hint.
    expect(vb.hint).toMatch(/per-canvas ratio branch/);
    // the chip cluster (480×480 not hostile) → launder ladder.
    expect(clusters[1].hint).toMatch(/launder ladder/);
  });

  it("caps examples at 8 and stays deterministic", () => {
    const results: CanvasResult[] = Array.from({ length: 12 }, (_, i) => ({
      w: 300 + i, h: 300, violations: [v("bar", "size", "x", -(i + 1))],
    }));
    const [c] = clusterViolations(results);
    expect(c.count).toBe(12);
    expect(c.examples.length).toBe(8);
    // deterministic: same input → same output
    expect(clusterViolations(results)).toEqual([c]);
  });

  it("ignores clean results (no violations)", () => {
    expect(clusterViolations([{ w: 480, h: 480, ok: true, violations: [] }])).toEqual([]);
  });
});

describe("geometry-audit — proof report builder", () => {
  const base: Omit<ProofReportInput, "failures" | "passes"> = {
    templateId: "@m0saic/demo/card/v1",
    specStr: "range 240:406x240:406 step 1",
    total: 100,
    propsHash: "deadbeef",
    wallMs: 1234,
    projectedMs: 1500,
    tier: "quick",
    floors: { firstInfeasible: null, firstSubPrec: null, maxSpread: 0, maxSpreadCanvas: "" },
    hostile: { total: 40, passed: 40, examples: ["241x241"] },
  };

  it("PROVEN report — no cluster table", () => {
    const { md, proven } = buildProofReport({ ...base, passes: 100, failures: [] });
    expect(proven).toBe(true);
    expect(md).toMatch(/## ✅ PROVEN — all 100 canvases meet the contract/);
    expect(md).not.toMatch(/Failure clusters/);
    expect(md).toMatch(/Hostile-degradation ledger/);
  });

  it("FAILED report — clustered table with piece · kind · axis · Δpx · routing", () => {
    const v = (name: string, kind: MosaicGeometryViolation["kind"], axis: "x" | "y", deltaPx: number): MosaicGeometryViolation => ({
      index: 0, name, kind, axis, intended: { x: 0, y: 0, w: 1, h: 1 }, deltaPx, detail: "",
    });
    const failures: CanvasResult[] = [
      { w: 386, h: 277, ok: false, violations: [v("value-band", "size", "y", -21)] },
      { w: 383, h: 379, ok: false, violations: [v("value-band", "size", "y", -18)] },
      { w: 401, h: 251, error: "boom" },
    ];
    const { md, proven } = buildProofReport({ ...base, passes: 97, failures });
    expect(proven).toBe(false);
    expect(md).toMatch(/## ❌ FAILED — 3 of 100 canvases violate/);
    // the clustered failure row
    expect(md).toMatch(/\| `value-band` \| size \| y \| 2 \| 18…21 \(worst @ 386x277\) \| 386x277, 383x379 \| .*per-canvas ratio branch/);
    // errors surfaced separately
    expect(md).toMatch(/### Resolve errors \(1\)/);
    expect(md).toMatch(/`401x251` — boom/);
  });
});

describe("geometry-audit — layout envelope", () => {
  it("finds the monotone break boundary (breaks below a scale)", () => {
    const samples: EnvelopeSample[] = [
      { w: 386, h: 386, violated: ["photo|gutter-target"] },
      { w: 500, h: 500, violated: ["photo|gutter-target"] },
      { w: 540, h: 540, violated: ["photo|gutter-target"] },
      { w: 720, h: 720, violated: ["photo|gutter-target"] },
      { w: 1000, h: 1000, violated: [] },
      { w: 1024, h: 1024, violated: [] },
      { w: 1080, h: 1080, violated: [] },
    ];
    const envs = computeEnvelopes(samples);
    expect(envs.length).toBe(1);
    const e = envs[0];
    expect(e.key).toBe("photo|gutter-target");
    expect(e.label).toBe("photo");
    expect(e.rule).toBe("gutter-target");
    expect(e.breakCount).toBe(4);
    expect(e.holdCount).toBe(3);
    expect(e.boundary).toBe("breaks ≤ 720px, holds ≥ 1000px");
    expect(e.examples).toEqual(["386x386", "500x500", "540x540", "720x720"]);
  });

  it("flags an invariant that breaks across the whole sweep", () => {
    const samples: EnvelopeSample[] = [
      { w: 400, h: 400, violated: ["hero|min-width-frac"] },
      { w: 800, h: 800, violated: ["hero|min-width-frac"] },
    ];
    const [e] = computeEnvelopes(samples);
    expect(e.holdCount).toBe(0);
    expect(e.boundary).toBe("breaks across the whole sweep");
  });

  it("ignores invariants that hold everywhere (they don't appear)", () => {
    const samples: EnvelopeSample[] = [
      { w: 480, h: 480, violated: [] },
      { w: 1080, h: 1080, violated: [] },
    ];
    expect(computeEnvelopes(samples)).toEqual([]);
  });

  it("report — boundary table + fully-satisfied count", () => {
    const samples: EnvelopeSample[] = [
      { w: 720, h: 720, violated: ["grid|missing-label"] },
      { w: 1080, h: 1080, violated: [] },
    ];
    const md = buildEnvelopeReport("@m0saic/demo/collage/v1", "ar 1:1 × scales 240:1080", samples);
    expect(md).toMatch(/# Layout envelope — @m0saic\/demo\/collage\/v1/);
    expect(md).toMatch(/Fully satisfied\*\* at 1\/2/);
    expect(md).toMatch(/\| `grid` · missing-label \| 1 \| 1 \| breaks ≤ 720px, holds ≥ 1080px \| 720x720 \|/);
  });

  it("report — all-green when nothing breaks", () => {
    const md = buildEnvelopeReport("@t", "matrix", [{ w: 1, h: 1, violated: [] }]);
    expect(md).toMatch(/Every declared invariant held at every swept canvas/);
  });
});
