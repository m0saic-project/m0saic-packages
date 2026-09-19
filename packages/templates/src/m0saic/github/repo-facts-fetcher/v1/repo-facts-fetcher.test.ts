// covers: repo-facts-fetcher template — replay determinism (byte-equal publish),
// network-free default render, factsToDocument shape (carrier + aliased data +
// sidecar), resolveGithubAccess token precedence, and fail-fast prop validation.
import type { MosaicDataSource, MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { mintConnectionSecretRef } from "@m0saic/types";
import { GITHUB_CONNECTION_ID, GITHUB_TOKEN_FIELD } from "../../connection";
import {
  GITHUB_REPO_FACTS_ALIAS,
  RepoFactsFetcher,
  factsToDocument,
  resolveGithubAccess,
} from "./repo-facts-fetcher";
import { SAMPLE_FACTS } from "./sample-facts";
import type { GithubRepoFacts } from "./facts";

function makeCtx(overrides: Partial<MosaicEngineContext> = {}): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 64, height: 64, fps: 1, durationMs: 1000, workspaceDir: "/tmp" },
    target: { width: 64, height: 64, fps: 1, durationMs: 1000 },
    media: {},
    ...overrides,
  } as MosaicEngineContext;
}

const dataSource = (doc: MosaicDocument): MosaicDataSource =>
  doc.sources.find((s) => (s as { type?: string }).type === "data") as MosaicDataSource;

