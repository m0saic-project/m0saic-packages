import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplateUpstreamData,
  MosaicTemplateUpstreamVariables,
} from "@m0saic/types";
import { asAliasId, asTemplateId, isAliasId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  defineMosaicTemplate,
  definePropsSchema,
  registerTemplate,
} from "@m0saic/template-utils";

/**
 * `@m0saic/meta/fixture-fetcher/v1` — the capability-layer PROOF fixture.
 *
 * A deterministic, network-free, fs-free stand-in for a real data
 * fetcher (the GitHub fetcher lands in F5). Its only job is to
 * exercise the capability plumbing end-to-end and anchor the
 * regression suites:
 *
 *  - publishes a fixed payload as an aliased `MosaicDataSource` in a
 *    data-only `mosaic_document` (pipeline-step-0 shape);
 *  - when `secretRef` is set, resolves it via `ctx.secrets` (which
 *    only reaches this template because it declares
 *    `tier: "capability"` — the Level 1 gate strips it otherwise) and
 *    publishes a DERIVED, non-secret marker: `{ secretResolved: true,
 *    secretLength }`. Cleartext never enters the document, the
 *    upstream channel, or the sidecar;
 *  - mirrors the published payload to `sidecars` so the jobs / CLI
 *    e2e suites can byte-assert what flowed through the pipeline.
 *
 * The returned doc pairs the data source with a minimal 1-cell black
 * CARRIER (the documented "data + renderable coexistence" shape from
 * `MosaicDataSource`'s contract): a `.mosaicx` wrapper installs the
 * rendered doc as a child behind a `mosaic` ref, and a ref's cell
 * must point at something renderable — a strictly data-only child is
 * unplannable behind a ref today. The carrier renders a black tile;
 * when the owning pipeline step is `intermediate: true` (the intended
 * wiring) that tile never reaches the deliverable. The strictly
 * data-only INLINE step shape (no carrier) is covered by the planner
 * unit tests (clean skip / PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE).
 *
 * Defaults are fully self-contained: no env var, no secret, no
 * network — the default e2e sweep stays green.
 */

/**
 * The fixed deterministic payload published when `payload` is not
 * supplied. The e2e suites byte-assert against this exact object —
 * change it and the sidecar-equality fixtures change with it.
 */
export const FIXTURE_FETCHER_DEFAULT_PAYLOAD = {
  dataset: "m0saic-fixture",
  version: 1,
  series: [3, 5, 8, 13],
  label: "deterministic fixture payload",
} as const;

export type FixtureFetcherProps = {
  /** Alias the data block publishes under. Default `"fixtureData"`. */
  alias?: string;
  /**
   * Payload to publish instead of the built-in fixture object. Must be
   * a plain JSON object (it becomes `MosaicDataSource.variables`).
   */
  payload?: Record<string, unknown>;
  /**
   * Optional `SecretRef` (e.g. `env:M0SAIC_FIXTURE_SECRET`). When set,
   * the ref is resolved via `ctx.secrets` and a derived non-secret
   * marker is published under the `secret` key of the data block.
   * Fails fast when the ref is unresolvable or `ctx.secrets` is absent.
   */
  secretRef?: string;
};

type FixtureFetcherOutputs = {
  dataset: string;
  version: number;
  series: number[];
  label: string;
  secret: { secretResolved: boolean; secretLength: number };
};

type FixtureFetcherSidecars = {
  fixtureData: Record<string, unknown>;
};

const propsSchema = definePropsSchema<FixtureFetcherProps>({
  alias: {
    type: "string",
    required: false,
    description:
      'Alias the published data block appears under in ctx.upstreamData. Default "fixtureData".',
  },
  payload: {
    type: "json",
    required: false,
    description:
      "Plain JSON object to publish instead of the built-in deterministic fixture payload.",
  },
  secretRef: {
    meta: { control: { placeholder: "none" } },
    type: "string",
    required: false,
    description:
      "Optional SecretRef (e.g. env:M0SAIC_FIXTURE_SECRET). Resolved via ctx.secrets; publishes { secretResolved, secretLength } — never cleartext.",
  },
});

