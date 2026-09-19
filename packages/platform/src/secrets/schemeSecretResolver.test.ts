import type { MosaicSecretResolver } from "@m0saic/types";
import { createSchemeSecretResolver } from "./schemeSecretResolver";

/** Resolver that owns one scheme and rejects everything else, like the real ones. */
const single = (scheme: string, entries: Record<string, string>): MosaicSecretResolver => ({
  async get(ref) {
    const m = new RegExp(`^${scheme}:(.+)$`).exec(String(ref));
    if (!m) throw new Error(`unsupported ref (expected "${scheme}:<id>")`);
    const v = entries[m[1]];
    if (v === undefined) throw new Error(`no such ${scheme} entry: ${m[1]}`);
    return v;
  },
  async has(ref) {
    const m = new RegExp(`^${scheme}:(.+)$`).exec(String(ref));
    return !!m && entries[m[1]] !== undefined;
  },
});

const resolver = createSchemeSecretResolver({
  keychain: single("keychain", { "github@localhost": "kc-value" }),
  env: single("env", { M0SAIC_STARTER_TOKEN: "env-value" }),
});

describe("createSchemeSecretResolver", () => {
  it("routes each scheme to the resolver that owns it", async () => {
    await expect(resolver.get("keychain:github@localhost")).resolves.toBe("kc-value");
    await expect(resolver.get("env:M0SAIC_STARTER_TOKEN")).resolves.toBe("env-value");
  });

  it("lets a host resolve BOTH — the portability the desktop was missing", async () => {
    // The desktop wired keychain only, so this env ref threw "unsupported ref"
    // even though the CLI resolved it and the docs told authors to write it.
    await expect(resolver.has("env:M0SAIC_STARTER_TOKEN")).resolves.toBe(true);
    await expect(resolver.has("keychain:github@localhost")).resolves.toBe(true);
  });

  it("a known scheme with an unknown id is MISSING, not unsupported", async () => {
    await expect(resolver.has("env:NOPE")).resolves.toBe(false);
    await expect(resolver.get("env:NOPE")).rejects.toThrow(/no such env entry/);
  });

  it("names every supported scheme when the scheme itself is unknown", async () => {
    // The diagnostic a single-scheme resolver cannot give.
    await expect(resolver.get("vault:thing")).rejects.toThrow(
      /Supported here: env:<id>, keychain:<id>/,
    );
  });

  it("has() stays non-throwing for an unknown scheme", async () => {
    await expect(resolver.has("vault:thing")).resolves.toBe(false);
    await expect(resolver.has("nonsense")).resolves.toBe(false);
  });

  it("does not invent case-insensitivity the delegates lack", async () => {
    // The env resolver matches /^env:/ exactly, so routing ENV: there would
    // only relocate the rejection. Report it here, where the message can name
    // the schemes that actually work.
    await expect(resolver.get("ENV:M0SAIC_STARTER_TOKEN")).rejects.toThrow(
      /Supported here: env:<id>, keychain:<id>/,
    );
    await expect(resolver.has("ENV:M0SAIC_STARTER_TOKEN")).resolves.toBe(false);
  });
});
