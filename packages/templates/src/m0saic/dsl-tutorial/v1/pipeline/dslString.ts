/**
 * ============================================================================
 * dsl-tutorial — live DSL-string projection (syntax + caret + narration)
 * ============================================================================
 *
 * Projects the deterministic `Step[]` + the m0 source string into what the
 * DSL-string panel renders against the GLOBAL clock:
 *
 *  - **glyphs** — every character of the m0 string classified into a syntax
 *    token type (`count` / `bracket` / `comma` / `passthrough` / `frame` /
 *    `base`), so the panel can colour each one from `theme.syntax`. Classified
 *    lexically with the same rule the parser uses: a digit run followed by `(` or
 *    `[` is a split COUNT; a lone `0` is a PASSTHROUGH; any other digit run / `F`
 *    is a leaf FRAME.
 *
 *  - **caretEnable** — one filter-context enable expr per glyph: nonzero exactly
 *    while the parse cursor sits on that character (the union of the step windows
 *    whose `charIndex` lands there). Drives the stepping caret + active-char wash.
 *    These are SIBLING cells in the panel (aligned 1:1 with the glyph strip), so
 *    no overlay-depth stacking.
 *
 *  - **narration** — enable-gated text variants (one per DISTINCT narration line,
 *    merged over its step windows) for the banner that reads out what each symbol
 *    does. Only the active line is lit.
 *
 * All exprs are FILTER context (raw commas). Deterministic — pure function of the
 * string + timing.
 * ============================================================================
 */

import type { Step } from "./buildSteps";
import type { Timing } from "./timing";
import type { ChipVariant } from "./inspector";
import type { DslSyntaxTheme } from "../theme/tokens";

export type SyntaxType = keyof DslSyntaxTheme;
export type Glyph = { ch: string; type: SyntaxType };

/** One step's caret position in the string + its time window. The panel needs
 *  the raw (charIndex, window) — not just per-glyph enables — to compute the
 *  scroll offset + screen-slot caret when a long string scrolls (the scroll math
 *  depends on the panel's pixel width, which only the panel knows). */
export type CaretStep = { charIndex: number; startSec: number; endSec: number };

export type DslStringProjection = {
  /** The m0 string, one classified glyph per character (display order). */
  glyphs: Glyph[];
  /** Per-glyph filter-context enable expr (nonzero while the cursor is here; "" = never). */
  caretEnable: string[];
  /** Raw per-step caret timeline (drives the scrolling-window math). */
  caretSteps: CaretStep[];
  /** Enable-gated narration lines (one lit at a time). */
  narration: ChipVariant[];
};

const f3 = (n: number): string => n.toFixed(3);
const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/** Classify every character of an m0 string into its syntax token type. */
export function classifyGlyphs(m0: string): Glyph[] {
  const out: Glyph[] = [];
  const n = m0.length;
  let i = 0;
  while (i < n) {
    const ch = m0[i];
    if (isDigit(ch)) {
      let j = i;
      while (j < n && isDigit(m0[j])) j++;
      const run = m0.slice(i, j);
      const next = j < n ? m0[j] : "";
      // A digit run that opens a split (`2(`, `3[`) is a COUNT; a lone `0` is a
      // PASSTHROUGH; anything else (`1`, `2`…) standing alone is a leaf FRAME.
      const type: SyntaxType = next === "(" || next === "[" ? "count" : run === "0" ? "passthrough" : "frame";
      for (let k = i; k < j; k++) out.push({ ch: m0[k], type });
      i = j;
      continue;
    }
    let type: SyntaxType;
    if (ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "{" || ch === "}") type = "bracket";
    else if (ch === ",") type = "comma";
    else if (ch === "-" || ch === ">") type = "passthrough";
    else if (ch === "F") type = "frame";
    else type = "base";
    out.push({ ch, type });
    i++;
  }
  return out;
}

/** Raw per-step caret timeline (charIndex + window) for the scrolling math. */
function caretStepList(steps: Step[], timing: Timing): CaretStep[] {
  return steps.map((s) => {
    const a = timing.stepStartSec(s.index);
    return { charIndex: s.charIndex, startSec: a, endSec: a + timing.stepDurSec };
  });
}

/** Per-glyph enable expr — the union of step windows whose cursor sits there. */
function caretEnableExprs(steps: Step[], timing: Timing, count: number): string[] {
  const windows: { a: number; b: number }[][] = Array.from({ length: count }, () => []);
  for (const s of steps) {
    const i = s.charIndex;
    if (i < 0 || i >= count) continue;
    const a = timing.stepStartSec(s.index);
    const b = a + timing.stepDurSec;
    const list = windows[i];
    const last = list[list.length - 1];
    if (last && Math.abs(last.b - a) < 1e-6) last.b = b; // contiguous → extend
    else list.push({ a, b });
  }
  return windows.map((list) =>
    list.length === 0 ? "" : list.map((r) => `(gte(t,${f3(r.a)})*lt(t,${f3(r.b)}))`).join("+"),
  );
}

/** Merge consecutive identical narration lines into enable-gated variants. The
 *  last line holds through the trail (the closing narration stays on screen for
 *  the end hold, like the canvas + inspector values). */
function narrationVariants(steps: Step[], timing: Timing): ChipVariant[] {
  const lastIndex = steps.length > 0 ? steps[0].total : 0;
  const endT = timing.durationMs / 1000;
  const ranges = new Map<string, { a: number; b: number }[]>();
  const order: string[] = [];
  for (const s of steps) {
    const label = s.narration || " ";
    const a = timing.stepStartSec(s.index);
    const b = s.index === lastIndex ? Math.max(a + timing.stepDurSec, endT) : a + timing.stepDurSec;
    if (!ranges.has(label)) {
      ranges.set(label, []);
      order.push(label);
    }
    const list = ranges.get(label)!;
    const last = list[list.length - 1];
    if (last && Math.abs(last.b - a) < 1e-6) last.b = b;
    else list.push({ a, b });
  }
  return order.map((label) => ({
    label,
    enableExpr: ranges.get(label)!.map((r) => `(gte(t,${f3(r.a)})*lt(t,${f3(r.b)}))`).join("+"),
  }));
}

/** Build the full DSL-string projection (glyphs + caret enables + narration). */
export function buildDslStringProjection(
  steps: Step[],
  timing: Timing,
  m0: string,
): DslStringProjection {
  const glyphs = classifyGlyphs(m0);
  return {
    glyphs,
    caretEnable: caretEnableExprs(steps, timing, glyphs.length),
    caretSteps: caretStepList(steps, timing),
    narration: narrationVariants(steps, timing),
  };
}
