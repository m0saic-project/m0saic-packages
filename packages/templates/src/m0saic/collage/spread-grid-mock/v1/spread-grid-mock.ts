import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/collage/spread-grid-mock/v1 — layout-contract dogfood (mock)
 * ============================================================================
 *
 * A precursor to the image-collage packer. It "just returns a doc with a known
 * spread grid": a fixed 6×4 grid baked @1920×1080 whose cells QUANTIZE (widths
 * 258–300px, heights 241–250px — 6 distinct sizes). Every cell is tagged
 * `"cell"` and the template declares the image-sheet invariant — uniform
 * thumbnails (`{ label: "cell", equal: "size" }`) — via the LAYOUT contract.
 *
 * With `debugLayout: true` the contract catches the spread
 * (`equal-width` 14% > 2%, `equal-height` 3.6% > 2%), and this is the first
 * `debugLayout` adopter, so `npm run audit:layout-envelope` sweeps it and reports
 * the canvas range where the uniform-grid invariant holds vs breaks. It is
 * `internal` — a fixed resolution-dependent grid (the §3c anti-pattern), kept
 * out of the curated shelves; the real image-collage regenerates its layout and
 * SEARCHES for one that holds.
 * ============================================================================
 */
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { definePropsSchema, registerTemplate, withLayoutContract } from "@m0saic/template-utils";
import { SPREAD_GRID_M0 } from "./grid-fixture";

type SpreadGridMockProps = {
  /** Dev-only: run the layout contract and stamp `editor.layoutContract`. */
  debugLayout?: boolean;
  /** Uniform-size tolerance (fraction). Default 0.02 — the grid's spread exceeds it. */
  equalTolerance?: number;
};

const TEMPLATE_ID = "@m0saic/collage/spread-grid-mock/v1";
/** The saved grid is a 6×4 = 24-cell sheet. */
const CELL_COUNT = 24;

const propsSchema = definePropsSchema<SpreadGridMockProps>({
  equalTolerance: {
    type: "number",
    required: false,
    description: "Uniform-size tolerance (fraction of the metric). Default 0.02.",
    meta: { ui: { label: "Equal tolerance", order: 1 } },
  },
  debugLayout: {
    type: "boolean",
    required: false,
    description:
      "Dev-only layout contract view: renders the contract wireframe instead of the grid — cells GREEN with the measured rule when uniform, offenders RED with the violation when not; stamps editor.layoutContract either way. Deterministic default false; production never sets it.",
    meta: { ui: { label: "Debug layout", order: 2, collapsedByDefault: true } },
  },
});

export const SpreadGridMock: MosaicTemplate<SpreadGridMockProps> = {
  id: asTemplateId(TEMPLATE_ID),
  label: "Spread Grid (layout-contract mock)",
  version: 1,
  internal: true, // fixed resolution-dependent grid — dogfood only, keep off the shelves
  // The mock's m0 is a saved editor fixture whose 6×4 grid deliberately sits on a
  // rough basis (335 = 5·67 cols, 221 = 13·17 rows) — the §3c anti-pattern this
  // template exists to exhibit for the layout contract. Declared, not fixed.
  lattice: {
    allow: [
      { count: 335, reason: "fixed 1920×1080 fixture grid — the quantizing anti-pattern the layout contract demonstrates catching" },
      { count: 221, reason: "fixed 1920×1080 fixture grid — the quantizing anti-pattern the layout contract demonstrates catching" },
    ],
  },
  description:
    "Mock precursor to the image-collage: a fixed 6×4 grid that quantizes, tagged for the layout contract's uniform-thumbnail invariant. The first debugLayout adopter (audit:layout-envelope).",
  capabilities: { tier: "core" },
  tags: ["developer", "collage", "mock", "layout-contract"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    equalTolerance: 0.02,
    debugLayout: false,
  },

  async render(props: SpreadGridMockProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    // Every cell is the same lavfi tile, tagged "cell" — the label the contract
    // keys off. Order is moot (all identical); it aligns to the 24 grid frames.
    const cell: MosaicLavfiSource = {
      type: "lavfi",
      color: "#161b22",
      editor: { label: "cell" },
    } as unknown as MosaicLavfiSource;
    const sources: MosaicSource[] = Array.from({ length: CELL_COUNT }, () => ({ ...cell }));

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: SPREAD_GRID_M0 as never,
      sources,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
      size: { width: W, height: H },
    };

    // The image-sheet invariant: every thumbnail the same size. Falsy debug →
    // returns `doc` untouched at zero cost; true → checks + stamps.
    return withLayoutContract(doc, ctx, {
      templateId: TEMPLATE_ID,
      relations: [{ label: "cell", equal: "size", tolerance: props.equalTolerance ?? 0.02 }],
      debug: props.debugLayout === true,
    });
  },
};

registerTemplate(SpreadGridMock);