export const FixtureFetcher = defineMosaicTemplate<
  FixtureFetcherProps,
  FixtureFetcherOutputs,
  MosaicTemplateUpstreamVariables,
  MosaicTemplateUpstreamData,
  FixtureFetcherSidecars
>({
  id: asTemplateId("@m0saic/meta/fixture-fetcher/v1"),
  label: "Fixture Fetcher (internal)",
  version: 1,
  description:
    "Deterministic capability-layer proof fixture: publishes a fixed payload as an aliased data source (pipeline-step-0 shape) and, when secretRef is set, a derived non-secret marker resolved via ctx.secrets. No network, no fs.",
  role: "data-fetcher",
  capabilities: { tier: "capability", caps: {} },
  tags: ["developer", "meta", "fixture", "data-fetcher", "internal"],
  internal: true,

  outputHints: {
    width: 64,
    height: 64,
    fps: 1,
    durationMs: 1000,
    note: "Publishes upstream variables; renders only a degenerate black carrier tile. Always wrap in a pipeline step with intermediate:true so the carrier never reaches the deliverable.",
  },

  // Documents the DEFAULT payload's shape. All keys optional — a
  // caller-supplied `payload` replaces the object wholesale, and the
  // post-render outputs guard must not fire on legitimate custom
  // payloads.
  outputsSchema: {
    dataset: { type: "string", required: false },
    version: { type: "number", required: false },
    series: { type: "number[]", required: false },
    label: { type: "string", required: false },
    secret: { type: "object", required: false },
  },

  propsSchema,
  defaultProps: {
    alias: "fixtureData",
  },

  async render(
    props: FixtureFetcherProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    // ── Fail-fast prop validation ────────────────────────────────
    const alias = props.alias ?? "fixtureData";
    if (!isAliasId(alias)) {
      throw new Error(
        `meta/fixture-fetcher: alias ${JSON.stringify(alias)} is not a valid AliasId (letter/_ start, alphanumeric, max 64 chars).`,
      );
    }
    if (
      props.payload !== undefined &&
      (props.payload === null ||
        typeof props.payload !== "object" ||
        Array.isArray(props.payload))
    ) {
      throw new Error(
        "meta/fixture-fetcher: payload must be a plain JSON object (MosaicDataSource.variables shape).",
      );
    }

    const published: Record<string, unknown> = {
      ...(props.payload ?? FIXTURE_FETCHER_DEFAULT_PAYLOAD),
    };

    // ── Optional secret resolution → derived non-secret marker ───
    if (props.secretRef !== undefined && props.secretRef !== "") {
      if (!ctx.secrets) {
        throw new Error(
          "meta/fixture-fetcher: secretRef was set but ctx.secrets is absent. " +
            "Either the host threads no secret resolver, or this template lost " +
            'its tier:"capability" declaration (the Level 1 gate strips secrets from core-tier templates).',
        );
      }
      const has = await ctx.secrets.has(props.secretRef);
      if (!has) {
        throw new Error(
          `meta/fixture-fetcher: secretRef ${JSON.stringify(props.secretRef)} did not resolve (resolver.has() === false).`,
        );
      }
      const value = await ctx.secrets.get(props.secretRef);
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(
          `meta/fixture-fetcher: secretRef ${JSON.stringify(props.secretRef)} resolved to an empty value.`,
        );
      }
      // Derived marker only — the cleartext value never leaves this scope.
      published.secret = { secretResolved: true, secretLength: value.length };
    }

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String("1", "fixtureFetcher"),
      assets: {},
      sources: [
        // Degenerate carrier — keeps the doc renderable behind a
        // `.mosaicx` wrapper's mosaic ref (see file-level doc). The
        // data source below is the actual payload channel.
        { type: "lavfi", color: "#000000" as MosaicColor },
        {
          type: "data",
          alias: asAliasId(alias),
          variables: published,
          editor: { owner: "template" },
        },
      ],
      // Mirror to disk so e2e suites can byte-assert the published
      // payload. Sidecar key is fixed (STRICT_IDENTIFIER-safe)
      // regardless of the alias prop.
      sidecars: { fixtureData: published },
    };
  },
});

registerTemplate(FixtureFetcher);

export default FixtureFetcher;
