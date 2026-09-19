/**
 * The report card: a check result → m0 + sources.
 *
 * Design intent — this render exists to be *read*, usually at a glance
 * and often as a screenshot pasted into a ticket. Two things carry that:
 *
 *  1. A full-bleed status band across the top. It touches the canvas
 *     edge deliberately (which is why this file builds its own chrome
 *     instead of using `alpineCard`, whose `compose()` insets everything
 *     by its padding). Colour reads before any text does.
 *  2. The *reason* is always on the card. A verdict with no explanation
 *     sends the reader back to a terminal, which defeats the point of
 *     rendering a card at all — so the footnote row carries the ECC
 *     diagnostic on a fail, and the actual error text on an error.
 *
 * Geometry follows the construction-strategy hard rule: real m0 cells
 * via the shared Node combinator kit, not one full-frame drawtext. Text
 * goes through the SVG glyph rasterizer (bundled deterministic font, no
 * drawtext spawn, and it gives us font weight, which `textCell` in the
 * Alpine kit does not expose).
 *
 * Weights are SMALL INTEGERS, deliberately
 * ----------------------------------------
 * `weightedSplit` makes a split's cell count equal the sum of its
 * weights, so a "natural" pixel-weighted inset like `[40, 1520, 40]`
 * becomes a 1600-cell split (clamped to 120 by the kit's basis cap, but
 * still 120 cells for one margin). Nest a few of those and the m0 runs
 * to thousands of cells. Every split here therefore uses a small basis,
 * and inner spacing prefers text `placement.padding` over geometry.
 */

import type {
  ForensicWatermarkCheckReport,
  ForensicWatermarkCheckVerdict,
  MosaicColor,
  MosaicSource,
} from "@m0saic/types";
import { makeColorTile } from "@m0saic/template-utils";

import { MIN_PRESENCE_MEAN_ABS_SCORE } from "./decode";

import {
  EMPTY,
  colSplit,
  insetNode,
  overlay,
  paint,
  rowSplit,
  type Node,
} from "../../../../alpine/_shared/alpine-card";
import type { AlpineTheme } from "../../../../alpine/_shared/alpine-theme";

// ── Row weights (small basis; sum 50) ─────────────────────────────
const W_BAND = 7;
const W_HEADER = 5;
const W_BODY = 31;
const W_FOOT = 7;
const H_TOTAL = W_BAND + W_HEADER + W_BODY + W_FOOT;

/** Body columns: input panel vs stats. */
const W_INPUT = 19;
const W_STATS = 31;

type HAlign = "left" | "center" | "right";
type Pad = { top?: number; right?: number; bottom?: number; left?: number };

/**
 * Inset a node by `u` units of a `total`-unit box. Two splits of
 * `total` cells each — keep `total` small (≤ 24).
 */
function inset(node: Node, u: number, total = 24): Node {
  if (u <= 0) return node;
  return insetNode(node, u, u, u, u, total, total);
}

/** One SVG-rasterized text cell. */
function text(
  content: string,
  fontSize: number,
  color: MosaicColor,
  opts: { bold?: boolean; hAlign?: HAlign; padding?: Pad; label: string },
): MosaicSource {
  const placement: Record<string, unknown> = {
    fit: "contain",
    hAlign: opts.hAlign ?? "left",
    vAlign: "middle",
  };
  if (opts.padding) placement.padding = opts.padding;
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: content || " " },
        style: {
          fontSize,
          fontColor: color,
          ...(opts.bold ? { fontWeight: "bold" as const } : {}),
        },
        placement,
      },
    ],
    editor: { owner: "template", label: opts.label },
  } as unknown as MosaicSource;
}

/** Stack of lines in one cell, each row weighted by a small integer. */
function lines(
  entries: Array<{
    text: string;
    fontSize: number;
    color: MosaicColor;
    bold?: boolean;
    weight?: number;
    padding?: Pad;
  }>,
  label: string,
  hAlign: HAlign = "left",
): Node {
  const rows = entries.filter((e) => e.text.trim().length > 0);
  if (rows.length === 0) return EMPTY;
  return rowSplit(
    rows.map((e, i) => ({
      weight: e.weight ?? 1,
      node: paint(
        text(e.text, e.fontSize, e.color, {
          bold: e.bold,
          hAlign,
          padding: e.padding,
          label: `${label}-${i}`,
        }),
      ),
    })),
  );
}

// ── Verdict presentation ──────────────────────────────────────────

/**
 * Four states, four colours. `mismatch` gets its own amber rather than
 * collapsing into the fail red: a clean decode carrying a different
 * payload means the tool worked perfectly and the file simply isn't the
 * copy you expected — operationally the most interesting answer here,
 * and one you should never have to squint at a hex string to notice.
 */
