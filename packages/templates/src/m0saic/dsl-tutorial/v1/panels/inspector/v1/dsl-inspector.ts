/**
 * ============================================================================
 * @m0saic/dsl-tutorial/inspector/v1 — live geometry inspector (internal)
 * ============================================================================
 *
 * The IDE's right-hand inspector: the active node's Kind/Status chips over a
 * grid of X/Y/W/H/Z fields whose values MUTATE as the parser walks — driven by
 * per-field `%{eif:…}` exprs on the global clock (see pipeline/inspector.ts), so
 * they move in lockstep with the canvas highlight + camera + step pill.
 *
 * Each field that changes on a step gets a git-diff "just changed" pulse: a soft
 * positive-coloured pill behind the value, flashing once and decaying. Depth-safe
 * by construction — one text layer per value (not one per step), a few
 * enable-gated chip variants, one pulse layer per row.
 *
 * Width-fitted (gate 33): every font is picked from the row height AND capped by
 * its cell under the CLI width model — the value cell by the LONGEST value the
 * walk ever shows, the chips by the longest chip label ("Overlay"), the captions
 * by their cells — so a narrow (portrait) panel shrinks its type instead of
 * clipping "1080" to "80". Rows are capped to the panel WIDTH (a tall portrait
 * panel keeps proportionate rows + bottom slack, not 140px rows), and the
 * section rule is sized in px so a tiny panel never quantizes it to a 0-size
 * frame (the 480×270 crash). Text sources are tagged for the parent's contract.
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicEngineContext,
  MosaicDocument,
  MosaicTemplate,
  MosaicTextSource,
  MosaicColor,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { definePropsSchema, registerTemplate, tag } from "@m0saic/template-utils";

import type { Node } from "../../../_shared/node-kit";
import {
  EMPTY,
  paint,
  rowSplit,
  colSplit,
  overlay,
  textCell,
  colorTile,
} from "../../../_shared/node-kit";
import { dslTutorialTheme } from "../../../theme/tokens";
import type { DslTutorialPreset, DslTutorialTheme } from "../../../theme/tokens";
import type {
  InspectorFieldExpr,
  ChipVariant,
} from "../../../pipeline/inspector";
import { CAPS_EM, DIGIT_EM, PROSE_EM, fitBudget, fitFontPx, fitFontPxAll, textWidthPx } from "../../../_shared/text-fit";

export type DslInspectorProps = {
  preset?: DslTutorialPreset;
  /** Per-field value + change-pulse exprs (global clock). */
  fields?: InspectorFieldExpr[];
  /** Enable-gated Kind chip variants. */
  kindVariants?: ChipVariant[];
  /** Enable-gated Status chip variants. */
  statusVariants?: ChipVariant[];
  /** Enable-gated "cols"/"rows" variants — tags the N (arity) row. */
  axisVariants?: ChipVariant[];
};

const propsSchema = definePropsSchema<DslInspectorProps>({
  preset: { type: "string", required: false, description: "Theme preset." },
  fields: { type: "json", required: false, description: "Per-field value + change exprs." },
  kindVariants: { type: "json", required: false, description: "Kind chip variants (enable-gated)." },
  statusVariants: { type: "json", required: false, description: "Status chip variants (enable-gated)." },
  axisVariants: { type: "json", required: false, description: "cols/rows chip variants for the N row (enable-gated)." },
});

/** The live value as ONE video text source whose enable-gated LAYERS are the
 *  distinct values (the narration-collapse idiom): a literal per value, lit over
 *  its windows. Only one is visible at a time, so stacking them at the same
 *  placement is free. Replaces a per-frame `%{eif:…}` expr — that single
 *  expression hit drawtext's ~80-boundary parser ceiling on dense grids. */
