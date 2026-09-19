import type { MosaicSecretResolver, SecretRef } from "@m0saic/types";

/**
 * The scheme part of a `<scheme>:<rest>` ref. Null when malformed.
 *
 * Case-SENSITIVE on purpose: this router delegates the ref verbatim, and the
 * resolvers it delegates to match their own scheme exactly (`/^env:/`). Routing
 * `ENV:FOO` to the env resolver would just move the rejection one layer down
 * with a worse message, so a mixed-case scheme is reported as unsupported here
 * — which at least names the schemes that do work.
 */
function refScheme(ref: SecretRef): string | null {
  const match = /^([a-zA-Z0-9_-]+):/.exec(String(ref));
  return match ? match[1] : null;
}

/**
 * Route a secret ref to the resolver that owns its scheme.
 *
 * A host usually has MORE THAN ONE credential store, and each single-scheme
 * resolver deliberately rejects refs it doesn't own so a misconfigured
 * document names its actual problem instead of reporting "not found". That is
 * right per-resolver and wrong per-host: the desktop app wired only the
 * keychain resolver, so `env:` refs — the scheme the CLI resolves, and the one
 * the docs tell authors to write — were rejected outright. A `.mosaic`
 * authored against the CLI rendered there and died in Make, which makes the
 * document format non-portable across hosts.
 *
 * This composes them instead: each scheme goes to its own resolver, and an
 * unknown scheme produces one error naming every scheme the host DOES support
 * — the diagnostic a single-scheme resolver cannot give.
 *
 * Hosts differ in which stores they can offer (the CLI has no OS keyring, so
 * it is env-only). That asymmetry is expected; silently rejecting a scheme
 * another host resolves is not.
 */
export function createSchemeSecretResolver(
  byScheme: Readonly<Record<string, MosaicSecretResolver>>,
): MosaicSecretResolver {
  const schemes = Object.keys(byScheme).sort();

  const pick = (ref: SecretRef): MosaicSecretResolver | null => {
    const scheme = refScheme(ref);
    return scheme ? (byScheme[scheme] ?? null) : null;
  };

  const unsupported = (ref: SecretRef): Error =>
    new Error(
      `secretRef ${JSON.stringify(String(ref))} uses a scheme this host cannot ` +
        `resolve. Supported here: ${schemes.map((s) => `${s}:<id>`).join(", ")}.`,
    );

  return {
    async get(ref: SecretRef): Promise<string> {
      const resolver = pick(ref);
      if (!resolver) throw unsupported(ref);
      return resolver.get(ref);
    },
    async has(ref: SecretRef): Promise<boolean> {
      const resolver = pick(ref);
      // Non-throwing by contract: an unsupported scheme is simply absent.
      if (!resolver) return false;
      return resolver.has(ref);
    },
  };
}
