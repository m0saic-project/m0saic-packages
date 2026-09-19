/**
 * Bridge protocol versioning — the compatibility handshake for the three
 * file/loopback bridges between the m0saic CLI and Mosaic Desktop:
 *
 *   1. momo rendezvous  `~/m0saic/momo/bridge.json`   (+ its /momo and /make POSTs)
 *   2. render feed      `~/m0saic/render/active.json` + `live.jsonl` records
 *
 * Contract (see docs/compat-bridges.md):
 *   - Writers stamp `protocolVersion` (this constant) + their own app version.
 *   - Readers WARN and continue on mismatch or missing fields — never block.
 *     A missing field means a pre-versioning peer (< CLI v1.0.0).
 *   - Fields are additive-only. Bump the version only for a breaking shape
 *     change, which per the v1 compat contract should be ~never.
 */

export const M0SAIC_BRIDGE_PROTOCOL_VERSION = 1;

export type BridgePeerInfo = {
  protocolVersion?: unknown;
  appVersion?: unknown;
};

/**
 * Warn-never-block compat check. Returns a single printable warning line when
 * the peer looks older/newer than us, or null when compatible. Callers decide
 * where the line goes (CLI stderr, electron console) and how often (once per
 * process is plenty).
 */
export function bridgeCompatWarning(
  peer: BridgePeerInfo | null | undefined,
  opts: { peerName: string; selfName: string },
): string | null {
  const v = peer?.protocolVersion;
  if (typeof v !== "number") {
    return (
      `${opts.peerName} predates bridge versioning — ` +
      `update it to match ${opts.selfName} if anything misbehaves.`
    );
  }
  if (v !== M0SAIC_BRIDGE_PROTOCOL_VERSION) {
    const appV =
      typeof peer?.appVersion === "string" ? ` (${opts.peerName} ${peer.appVersion})` : "";
    return (
      `${opts.peerName} speaks bridge protocol v${v}, ` +
      `${opts.selfName} speaks v${M0SAIC_BRIDGE_PROTOCOL_VERSION}${appV} — ` +
      `update the older side if anything misbehaves.`
    );
  }
  return null;
}