function valueText(
  variants: ChipVariant[],
  fontSize: number,
  color: MosaicColor,
  hAlign: "left" | "center" | "right",
): MosaicTextSource {
  const layers = (variants.length ? variants : [{ label: " ", enableExpr: "1" }]).map((v) => ({
    content: { kind: "literal" as const, text: v.label || " " },
    style: { fontSize, fontColor: color },
    placement: { fit: "contain", hAlign, vAlign: "middle" } as never,
    overlay: { enable: v.enableExpr },
  }));
  return {
    type: "text",
    // VIDEO: per-layer enable=… is evaluated per frame (a still would freeze at t=0).
    renderMode: { kind: "video" },
    visual: { backgroundColor: "black@0" },
    layers,
  } as MosaicTextSource;
}

/** A literal text cell that is only visible while `enableExpr` is nonzero. */
function enableText(
  label: string,
  enableExpr: string,
  fontSize: number,
  color: MosaicColor,
): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: label || " " },
        style: { fontSize, fontColor: color },
        placement: { fit: "contain", hAlign: "center", vAlign: "middle" } as never,
      },
    ],
    overlay: { enable: enableExpr },
  } as MosaicTextSource;
}

/** Horizontal padding helper (safe — never subdivides a thin height). */
function hpad(node: Node, left: number, mid: number, right: number): Node {
  return colSplit([
    { weight: left, node: EMPTY },
    { weight: mid, node },
    { weight: right, node: EMPTY },
  ]);
}

/** A rounded chip holding stacked enable-gated label variants (only one lit). */
function chip(
  variants: ChipVariant[],
  theme: DslTutorialTheme,
  font: number,
  ink: MosaicColor,
): Node {
  const bg = paint(
    colorTile(theme.surfaceRaised, {
      cornerRadius: 0.34,
      cornerStyle: "rounded",
      border: { color: theme.border, width: 0.006, alpha: theme.borderAlpha },
    }),
  );
  const labels = (variants ?? []).map((v) =>
    paint(tag(enableText(v.label, v.enableExpr, font, ink), "chip")),
  );
  return overlay([bg, hpad(overlay(labels.length ? labels : [EMPTY]), 1, 8, 1)]);
}

/** Internal-state field names — shown below the divider (engine bookkeeping,
 *  not properties of the single rect). */
const INTERNAL_FIELDS = new Set(["N", "R", "C"]);

/** Section divider column weights (basis 100): pad · caption · gap · rule · pad. */
const SECTION_COLS = { pad: 4, caption: 38, gap: 2, rule: 52 };
/** Inspector row column weights (basis 64): pad · label · gap · axis chip · gap · value · pad. */
const ROW_COLS = { pad: 4, label: 12, gap1: 2, axis: 14, gap2: 4, value: 24 };
/** Title row column weights (basis 72): pad · INSPECTOR · gap · kind chip · gap · status chip · pad. */
const TITLE_COLS = { pad: 4, title: 26, gap1: 4, chip: 16, gap2: 2 };
/** hpad(…, 1, 8, 1) / hpad(…, 1, 10, 1): the text gets the middle 8/10 (chips) or 10/12 (values). */
const CHIP_INNER_FRAC = 0.8;
const VALUE_INNER_FRAC = 10 / 12;
/** Row height cap as a fraction of the panel WIDTH — a tall portrait panel keeps
 *  proportionate rows (+ bottom slack) instead of stretching them to fill. */
const ROW_H_MAX_OF_W = 0.3;
/** Section rule: a 1-unit hairline in a band quantized at ≥ RULE_PX_PER_UNIT px
 *  per unit — the engine's floor quantization can zero a unit under ~1px (the
 *  480×270 / 704×396 "0-size frame" refusals), and the band's own px shifts ±1
 *  between the child's slot and the flattened parent, so the granularity is
 *  chosen from the band, never assumed. A band too short for 3 such units (pad
 *  · rule · pad) gets the caption only. */
const RULE_PX_PER_UNIT = 2.5;

