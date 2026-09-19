// covers: github/connection — schema shape + id/publisher validity, side-effect
// registration into the host-connection registry, and probe result mapping
// (reachable / authenticated / auth-failed / unreachable) with fetch stubbed.
import { getHostConnection } from "@m0saic/template-utils";
import type { MosaicHostConnectionProbeOpts } from "@m0saic/types";
import {
  GITHUB_CONNECTION_ID,
  GITHUB_CONNECTION_SCHEMA,
  GITHUB_TOKEN_FIELD,
  githubConnectionProbe,
} from "./connection";

type FetchImpl = NonNullable<MosaicHostConnectionProbeOpts["fetchImpl"]>;

function fetchReturning(status: number, body: unknown): FetchImpl {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  });
}
const RATE_OK = { resources: { core: { limit: 5000, remaining: 4999 } } };

describe("github/connection", () => {
  describe("schema", () => {
    it("is a well-formed publisher@profile connection", () => {
      expect(String(GITHUB_CONNECTION_ID)).toBe("github@default");
      expect(GITHUB_CONNECTION_SCHEMA.publisher).toBe("github");
      expect(GITHUB_CONNECTION_SCHEMA.version).toBe(1);
    });
    it("declares baseUrl(url, optional) + token(secret, keychain, optional)", () => {
      const baseUrl = GITHUB_CONNECTION_SCHEMA.fields.find((f) => f.key === "baseUrl");
      const token = GITHUB_CONNECTION_SCHEMA.fields.find((f) => f.key === GITHUB_TOKEN_FIELD);
      expect(baseUrl?.kind).toBe("url");
      expect(baseUrl?.required).toBe(false);
      expect(token?.kind).toBe("secret");
      expect(token && token.kind === "secret" ? token.storage : undefined).toBe("keychain");
      expect(token?.required).toBe(false);
    });
  });

  describe("registration side-effect", () => {
    it("importing the module registered github@default", () => {
      const reg = getHostConnection(GITHUB_CONNECTION_ID);
      expect(reg).toBeDefined();
      expect(reg?.schema.id).toBe(GITHUB_CONNECTION_ID);
    });
  });

  describe("probe result mapping", () => {
    it("reachable + authenticated when a token is accepted (200)", async () => {
      const res = await githubConnectionProbe.probe(
        { baseUrl: "https://api.github.com", token: "ghp_x" },
        { fetchImpl: fetchReturning(200, RATE_OK) },
      );
      expect(res).toMatchObject({ ok: true, reachable: true, authenticated: true, info: { limit: 5000, remaining: 4999 } });
    });
    it("reachable but NOT authenticated when anonymous (200, no token)", async () => {
      const res = await githubConnectionProbe.probe({}, { fetchImpl: fetchReturning(200, RATE_OK) });
      expect(res).toMatchObject({ ok: true, reachable: true, authenticated: false });
    });
    it("AUTH_FAILED on 401 (rejected token)", async () => {
      const res = await githubConnectionProbe.probe(
        { token: "bad" },
        { fetchImpl: fetchReturning(401, { message: "Bad credentials" }) },
      );
      expect(res).toEqual({ ok: false, code: "AUTH_FAILED", message: expect.any(String) });
    });
    it("UNREACHABLE when the fetch throws", async () => {
      const res = await githubConnectionProbe.probe(
        {},
        { fetchImpl: async () => { throw new Error("ENOTFOUND"); } },
      );
      expect(res).toMatchObject({ ok: false, code: "UNREACHABLE" });
    });
    it("UNREACHABLE on an unexpected non-200/401 status", async () => {
      const res = await githubConnectionProbe.probe({}, { fetchImpl: fetchReturning(503, {}) });
      expect(res).toMatchObject({ ok: false, code: "UNREACHABLE" });
    });
  });
});
