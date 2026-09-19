import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplateOutputs,
  MosaicTemplateUpstreamData,
  MosaicTemplateUpstreamVariables,
  MosaicTextLayer,
  MosaicTextSource,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  defineMosaicTemplate,
  definePropsSchema,
  getUpstreamBlock,
  getUpstreamVariables,
  listUpstreamAliases,
  registerTemplate,
  bindProps,
} from "@m0saic/template-utils";

/**
 * `@m0saic/meta/upstream-echo/v1` — the consumer half of the
 * capability-layer proof pair (producer: `@m0saic/meta/fixture-fetcher/v1`).
 *
 * Core-tier renderable that:
 *
 *  - reads the aliased data block `ctx.upstreamData[alias]` plus the
 *    flat `ctx.upstreamVariables` union (whatever cross-step /
 *    cross-tile threading delivered);
 *  - renders a SELF-EVIDENCING status card (duration/fps from
 *    `ctx.target` via the define-wrapper stamp): pale-green
 *    background + "UPSTREAM OK" + a deterministic summary of the
 *    received block when the aliased data arrived; red background +
 *    "UPSTREAM MISSING" + what WAS available when it didn't — so a
 *    human eyeballing the rendered tile can read the verdict without
 *    opening the sidecar;
 *  - mirrors EXACTLY what it received into `sidecars.upstreamEcho`,
 *    so e2e suites can byte-assert the data that crossed the
 *    pipeline boundary;
 *  - declares `upstreamVariablesSchema` / `upstreamDataSchema`,
 *    exercising the resolver's VARIABLES_SCHEMA_MISMATCH guard: a
 *    pipeline that wires it after the fixture-fetcher resolves
 *    cleanly; a mis-wired pipeline (no producer, wrong alias, drifted
 *    types) errors at resolve time.
 *
 * Standalone renders (no upstream at all) are also fine — the
 * resolver only checks schemas on invocation paths; the tile then
 * shows the red MISSING card and the sidecar records both channels
 * as absent.
 */

export type UpstreamEchoProps = {
  /** Aliased data block to echo. Default `"fixtureData"`. */
  alias?: string;
  /**
   * Optional background OVERRIDE (#rrggbb). Unset → semantic colors:
   * pale green when the aliased block arrived, red when it didn't.
   */
  color?: string;
};

/** Semantic backgrounds (exported so tests pin the exact values). */
export const UPSTREAM_ECHO_OK_BG = "#d9efd9";
export const UPSTREAM_ECHO_MISSING_BG = "#a03030";

type UpstreamEchoSidecars = {
  upstreamEcho: {
    alias: string;
    upstreamData: Record<string, unknown> | null;
    upstreamVariables: Record<string, unknown> | null;
  };
};

const propsSchema = definePropsSchema<UpstreamEchoProps>({
  alias: {
    type: "string",
    required: false,
    description:
      'Which ctx.upstreamData block to echo into the sidecar. Default "fixtureData".',
  },
  color: {
    meta: { constraints: { isColor: true }, control: { placeholder: "green when found, red when missing", colorPicker: true } },
    type: "string",
    required: false,
    description:
      "Optional background override (#rrggbb). Unset: pale green when the aliased upstream block arrived, red when it didn't.",
  },
});

// U / D stay at the loose defaults: narrowing them would break
// contravariance with `registerTemplate` (which accepts the loose
// form) — a common trade-off for data-fetcher templates. The
// consumed shapes are documented via upstreamVariablesSchema /
// upstreamDataSchema below instead.
export const UpstreamEcho = defineMosaicTemplate<
  UpstreamEchoProps,
  MosaicTemplateOutputs,
  MosaicTemplateUpstreamVariables,
  MosaicTemplateUpstreamData,
  UpstreamEchoSidecars
