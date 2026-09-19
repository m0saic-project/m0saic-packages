import { identityLine, resolveTarget, tileLine } from "./manifest";
import { awardToTileIndex, subjectOf } from "./target";
import type { ResolvedPreview } from "./props";

describe("resolveTarget (bundled seed)", () => {
  it("resolves the founder root by 'root', by '0' and by handle", () => {
    for (const tile of ["root", "0", "@m0saic-dev", "M0SAIC-DEV"]) {
      const r = resolveTarget({ communityDir: "", m: "001", tile, asOf: "now" });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.target.slot.slot).toBe(0);
      expect(r.target.slot.tileIndex).toBe(32);
      expect((r.target.tileImage as { kind: string; path: string }).path.endsWith("tile.png")).toBe(true);
      expect(r.target.synthetic).toBe(false);
      expect(r.target.claimedTiles.get(32)?.slot.handle).toBe("m0saic-dev");
      expect(r.target.rootShown).toBe(true);
    }
  });
  it("fails fast on an unknown M, an unclaimed slot, an unknown handle, a bad folder", () => {
    expect(resolveTarget({ communityDir: "", m: "009", tile: "root", asOf: "now" })).toMatchObject({ ok: false });
    expect(resolveTarget({ communityDir: "", m: "001", tile: "1", asOf: "now" })).toMatchObject({ ok: false, error: expect.stringMatching(/unclaimed/) });
    expect(resolveTarget({ communityDir: "", m: "001", tile: "nobody", asOf: "now" })).toMatchObject({ ok: false });
    expect(resolveTarget({ communityDir: "/definitely/not/here", m: "001", tile: "root", asOf: "now" })).toMatchObject({ ok: false, error: expect.stringMatching(/index.json/) });
  });
  it("stands an UNCLAIMED slot up when the dev preview asks for it", () => {
    const r = resolveTarget({ communityDir: "", m: "001", tile: "2", asOf: "now", allowUnclaimed: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.synthetic).toBe(true);
    expect(r.target.tileImage).toBeNull();
    // Claim 2 takes the 2nd tile of the M's own deal order.
    expect(r.target.slot.tileIndex).toBe(r.target.entry.claimOrder[1]);
    expect(r.target.slot.stableKey).toBeTruthy();
    // The real claims are still painted.
    expect(r.target.claimedTiles.get(32)?.slot.handle).toBe("m0saic-dev");
    // A handle nobody holds still fails, and the plain error points at the lever.
    expect(resolveTarget({ communityDir: "", m: "001", tile: "nobody", asOf: "now", allowUnclaimed: true })).toMatchObject({ ok: false });
    expect(resolveTarget({ communityDir: "", m: "001", tile: "1", asOf: "now" })).toMatchObject({ ok: false, error: expect.stringMatching(/Dev preview/) });
  });
  it("asOf 'claim' shows only claims up to this tile's timestamp", () => {
    const r = resolveTarget({ communityDir: "", m: "001", tile: "root", asOf: "claim" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.target.claimedTiles.size).toBe(1);
  });
});

describe("caption lines", () => {
  it("state the M identity and the tile", () => {
    const r = resolveTarget({ communityDir: "", m: "001", tile: "root", asOf: "now" });
    if (!r.ok) throw new Error(r.error);
    expect(identityLine(r.target.entry)).toBe("Community M #001 - opened 2026-04-15 - in progress");
    expect(tileLine(r.target.entry, r.target.slot)).toBe("tile 32 - root - @m0saic-dev - 2026-04-15");
  });
});

describe("Subject tile lever speaks award order (founder, 2026-09-16)", () => {
  const pv = (tile: number | null): ResolvedPreview => ({ claims: 0, style: "mix", seed: 1, logoShare: 0.34, tile, piece: "off", pieceAspect: "16:9" });
  it("claim N is the Nth tile the Community page lists, 0 is the root — never the geometry index", () => {
    const r = resolveTarget({ communityDir: "", m: "001", tile: "root", asOf: "now" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = r.target.entry;
    expect(awardToTileIndex(entry, 1)).toEqual({ tileIndex: entry.claimOrder[0], claimNo: 1 });
    expect(awardToTileIndex(entry, 12)).toEqual({ tileIndex: entry.claimOrder[11], claimNo: 12 });
    expect(awardToTileIndex(entry, 32)).toEqual({ tileIndex: entry.claimOrder[31], claimNo: 32 });
    expect(awardToTileIndex(entry, 0)).toEqual({ tileIndex: 32, claimNo: null });
    expect(() => awardToTileIndex(entry, 33)).toThrow(/past this M/);
    // The seed M deals tile 20 first — which is not geometry tile 1.
    expect(entry.claimOrder[0]).toBe(20);
  });
  it("subjectOf agrees with the main tile prop for the same claim, and captions both numbers", () => {
    const viaLever = resolveTarget({ communityDir: "", m: "001", tile: "root", asOf: "now" });
    const viaProp = resolveTarget({ communityDir: "", m: "001", tile: "2", asOf: "now", allowUnclaimed: true });
    expect(viaLever.ok && viaProp.ok).toBe(true);
    if (!viaLever.ok || !viaProp.ok) return;
    const s = subjectOf(viaLever.target, pv(2));
    expect(s.tileIndex).toBe(viaProp.target.slot.tileIndex);
    expect(s.standIn).toBe(true);
    expect(s.caption).toBe(`tile ${s.tileIndex} - claim 2 of 32 - preview stand-in - mixed, unclaimed`);
    // Unset lever → the resolved slot (the real root here, no stand-in).
    const real = subjectOf(viaLever.target, pv(null));
    expect(real.tileIndex).toBe(32);
    expect(real.standIn).toBe(false);
  });
});