export function verdictPresentation(
  verdict: ForensicWatermarkCheckVerdict,
  theme: AlpineTheme,
): { color: MosaicColor; headline: string } {
  switch (verdict) {
    case "pass":
      return { color: theme.positive, headline: "PASS — payload recovered" };
    case "mismatch":
      return { color: "#F59E0B" as MosaicColor, headline: "MISMATCH — different payload" };
    case "fail":
      return { color: theme.negative, headline: "FAIL — no clean codeword" };
    case "error":
    default:
      return { color: theme.negative, headline: "ERROR — could not run the check" };
  }
}

/**
 * Confidence colour for `worstAbsScore`. Thresholds mirror the
 * troubleshooting guidance shipped with the encoder: ≥3 healthy margin,
 * 1–3 marginal, below 1 the watermark is effectively not present.
 */
function scoreColor(score: number, theme: AlpineTheme): MosaicColor {
  if (score >= 3) return theme.positive;
  if (score >= 1) return theme.label;
  return theme.negative;
}

/** Redact all but the last 4 hex chars. */
function maskHex(hex: string): string {
  if (!hex) return "—";
  return hex.length <= 4 ? "••••" : `••••${hex.slice(-4)}`;
}

function fmtHex(hex: string | undefined, show: boolean): string {
  if (!hex) return "—";
  return show ? hex : maskHex(hex);
}

/** Wrap to `maxChars` and cap at `maxLines`, ellipsizing when truncated. */
export function wrapCapped(s: string, maxChars: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  let consumed = 0;
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      out.push(cur);
      cur = w;
      if (out.length === maxLines) break;
    } else {
      cur = next;
    }
    consumed += 1;
  }
  if (out.length < maxLines && cur) {
    out.push(cur);
    consumed = words.length;
  }
  if (consumed < words.length && out.length) {
    const last = out[out.length - 1]!;
    out[out.length - 1] =
      last.length >= maxChars ? `${last.slice(0, Math.max(1, maxChars - 1))}…` : `${last}…`;
  }
  return out;
}

/** The footnote line — always the *reason*, never just a restatement. */
export function footnoteText(report: ForensicWatermarkCheckReport): string {
  if (report.verdict === "error") {
    return report.error?.message ?? "The check could not run.";
  }
  if (report.verdict === "fail") {
    if (report.meanAbsScore !== undefined && report.meanAbsScore < MIN_PRESENCE_MEAN_ABS_SCORE) {
      return (
        `No watermark energy for this recipe (mean |score| ${report.meanAbsScore.toFixed(2)}) — ` +
        `most likely the un-marked original, or a copy stamped with a different key or grid. ` +
        `Sampled ${report.framesSampled} frame(s).`
      );
    }
    return (
      `No syndrome-clean codeword. Worst |score| ${report.worstAbsScore.toFixed(2)} ` +
      `(below ~1 means no watermark is present, or the channel degraded past ` +
      `BCH's ${report.ecc.t}-bit budget). Sampled ${report.framesSampled} frame(s).`
    );
  }
  const corrected = report.errorPositions.length;
  if (corrected === 0) {
    return `Clean decode — BCH corrected no bits. Sampled ${report.framesSampled} frame(s).`;
  }
  const shown = report.errorPositions.slice(0, 12).join(", ");
  const more = corrected > 12 ? ` +${corrected - 12} more` : "";
  return `BCH corrected ${corrected} bit(s) at codeword index ${shown}${more}.`;
}

// ── Card ──────────────────────────────────────────────────────────

export interface BuildReportCardInputs {
  report: ForensicWatermarkCheckReport;
  theme: AlpineTheme;
  W: number;
  H: number;
  title: string;
  showPayload: boolean;
  /** Asset id of the checked video, when it can be shown. */
  videoAssetId?: string;
  /** Poster frame offset for the input panel. */
  posterFrameMs: number;
  /** Human caption under the poster ("1920×1080 · 30 fps · 12.4 s"). */
  inputCaption?: string;
  /** Overrides the band — used by renderLite for the "not checked" state. */
  bandOverride?: { color: MosaicColor; headline: string };
  /** Blanks the decode-derived tiles (renderLite). */
  pending?: boolean;
}

