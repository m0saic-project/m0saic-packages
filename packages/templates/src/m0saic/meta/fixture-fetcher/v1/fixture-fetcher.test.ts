// covers: @m0saic/meta/fixture-fetcher/v1 — deterministic data-only
// publish, secretRef → derived marker (never cleartext), fail-fast paths.
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { isMosaicDataSource } from "@m0saic/types";
import { createEnvSecretResolver } from "@m0saic/platform/secrets";
import {
  FixtureFetcher,
  FIXTURE_FETCHER_DEFAULT_PAYLOAD,
} from "./fixture-fetcher";

const SECRET_ENV = "M0SAIC_FIXTURE_FETCHER_TEST_SECRET";
const SECRET_VALUE = "hunter2-hunter2";

function makeCtx(overrides: Partial<MosaicEngineContext> = {}): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 320, height: 180, fps: 30, durationMs: 1000, workspaceDir: "/tmp" },
    target: { width: 320, height: 180, fps: 30, durationMs: 1000 },
    media: {},
    ...overrides,
  } as MosaicEngineContext;
}

function ctxWithEnvSecrets(): MosaicEngineContext {
  return makeCtx({ secrets: createEnvSecretResolver() } as Partial<MosaicEngineContext>);
}

describe("@m0saic/meta/fixture-fetcher/v1", () => {
  beforeEach(() => {
    process.env[SECRET_ENV] = SECRET_VALUE;
  });
  afterEach(() => {
    delete process.env[SECRET_ENV];
  });

  it("publishes the fixed deterministic payload under the default alias, beside the carrier", async () => {
    const doc = (await FixtureFetcher.render(
      { ...FixtureFetcher.defaultProps },
      ctxWithEnvSecrets(),
    )) as MosaicDocument;

    expect(doc.kind).toBe("mosaic_document");
    const sources = doc.sources ?? [];
    // Exactly one renderable (the degenerate carrier) + one data source.
    // (finalizeRenderable stamps editor.owner / engine.renderStatus meta,
    // so match the authored fields rather than the exact object.)
    const renderables = sources.filter((s) => !isMosaicDataSource(s));
    expect(renderables).toHaveLength(1);
    expect(renderables[0]).toMatchObject({ type: "lavfi", color: "#000000" });
    expect(sources.filter(isMosaicDataSource)).toHaveLength(1);

    const data = sources.find(isMosaicDataSource)!;
    expect(String(data.alias)).toBe("fixtureData");
    expect(data.variables).toEqual(FIXTURE_FETCHER_DEFAULT_PAYLOAD);
    // Sidecar mirrors the published payload byte-for-byte.
    expect(doc.sidecars).toEqual({ fixtureData: FIXTURE_FETCHER_DEFAULT_PAYLOAD });
  });

  it("is deterministic: identical props + ctx → deep-equal documents", async () => {
    const a = await FixtureFetcher.render({ alias: "fixtureData" }, ctxWithEnvSecrets());
    const b = await FixtureFetcher.render({ alias: "fixtureData" }, ctxWithEnvSecrets());
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it("honors a custom alias and payload", async () => {
    const payload = { rows: [1, 2], label: "custom" };
    const doc = (await FixtureFetcher.render(
      { alias: "customBlock", payload },
      ctxWithEnvSecrets(),
    )) as MosaicDocument;

    const data = (doc.sources ?? []).find(isMosaicDataSource)!;
    expect(String(data.alias)).toBe("customBlock");
    expect(data.variables).toEqual(payload);
  });

  it("resolves secretRef to a derived marker and never leaks cleartext", async () => {
    const doc = (await FixtureFetcher.render(
      { alias: "fixtureData", secretRef: `env:${SECRET_ENV}` },
      ctxWithEnvSecrets(),
    )) as MosaicDocument;

    const data = (doc.sources ?? []).find(isMosaicDataSource)!;
    expect(data.variables.secret).toEqual({
      secretResolved: true,
      secretLength: SECRET_VALUE.length,
    });
    // The cleartext must appear NOWHERE in the returned document.
    expect(JSON.stringify(doc)).not.toContain(SECRET_VALUE);
  });

  it("fails fast when secretRef is set but ctx.secrets is absent", async () => {
    await expect(
      FixtureFetcher.render(
        { secretRef: `env:${SECRET_ENV}` },
        makeCtx(), // no secrets resolver
      ),
    ).rejects.toThrow(/ctx\.secrets is absent/);
  });

  it("fails fast on an unresolvable secretRef", async () => {
    await expect(
      FixtureFetcher.render(
        { secretRef: "env:M0SAIC_FIXTURE_FETCHER_TEST_MISSING" },
        ctxWithEnvSecrets(),
      ),
    ).rejects.toThrow(/did not resolve/);
  });

  it("fails fast on an invalid alias or non-object payload", async () => {
    await expect(
      FixtureFetcher.render({ alias: "has spaces!" }, ctxWithEnvSecrets()),
    ).rejects.toThrow(/not a valid AliasId/);
    await expect(
      FixtureFetcher.render(
        { payload: [1, 2, 3] as unknown as Record<string, unknown> },
        ctxWithEnvSecrets(),
      ),
    ).rejects.toThrow(/plain JSON object/);
  });

  it("declares the capability tier the Level 1 gate requires", () => {
    expect(FixtureFetcher.capabilities).toEqual({ tier: "capability", caps: {} });
    expect(FixtureFetcher.internal).toBe(true);
  });
});
