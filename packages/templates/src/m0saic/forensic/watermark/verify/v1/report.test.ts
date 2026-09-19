import { describe, expect, it } from "@jest/globals";
import { validateM0String } from "@m0saic/dsl";
import type { ForensicWatermarkCheckReport } from "@m0saic/types";

import { alpineTheme } from "../../../../alpine/_shared/alpine-theme";
import { buildReportCard, footnoteText, verdictPresentation } from "./report";

const theme = alpineTheme("light");

const BASE: ForensicWatermarkCheckReport = {
  ok: true,
  recoveredHex: "deadbeef",
  expectedHex: "deadbeef",
  matches: true,
  correctedBitCount: 3,
  errorPositions: [7, 41, 99],
  worstAbsScore: 4.72,
  framesSampled: 36,
  mode: "id32",
  verdict: "pass",
  grid: { cols: 64, rows: 36 },
  ecc: { n: 127, k: 36, t: 15 },
  videoPath: "/renders/stamped.mp4",
  sidecarPath: "/renders/stamped.watermark.json",
};

const card = (report: ForensicWatermarkCheckReport, over = {}) =>
  buildReportCard({
    report,
    theme,
    W: 1600,
    H: 1000,
    title: "Watermark check",
    showPayload: true,
    videoAssetId: "verify_input",
    posterFrameMs: 0,
    inputCaption: "1920×1080 · 30 fps · 12.4 s",
    ...over,
  });

describe("verdictPresentation", () => {
  it("gives each verdict its own colour", () => {
    const colors = (["pass", "mismatch", "fail", "error"] as const).map(
      (v) => verdictPresentation(v, theme).color,
    );
    // pass/mismatch/fail must be visually distinct; error reuses the fail red
    // deliberately (both are "something is wrong"), so 3 distinct colours.
    expect(new Set(colors).size).toBe(3);
    expect(colors[0]).toBe(theme.positive);
    expect(colors[2]).toBe(theme.negative);
  });

  it("keeps mismatch out of the fail red", () => {
    expect(verdictPresentation("mismatch", theme).color).not.toBe(
      verdictPresentation("fail", theme).color,
    );
  });

  it("leads every headline with the verdict word", () => {
    expect(verdictPresentation("pass", theme).headline).toMatch(/^PASS/);
    expect(verdictPresentation("mismatch", theme).headline).toMatch(/^MISMATCH/);
    expect(verdictPresentation("fail", theme).headline).toMatch(/^FAIL/);
    expect(verdictPresentation("error", theme).headline).toMatch(/^ERROR/);
  });
});

describe("footnoteText — always says why", () => {
  it("surfaces the error message on an error verdict", () => {
    const t = footnoteText({
      ...BASE,
      verdict: "error",
      error: { code: "SIDECAR_NOT_FOUND", message: "Sidecar not found: /r/x.json" },
    });
    expect(t).toContain("/r/x.json");
  });

  it("explains a fail with the score and the ECC budget", () => {
    const t = footnoteText({ ...BASE, ok: false, verdict: "fail", worstAbsScore: 0.31 });
    expect(t).toContain("0.31");
    expect(t).toContain("15-bit budget");
  });

  it("names the no-energy case on a presence fail (the un-marked original)", () => {
    const t = footnoteText({ ...BASE, ok: false, verdict: "fail", worstAbsScore: 0, meanAbsScore: 0 });
    expect(t).toContain("No watermark energy");
    expect(t).toContain("un-marked original");
  });

  it("lists corrected codeword positions on a clean decode", () => {
    expect(footnoteText(BASE)).toContain("7, 41, 99");
  });

  it("caps the position list and counts the remainder", () => {
    const many = { ...BASE, errorPositions: Array.from({ length: 20 }, (_, i) => i) };
    expect(footnoteText(many)).toContain("+8 more");
  });

  it("says so when nothing needed correcting", () => {
    expect(footnoteText({ ...BASE, correctedBitCount: 0, errorPositions: [] })).toContain(
      "corrected no bits",
    );
  });
});

describe("buildReportCard", () => {
  it("emits a valid m0 string for every verdict", () => {
    for (const verdict of ["pass", "mismatch", "fail", "error"] as const) {
      const node = card({ ...BASE, verdict });
      const res = validateM0String(node.m0);
      expect({ verdict, ok: res.ok }).toEqual({ verdict, ok: true });
    }
  });

  it("emits sources in DFS order: painted canvas, then the band", () => {
    // The kit builds m0 and sources together, so source order must match
    // the DSL's depth-first walk or every cell paints the wrong thing. The
    // canvas is a painted base (gate 35: through a .mosaicx wrapper the doc's
    // backgroundColor is dropped and unpainted rows came out black).
    const node = card(BASE);
    const canvas = node.sources[0] as { type?: string };
    const band = node.sources[1] as { type?: string };
    const headline = node.sources[2] as { type?: string; layers?: Array<{ content?: { text?: string } }> };
    expect(canvas.type).toBe("lavfi"); // the canvas base
    expect(band.type).toBe("lavfi"); // the full-bleed band colour
    expect(headline.type).toBe("text");
    expect(headline.layers?.[0]?.content?.text).toMatch(/^PASS/);
    expect(node.m0.startsWith("F{")).toBe(true); // base{card}
  });

  it("keeps the m0 compact — small weight bases, not pixel weights", () => {
    // weightedSplit makes cell count equal the weight sum, so pixel-weighted
    // insets balloon the DSL. Guardrail against that regressing.
    const node = card(BASE);
    expect(node.m0.length).toBeLessThan(4000);
  });

  it("references the input video exactly once, seeked to the poster frame", () => {
    const node = card(BASE, { posterFrameMs: 2500 });
    const media = node.sources.filter((s) => (s as { type?: string }).type === "media");
    expect(media).toHaveLength(1);
    expect((media[0] as { playback?: { clipStartMs?: number } }).playback?.clipStartMs).toBe(2500);
  });

  it("drops the media source when there is no input", () => {
    const node = card(BASE, { videoAssetId: undefined });
    expect(node.sources.filter((s) => (s as { type?: string }).type === "media")).toHaveLength(0);
  });

  it("redacts payload hexes when showPayload is off", () => {
    const shown = JSON.stringify(card(BASE, { showPayload: true }).sources);
    const hidden = JSON.stringify(card(BASE, { showPayload: false }).sources);
    expect(shown).toContain("deadbeef");
    expect(hidden).not.toContain("deadbeef");
    expect(hidden).toContain("••••beef");
  });

  it("blanks decode-derived values in the pending (preview) state", () => {
    const node = card(BASE, { pending: true });
    const json = JSON.stringify(node.sources);
    // The frame count and recovered payload are only knowable after a real
    // sample — a preview must not imply it has them.
    expect(json).not.toContain("36 frames");
    expect(json).not.toContain('"36"');
  });

  it("honours a band override without touching the rest of the card", () => {
    const node = card(BASE, {
      pending: true,
      bandOverride: { color: theme.muted, headline: "NOT CHECKED — run Make" },
    });
    expect(JSON.stringify(node.sources)).toContain("NOT CHECKED");
  });

  it("stays valid at a squarer aspect", () => {
    const node = buildReportCard({
      report: BASE,
      theme,
      W: 1000,
      H: 1000,
      title: "t",
      showPayload: true,
      posterFrameMs: 0,
    });
    expect(validateM0String(node.m0).ok).toBe(true);
  });
});
