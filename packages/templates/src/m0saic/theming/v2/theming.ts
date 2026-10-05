/**
 * @m0saic/theming/v2 — the shared design-token PRODUCER.
 *
 * Publishes one {@link ThemeTokens} set (chosen by `preset`) onto the
 * upstream-variables channel (F1 threading): a `type:"data"` source whose
 * `variables` become every downstream step's `ctx.upstreamVariables`. Wrap it
 * as an `intermediate: true` pipeline step ahead of the templates that read
 * the tokens — swapping this one step's `preset` re-skins the whole chain.
 * `@m0saic/meta/upstream-echo/v1` is the read-side smoke fixture.
 *
 * Two modes via `preview`:
 *  - `preview:true` (default) renders a swatch (card surface + palette strip)
 *    so the preset is self-evidencing standalone — and the Phase-6 theme-swap
 *    demo is a three-render diff where only `preset` changes.
 *  - `preview:false` emits a **data-only** doc (just the token block). As an
 *    `intermediate:true` pipeline step the plan builder skips it entirely
 *    (zero render cost) while the tokens still thread downstream — the
 *    production path. It is not renderable standalone (pipeline-only).
 *
 * The token set is the layered m0saic system (see `theme-tokens.ts`): one brand
 * (deep navy + orange, from `App.css :root`), semantic role tokens, and
 * `dark`/`light`/`high-contrast` as MODES of that one brand. `preset` selects
 * the mode. A `dataPalette` ships as a brand default but a content-owning
 * template (e.g. a GitHub pulse) may override it locally.
 */
import type { MosaicDocument } from "@m0saic/types";
import { asTemplateId, isAliasId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  defineMosaicTemplate,
  definePropsSchema,
  publishTheme,
  registerTemplate,
} from "@m0saic/template-utils";
import { resolveTheme, DEFAULT_THEME_MODE, type ThemeMode } from "../v1/theme-tokens";
import { buildTokenSheet } from "../v1/token-sheet";

type ThemingV2Props = {
  /** Which token set to publish + preview. */
  preset: ThemeMode;
  /** Upstream alias the token block publishes under. Default `"theme"`. */
  alias: string;
  /**
   * `true` (default): render the swatch preview — for eyeballing tokens
   * standalone. `false`: emit a **data-only** doc (just the published token
   * block, no cells). A data-only doc is valid ONLY as an
   * `intermediate: true` pipeline step — the plan builder then skips it
   * cleanly (zero render cost) while its tokens still thread downstream.
   * Rendering `preview:false` standalone is intentionally an error.
   */
  preview: boolean;
};

const propsSchema = definePropsSchema<ThemingV2Props>({
  preset: {
    type: "string",
    required: false,
    meta: {
      constraints: { oneOf: ["dark", "light", "high-contrast"] },
    },
  },
  alias: {
    type: "string",
    required: false,
    meta: { ui: { consumer: "agent" } },
  },
  preview: {
    type: "boolean",
    required: false,
  },
});

export const ThemingV2 = defineMosaicTemplate<ThemingV2Props>({
  id: asTemplateId("@m0saic/theming/v2"),
  version: 2,
  capabilities: { tier: "core" },
  outputHints: {
    width: 1920,
    height: 1080,
    note: "A single-frame Theme-Tokens sheet (image); the real payload is the published token block on ctx.upstreamVariables.",
    format: { kind: "image", frameCount: 1 },
  },
  propsSchema,
  bindings: {
    unbound: {
      // The key the token block publishes under — data, never drawn.
      alias: "data key",
    },
  },
  defaultProps: {
    preset: DEFAULT_THEME_MODE,
    alias: "theme",
    preview: true,
  },
  render: async (props, ctx): Promise<MosaicDocument> => {
    const preset: ThemeMode = props.preset ?? DEFAULT_THEME_MODE;
    const alias = props.alias ?? "theme";
    const preview = props.preview ?? true;
    if (!isAliasId(alias)) {
      throw new Error(
        `@m0saic/theming: alias ${JSON.stringify(alias)} is not a valid AliasId (letter/_ start, alphanumeric, max 64 chars).`,
      );
    }
    const t = resolveTheme(preset);
    const themeSource = publishTheme(t, { alias });

    // Production path: a data-only doc (no cells). Valid ONLY as an
    // `intermediate: true` pipeline step, where the plan builder skips it
    // (isDataOnlyStep → no commands) while the tokens still thread downstream.
    if (!preview) {
      return {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String("1", "theme"),
        assets: {},
        sources: [themeSource],
        sidecars: { theme: { ...t } },
      };
    }

    // Preview path: the Theme-Tokens sheet at the canvas dims + the token
    // block on the side-channel.
    const W = ctx.target.width;
    const H = ctx.target.height;
    const sheet = buildTokenSheet(t, W, H, preset);
    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(sheet.m0, "themeTokenSheet"),
      backgroundColor: t.surfaceApp,
      assets: {},
      sources: [...sheet.sources, themeSource],
      // A static sheet — emit a single PNG, not a 90-frame video.
      format: { kind: "image", frameCount: 1 },
      // Mirror the published tokens for byte-assertable e2e verification.
      sidecars: { theme: { ...t } },
    };
  },
});

registerTemplate(ThemingV2);

export default ThemingV2;