>({
  id: asTemplateId("@m0saic/meta/upstream-echo/v1"),
  label: "Upstream Echo (internal)",
  version: 1,
  description:
    "Consumer proof fixture: reads ctx.upstreamData[alias] + ctx.upstreamVariables, renders a self-evidencing status card (pale green 'UPSTREAM OK' + block summary, or red 'UPSTREAM MISSING'), and mirrors the received upstream into sidecars.upstreamEcho for byte-assertable verification. Declares upstream schemas to exercise the resolver's schema guard.",
  capabilities: { tier: "core" },
  tags: ["developer", "meta", "fixture", "upstream", "internal"],
  internal: true,

  outputHints: {
    width: 640,
    height: 360,
    fps: 30,
    durationMs: 1000,
    note: "Status-card echo tile (green=upstream OK, red=missing); the byte-assertable payload is the sidecar mirror.",
  },

  // Consumer contracts — exercised by the resolver's schema guard on
  // invocation paths. The fixture-fetcher's DEFAULT payload satisfies
  // the fixtureData block; keys are declared with the types the
  // default payload carries. Flat-union keys stay optional so the
  // echo also renders standalone (no producer) without diagnostics.
  upstreamVariablesSchema: {
    dataset: { type: "string", required: false },
    series: { type: "number[]", required: false },
  },
  upstreamDataSchema: {
    fixtureData: {
      description:
        "Data block published by @m0saic/meta/fixture-fetcher/v1 under its default alias.",
      variables: {
        dataset: { type: "string", required: false },
        version: { type: "number", required: false },
        series: { type: "number[]", required: false },
      },
    },
  },

  propsSchema,
  // `color` deliberately absent: its deterministic default is the
  // SEMANTIC background (green when upstream arrived, red when not),
  // derived in render — a fixed default would defeat the status card.
  defaultProps: {
    alias: "fixtureData",
  },

  async render(
    props: UpstreamEchoProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const alias = props.alias ?? "fixtureData";
    if (props.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(props.color)) {
      throw new Error(
        `meta/upstream-echo: color ${JSON.stringify(props.color)} must be a #rrggbb hex color.`,
      );
    }

    const upstreamData = getUpstreamBlock(ctx, alias) ?? null;
    const upstreamVariables = getUpstreamVariables(ctx) ?? null;

    // ── Self-evidencing status card ─────────────────────────────
    // Green + summary when the aliased block arrived; red + diagnosis
    // when it didn't. All lines deterministic (sorted keys, counts).
    const ok = upstreamData !== null;
    const bg = (props.color ?? (ok ? UPSTREAM_ECHO_OK_BG : UPSTREAM_ECHO_MISSING_BG)) as MosaicColor;
    const fg = (ok && props.color === undefined ? "#1e3a26" : "#fff5f5") as MosaicColor;

    const flatKeyCount = Object.keys(upstreamVariables ?? {}).length;
    const bodyLines = ok
      ? [
          `alias: ${alias}`,
          `block keys: ${Object.keys(upstreamData).sort().join(", ") || "(none)"}`,
          `flat union keys: ${flatKeyCount}`,
        ]
      : [
          `alias: ${alias}`,
          `available blocks: ${listUpstreamAliases(ctx).join(", ") || "(none)"}`,
          `flat union keys: ${flatKeyCount}`,
        ];

    // Generous fixed sizes + margins — app text-fit runs wider than CLI.
    const titleFont = 34;
    const bodyFont = 20;
    const layers: MosaicTextLayer[] = [
      {
        content: { kind: "literal", text: ok ? "UPSTREAM OK" : "UPSTREAM MISSING" },
        style: { fontSize: titleFont, fontColor: fg } as never,
        placement: { hAlign: "left", vAlign: "top", xExpr: "w*0.06", yExpr: "h*0.08" } as never,
      },
      ...bodyLines.map((text, i) => ({
        content: { kind: "literal" as const, text },
        style: { fontSize: bodyFont, fontColor: fg } as never,
        placement: {
          hAlign: "left",
          vAlign: "top",
          xExpr: "w*0.06",
          yExpr: `h*${(0.32 + i * 0.14).toFixed(2)}`,
        } as never,
      })),
    ];

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String("F", "upstreamEcho"),
      assets: {},
      sources: [
        // Layer 1 (`alias: …`) SHOWS the alias prop — bind that layer so Make's
        // double-click edits it in place.
        bindProps({ type: "text", visual: { backgroundColor: bg }, layers } as MosaicTextSource, [
          { propKey: "alias", layer: 1 },
        ]),
      ],
      sidecars: {
        upstreamEcho: {
          alias,
          upstreamData,
          upstreamVariables,
        },
      },
    };
  },
});

registerTemplate(UpstreamEcho);

export default UpstreamEcho;
