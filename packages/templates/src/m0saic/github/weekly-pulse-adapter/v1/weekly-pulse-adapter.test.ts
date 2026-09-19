// covers: weekly-pulse-adapter template — upstream consumption + republish,
// required-block hard error, sidecar mirror, determinism, prop pass-through,
// and the pulseToDocument shape.
import type { MosaicDataSource, MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { WEEKLY_PULSE_ALIAS, WeeklyPulseAdapter, pulseToDocument } from "./weekly-pulse-adapter";
import { deriveWeeklyPulse } from "./derive-pulse";
import { SAMPLE_FACTS } from "../../repo-facts-fetcher/v1/sample-facts";

function makeCtx(overrides: Partial<MosaicEngineContext> = {}): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 64, height: 64, fps: 1, durationMs: 1000, workspaceDir: "/tmp" },
    target: { width: 64, height: 64, fps: 1, durationMs: 1000 },
    media: {},
    ...overrides,
  } as MosaicEngineContext;
}
const withFacts = () => makeCtx({ upstreamData: { githubRepoFacts: SAMPLE_FACTS } } as never);
const dataSource = (doc: MosaicDocument): MosaicDataSource =>
  doc.sources.find((s) => (s as { type?: string }).type === "data") as MosaicDataSource;

describe("@m0saic/github/weekly-pulse-adapter/v1", () => {
  it("derives weeklyPulse from the upstream githubRepoFacts and mirrors it to the sidecar", async () => {
    const doc = (await WeeklyPulseAdapter.render({}, withFacts())) as MosaicDocument;
    const expected = deriveWeeklyPulse(SAMPLE_FACTS);
    expect(doc.sources[0]).toMatchObject({ type: "lavfi", color: "#000000" });
    const ds = dataSource(doc);
    expect(ds.alias).toBe(WEEKLY_PULSE_ALIAS);
    expect(ds.variables).toEqual(expected);
    expect(doc.sidecars?.weeklyPulse).toEqual(expected);
  });

  it("returns an error mosaic (NOT a throw) when the required upstream block is absent", async () => {
    const doc = (await WeeklyPulseAdapter.render({}, makeCtx())) as MosaicDocument;
    const src = doc.sources[0] as { engine?: { renderStatus?: string; renderError?: { code?: string } } };
    expect(src.engine?.renderStatus).toBe("error"); // valid, engine-marked error frame
    expect(src.engine?.renderError?.code).toBe("MISSING_UPSTREAM_GITHUB_REPO_FACTS");
    // publishes NO weeklyPulse — a downstream beat/runner sees the gap and error-frames too
    expect(doc.sources.find((s) => (s as { type?: string }).type === "data")).toBeUndefined();
  });

  it("is deterministic — same upstream → byte-identical publish", async () => {
    const a = (await WeeklyPulseAdapter.render({}, withFacts())) as MosaicDocument;
    const b = (await WeeklyPulseAdapter.render({}, withFacts())) as MosaicDocument;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("passes preview props through to the derivation", async () => {
    const doc = (await WeeklyPulseAdapter.render({ notableCount: 2 }, withFacts())) as MosaicDocument;
    const pulse = dataSource(doc).variables as ReturnType<typeof deriveWeeklyPulse>;
    expect(pulse.notable.items.length).toBe(2);
  });

  it("declares githubRepoFacts as a REQUIRED upstream block (so drift/absence errors at resolve time)", () => {
    const block = WeeklyPulseAdapter.upstreamDataSchema?.githubRepoFacts;
    expect(block?.variables.schemaVersion).toMatchObject({ required: true });
    expect(WeeklyPulseAdapter.role).toBe("adapter");
    expect(WeeklyPulseAdapter.capabilities.tier).toBe("core");
  });

  it("pulseToDocument wraps a sheet in carrier + aliased data + sidecar", () => {
    const doc = pulseToDocument(deriveWeeklyPulse(SAMPLE_FACTS));
    expect(dataSource(doc).alias).toBe(WEEKLY_PULSE_ALIAS);
    expect(doc.sidecars?.weeklyPulse).toBeDefined();
  });
});