/** A labelled section divider: a small muted caption + a thin rule line sized in
 *  px against its band (never a 0-size frame). */
function sectionDivider(label: string, theme: DslTutorialTheme, font: number, bandH: number, captionW: number): Node {
  const units = Math.floor(bandH / RULE_PX_PER_UNIT);
  const above = Math.floor((units - 1) / 2);
  const rule =
    units >= 3
      ? rowSplit([
          { weight: above, node: EMPTY },
          { weight: 1, node: paint(colorTile(theme.border)) },
          { weight: units - 1 - above, node: EMPTY },
        ])
      : EMPTY;
  return colSplit([
    { weight: SECTION_COLS.pad, node: EMPTY },
    { weight: SECTION_COLS.caption, node: paint(tag(textCell(captionOrBlank(label, font, captionW), font, theme.muted, "left", "middle"), "section-title")) },
    { weight: SECTION_COLS.gap, node: EMPTY },
    { weight: SECTION_COLS.rule, node: rule },
    { weight: SECTION_COLS.pad, node: EMPTY },
  ]);
}

/** A caption that can't fit its cell even at the floor font paints BLANK (the
 *  rule / chips still identify the row) rather than clipping mid-word. The
 *  blank keeps the source (and its contract label) in place. */
function captionOrBlank(label: string, font: number, availW: number): string {
  return textWidthPx(label, font, CAPS_EM) <= availW ? label : " ";
}

/** The longest label a set of chip variants ever shows (drives the shared chip font). */
function longestLabel(variants: ReadonlyArray<ChipVariant> | undefined): string {
  let best = " ";
  for (const v of variants ?? []) if ((v.label ?? "").length > best.length) best = v.label;
  return best;
}

/**
 * The inspector's type ramp, WIDTH-FITTED: each size starts from the row height
 * (the design) and is capped by its cell + the longest string it must hold under
 * the CLI width model. Exported for the gate-33 locks.
 */
export function inspectorTypeRamp(
  W: number,
  rowH: number,
  fields: ReadonlyArray<InspectorFieldExpr>,
  chips: ReadonlyArray<ChipVariant>,
): { titleFont: number; chipFont: number; labelFont: number; valueFont: number; sectionFont: number; titleW: number; sectionW: number } {
  const titleBasis = TITLE_COLS.pad * 2 + TITLE_COLS.title + TITLE_COLS.gap1 + TITLE_COLS.chip * 2 + TITLE_COLS.gap2;
  const rowBasis = ROW_COLS.pad * 2 + ROW_COLS.label + ROW_COLS.gap1 + ROW_COLS.axis + ROW_COLS.gap2 + ROW_COLS.value;
  const titleW = fitBudget((TITLE_COLS.title / titleBasis) * W);
  const chipW = fitBudget((TITLE_COLS.chip / titleBasis) * W * CHIP_INNER_FRAC);
  const axisChipW = fitBudget((ROW_COLS.axis / rowBasis) * W * CHIP_INNER_FRAC);
  const labelW = fitBudget((ROW_COLS.label / rowBasis) * W);
  const valueW = fitBudget((ROW_COLS.value / rowBasis) * W * VALUE_INNER_FRAC);
  const sectionW = fitBudget((SECTION_COLS.caption / 100) * W);

  const longestValue = fields.reduce((best, f) => {
    const l = longestLabel(f.valueVariants);
    return l.length > best.length ? l : best;
  }, "0");
  const longestField = fields.reduce((best, f) => (f.name.length > best.length ? f.name : best), "X");

  return {
    titleFont: fitFontPx("INSPECTOR", titleW, Math.max(11, Math.round(rowH * 0.34)), 8, CAPS_EM),
    chipFont: fitFontPxAll(
      [
        { text: longestLabel(chips), availW: Math.min(chipW, axisChipW), em: PROSE_EM },
      ],
      Math.max(10, Math.round(rowH * 0.3)),
      7,
    ),
    labelFont: fitFontPx(longestField, labelW, Math.max(12, Math.round(rowH * 0.36)), 8, CAPS_EM),
    valueFont: fitFontPx(longestValue, valueW, Math.max(14, Math.round(rowH * 0.46)), 8, DIGIT_EM),
    sectionFont: fitFontPx("ENGINE STATE", sectionW, Math.max(9, Math.round(rowH * 0.26)), 7, CAPS_EM),
    titleW,
    sectionW,
  };
}

