import {
  bridgeCompatWarning,
  M0SAIC_BRIDGE_PROTOCOL_VERSION,
} from "./protocol";

const OPTS = { peerName: "Mosaic Desktop", selfName: "the m0saic CLI" };

describe("bridgeCompatWarning", () => {
  it("null (compatible) on the current protocol version", () => {
    expect(
      bridgeCompatWarning(
        { protocolVersion: M0SAIC_BRIDGE_PROTOCOL_VERSION, appVersion: "1.0.0" },
        OPTS,
      ),
    ).toBeNull();
  });

  it("missing field → pre-versioning peer warning, never a throw", () => {
    for (const peer of [undefined, null, {}, { appVersion: "0.1.0" }]) {
      const w = bridgeCompatWarning(peer as never, OPTS);
      expect(w).toContain("predates bridge versioning");
      expect(w).toContain("Mosaic Desktop");
    }
  });

  it("mismatched version → warning naming both sides and the peer app version", () => {
    const w = bridgeCompatWarning(
      { protocolVersion: 99, appVersion: "9.9.9" },
      OPTS,
    );
    expect(w).toContain("v99");
    expect(w).toContain(`v${M0SAIC_BRIDGE_PROTOCOL_VERSION}`);
    expect(w).toContain("9.9.9");
  });

  it("non-numeric protocolVersion treated as pre-versioning", () => {
    expect(bridgeCompatWarning({ protocolVersion: "1" }, OPTS)).toContain(
      "predates",
    );
  });
});
