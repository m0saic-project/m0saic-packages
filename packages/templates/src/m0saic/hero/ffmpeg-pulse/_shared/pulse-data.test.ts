import {
  MOCK_FFMPEG_PULSE,
  compactNum,
  signedPct,
  monthDay,
  periodLabel,
  kpiValue,
  kpiDelta,
  resolvePulse,
  type WeeklyPulse,
} from "./pulse-data";
import type { MosaicEngineContext } from "@m0saic/types";

describe("resolvePulse — upstream > prop > mock (F5 Seam D)", () => {
  const ctxWith = (weeklyPulse?: unknown): MosaicEngineContext =>
    ({
      mode: "render",
      target: { width: 1920, height: 1080, fps: 30, durationMs: 1000 },
      output: { width: 1920, height: 1080, fps: 30, durationMs: 1000, workspaceDir: "/tmp" },
      media: {},
      ...(weeklyPulse ? { upstreamData: { weeklyPulse } } : {}),
    } as unknown as MosaicEngineContext);
  const propPulse: WeeklyPulse = { ...MOCK_FFMPEG_PULSE, repo: { ...MOCK_FFMPEG_PULSE.repo, name: "PropRepo" } };
  const upstreamPulse: WeeklyPulse = { ...MOCK_FFMPEG_PULSE, repo: { ...MOCK_FFMPEG_PULSE.repo, name: "UpstreamRepo" } };

  it("upstream data wins over both prop and mock", () => {
    expect(resolvePulse(propPulse, ctxWith(upstreamPulse)).repo.name).toBe("UpstreamRepo");
  });
  it("the prop wins over the mock when no upstream is present", () => {
    expect(resolvePulse(propPulse, ctxWith()).repo.name).toBe("PropRepo");
  });
  it("the mock is the final fallback (exact object)", () => {
    expect(resolvePulse(undefined, ctxWith())).toBe(MOCK_FFMPEG_PULSE);
  });
});

describe("pulse-data helpers", () => {
  it("compactNum compacts thousands/millions, passes small through", () => {
    expect(compactNum(127)).toBe("127");
    expect(compactNum(9731)).toBe("9.7K");
    expect(compactNum(18463)).toBe("18.5K");
    expect(compactNum(1_234_567)).toBe("1.2M");
    expect(compactNum(-2200)).toBe("-2.2K");
  });

  it("signedPct signs the value", () => {
    expect(signedPct(18)).toBe("+18%");
    expect(signedPct(-4.3)).toBe("-4.3%");
    expect(signedPct(0)).toBe("+0%");
  });

  it("monthDay + periodLabel format the window without Date()", () => {
    expect(monthDay("2025-05-15")).toBe("May 15");
    expect(periodLabel(MOCK_FFMPEG_PULSE.period)).toBe("May 12 – May 18, 2025");
  });

  it("kpiValue/kpiDelta honor display overrides + missing deltas", () => {
    expect(kpiValue({ key: "a", label: "A", value: 87, display: "+87" })).toBe("+87");
    expect(kpiValue({ key: "a", label: "A", value: 18463 })).toBe("18.5K");
    expect(kpiDelta({ key: "a", label: "A", value: 1, deltaPct: 9 })).toBe("+9%");
    expect(kpiDelta({ key: "a", label: "A", value: 1 })).toBe("");
  });
});

describe("MOCK_FFMPEG_PULSE", () => {
  const m: WeeklyPulse = MOCK_FFMPEG_PULSE;

  it("has the headline KPI grid (API-derivable only)", () => {
    expect(m.kpis.length).toBe(8);
    const keys = m.kpis.map((k) => k.key);
    // The expensive/heuristic storyboard tiles are intentionally absent.
    for (const dropped of ["ciSuccess", "reviewTime", "deployments"]) expect(keys).not.toContain(dropped);
    for (const k of m.kpis) expect(k.label.length).toBeGreaterThan(0);
  });

  it("activity days sum to the total and the peak is the max day", () => {
    const total = m.activity.days.reduce((a, d) => a + d.commits, 0);
    expect(total).toBe(127);
    expect(Math.max(...m.activity.days.map((d) => d.commits))).toBe(m.activity.peak.commits);
  });

  it("changes byArea files sum to totalFiles", () => {
    const sum = m.changes.byArea.reduce((a, s) => a + s.files, 0);
    expect(sum).toBe(m.changes.totalFiles);
  });

  it("contributor rows are rank-ordered with non-negative stats", () => {
    m.contributors.rows.forEach((row, i) => {
      expect(row.rank).toBe(i + 1);
      expect(row.commits).toBeGreaterThanOrEqual(0);
      expect(row.additions).toBeGreaterThanOrEqual(0);
      expect(row.deletions).toBeGreaterThanOrEqual(0);
    });
  });

  it("every beat carries a non-empty stat rail", () => {
    expect(m.activity.rail.length).toBeGreaterThan(0);
    expect(m.contributors.rail.length).toBeGreaterThan(0);
    expect(m.changes.rail.length).toBeGreaterThan(0);
    expect(m.notable.rail.length).toBeGreaterThan(0);
    expect(m.fin.kpiStrip.length).toBeGreaterThan(0);
  });

  it("notable commits have a known kind + 7-char hash", () => {
    for (const c of m.notable.items) {
      // Keep in lockstep with the CommitKind union in pulse-data.ts.
      expect(["feat", "fix", "perf", "docs", "test", "chore"]).toContain(c.kind);
      expect(c.hash.length).toBe(7);
    }
  });
});