/** One inspector row: `LABEL` (muted) … optional axis tag … value (live expr)
 *  with a change pulse. The axis tag (only the N row passes one) reads "cols" /
 *  "rows" so the arity is qualified — a 2 that means columns vs rows. */
function fieldRow(
  field: InspectorFieldExpr,
  theme: DslTutorialTheme,
  labelFont: number,
  valueFont: number,
  axisChip?: Node,
): Node {
  const label = paint(tag(textCell(field.name, labelFont, theme.label, "left", "middle"), "field-label"));

  // Pulse pill behind the value — positive (git "added") wash, flashing on change.
  // ENABLE-ONLY at a baked-in tile alpha, NOT a time-varying `overlay.alpha`: an
  // alpha expr (or enable folded into alpha) becomes a per-pixel `geq`, and 8
  // fields of that overflowed the inspector filtergraph on dense grids. With the
  // 0.35 alpha baked into the COLOR, `overlay.enable` alone gates the tile per
  // frame — no geq. Square (no rounding) so it needs no corner-mask geq either.
  const pulse = paint({
    ...colorTile(`${theme.positive}@0.35` as MosaicColor),
    overlay: { enable: field.changeEnable },
  } as never);
  const value = paint(tag(valueText(field.valueVariants, valueFont, theme.title, "right"), "field-value"));
  const valueCell = overlay([pulse, hpad(value, 1, 10, 1)]);

  return colSplit([
    { weight: ROW_COLS.pad, node: EMPTY },
    { weight: ROW_COLS.label, node: label },
    { weight: ROW_COLS.gap1, node: EMPTY },
    { weight: ROW_COLS.axis, node: axisChip ?? EMPTY }, // axis tag on N; blank elsewhere
    { weight: ROW_COLS.gap2, node: EMPTY },
    { weight: ROW_COLS.value, node: valueCell },
    { weight: ROW_COLS.pad, node: EMPTY },
  ]);
}

