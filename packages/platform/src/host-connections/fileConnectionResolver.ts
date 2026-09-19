import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  MosaicConnectionResolver,
  MosaicHostConnectionId,
} from "@m0saic/types";

/**
 * A single connection's stored field values. Map from `field.key` →
 * value. Only fields with `kind: "url"` or `kind: "string"` ever appear
 * here; secret-kind fields route through the keychain (see
 * `secrets/keychainSecretResolver`).
 *
 * Values are typed as `unknown` because schemas evolve across pack
 * versions; the host applies a schema-version-keyed migration on
 * read if needed.
 */
export type ConnectionStoreEntry = Record<string, unknown>;

/**
 * Write surface for the connection store. The settings UI in the host
 * mutates connections through this; the resolver below is read-only.
 *
 * One file per host install (`<m0saic-root>/connections.json`) holds
 * every connection profile for every installed pack, keyed by full
 * `<publisher>@<profile>` id.
 */
export interface ConnectionStore {
  /** Read every persisted connection. Returns `{}` when the file is absent. */
  readAll(): Promise<Record<string, ConnectionStoreEntry>>;
  /** Read one connection by id; `undefined` when absent. */
  readOne(id: string): Promise<ConnectionStoreEntry | undefined>;
  /** Persist `values` under `id`. Overwrites any existing entry. */
  writeOne(id: string, values: ConnectionStoreEntry): Promise<void>;
  /** Remove the entry for `id`. No-op when absent. */
  deleteOne(id: string): Promise<void>;
  /** Enumerate every id currently persisted. Sorted for stability. */
  listIds(): Promise<string[]>;
}

/**
 * Construct a file-backed connection resolver + writer for a host
 * process.
 *
 * # File format
 *
 * Trivial JSON: `Record<connectionId, fieldValues>`. Atomic writes via
 * temp-file + rename. Missing file → treated as empty map (returns
 * `undefined` from `get`, `false` from `has`).
 *
 * Example:
 * ```json
 * {
 *   "github-dev@default": { "githubUrl": "http://localhost:9999" }
 * }
 * ```
 *
 * Secrets are NEVER stored here — they live in the keychain and are
 * addressed at render time via a `SecretRef` like
 * `keychain:github-dev@default/apiKey`.
 *
 * # Concurrency
 *
 * Re-reads the file on every `get` / `has` / `readAll` — no in-memory
 * cache. Writes are atomic. Concurrent writers within the same host
 * process are NOT supported; the settings UI is the only writer.
 */
export function createFileConnectionStore(opts: {
  storePath: string;
}): { resolver: MosaicConnectionResolver; store: ConnectionStore } {
  const { storePath } = opts;

  async function loadAll(): Promise<Record<string, ConnectionStoreEntry>> {
    try {
      const txt = await fs.readFile(storePath, "utf8");
      const parsed = JSON.parse(txt);
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
          `connection store at ${storePath} is not a JSON object`,
        );
      }
      // Filter to plain-object values; anything else is malformed and
      // we drop it loudly rather than letting it leak to consumers.
      const out: Record<string, ConnectionStoreEntry> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v != null && typeof v === "object" && !Array.isArray(v)) {
          out[k] = v as ConnectionStoreEntry;
        }
      }
      return out;
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

  async function saveAll(
    all: Record<string, ConnectionStoreEntry>,
  ): Promise<void> {
    const dir = path.dirname(storePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${storePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
    await fs.rename(tmp, storePath);
  }

  function keyOf(id: MosaicHostConnectionId | string): string {
    return String(id);
  }

  const resolver: MosaicConnectionResolver = {
    async get(id) {
      const all = await loadAll();
      return all[keyOf(id)];
    },
    async has(id) {
      const all = await loadAll();
      return Object.prototype.hasOwnProperty.call(all, keyOf(id));
    },
  };

  const store: ConnectionStore = {
    readAll: loadAll,
    async readOne(id) {
      const all = await loadAll();
      return all[id];
    },
    async writeOne(id, values) {
      if (!isValidConnectionId(id)) {
        throw new Error(
          `invalid connection id ${JSON.stringify(id)} ` +
            `(must be '<publisher>@<profile>', non-empty, no whitespace)`,
        );
      }
      if (values == null || typeof values !== "object" || Array.isArray(values)) {
        throw new Error(
          `connection values must be a plain object (got ${typeof values}).`,
        );
      }
      const all = await loadAll();
      all[id] = values;
      await saveAll(all);
    },
    async deleteOne(id) {
      const all = await loadAll();
      if (!Object.prototype.hasOwnProperty.call(all, id)) return;
      delete all[id];
      await saveAll(all);
    },
    async listIds() {
      const all = await loadAll();
      return Object.keys(all).sort();
    },
  };

  return { resolver, store };
}

/**
 * Validate a connection id at the store boundary. Matches the brand
 * validator in `@m0saic/types` (publisher@profile shape) but is
 * duplicated here so the store doesn't need to import the brand
 * helper at runtime — the file is the persistence layer; types live
 * a layer above.
 */
function isValidConnectionId(id: string): boolean {
  if (typeof id !== "string") return false;
  if (id.length === 0 || id.length > 256) return false;
  return /^[^@\s]+@[^@\s]+$/.test(id);
}