/** Build the whole card. Returns the root node; caller sets the doc background. */
export function buildReportCard(inputs: BuildReportCardInputs): Node {
  const { report, theme, W, H, showPayload } = inputs;
  const dash = "—";
  const p = inputs.pending;
  const isError = report.verdict === "error";

  // Font sizes track the canvas; geometry does not.
  const bandH = (H * W_BAND) / H_TOTAL;
  const headerH = (H * W_HEADER) / H_TOTAL;
  const bodyH = (H * W_BODY) / H_TOTAL;
  const footH = (H * W_FOOT) / H_TOTAL;

  const gutter: Pad = { left: 0.02, right: 0.02 };

  // ── 1. Status band (full-bleed) ─────────────────────────────
  const band = inputs.bandOverride ?? verdictPresentation(report.verdict, theme);
  const bandFont = Math.max(12, Math.round(bandH * 0.3));
  const statusBand = overlay([
    paint(makeColorTile(band.color)),
    colSplit([
      {
        weight: 3,
        node: paint(
          text(band.headline, bandFont, "#FFFFFF" as MosaicColor, {
            bold: true,
            hAlign: "left",
            padding: { left: 0.05 },
            label: "verdict",
          }),
        ),
      },
      {
        weight: 2,
        node: paint(
          text(
            p || isError ? "" : fmtHex(report.recoveredHex ?? report.expectedHex, showPayload),
            Math.round(bandFont * 0.8),
            "#FFFFFFCC" as MosaicColor,
            { bold: true, hAlign: "right", padding: { right: 0.08 }, label: "verdict-payload" },
          ),
        ),
      },
    ]),
  ]);

  // ── 2. Header ───────────────────────────────────────────────
  const headFont = Math.max(10, Math.round(headerH * 0.28));
  const header = colSplit([
    {
      weight: 7,
      node: lines(
        [
          { text: inputs.title, fontSize: headFont, color: theme.title, bold: true, weight: 3, padding: gutter },
          { text: baseName(report.videoPath), fontSize: Math.round(headFont * 0.76), color: theme.label, weight: 2, padding: gutter },
          { text: baseName(report.sidecarPath), fontSize: Math.round(headFont * 0.68), color: theme.muted, weight: 2, padding: gutter },
        ],
        "header",
      ),
    },
    {
      weight: 3,
      node: lines(
        [
          { text: "m0saic · forensic", fontSize: Math.round(headFont * 0.7), color: theme.muted, padding: gutter },
          { text: "spatio-temporal-ab-bch", fontSize: Math.round(headFont * 0.6), color: theme.muted, padding: gutter },
        ],
        "brand",
        "right",
      ),
    },
  ]);

  // ── 3. Body ─────────────────────────────────────────────────
  const cardTile = (): Node =>
    paint(
      makeColorTile(theme.card, {
        effects: {
          rounding: { cornerStyle: "rounded", borderRadius: theme.cornerRadius * 0.5 },
          stroke: {
            position: "inner",
            width: 0.002,
            color: theme.border,
            alpha: theme.borderAlpha,
          },
        },
      }),
    );

  // Input panel — poster frame + caption. The video is a media source
  // with a clipStartMs seek, so on a still output this costs no extra
  // ffmpeg pass.
  const posterNode: Node = inputs.videoAssetId
    ? paint({
        type: "media",
        mediaType: "video",
        assetId: inputs.videoAssetId,
        placement: { fit: "contain" },
        playback: { clipStartMs: Math.max(0, Math.round(inputs.posterFrameMs)) },
      } as unknown as MosaicSource)
    : paint(
        text("no input", Math.round(bodyH * 0.06), theme.muted, {
          hAlign: "center",
          label: "no-input",
        }),
      );

  const inputPanel = overlay([
    cardTile(),
    inset(
      rowSplit([
        { weight: 4, node: posterNode },
        {
          weight: 1,
          node: paint(
            text(inputs.inputCaption ?? dash, Math.round(bodyH * 0.05), theme.muted, {
              hAlign: "center",
              label: "input-caption",
            }),
          ),
        },
      ]),
      1,
      20,
    ),
  ]);

  // Stat tiles — 2 rows × 3.
  const tileLabelFont = Math.max(9, Math.round(bodyH * 0.045));
  const tileValueFont = Math.max(12, Math.round(bodyH * 0.08));

  const tile = (label: string, value: string, valueColor: MosaicColor, key: string): Node =>
    overlay([
      cardTile(),
      inset(
        rowSplit([
          {
            weight: 2,
            node: paint(
              text(label, tileLabelFont, theme.muted, {
                hAlign: "left",
                padding: { left: 0.06 },
                label: `${key}-l`,
              }),
            ),
          },
          {
            weight: 3,
            node: paint(
              text(value, tileValueFont, valueColor, {
                bold: true,
                hAlign: "left",
                padding: { left: 0.06 },
                label: `${key}-v`,
              }),
            ),
          },
        ]),
        1,
        18,
      ),
    ]);

  const tiles = rowSplit([
    {
      weight: 1,
      node: colSplit([
        { weight: 1, node: tile("MODE", report.grid.cols ? report.mode : dash, theme.title, "mode") },
        {
          weight: 1,
          node: tile("FRAMES SAMPLED", p || isError ? dash : String(report.framesSampled), theme.title, "frames"),
        },
        {
          weight: 1,
          node: tile(
            "CORRECTED BITS",
            p || isError ? dash : `${report.correctedBitCount} / ${report.ecc.t}`,
            theme.title,
            "corrected",
          ),
        },
      ]),
    },
    {
      weight: 1,
      node: colSplit([
        {
          weight: 1,
          node: tile(
            "WORST |SCORE|",
            p || isError ? dash : report.worstAbsScore.toFixed(2),
            p || isError ? theme.title : scoreColor(report.worstAbsScore, theme),
            "score",
          ),
        },
        {
          weight: 1,
          node: tile(
            "GRID",
            report.grid.cols ? `${report.grid.cols} × ${report.grid.rows}` : dash,
            theme.title,
            "grid",
          ),
        },
        {
          weight: 1,
          node: tile(
            // n/k/t, not "BCH(127, 36, 15)" — the label already says ECC,
            // and the parenthesised form overruns the tile at tile widths.
            "ECC",
            report.ecc.n ? `${report.ecc.n}/${report.ecc.k}/${report.ecc.t}` : dash,
            theme.title,
            "ecc",
          ),
        },
      ]),
    },
  ]);

  // Payload strip — the money rows.
  const stripLabelFont = Math.max(9, Math.round(bodyH * 0.05));
  const stripValueFont = Math.max(12, Math.round(bodyH * 0.095));
  const payloadRow = (label: string, value: string, color: MosaicColor, key: string): Node =>
    colSplit([
      {
        weight: 3,
        node: paint(
          text(label, stripLabelFont, theme.muted, {
            hAlign: "left",
            padding: { left: 0.12 },
            label: `${key}-l`,
          }),
        ),
      },
      {
        weight: 7,
        node: paint(
          text(value, stripValueFont, color, { bold: true, hAlign: "left", label: `${key}-v` }),
        ),
      },
    ]);

  const recoveredColor: MosaicColor =
    report.verdict === "pass"
      ? theme.positive
      : report.verdict === "mismatch"
        ? ("#F59E0B" as MosaicColor)
        : theme.negative;

  const payloadStrip = overlay([
    cardTile(),
    inset(
      rowSplit([
        {
          weight: 1,
          node: payloadRow("EXPECTED", fmtHex(report.expectedHex, showPayload), theme.title, "expected"),
        },
        {
          weight: 1,
          node: payloadRow(
            "RECOVERED",
            p || isError ? dash : fmtHex(report.recoveredHex, showPayload),
            p || isError ? theme.title : recoveredColor,
            "recovered",
          ),
        },
      ]),
      1,
      20,
    ),
  ]);

  const body = colSplit([
    { weight: W_INPUT, node: inputPanel },
    {
      weight: W_STATS,
      node: rowSplit([
        { weight: 3, node: tiles },
        { weight: 2, node: payloadStrip },
      ]),
    },
  ]);

  // ── 4. Footnote — the reason ────────────────────────────────
  const footFont = Math.max(9, Math.round(footH * 0.2));
  const footColor = isError ? theme.negative : theme.muted;
  const footLines = p
    ? ["Select a video and run Make to sample it."]
    : wrapCapped(footnoteText(report), Math.max(48, Math.round(W / (footFont * 0.52))), 3);
  const footnote = lines(
    footLines.map((t) => ({ text: t, fontSize: footFont, color: footColor, padding: gutter })),
    "footnote",
  );

  const card = rowSplit([
    { weight: W_BAND, node: statusBand },
    { weight: W_HEADER, node: header },
    { weight: W_BODY, node: body },
    { weight: W_FOOT, node: footnote },
  ]);
  // The canvas is REAL geometry — a painted base under the card — not
  // `doc.backgroundColor`. Through a `.mosaicx` wrapper (Make, the ledger
  // twins) the child doc's backgroundColor is dropped, and the header /
  // footnote rows (text cells on nothing) came out on black (gate-35
  // catch; the stat-card gate hit the same class).
  return overlay([paint(makeColorTile(theme.canvas)), card]);
}

/** Basename without pulling in `node:path` (this file stays IO-free). */
function baseName(p: string): string {
  if (!p) return "—";
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
