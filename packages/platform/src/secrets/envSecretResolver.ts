import type { MosaicSecretResolver, SecretRef } from "@m0saic/types";

/**
 * Environment-variable-backed secret resolver. Day-one tactical impl
 * for CLI / headless renders where the user (or CI) supplies secrets
 * as ambient environment variables.
 *
 * # Ref scheme
 *
 * `env:<NAME>` — looks up `process.env[NAME]`.
 *
 * - `"env:GITHUB_TOKEN"` → `process.env.GITHUB_TOKEN`.
 * - Names are case-sensitive (matches Node's `process.env` semantics
 *   on POSIX; on Windows `process.env` is case-insensitive at the OS
 *   level but `process.env.foo` and `process.env.FOO` resolve to the
 *   same entry — the impl doesn't paper over this).
 *
 * # Why this is day-one tactical
 *
 * No persistence, no encryption, no UI. The user manages secret
 * rotation by `export GITHUB_TOKEN=...` (or `set GITHUB_TOKEN=...`
 * on Windows). Right for CLI use; not the right shape for a desktop
 * app that should remember credentials across launches — see
 * `keychainSecretResolver` for that.
 *
 * # Determinism
 *
 * Reads `process.env` on every call — no caching. If the env changes
 * between two `get` calls (e.g. a long-running daemon that reloads
 * config), the second call sees the new value.
 *
 * # Test seam
 *
 * Accepts an optional `env` parameter so tests can inject a fixture
 * map without polluting `process.env`. Production callers pass nothing
 * and get the live `process.env`.
 */
export function createEnvSecretResolver(
  env: NodeJS.ProcessEnv = process.env,
): MosaicSecretResolver {
  return {
    async get(ref: SecretRef): Promise<string> {
      const name = parseEnvRef(ref);
      const value = env[name];
      if (value == null || value === "") {
        throw new Error(
          `secret not found: env variable ${JSON.stringify(name)} is not set ` +
            `(referenced as ${JSON.stringify(ref)})`,
        );
      }
      return value;
    },
    async has(ref: SecretRef): Promise<boolean> {
      try {
        const name = parseEnvRef(ref);
        const value = env[name];
        return value != null && value !== "";
      } catch {
        return false;
      }
    },
  };
}

/**
 * Parse the `env:NAME` ref scheme. Rejects refs from other schemes
 * (e.g. `keychain:foo`) so a misconfigured doc can't silently fall
 * through to "no such env var" — the error message names the actual
 * problem (wrong scheme) instead.
 */
function parseEnvRef(ref: SecretRef): string {
  const match = /^env:(.+)$/.exec(ref);
  if (!match) {
    throw new Error(
      `envSecretResolver: unsupported ref ${JSON.stringify(ref)} ` +
        `(expected scheme "env:<NAME>")`,
    );
  }
  const name = match[1].trim();
  if (name.length === 0) {
    throw new Error(
      `envSecretResolver: empty env var name in ref ${JSON.stringify(ref)}`,
    );
  }
  return name;
}
