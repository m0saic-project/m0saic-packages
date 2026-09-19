/**
 * ============================================================================
 * dsl-tutorial — inspector projection (live X/Y/W/H/Z + Kind/Status)
 * ============================================================================
 *
 * Projects the deterministic `Step[]` into the ffmpeg expressions the inspector
 * panel renders against the GLOBAL clock — so the values mutate in lockstep with
 * the geometry walk, the camera, and the step pill (no local clock).
 *
 * Two depth-safe mechanisms (both keep the panel well under the ~25 overlay
 * mask-drop limit):
 *
 *  - **Numeric fields (X/Y/W/H/Z)** — ONE `drawtext` expr per field: a
 *    piecewise-constant `%{eif:…}` over `t` that prints the active node's value.
 *    No per-step overlay stacking (which would blow the depth limit on a big
 *    walk); a single text layer that "reads out" the value as the parser moves.
 *
 *  - **Kind / Status chips** — a handful of enable-gated text variants (one per
 *    DISTINCT kind / status), each lit over the union of its step windows. Only
 *    a few distinct values, so depth stays ~3.
 *
 * Plus a git-diff "just changed" PULSE per field: a soft alpha expr (filter
 * context) that flashes once on each step where that field's value mutated
 * (`before != after`), decaying over the step — the cue that a value is "new".
 *
 * Escaping: `drawtext` `%{eif:…}` text needs commas escaped as `\,` and colons
 * as `\:` (the `eifText` wrapper does this). Overlay `alpha`/`enable` exprs are
 * FILTER context — raw commas. The two never mix.
 * ============================================================================
 */

import type { Step, InspectorField } from "./buildSteps";
import type { Timing } from "./timing";

export type InspectorFieldExpr = {
  name: InspectorField;
  /** Value variants: one per DISTINCT value, each gated over the union of the
   *  windows where the field holds that value. The panel renders these as
   *  enable-gated LAYERS of one video text source (the narration-collapse idiom).
   *  Replaces the old single `%{eif:…}` expression, which hit drawtext's ~80-
   *  boundary parser ceiling on dense grids (10×10 → ~100 changes → crash). */
  valueVariants: ChipVariant[];
  /** Filter-context ENABLE expr (nonzero = the "just changed" pulse is lit) — the
   *  union of the step windows where this field mutated. Drives the pulse tile's
   *  `overlay.enable` (a per-frame gate on the overlay), NOT `overlay.alpha`: a
   *  time-varying alpha becomes a per-PIXEL `geq`, and 8 fields × a dense-grid
   *  alpha expr overflowed the inspector filtergraph ("Cannot allocate memory").
   *  Enable gates the whole tile per frame — no geq — at a fixed tile alpha. */
  changeEnable: string;
};

export type ChipVariant = {
  label: string;
  /** Filter-context enable expr (nonzero = shown). */
  enableExpr: string;
};

export type InspectorProjection = {
  fields: InspectorFieldExpr[];
  kindVariants: ChipVariant[];
  statusVariants: ChipVariant[];
  /** "cols" / "rows" enable windows for the split N refers to — tags the arity. */
  axisVariants: ChipVariant[];
};

const FIELDS: InspectorField[] = ["X", "Y", "W", "H", "Z", "N", "R", "C"];
/** Max change-pulse enable windows per field — bounds the overlay `enable=` expr
 *  regardless of grid density (a dense grid changes a field ~once per tile). The
 *  pulse is a subtle value-changed flash that fires near-constantly on a dense
 *  walk, so an evenly-spaced subset reads identically. */
const PULSE_TERM_CAP = 32;

const f3 = (n: number): string => n.toFixed(3);

/**
 * The live value as enable-gated VARIANTS: one per DISTINCT value, each gated
 * over the union of windows where the field holds that value. A field's value is
 * piecewise-constant over `t` (holds the root value through the lead, then steps
 * to each new value at its step start); we build those segments and group them by
 * value. Because a value repeats (a grid's X cycles 0,tileW,2·tileW,… every row),
 * the distinct-value count is ≪ the change count, so this stays a handful of
 * variants even on a dense grid — one gated LAYER each, no giant `%{eif}` expr.
 */
function valueVariantsFor(
  steps: Step[],
  timing: Timing,
  field: InspectorField,
): ChipVariant[] {
  // Boundaries: { tStart, v } — only where the value actually changes.
  const bounds: { tStart: number; v: number }[] = [];
  // Step 0 (the lead, before step 1) shows the root's own value — the unparsed
  // canvas — so the very first split visibly mutates it.
  if (steps.length > 0 && steps[0].fields[field].before != null) {
    bounds.push({ tStart: 0, v: Math.round(steps[0].fields[field].before as number) });
  }
  for (const s of steps) {
    const v = Math.round(s.fields[field].after);
    if (bounds.length === 0 || bounds[bounds.length - 1].v !== v) {
      bounds.push({ tStart: timing.stepStartSec(s.index), v });
    }
  }
  const endT = timing.durationMs / 1000;
  if (bounds.length === 0) return [{ label: "0", enableExpr: `(gte(t,0.000)*lt(t,${f3(endT)}))` }];

  // Each boundary segment [tStart_k, tStart_{k+1 or end}) holds value v_k; group
  // segments by value into disjoint windows, merging contiguous ones.
  const byValue = new Map<number, { a: number; b: number }[]>();
  const order: number[] = [];
  for (let k = 0; k < bounds.length; k++) {
    const a = bounds[k].tStart;
    const b = k + 1 < bounds.length ? bounds[k + 1].tStart : endT;
    if (b <= a) continue;
    let list = byValue.get(bounds[k].v);
    if (!list) {
      list = [];
      byValue.set(bounds[k].v, list);
      order.push(bounds[k].v);
    }
    const last = list[list.length - 1];
    if (last && Math.abs(last.b - a) < 1e-6) last.b = b; // contiguous → extend
    else list.push({ a, b });
  }
  return order.map((v) => ({
    label: String(v),
    enableExpr: byValue
      .get(v)!
      .map((r) => `(gte(t,${f3(r.a)})*lt(t,${f3(r.b)}))`)
      .join("+"),
  }));
}

