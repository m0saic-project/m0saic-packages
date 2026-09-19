import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MosaicSecretResolver, SecretRef } from "@m0saic/types";

/**
 * Structural type for Electron's `safeStorage` module. Defined here so
 * `@m0saic/platform` doesn't take a hard dep on `electron` — the host
 * passes the real `safeStorage` (or a test fake) at construction time.
 *
 * Reference: https://www.electronjs.org/docs/latest/api/safe-storage
 */
export interface SafeStorageLike {
  /**
   * True when the OS keyring is available + unlocked. On macOS this is
   * Keychain; Windows uses DPAPI; Linux uses libsecret (gnome-keyring
   * / kwallet). Returns false on Linux configs without a keyring
   * daemon — the host should refuse to store secrets in that case,
   * not silently fall back to clear-text.
   */
  isEncryptionAvailable(): boolean;

  /** Encrypt cleartext into an opaque Buffer. Throws on encryption failure. */
  encryptString(plainText: string): Buffer;

  /** Decrypt back to cleartext. Throws on bad-blob / wrong-machine. */
  decryptString(encrypted: Buffer): string;
}

/**
 * Persistent map of `id → encrypted-blob`, stored as JSON on disk.
 *
 * The file format is intentionally trivial — JSON with base64-encoded
 * encrypted strings — so the Electron credentials UI and the resolver
 * agree on a single schema. Reads/writes go through atomic
 * temp-file + rename to survive a crash mid-write.
 */
export interface KeychainStore {
  /** Persist `cleartext` under `id`. Overwrites any existing entry. */
  setSecret(id: string, cleartext: string): Promise<void>;

  /** Remove the entry for `id`. No-op if absent. */
  deleteSecret(id: string): Promise<void>;

  /** Enumerate every id currently in the store. For credentials-UI listings. */
  listSecretIds(): Promise<string[]>;
}

/**
 * Construct a keychain-backed resolver + writer for a host process.
 *
 * The resolver satisfies `MosaicSecretResolver` (read-only, threaded
 * into `ctx.secrets` for templates). The store is the write side —
 * exposed to the Electron credentials UI via IPC.
 *
 * # Ref scheme
 *
 * `keychain:<id>` — looks up `<id>` in the on-disk index, decrypts via
 * `safeStorage`. `<id>` is opaque and host-chosen; recommended format
 * is `<provider>@<host>` (e.g. `"github@localhost"`) so users can keep
 * multiple endpoints addressable.
 *
 * # Determinism
 *
 * Re-reads the index file on every `get` / `has` / list. No in-memory
 * cache. Writes are atomic (temp + rename) so a partial write can't
 * corrupt the file. Concurrent writers within the same host process
 * are NOT supported — the credentials UI is the only writer; the
 * resolver is read-only.
 *
 * # Failure modes
 *
 * - `safeStorage.isEncryptionAvailable() === false` (Linux without
 *   libsecret): every `setSecret` rejects with an explicit error. The
 *   host should detect this at startup and surface the "OS keyring
 *   unavailable" condition in the UI rather than silently failing
 *   later.
 * - Store file missing: treated as empty map (returns false from
 *   `has`, rejects from `get`).
 * - Store file corrupt: rejects from every method with the parse
 *   error. Manual repair required.
 */
export function createKeychainSecrets(opts: {
  safeStorage: SafeStorageLike;
  storePath: string;
}): { resolver: MosaicSecretResolver; store: KeychainStore } {
  const { safeStorage, storePath } = opts;

  async function loadIndex(): Promise<Record<string, string>> {
    try {
      const txt = await fs.readFile(storePath, "utf8");
      const parsed = JSON.parse(txt);
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
          `keychain store at ${storePath} is not a JSON object`,
        );
      }
      return parsed as Record<string, string>;
    } catch (err) {
      if (
        err != null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "ENOENT"
      ) {
        return {};
      }
      throw err;
    }
  }

  async function saveIndex(index: Record<string, string>): Promise<void> {
    const dir = path.dirname(storePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${storePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
    await fs.rename(tmp, storePath);
  }

  const resolver: MosaicSecretResolver = {
    async get(ref: SecretRef): Promise<string> {
      const id = parseKeychainRef(ref);
      const index = await loadIndex();
      const encoded = index[id];
      if (encoded == null) {
        throw new Error(
          `secret not found: keychain has no entry for ${JSON.stringify(id)} ` +
            `(referenced as ${JSON.stringify(ref)})`,
        );
      }
      try {
        const encrypted = Buffer.from(encoded, "base64");
        return safeStorage.decryptString(encrypted);
      } catch (err) {
        throw new Error(
          `keychain entry for ${JSON.stringify(id)} failed to decrypt — ` +
            `was it stored on a different machine or under a different OS user? ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
      }
    },
    async has(ref: SecretRef): Promise<boolean> {
      try {
        const id = parseKeychainRef(ref);
        const index = await loadIndex();
        return Object.prototype.hasOwnProperty.call(index, id);
      } catch {
        return false;
      }
    },
  };

  const store: KeychainStore = {
    async setSecret(id: string, cleartext: string): Promise<void> {
      if (!isValidId(id)) {
        throw new Error(
          `invalid keychain id ${JSON.stringify(id)} ` +
            `(must be non-empty, max 128 chars, no control characters)`,
        );
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          `OS keyring not available; refusing to store secret in clear text. ` +
            `On Linux, install libsecret + gnome-keyring or KWallet; ` +
            `on macOS / Windows the keyring is built-in and should not be missing.`,
        );
      }
      const encrypted = safeStorage.encryptString(cleartext);
      const index = await loadIndex();
      index[id] = encrypted.toString("base64");
      await saveIndex(index);
    },
    async deleteSecret(id: string): Promise<void> {
      const index = await loadIndex();
      if (!Object.prototype.hasOwnProperty.call(index, id)) return;
      delete index[id];
      await saveIndex(index);
    },
    async listSecretIds(): Promise<string[]> {
      const index = await loadIndex();
      return Object.keys(index).sort();
    },
  };

  return { resolver, store };
}

/**
 * Parse the `keychain:<id>` ref scheme. Rejects refs from other
 * schemes (e.g. `env:foo`) so a misconfigured doc doesn't silently
 * fall through to "no such keychain entry" — the error names the
 * actual problem.
 */
function parseKeychainRef(ref: SecretRef): string {
  const match = /^keychain:(.+)$/.exec(ref);
  if (!match) {
    throw new Error(
      `keychainSecretResolver: unsupported ref ${JSON.stringify(ref)} ` +
        `(expected scheme "keychain:<id>")`,
    );
  }
  const id = match[1].trim();
  if (id.length === 0) {
    throw new Error(
      `keychainSecretResolver: empty id in ref ${JSON.stringify(ref)}`,
    );
  }
  return id;
}

/**
 * Validate a keychain id at write time. The id is user-typed in the
 * credentials UI; we accept anything printable up to 128 chars but
 * reject control characters so a malicious id can't sneak past JSON
 * escaping and produce surprising filenames in error messages.
 */
function isValidId(id: string): boolean {
  if (typeof id !== "string") return false;
  if (id.length === 0 || id.length > 128) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(id)) return false;
  return true;
}
