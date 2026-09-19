import { describe, expect, it } from "@jest/globals";
import {
  bitsToPayloadHex,
  encodePayload,
  padToK,
  paramsForMode,
  payloadHexToBits,
} from "./encoder";
import { DEFAULT_ALPHA_OPTS } from "./alphaPerCell";

describe("payloadHexToBits / bitsToPayloadHex", () => {
  it("round-trips a 32-bit payload", () => {
    const hex = "deadbeef";
    const bits = payloadHexToBits(hex, 32);
    expect(bits).toHaveLength(32);
    expect(bitsToPayloadHex(bits)).toBe(hex);
  });

  it("round-trips a 128-bit UUID", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    const bits = payloadHexToBits(hex, 128);
    expect(bits).toHaveLength(128);
    expect(bitsToPayloadHex(bits)).toBe(hex);
  });

  it("accepts upper-case and an 0x prefix", () => {
    expect(payloadHexToBits("0xDEADBEEF", 32)).toEqual(
      payloadHexToBits("deadbeef", 32),
    );
  });

  it("rejects wrong-length hex", () => {
    expect(() => payloadHexToBits("dead", 32)).toThrow();
    expect(() => payloadHexToBits("deadbeefca", 32)).toThrow();
  });

  it("rejects invalid hex chars", () => {
    expect(() => payloadHexToBits("zeadbeef", 32)).toThrow();
  });

  it("MSB-first bit ordering", () => {
    const bits = payloadHexToBits("80000000", 32);
    expect(bits[0]).toBe(1);
    for (let i = 1; i < 32; i += 1) expect(bits[i]).toBe(0);
  });
});

describe("padToK", () => {
  it("appends zeros on the LSB side", () => {
    const bits = [1, 0, 1, 1];
    const padded = padToK(bits, 8);
    expect(padded).toEqual([1, 0, 1, 1, 0, 0, 0, 0]);
  });

  it("returns the input unchanged when already k bits", () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 0];
    expect(padToK(bits, 8)).toEqual(bits);
  });

  it("throws when input exceeds k", () => {
    expect(() => padToK([1, 0, 1, 1, 0, 0, 1, 0, 1], 8)).toThrow();
  });
});

describe("paramsForMode", () => {
  it("id32 → BCH(127, ?, 15) with 32-bit payload", () => {
    const r = paramsForMode("id32");
    expect(r.params.n).toBe(127);
    expect(r.payloadBits).toBe(32);
  });

  it("uuid128 → BCH(255, ?, 18) with 128-bit payload", () => {
    const r = paramsForMode("uuid128");
    expect(r.params.n).toBe(255);
    expect(r.payloadBits).toBe(128);
  });
});

describe("encodePayload — end-to-end", () => {
  it("deterministic: same inputs produce same cells + codeword", () => {
    const a = encodePayload({
      mode: "id32",
      payloadHex: "deadbeef",
      seed: 0xc0ffee,
      cols: 64,
      rows: 36,
      alpha: DEFAULT_ALPHA_OPTS,
    });
    const b = encodePayload({
      mode: "id32",
      payloadHex: "deadbeef",
      seed: 0xc0ffee,
      cols: 64,
      rows: 36,
      alpha: DEFAULT_ALPHA_OPTS,
    });
    expect(a.codeword).toEqual(b.codeword);
    expect(a.cells.map((c) => c.polarity)).toEqual(
      b.cells.map((c) => c.polarity),
    );
    expect(a.cells.map((c) => c.alpha)).toEqual(
      b.cells.map((c) => c.alpha),
    );
  });

  it("different payloads → different codewords (and cell polarities)", () => {
    const a = encodePayload({
      mode: "id32",
      payloadHex: "00000000",
      seed: 1,
      cols: 32,
      rows: 18,
      alpha: DEFAULT_ALPHA_OPTS,
    });
    const b = encodePayload({
      mode: "id32",
      payloadHex: "ffffffff",
      seed: 1,
      cols: 32,
      rows: 18,
      alpha: DEFAULT_ALPHA_OPTS,
    });
    expect(a.codeword).not.toEqual(b.codeword);
  });

  it("luminance-adaptive scales α: dark/bright cells get smaller α", () => {
    const cols = 32;
    const rows = 18;
    const cells = cols * rows;
    const hostLuma: number[] = new Array(cells);
    for (let i = 0; i < cells; i += 1) {
      // Alternating extreme/mid pattern
      hostLuma[i] = i % 2 === 0 ? 0 : 128;
    }
    const result = encodePayload({
      mode: "id32",
      payloadHex: "deadbeef",
      seed: 7,
      cols,
      rows,
      alpha: DEFAULT_ALPHA_OPTS,
      hostLuminance: hostLuma,
    });
    for (let i = 0; i < cells; i += 2) {
      expect(result.cells[i]!.alpha).toBeLessThan(result.cells[i + 1]!.alpha);
    }
  });

  it("cells.length === cols * rows for id32 mode", () => {
    const r = encodePayload({
      mode: "id32",
      payloadHex: "deadbeef",
      seed: 99,
      cols: 64,
      rows: 36,
      alpha: DEFAULT_ALPHA_OPTS,
    });
    expect(r.cells).toHaveLength(64 * 36);
  });

  it("polarity is always ±1", () => {
    const r = encodePayload({
      mode: "id32",
      payloadHex: "deadbeef",
      seed: 99,
      cols: 32,
      rows: 18,
      alpha: DEFAULT_ALPHA_OPTS,
    });
    for (const c of r.cells) {
      expect(c.polarity === 1 || c.polarity === -1).toBe(true);
    }
  });
});

describe("encodePayload — hostActivity", () => {
  it("flat cells embed weaker than textured cells at equal luminance", () => {
    const cols = 16, rows = 9, n = cols * rows;
    const result = encodePayload({
      mode: "id32",
      payloadHex: "deadbeef",
      seed: 0x1234abcd,
      cols,
      rows,
      alpha: DEFAULT_ALPHA_OPTS,
      hostLuminance: new Array(n).fill(128),
      // first half flat, second half fully textured
      hostActivity: Array.from({ length: n }, (_, i) => (i < n / 2 ? 0 : 40)),
    });
    const flat = result.cells.slice(0, n / 2).map((c) => c.alpha);
    const textured = result.cells.slice(n / 2).map((c) => c.alpha);
    expect(Math.max(...flat)).toBeCloseTo(DEFAULT_ALPHA_OPTS.alphaMin, 9);
    expect(Math.min(...textured)).toBeCloseTo(DEFAULT_ALPHA_OPTS.alphaMax, 9);
  });
});
