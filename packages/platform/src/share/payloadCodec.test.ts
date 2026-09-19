import {
  PAYLOAD_VERSION_PREFIX,
  MAX_INFLATED_BYTES,
  toBase64Url,
  fromBase64Url,
  streamsShareCodec,
  encodeSharePayload,
  decodeSharePayload,
  type ShareCodec,
} from "./payloadCodec";

const bytesOf = (u: Uint8Array): number[] => Array.from(u);

describe("base64url", () => {
  it("round-trips every remainder length and the high bytes that map to - and _", () => {
    const cases = [
      [],
      [0],
      [0, 0],
      [0, 0, 0],
      [0xff],
      [0xff, 0xff],
      [0xff, 0xff, 0xff],
      [0xfb, 0xff],
      [0xfb, 0xfc, 0xfd, 0xfe, 0xff],
      Array.from({ length: 256 }, (_, i) => i),
    ];
    for (const c of cases) {
      const encoded = toBase64Url(new Uint8Array(c));
      expect(encoded).not.toMatch(/[+/=]/);
      expect(bytesOf(fromBase64Url(encoded))).toEqual(c);
    }
  });

  it("uses the URL alphabet (0xFB 0xFF → -_8, where standard base64 gives +/8=)", () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => fromBase64Url("abc$")).toThrow(/character/);
    expect(() => fromBase64Url("ab+/")).toThrow(/character/);
    expect(() => fromBase64Url("constructor")).not.toThrow();
  });

  it("rejects a length that no byte sequence can produce (≡ 1 mod 4)", () => {
    expect(() => fromBase64Url("abcde")).toThrow(/length/);
    expect(() => fromBase64Url("a")).toThrow(/length/);
  });
});

describe("encodeSharePayload / decodeSharePayload (native deflate-raw)", () => {
  it("prefixes the payload version", async () => {
    const p = await encodeSharePayload({});
    expect(p.startsWith(PAYLOAD_VERSION_PREFIX)).toBe(true);
    expect(p).not.toMatch(/[+/=]/);
  });

  it("round-trips nested props with unicode", async () => {
    const props = { title: "héllo ✓ 日本", data: [1, 2.5, { b: null, c: [true, false] }], m0: "6[1,0,0,0,0,1]" };
    expect(await decodeSharePayload(await encodeSharePayload(props))).toEqual(props);
  });

  it("actually compresses a repetitive bag", async () => {
    const props = { text: "abc ".repeat(4000) };
    const p = await encodeSharePayload(props);
    expect(p.length).toBeLessThan(200);
    expect(await decodeSharePayload(p)).toEqual(props);
  });

  it("rejects an unknown version prefix before touching the bytes", async () => {
    await expect(decodeSharePayload("x" + "AAAA")).rejects.toThrow(/version/);
    await expect(decodeSharePayload("")).rejects.toThrow(/version/);
  });

  it("rejects corrupt payloads", async () => {
    await expect(decodeSharePayload("z!!!!")).rejects.toThrow(/character/);
    await expect(decodeSharePayload("zAAAAAAAA")).rejects.toThrow();
  });

  it("caps the inflated size — a zip bomb cannot allocate past MAX_INFLATED_BYTES", async () => {
    const huge = new Uint8Array(MAX_INFLATED_BYTES + 1024 * 1024);
    const packed = await streamsShareCodec.deflateRaw(huge);
    expect(packed.byteLength).toBeLessThan(64 * 1024);
    await expect(streamsShareCodec.inflateRaw(packed, MAX_INFLATED_BYTES)).rejects.toThrow(/too large/);
    const back = await streamsShareCodec.inflateRaw(packed, huge.byteLength);
    expect(back.byteLength).toBe(huge.byteLength);
  });

  it("honours an injected codec (the seam an older Node plugs zlib into)", async () => {
    const identity: ShareCodec = {
      deflateRaw: async (b) => b,
      inflateRaw: async (b) => b,
    };
    const props = { a: 1 };
    const p = await encodeSharePayload(props, identity);
    expect(p).toBe(PAYLOAD_VERSION_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(props))));
    expect(await decodeSharePayload(p, identity)).toEqual(props);
  });
});
