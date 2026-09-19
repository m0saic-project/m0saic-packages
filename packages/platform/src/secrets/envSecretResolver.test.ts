import { createEnvSecretResolver } from "./envSecretResolver";

describe("envSecretResolver", () => {
  describe("get", () => {
    it("resolves env:NAME → process.env[NAME]", async () => {
      const r = createEnvSecretResolver({ GITHUB_TOKEN: "abc123" });
      await expect(r.get("env:GITHUB_TOKEN")).resolves.toBe("abc123");
    });

    it("rejects when the env var is unset", async () => {
      const r = createEnvSecretResolver({});
      await expect(r.get("env:MISSING")).rejects.toThrow(/not set/);
    });

    it("rejects when the env var is empty string", async () => {
      // process.env coerces empty string the same as unset for our purposes —
      // an empty key would mostly be a config bug, not a deliberate "empty
      // secret".
      const r = createEnvSecretResolver({ EMPTY: "" });
      await expect(r.get("env:EMPTY")).rejects.toThrow(/not set/);
    });

    it("rejects refs from other schemes", async () => {
      const r = createEnvSecretResolver({ GITHUB_TOKEN: "abc" });
      await expect(r.get("keychain:foo")).rejects.toThrow(
        /unsupported ref.*expected scheme/i,
      );
    });

    it("rejects malformed env: refs", async () => {
      const r = createEnvSecretResolver({});
      await expect(r.get("env:")).rejects.toThrow(/unsupported ref/);
      await expect(r.get("env: ")).rejects.toThrow(/empty env var name/);
    });

    it("preserves case in env var names", async () => {
      const r = createEnvSecretResolver({ FOO: "upper", foo: "lower" });
      // On POSIX these are distinct entries. On Windows they collapse at the
      // OS level — but our injected map preserves both, so the test runs
      // case-sensitive regardless of host platform.
      await expect(r.get("env:FOO")).resolves.toBe("upper");
      await expect(r.get("env:foo")).resolves.toBe("lower");
    });
  });

  describe("has", () => {
    it("returns true when the env var is set", async () => {
      const r = createEnvSecretResolver({ A: "v" });
      await expect(r.has("env:A")).resolves.toBe(true);
    });

    it("returns false when the env var is unset", async () => {
      const r = createEnvSecretResolver({});
      await expect(r.has("env:NOPE")).resolves.toBe(false);
    });

    it("returns false for empty-string values (mirrors get)", async () => {
      const r = createEnvSecretResolver({ EMPTY: "" });
      await expect(r.has("env:EMPTY")).resolves.toBe(false);
    });

    it("returns false for unsupported schemes (does not throw)", async () => {
      const r = createEnvSecretResolver({});
      await expect(r.has("keychain:foo")).resolves.toBe(false);
      await expect(r.has("")).resolves.toBe(false);
    });
  });

  describe("live process.env (smoke)", () => {
    it("defaults to live process.env when no env arg is supplied", async () => {
      const savedNode = process.env.NODE_ENV;
      // NODE_ENV is almost always set in jest; if not, this is a no-op test.
      if (savedNode != null && savedNode.length > 0) {
        const r = createEnvSecretResolver();
        await expect(r.get("env:NODE_ENV")).resolves.toBe(savedNode);
      }
    });

    it("does not cache — reads fresh on every call", async () => {
      const env: NodeJS.ProcessEnv = { ROT: "v1" };
      const r = createEnvSecretResolver(env);
      await expect(r.get("env:ROT")).resolves.toBe("v1");
      env.ROT = "v2";
      await expect(r.get("env:ROT")).resolves.toBe("v2");
    });
  });
});
