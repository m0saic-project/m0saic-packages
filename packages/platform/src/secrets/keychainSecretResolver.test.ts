import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeM0saicTempPrefix } from "../paths";
import {
  createKeychainSecrets,
  type SafeStorageLike,
} from "./keychainSecretResolver";

/**
 * Test-only SafeStorage stand-in. Encrypts by base64-rotating the
 * plaintext through a marker byte so encrypt/decrypt round-trips
 * deterministically. Mismatched buffers throw, mirroring the real
 * `safeStorage.decryptString` behavior.
 */
function makeFakeSafeStorage(
  opts: { available?: boolean; marker?: string } = {},
): SafeStorageLike {
  const available = opts.available ?? true;
  const marker = opts.marker ?? "FAKE_ENC:";
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) =>
      Buffer.from(marker + plainText, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const txt = encrypted.toString("utf8");
      if (!txt.startsWith(marker)) {
        throw new Error("fake decrypt: wrong marker");
      }
      return txt.slice(marker.length);
    },
  };
}

function mkTempDir(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("keychain-resolver-test")));
}

describe("keychainSecretResolver", () => {
  let tmp: string;
  let storePath: string;

  beforeEach(() => {
    tmp = mkTempDir();
    storePath = path.join(tmp, "secrets.json");
  });

  afterEach(() => {
    fsSync.rmSync(tmp, { recursive: true, force: true });
  });

  describe("read/write round-trip", () => {
    it("setSecret then get returns the original cleartext", async () => {
      const { resolver, store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await store.setSecret("github@localhost", "abc123");
      await expect(resolver.get("keychain:github@localhost")).resolves.toBe(
        "abc123",
      );
    });

    it("setSecret persists to disk (resolver reads file fresh)", async () => {
      // Two factories pointing at the same file — proves persistence across
      // host process boundaries. The credentials UI uses one factory; the
      // render path uses another.
      const writer = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await writer.store.setSecret("foo", "bar");

      const reader = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(reader.resolver.get("keychain:foo")).resolves.toBe("bar");
    });

    it("overwriting an existing entry returns the new value", async () => {
      const { resolver, store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await store.setSecret("k", "v1");
      await store.setSecret("k", "v2");
      await expect(resolver.get("keychain:k")).resolves.toBe("v2");
    });
  });

  describe("get failures", () => {
    it("rejects when the store file is absent", async () => {
      const { resolver } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(resolver.get("keychain:nope")).rejects.toThrow(
        /no entry for/,
      );
    });

    it("rejects when the entry is missing", async () => {
      const { resolver, store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await store.setSecret("present", "ok");
      await expect(resolver.get("keychain:absent")).rejects.toThrow(
        /no entry for/,
      );
    });

    it("rejects when the encrypted blob is corrupt", async () => {
      const { resolver, store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await store.setSecret("k", "v");
      // Tamper with the on-disk blob — simulates wrong-machine / wrong-user.
      const corrupted = { k: Buffer.from("not encrypted").toString("base64") };
      await fs.writeFile(storePath, JSON.stringify(corrupted), "utf8");
      await expect(resolver.get("keychain:k")).rejects.toThrow(
        /failed to decrypt/,
      );
    });

    it("rejects refs from other schemes", async () => {
      const { resolver } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(resolver.get("env:FOO")).rejects.toThrow(
        /unsupported ref.*keychain:/i,
      );
    });

    it("rejects malformed keychain: refs", async () => {
      const { resolver } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(resolver.get("keychain:")).rejects.toThrow(
        /unsupported ref/,
      );
      await expect(resolver.get("keychain: ")).rejects.toThrow(/empty id/);
    });

    it("rejects when the store file is malformed", async () => {
      await fs.writeFile(storePath, "not json {", "utf8");
      const { resolver } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(resolver.get("keychain:k")).rejects.toThrow();
    });

    it("rejects when the store file is an array (not an object)", async () => {
      await fs.writeFile(storePath, JSON.stringify(["nope"]), "utf8");
      const { resolver } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(resolver.get("keychain:k")).rejects.toThrow(
        /not a JSON object/,
      );
    });
  });

  describe("has", () => {
    it("returns true for present entries", async () => {
      const { resolver, store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await store.setSecret("k", "v");
      await expect(resolver.has("keychain:k")).resolves.toBe(true);
    });

    it("returns false for absent entries", async () => {
      const { resolver } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(resolver.has("keychain:nope")).resolves.toBe(false);
    });

    it("returns false for unsupported schemes (does not throw)", async () => {
      const { resolver } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(resolver.has("env:FOO")).resolves.toBe(false);
    });
  });

  describe("store write path", () => {
    it("setSecret refuses when safeStorage reports encryption unavailable", async () => {
      const { store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage({ available: false }),
        storePath,
      });
      await expect(store.setSecret("k", "v")).rejects.toThrow(
        /keyring not available/,
      );
      // Sanity: store file was never created
      await expect(fs.access(storePath)).rejects.toBeDefined();
    });

    it("setSecret rejects invalid ids (empty, too long, control chars)", async () => {
      const { store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(store.setSecret("", "v")).rejects.toThrow(/invalid keychain id/);
      await expect(store.setSecret("a".repeat(129), "v")).rejects.toThrow(
        /invalid keychain id/,
      );
      await expect(store.setSecret("bad\x00null", "v")).rejects.toThrow(
        /invalid keychain id/,
      );
    });

    it("deleteSecret removes an existing entry", async () => {
      const { resolver, store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await store.setSecret("k", "v");
      await store.deleteSecret("k");
      await expect(resolver.has("keychain:k")).resolves.toBe(false);
    });

    it("deleteSecret is a no-op for absent ids", async () => {
      const { store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      // Should not throw even though the store doesn't exist yet
      await expect(store.deleteSecret("nope")).resolves.toBeUndefined();
    });

    it("listSecretIds returns sorted ids", async () => {
      const { store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await store.setSecret("zeta", "v");
      await store.setSecret("alpha", "v");
      await store.setSecret("mu", "v");
      await expect(store.listSecretIds()).resolves.toEqual([
        "alpha",
        "mu",
        "zeta",
      ]);
    });

    it("listSecretIds returns [] for a missing store file", async () => {
      const { store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath,
      });
      await expect(store.listSecretIds()).resolves.toEqual([]);
    });

    it("setSecret creates the store directory if absent", async () => {
      const nestedDir = path.join(tmp, "nested", "deeper");
      const nestedPath = path.join(nestedDir, "secrets.json");
      const { store } = createKeychainSecrets({
        safeStorage: makeFakeSafeStorage(),
        storePath: nestedPath,
      });
      await store.setSecret("k", "v");
      await expect(fs.access(nestedPath)).resolves.toBeUndefined();
    });
  });
});
