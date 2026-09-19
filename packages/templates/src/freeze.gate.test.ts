/**
 * Stage 0 as a unit test — so `npm test` in this package is a freeze lock too,
 * not only `npm run build` (check-registry.mjs) and the pre-commit hook.
 *
 * Pure filesystem + hashing against the COMMITTED manifest: no registry load,
 * no render. If this fails, someone changed code in a frozen file (comments
 * only!), deleted one, or the manifest was minted under another hash version
 * (re-mint at a release — never to clear this test). Contract: .ai/CLAUDE.md §10.
 */
import * as path from "node:path";
import { FREEZE_HASH_VERSION, checkFreeze, manifestHashVersion, readFreezeManifest } from "./freeze";

const PACKAGE_ROOT = path.resolve(__dirname, "..");

describe("freeze gate (Stage 0) against the committed manifest", () => {
  const manifest = readFreezeManifest(PACKAGE_ROOT);

  it("the manifest is committed", () => {
    expect(manifest).not.toBeNull();
    expect(Object.keys(manifest!.files).length).toBeGreaterThan(0);
  });

  it("was minted with the hash version this checker implements (else: re-mint at a release)", () => {
    expect(`manifest minted with hash v${manifestHashVersion(manifest!)}, checker is v${FREEZE_HASH_VERSION}`)
      .toBe(`manifest minted with hash v${FREEZE_HASH_VERSION}, checker is v${FREEZE_HASH_VERSION}`);
  });

  it("no frozen file changed or was deleted (comments only; a change is a new vN+1 folder)", () => {
    const r = checkFreeze(PACKAGE_ROOT, manifest!);
    expect(r.hashVersionMismatch?.message).toBeUndefined();
    expect({ changed: r.changed, deleted: r.deleted }).toEqual({ changed: [], deleted: [] });
    expect(r.ok).toBe(true);
    expect(r.unchanged.length).toBe(Object.keys(manifest!.files).length);
  });
});
