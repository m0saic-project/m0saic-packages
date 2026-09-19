import {
  asMosaicHostConnectionId,
  mintConnectionSecretRef,
  type MosaicConnectionResolver,
  type MosaicHostConnectionField,
  type MosaicHostConnectionProbeResult,
  type MosaicHostConnectionRegistration,
  type MosaicHostConnectionSchema,
} from "./host-connections";

describe("asMosaicHostConnectionId", () => {
  it("accepts publisher@profile", () => {
    const id = asMosaicHostConnectionId("github-dev@default");
    expect(id).toBe("github-dev@default");
  });

  it("accepts multi-profile names", () => {
    expect(asMosaicHostConnectionId("github-dev@home")).toBe("github-dev@home");
    expect(asMosaicHostConnectionId("plex-dev@work")).toBe("plex-dev@work");
  });

  it("rejects malformed shapes", () => {
    expect(() => asMosaicHostConnectionId("")).toThrow();
    expect(() => asMosaicHostConnectionId("no-at-sign")).toThrow();
    expect(() => asMosaicHostConnectionId("@default")).toThrow();
    expect(() => asMosaicHostConnectionId("github-dev@")).toThrow();
    expect(() => asMosaicHostConnectionId("a@b@c")).toThrow();
    expect(() => asMosaicHostConnectionId("has space@default")).toThrow();
  });
});

describe("MosaicHostConnectionSchema — shape compiles", () => {
  it("compiles a minimum-viable schema", () => {
    const fields: MosaicHostConnectionField[] = [
      { kind: "url", key: "url", label: "URL", required: true },
      {
        kind: "secret",
        key: "apiKey",
        label: "API key",
        required: false,
        storage: "keychain",
      },
    ];
    const schema: MosaicHostConnectionSchema = {
      id: asMosaicHostConnectionId("test-dev@default"),
      version: 1,
      label: "Test",
      publisher: "test-dev",
      fields,
    };
    expect(schema.version).toBe(1);
    expect(schema.fields.length).toBe(2);
  });

  it("admits all three field kinds", () => {
    const fields: MosaicHostConnectionField[] = [
      { kind: "url", key: "url", label: "URL", required: true },
      { kind: "string", key: "mode", label: "Mode", required: false },
      {
        kind: "secret",
        key: "token",
        label: "Token",
        required: true,
        storage: "env",
      },
    ];
    expect(fields.map((f) => f.kind)).toEqual(["url", "string", "secret"]);
  });
});

describe("MosaicHostConnectionProbeResult — discriminated union", () => {
  it("ok=true with two-tick fields", () => {
    const r: MosaicHostConnectionProbeResult = {
      ok: true,
      reachable: true,
      authenticated: true,
      version: "0.30.1",
    };
    if (r.ok) {
      expect(r.reachable).toBe(true);
      expect(r.authenticated).toBe(true);
    }
  });

  it("ok=false carries a stable code + message", () => {
    const r: MosaicHostConnectionProbeResult = {
      ok: false,
      code: "UNREACHABLE",
      message: "GitHub server at http://localhost:9999 didn't respond",
    };
    if (!r.ok) {
      expect(r.code).toBe("UNREACHABLE");
      expect(r.message).toMatch(/GitHub/);
    }
  });
});

describe("mintConnectionSecretRef", () => {
  it("formats the canonical keychain:<id>/<field> ref", () => {
    expect(mintConnectionSecretRef("github-dev@default", "apiKey")).toBe(
      "keychain:github-dev@default/apiKey",
    );
  });

  it("accepts a branded id", () => {
    const id = asMosaicHostConnectionId("github-dev@default");
    expect(mintConnectionSecretRef(id, "apiKey")).toBe(
      "keychain:github-dev@default/apiKey",
    );
  });

  it("rejects empty connectionId and fieldKey", () => {
    expect(() => mintConnectionSecretRef("", "apiKey")).toThrow();
    expect(() => mintConnectionSecretRef("github-dev@default", "")).toThrow();
  });

  it("rejects fieldKey containing '/' or whitespace", () => {
    expect(() =>
      mintConnectionSecretRef("github-dev@default", "a/b"),
    ).toThrow();
    expect(() =>
      mintConnectionSecretRef("github-dev@default", "a b"),
    ).toThrow();
  });
});

describe("MosaicHostConnectionRegistration + Resolver — interface contract", () => {
  it("a registration pairs schema + probe", () => {
    const registration: MosaicHostConnectionRegistration = {
      schema: {
        id: asMosaicHostConnectionId("test-dev@default"),
        version: 1,
        label: "Test",
        publisher: "test-dev",
        fields: [{ kind: "url", key: "url", label: "URL", required: true }],
      },
      probe: {
        async probe(values) {
          if (typeof values.url !== "string") {
            return { ok: false, code: "BAD_URL", message: "missing url" };
          }
          return { ok: true, reachable: true };
        },
      },
    };
    expect(registration.schema.version).toBe(1);
  });

  it("MosaicConnectionResolver returns undefined when not configured", async () => {
    const empty: MosaicConnectionResolver = {
      async get() {
        return undefined;
      },
      async has() {
        return false;
      },
    };
    expect(await empty.get("never-registered@default")).toBeUndefined();
    expect(await empty.has("never-registered@default")).toBe(false);
  });
});
