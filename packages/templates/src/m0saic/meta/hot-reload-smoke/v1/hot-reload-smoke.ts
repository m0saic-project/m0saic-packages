import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicTextLayer,
  MosaicTextSource,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  defineMosaicTemplate,
  definePropsSchema,
  makeColorTile,
  registerTemplate,
  solidBackground,
} from "@m0saic/template-utils";

/**
 * `@m0saic/meta/hot-reload-smoke/v1` — the template hot-reload CANARY.
 *
 * A solid color square with the color name printed on it. Deliberately the
 * dumbest renderable in the library: it has no media inputs, no geometry, and
 * no upstream, so when it comes out the wrong color the ONLY explanation is
 * that the app is running stale template code.
 *
 * ## How to use it
 *
 * The fill color is the module constant {@link HOT_RELOAD_SMOKE_COLOR}, NOT a
 * prop default. That distinction is the whole point: changing a prop default
 * can be masked by a prop bag the editor already holds, whereas changing this
 * constant can only show up if the running process re-executed this file.
 *
 * 1. Open `@m0saic/meta/hot-reload-smoke/v1` in Make. It renders RED.
 * 2. Edit `HOT_RELOAD_SMOKE_COLOR` below to `SMOKE_BLUE`.
 * 3. `npm run build:templates`.
 * 4. The desktop app hot-reloads on its own (dev watcher); or click
 *    "Reload templates" in the Make header.
 * 5. Preview and render both turn BLUE with no app restart.
 *
 * If step 5 still shows red, the hot reload is broken — see
 * `apps/mosaic/electron/templateHotReload.js`.
 *
 * `@m0saic/meta/hot-reload-smoke/v1` is `internal` — it's a dev instrument,
 * not a template anyone renders for output.
 */

/** The canary's two colors, exported so tests can pin the exact values. */
export const SMOKE_RED = "#d02020";
export const SMOKE_BLUE = "#2050d0";

/**
 * THE ONE LINE TO FLIP when verifying hot reload. Swap `SMOKE_RED` for
 * `SMOKE_BLUE`, rebuild templates, and the running app must follow.
 */
export const HOT_RELOAD_SMOKE_COLOR: string = SMOKE_RED;

/** Human-readable name for the current constant, printed on the square. */
export function smokeColorLabel(color: string): string {
  if (color === SMOKE_RED) return "RED";
  if (color === SMOKE_BLUE) return "BLUE";
  return color.toUpperCase();
}

export type HotReloadSmokeProps = {
  /**
   * Optional fill OVERRIDE (#rrggbb). Unset — the deterministic default — uses
   * the module constant, which is what makes this a hot-reload canary. Set it
   * only when you want the square in some other color for an unrelated test.
   */
  color?: string;
  /** Print the color name + template id on the square. Default `true`. */
  showLabel?: boolean;
};

const propsSchema = definePropsSchema<HotReloadSmokeProps>({
  color: {
    meta: { constraints: { isColor: true }, control: { placeholder: "module constant HOT_RELOAD_SMOKE_COLOR", colorPicker: true } },
    type: "string",
    required: false,
    description:
      "Optional fill override (#rrggbb). Unset: the HOT_RELOAD_SMOKE_COLOR constant baked into the template source.",
  },
  showLabel: {
    type: "boolean",
    required: false,
    description: "Print the color name and template id on the square.",
  },
});

export const HotReloadSmoke = defineMosaicTemplate<HotReloadSmokeProps>({
  id: asTemplateId("@m0saic/meta/hot-reload-smoke/v1"),
  label: "Hot Reload Smoke (internal)",
  version: 1,
  description:
    "Dev canary for the desktop app's template hot reload: a solid color square whose fill comes from a constant in the template SOURCE (not a prop default), so a rebuilt dist can only show through if the running process re-executed the file. Flip HOT_RELOAD_SMOKE_COLOR red → blue, rebuild, and the app must follow without a restart.",
  capabilities: { tier: "core" },
  tags: ["developer", "meta", "fixture", "internal"],
  internal: true,

  outputHints: {
    width: 720,
    height: 720,
    fps: 30,
    durationMs: 1000,
    note: "Square canvas — the canary is a solid fill, so the aspect only has to be unmistakable.",
  },

  propsSchema,
  // `color` deliberately absent: its deterministic default is the module
  // constant resolved in render(). Baking it in here would make the default
  // travel in the editor's prop bag, which is exactly the staleness this
  // template exists to detect.
  defaultProps: {
    showLabel: true,
  },

  async render(
    props: HotReloadSmokeProps,
    _ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    if (props.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(props.color)) {
      throw new Error(
        `meta/hot-reload-smoke: color ${JSON.stringify(props.color)} must be a #rrggbb hex color.`,
      );
    }

    const fill = props.color ?? HOT_RELOAD_SMOKE_COLOR;
    const showLabel = props.showLabel ?? true;

    // xExpr / yExpr are ffmpeg drawtext expressions and OVERRIDE hAlign /
    // vAlign, so centering is spelled `(w-text_w)/2` rather than
    // `hAlign: "center"` (which the expr would ignore).
    // Generous fixed sizes — the app fits text wider than the CLI does.
    const layers: MosaicTextLayer[] = [
      {
        content: { kind: "literal", text: smokeColorLabel(fill) },
        style: { fontSize: 96, fontColor: "#ffffff" as MosaicColor },
        placement: { xExpr: "(w-text_w)/2", yExpr: "h*0.44-text_h/2" },
      },
      {
        content: { kind: "literal", text: "hot-reload-smoke/v1" },
        style: { fontSize: 26, fontColor: "#ffffff" as MosaicColor },
        placement: { xExpr: "(w-text_w)/2", yExpr: "h*0.62-text_h/2" },
      },
    ];

    // A text source must carry at least one layer (TEXT_LAYERS_EMPTY), so the
    // label-off variant is a lavfi color tile rather than a text source with
    // an empty layers[] — the canonical solid-fill route either way.
    const source = showLabel
      ? ({
          type: "text",
          visual: { backgroundColor: solidBackground(fill as MosaicColor) },
          layers,
        } as MosaicTextSource)
      : makeColorTile(solidBackground(fill as MosaicColor));

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String("F", "hotReloadSmoke"),
      assets: {},
      sources: [source],
    };
  },
});

registerTemplate(HotReloadSmoke);

export default HotReloadSmoke;
