import type { MosaicSecretResolver, SecretRef } from "./secrets";

describe("MosaicSecretResolver — interface contract", () => {
  // A reference resolver that exercises the full surface. If this stops
  // compiling, the interface changed in a non-additive way and any
  // implementation in @m0saic/platform will break.
  const ref: SecretRef = "env:TEST";
  const resolver: MosaicSecretResolver = {
    async get(r) {
      if (r === "env:TEST") return "secret-value";
      throw new Error(`unknown ref: ${r}`);
    },
    async has(r) {
      return r === "env:TEST";
    },
  };

  it("get returns cleartext for known refs", async () => {
    await expect(resolver.get(ref)).resolves.toBe("secret-value");
  });

  it("get rejects on unknown refs", async () => {
    await expect(resolver.get("env:NOPE")).rejects.toThrow(/unknown ref/);
  });

  it("has is non-throwing and mirrors get", async () => {
    await expect(resolver.has(ref)).resolves.toBe(true);
    await expect(resolver.has("env:NOPE")).resolves.toBe(false);
  });

  it("SecretRef is a plain string brand — opaque to type-checker", () => {
    const refs: SecretRef[] = ["env:A", "keychain:b@prod", "custom:anything"];
    expect(refs).toHaveLength(3);
  });
});