export const DslInspector: MosaicTemplate<DslInspectorProps> = {
  id: asTemplateId("@m0saic/dsl-tutorial/inspector/v1"),
  label: "DSL Tutorial — Inspector",
  version: 1,
  description:
    "Internal: live geometry inspector (X/Y/W/H/Z mutating with the walk + Kind/Status chips) for dsl-tutorial.",
  capabilities: { tier: "core" },
  tags: ["developer", "dsl-tutorial", "internal", "inspector"],
  internal: true,
  outputHints: { width: 480, height: 450, fps: 30, durationMs: 12000, note: "Live geometry inspector." }, // 480×450 not 460×430: 5-smooth axes (latticeSmooth)
  propsSchema,
  defaultProps: { preset: "dark" },

  render(props: DslInspectorProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const theme = dslTutorialTheme(props.preset);
    const W = ctx.target.width;
    const H = ctx.target.height;
    const fields = props.fields ?? [];

    // Row height ≈ panel / (title + one row per field + divider + padding), CAPPED
    // to the panel width so a tall portrait panel keeps proportionate rows (the
    // slack becomes bottom padding). Fonts scale off it AND are width-fitted
    // (inspectorTypeRamp), so adding/removing a field re-fits the grid and a
    // narrow panel never clips a value.
    const contentH = H * 0.96;
    const rowH = Math.min(contentH / (Math.max(1, fields.length) + 4), W * ROW_H_MAX_OF_W);
    const unit = rowH / 12; // px per row-weight unit (a 12-weight band = one row)
    const chips = [...(props.kindVariants ?? []), ...(props.statusVariants ?? []), ...(props.axisVariants ?? [])];
    const { titleFont, chipFont, labelFont, valueFont, sectionFont, titleW, sectionW } = inspectorTypeRamp(W, rowH, fields, chips);

    // Output fields (X/Y/W/H/Z — the one rect) on top; internal engine state
    // (N/R/C) below a labelled divider.
    const outputFields = fields.filter((f) => !INTERNAL_FIELDS.has(f.name));
    const internalFields = fields.filter((f) => INTERNAL_FIELDS.has(f.name));

    // ── Title row: INSPECTOR · Kind chip · Status chip ──
    const titleRow = colSplit([
      { weight: TITLE_COLS.pad, node: EMPTY },
      { weight: TITLE_COLS.title, node: paint(tag(textCell(captionOrBlank("INSPECTOR", titleFont, titleW), titleFont, theme.muted, "left", "middle"), "inspector-title")) },
      { weight: TITLE_COLS.gap1, node: EMPTY },
      { weight: TITLE_COLS.chip, node: chip(props.kindVariants ?? [], theme, chipFont, theme.accent) },
      { weight: TITLE_COLS.gap2, node: EMPTY },
      { weight: TITLE_COLS.chip, node: chip(props.statusVariants ?? [], theme, chipFont, theme.label) },
      { weight: TITLE_COLS.pad, node: EMPTY },
    ]);

    // ── Field grid: OUTPUT (the rect) · divider · INTERNAL (engine state) ──
    // Gap bands are skipped when a weight unit is under a pixel — a 1-unit gap
    // would quantize to a 0-size frame and refuse the whole render.
    const gaps = unit >= 1;
    const rowBands: { weight: number; node: Node }[] = [{ weight: 13, node: titleRow }];
    for (const f of outputFields) {
      if (gaps) rowBands.push({ weight: 2, node: EMPTY }); // gap
      rowBands.push({ weight: 12, node: fieldRow(f, theme, labelFont, valueFont) });
    }
    if (internalFields.length > 0) {
      // "cols"/"rows" tag for the arity row, lit per step from the split in focus.
      const axisChip =
        props.axisVariants && props.axisVariants.length > 0
          ? chip(props.axisVariants, theme, chipFont, theme.muted)
          : undefined;
      if (gaps) rowBands.push({ weight: 5, node: EMPTY }); // section gap
      rowBands.push({ weight: 7, node: sectionDivider("ENGINE STATE", theme, sectionFont, 7 * unit, sectionW) });
      if (gaps) rowBands.push({ weight: 1, node: EMPTY });
      for (const f of internalFields) {
        if (gaps) rowBands.push({ weight: 2, node: EMPTY }); // gap
        rowBands.push({
          weight: 12,
          node: fieldRow(f, theme, labelFont, valueFont, f.name === "N" ? axisChip : undefined),
        });
      }
    }
    rowBands.push({ weight: 3, node: EMPTY }); // bottom pad
    // Slack below the capped rows (portrait) so the rows keep their height.
    const usedUnits = rowBands.reduce((a, b) => a + b.weight, 0);
    const slackUnits = contentH / unit - usedUnits;
    if (slackUnits >= 1) rowBands.push({ weight: slackUnits, node: EMPTY });

    const content = rowSplit(rowBands);

    // Content is FLUSH to the top of the panel rect (so the inspector's first row
    // lines up with the canvas/viewframe top); only a small bottom pad remains.
    const padded = rowSplit([
      { weight: 96, node: content },
      { weight: 4, node: EMPTY },
    ]);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: toM0String(padded.m0, "DslInspector"),
      sources: padded.sources,
      backgroundColor: theme.surface,
    });
  },
};

registerTemplate(DslInspector);
