import { asInstallId } from "@m0saic/types";
import {
  IDENTITY_SCRAMBLER,
  createInstallScrambler,
  createRandomScrambler,
  createScramblerForMode,
} from "./scrambler";

const A = asInstallId("550e8400-e29b-41d4-a716-446655440000");
const B = asInstallId("650e8400-e29b-41d4-a716-446655440000");

describe("createInstallScrambler", () => {
  it("is deterministic per install and 12 hex chars", () => {
    const s = createInstallScrambler(A);
    const one = s.scramble("@m0saic/a/b/v1", "template_id");
    const two = s.scramble("@m0saic/a/b/v1", "template_id");
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{12}$/);
  });

  it("differs across installs (no cross-install correlation)", () => {
    const a = createInstallScrambler(A).scramble("x", "template_id");
    const b = createInstallScrambler(B).scramble("x", "template_id");
    expect(a).not.toBe(b);
  });

  it("namespaces prevent cross-type collisions", () => {
    const s = createInstallScrambler(A);
    expect(s.scramble("foo", "template_id")).not.toBe(
      s.scramble("foo", "asset_id"),
    );
  });
});

describe("mode variants", () => {
  it("random differs per call", () => {
    const s = createRandomScrambler();
    expect(s.scramble("x", "template_id")).not.toBe(
      s.scramble("x", "template_id"),
    );
  });

  it("off is passthrough", () => {
    expect(IDENTITY_SCRAMBLER.scramble("raw-id", "template_id")).toBe("raw-id");
  });

  it("createScramblerForMode dispatches all three modes", () => {
    expect(
      createScramblerForMode("deterministic", A).scramble("x", "template_id"),
    ).toMatch(/^[0-9a-f]{12}$/);
    expect(createScramblerForMode("off", A).scramble("x", "template_id")).toBe(
      "x",
    );
    expect(
      createScramblerForMode("random", A).scramble("x", "template_id"),
    ).toMatch(/^[0-9a-f]{12}$/);
  });
});