/** ENABLE windows for the "just changed" pulse — the union of step windows where
 *  the field mutated. On/off over each step (no decay), applied as the pulse
 *  tile's `overlay.enable` (per-frame, cheap) rather than a per-pixel `geq` alpha.
 *  `N` additionally pulses on EVERY count-read step, so reading a split count is
 *  never a visual no-op even when the count repeats (e.g. an 8×8 grid). */
function changeEnable(
  steps: Step[],
  timing: Timing,
  field: InspectorField,
): string {
  const terms: string[] = [];
  for (const s of steps) {
    const d = s.fields[field];
    // Internal fields pulse on the event that "reads" them even if the value
    // repeats, so the engine-state read is never a visual no-op: N/R on a count,
    // C on a passthrough or leaf (donate / claim).
    const forcePulse =
      ((field === "N" || field === "R") && s.eventType === "count") ||
      (field === "C" && (s.eventType === "passthrough" || s.eventType === "emitLeaf"));
    if (!forcePulse && (d.before == null || d.before === d.after)) continue; // dedupe steady fields
    const a = timing.stepStartSec(s.index);
    const b = a + timing.stepDurSec;
    if (b <= a) continue;
    terms.push(`(gte(t,${f3(a)})*lt(t,${f3(b)}))`);
  }
  if (terms.length === 0) return "0";
  // Cap + decimate: the enable joins the overlay's `enable=` in the filtergraph,
  // so keep it bounded regardless of grid density (see PULSE_TERM_CAP).
  const capped =
    terms.length > PULSE_TERM_CAP
      ? Array.from(
          { length: PULSE_TERM_CAP },
          (_v, i) => terms[Math.floor((i * terms.length) / PULSE_TERM_CAP)],
        )
      : terms;
  // Windows are disjoint → the sum is a clean 0/1 gate.
  return capped.join("+");
}

/** Merge each step's `label` into disjoint [start,end) ranges, OR'd into an enable expr. */
function variantsFor(
  steps: Step[],
  timing: Timing,
  labelOf: (s: Step) => string,
): ChipVariant[] {
  // Per label → merged ranges (collapse consecutive same-label steps). The walk's
  // FINAL step (index === total) runs to the end of the video, so the chips hold
  // their final state through the trail (they used to blank out for the closing
  // hold while the canvas + values kept theirs). A filtered step list (the axis
  // chip only sees split-focused steps) is NOT extended past its own last step —
  // the arity tag must stay blank once the walk is back at the root (N = 0).
  const lastIndex = steps.length > 0 ? steps[0].total : 0;
  const endT = timing.durationMs / 1000;
  const ranges = new Map<string, { a: number; b: number }[]>();
  for (const s of steps) {
    const label = labelOf(s);
    const a = timing.stepStartSec(s.index);
    const b = s.index === lastIndex ? Math.max(a + timing.stepDurSec, endT) : a + timing.stepDurSec;
    const list = ranges.get(label) ?? [];
    const last = list[list.length - 1];
    if (last && Math.abs(last.b - a) < 1e-6) last.b = b; // contiguous → extend
    else list.push({ a, b });
    ranges.set(label, list);
  }
  const out: ChipVariant[] = [];
  for (const [label, list] of ranges) {
    const enableExpr = list
      .map((r) => `(gte(t,${f3(r.a)})*lt(t,${f3(r.b)}))`)
      .join("+");
    out.push({ label, enableExpr });
  }
  return out;
}

// Short, chip-safe kind names (full "Passthrough" overflows the chip → "Pass").
const KIND_LABEL: Partial<Record<NonNullable<Step["kind"]>, string>> = {
  passthrough: "Pass",
};
const kindLabel = (s: Step): string =>
  s.kind
    ? KIND_LABEL[s.kind] ?? s.kind.charAt(0).toUpperCase() + s.kind.slice(1)
    : "Node";

const STATUS: Record<Step["eventType"], string> = {
  count: "Count",
  enter: "Split",
  sibling: "Next",
  emitLeaf: "Leaf",
  exit: "Close",
  passthrough: "Pass",
  null: "Null",
  overlay: "Overlay",
};
const statusLabel = (s: Step): string => STATUS[s.eventType] ?? "Step";

/** Build the full inspector projection (field exprs + Kind/Status chip variants). */
export function buildInspectorProjection(
  steps: Step[],
  timing: Timing,
): InspectorProjection {
  const fields: InspectorFieldExpr[] = FIELDS.map((name) => ({
    name,
    valueVariants: valueVariantsFor(steps, timing, name),
    changeEnable: changeEnable(steps, timing, name),
  }));
  return {
    fields,
    kindVariants: variantsFor(steps, timing, kindLabel),
    statusVariants: variantsFor(steps, timing, statusLabel),
    // Only steps that sit inside (or read) a split carry an axis — root steps
    // (no split in focus) are excluded so the tag is blank there.
    axisVariants: variantsFor(
      steps.filter((s) => s.axisInFocus),
      timing,
      (s) => (s.axisInFocus === "col" ? "cols" : "rows"),
    ),
  };
}