describe("@m0saic/github/repo-facts-fetcher/v1", () => {
  describe("factsToDocument shape", () => {
    it("emits a black carrier + the aliased data source + a sidecar mirror", () => {
      const doc = factsToDocument(SAMPLE_FACTS);
      expect(doc.kind).toBe("mosaic_document");
      expect(doc.sources[0]).toMatchObject({ type: "lavfi", color: "#000000" });
      const ds = dataSource(doc);
      expect(ds.alias).toBe(GITHUB_REPO_FACTS_ALIAS);
      expect(ds.variables).toEqual(SAMPLE_FACTS);
      expect(doc.sidecars?.githubRepoFacts).toEqual(SAMPLE_FACTS);
    });
  });

  describe("replay mode", () => {
    it("default render publishes the embedded sample, byte-identically and repeatably", async () => {
      const a = (await RepoFactsFetcher.render(RepoFactsFetcher.defaultProps, makeCtx())) as MosaicDocument;
      const b = (await RepoFactsFetcher.render({}, makeCtx())) as MosaicDocument;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(dataSource(a).variables).toEqual(SAMPLE_FACTS);
      expect(dataSource(a).variables).toEqual(dataSource(b).variables);
    });

    it("is network-free — never touches fetch", async () => {
      const original = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error("NETWORK FORBIDDEN in replay mode");
      }) as typeof fetch;
      try {
        const doc = (await RepoFactsFetcher.render({ source: "replay" }, makeCtx())) as MosaicDocument;
        expect(dataSource(doc).variables).toEqual(SAMPLE_FACTS);
      } finally {
        globalThis.fetch = original;
      }
    });

    it("publishes a caller-supplied facts payload verbatim", async () => {
      const custom = { ...SAMPLE_FACTS, repo: { ...SAMPLE_FACTS.repo, fullName: "other/repo", name: "repo" } } as GithubRepoFacts;
      const doc = (await RepoFactsFetcher.render({ source: "replay", facts: custom }, makeCtx())) as MosaicDocument;
      expect((dataSource(doc).variables as GithubRepoFacts).repo.fullName).toBe("other/repo");
    });
  });

  describe("resolveGithubAccess — token precedence + baseUrl", () => {
    const secretsWith = (map: Record<string, string>) => ({
      has: async (ref: string) => ref in map,
      get: async (ref: string) => { if (!(ref in map)) throw new Error("missing"); return map[ref]; },
    });
    const connectionsWith = (present: boolean, vals: Record<string, unknown> = {}) => ({
      has: async () => present,
      get: async () => (present ? vals : undefined),
    });

    it("explicit tokenRef wins over the connection", async () => {
      const ctx = makeCtx({
        secrets: secretsWith({ "env:GITHUB_TOKEN": "explicit-tok", [mintConnectionSecretRef(GITHUB_CONNECTION_ID, GITHUB_TOKEN_FIELD)]: "conn-tok" }) as never,
        connections: connectionsWith(true, { baseUrl: "https://ghe.example/api/v3" }) as never,
      });
      const r = await resolveGithubAccess({ tokenRef: "env:GITHUB_TOKEN" }, ctx);
      expect(r.token).toBe("explicit-tok");
      expect(r.baseUrl).toBe("https://ghe.example/api/v3");
    });

    it("falls back to the connection keychain ref when no tokenRef", async () => {
      const ref = mintConnectionSecretRef(GITHUB_CONNECTION_ID, GITHUB_TOKEN_FIELD);
      const ctx = makeCtx({ secrets: secretsWith({ [ref]: "conn-tok" }) as never, connections: connectionsWith(true) as never });
      const r = await resolveGithubAccess({}, ctx);
      expect(r.token).toBe("conn-tok");
    });

    it("degrades to anonymous (no throw) when nothing resolves", async () => {
      const r = await resolveGithubAccess({}, makeCtx()); // no secrets / connections at all
      expect(r.token).toBeUndefined();
      expect(r.baseUrl).toBeUndefined();
    });

    it("does not throw when an explicit tokenRef is unresolvable — degrades", async () => {
      const ctx = makeCtx({ secrets: secretsWith({}) as never });
      const r = await resolveGithubAccess({ tokenRef: "env:NOPE" }, ctx);
      expect(r.token).toBeUndefined();
    });

    it("falls through to the connection token when tokenRef is set but unresolvable (app path)", async () => {
      const ref = mintConnectionSecretRef(GITHUB_CONNECTION_ID, GITHUB_TOKEN_FIELD);
      const ctx = makeCtx({
        secrets: secretsWith({ [ref]: "conn-tok" }) as never, // env:NOPE absent, connection ref present
        connections: connectionsWith(true) as never,
      });
      const r = await resolveGithubAccess({ tokenRef: "env:NOPE" }, ctx);
      expect(r.token).toBe("conn-tok"); // Settings → Integrations token, not anonymous
    });
  });

  describe("fail-fast prop validation", () => {
    it("rejects an unknown source", async () => {
      await expect(RepoFactsFetcher.render({ source: "bogus" as never }, makeCtx())).rejects.toThrow(/source must be/);
    });
    it("rejects a malformed repo in live mode", async () => {
      await expect(RepoFactsFetcher.render({ source: "live", repo: "not-a-repo" }, makeCtx())).rejects.toThrow(/owner\/name/);
    });
    it("rejects a malformed window in live mode", async () => {
      await expect(
        RepoFactsFetcher.render({ source: "live", repo: "o/r", window: { startISO: "x" } as never }, makeCtx()),
      ).rejects.toThrow(/window must be/);
    });
  });

  describe("live-mode runtime failure degrades to an error mosaic (not a throw)", () => {
    it("returns an error frame when the repo fetch fails at runtime (404 / network)", async () => {
      const original = globalThis.fetch;
      globalThis.fetch = (async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        async text() { return "{}"; },
        async json() { return { message: "Not Found" }; },
        headers: { get: () => null },
      })) as unknown as typeof fetch;
      try {
        const doc = (await RepoFactsFetcher.render(
          { source: "live", repo: "o/nope", window: SAMPLE_FACTS.window },
          makeCtx(),
        )) as MosaicDocument;
        const src = doc.sources[0] as { engine?: { renderStatus?: string; renderError?: { code?: string } } };
        expect(src.engine?.renderStatus).toBe("error");
        expect(src.engine?.renderError?.code).toBe("GITHUB_FETCH_FAILED");
        expect(doc.sources.find((s) => (s as { type?: string }).type === "data")).toBeUndefined();
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
