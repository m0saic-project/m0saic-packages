import * as crypto from "crypto";
import type {
  InstallId,
  MosaicAnalyticsScrambler,
  MosaicAnalyticsScramblingMode,
} from "@m0saic/types";

const SCRAMBLE_HEX_CHARS = 12;

/**
 * Deterministic install-keyed scrambler (the epic's HMAC-SHA256 spec).
 * Same raw + same install → same output; different installs → different
 * outputs; irreversible for the operator (who never sees the installId
 * used as the key… wait — the operator DOES receive installId).
 *
 * Precision on that last point: the operator receives `installId`, so
 * plain `sha256(installId + raw)` would let them dictionary-attack
 * template ids. HMAC does not fix that by itself — what does is the
 * INPUT space: scrambled values only ever preserve distinct-count
 * semantics upstream (`distinctTemplatesUsed`), the ids themselves are
 * never transmitted (the analytics event union has no slot). The
 * scrambler exists for forward-compatible per-field treatments and for
 * local-side dedup keys.
 */
export function createInstallScrambler(
  installId: InstallId,
): MosaicAnalyticsScrambler {
  return {
    scramble: (raw, namespace) =>
      crypto
        .createHmac("sha256", installId)
        .update(`${namespace}:${raw}`)
        .digest("hex")
        .slice(0, SCRAMBLE_HEX_CHARS),
  };
}

/** `"random"` mode — maximum unlinkability, fresh value per call. */
export function createRandomScrambler(): MosaicAnalyticsScrambler {
  return {
    scramble: () => crypto.randomBytes(SCRAMBLE_HEX_CHARS / 2).toString("hex"),
  };
}

/** `"off"` mode — passthrough (raw sent only where redaction allows). */
export const IDENTITY_SCRAMBLER: MosaicAnalyticsScrambler = {
  scramble: (raw) => raw,
};

/** Scrambler instance for a consent's `scrambling` mode. */
export function createScramblerForMode(
  mode: MosaicAnalyticsScramblingMode,
  installId: InstallId,
): MosaicAnalyticsScrambler {
  switch (mode) {
    case "deterministic":
      return createInstallScrambler(installId);
    case "random":
      return createRandomScrambler();
    case "off":
      return IDENTITY_SCRAMBLER;
  }
}
