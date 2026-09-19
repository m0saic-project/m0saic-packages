// Share link — the props payload codec (JSON ⇄ URL-safe string).
//
// Wire form: `z` + base64url( deflate-raw( utf8( JSON ) ) ). The single leading
// character is the payload VERSION: a future codec bumps the prefix and the
// parser rejects anything it does not know, so `z` never changes meaning.
//
// Byte compression sits behind the `ShareCodec` seam so the pure parts
// (base64url, the prefix, JSON, the inflate cap) work with any deflate
// implementation. The default codec is the WHATWG CompressionStream /
// DecompressionStream ("deflate-raw"): zero dependencies, present in
// Chromium, Firefox, Safari 16.4+, Electron and Node 20.12+ as globals — one
// implementation for the web app, the CLI and the desktop main process. An
// older Node can inject `zlib` through the seam.
//
// Why compress at all: a props bag percent-encoded into a query string
// roughly doubles (`"` `{` `,` each cost three chars) and the data-heavy
// templates blow through an 8000-char link cap. Measured on every
// first-party template's FULL default props (2026-09-06): p90 10.8k chars
// percent-encoded vs 2.2k deflated.

export const PAYLOAD_VERSION_PREFIX = "z";

/**
 * Inflate cap. 8000 chars of deflate can expand ~1000×, and a hostile link
 * must not allocate unbounded memory. The biggest real props bag is ~21 KB.
 */
export const MAX_INFLATED_BYTES = 2 * 1024 * 1024;

export type ShareCodec = {
  deflateRaw(bytes: Uint8Array): Promise<Uint8Array>;
  /** Rejects once the inflated size passes `maxBytes`. */
  inflateRaw(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array>;
};

// ---------------------------------------------------------------------------
// base64url (RFC 4648 §5, no padding)
// ---------------------------------------------------------------------------

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Char code → sextet, 255 = not in the alphabet. Indexed by code so a
 *  prototype key (`constructor`) can never read as a valid digit. */
const B64_DECODE = new Uint8Array(256).fill(255);
for (let i = 0; i < B64_ALPHABET.length; i++) B64_DECODE[B64_ALPHABET.charCodeAt(i)] = i;

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63];
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  if (s.length % 4 === 1) throw new Error("Invalid base64url length");
  const sextets = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const v = B64_DECODE[s.charCodeAt(i)] ?? 255;
    if (v === 255) throw new Error("Invalid base64url character");
    sextets[i] = v;
  }
  const full = Math.floor(s.length / 4);
  const rem = s.length - full * 4; // 0, 2 or 3
  const out = new Uint8Array(full * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0));
  let o = 0;
  let i = 0;
  for (; i < full * 4; i += 4) {
    const n = (sextets[i] << 18) | (sextets[i + 1] << 12) | (sextets[i + 2] << 6) | sextets[i + 3];
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  if (rem === 2) {
    out[o++] = ((sextets[i] << 2) | (sextets[i + 1] >> 4)) & 255;
  } else if (rem === 3) {
    const n = (sextets[i] << 12) | (sextets[i + 1] << 6) | sextets[i + 2];
    out[o++] = (n >> 10) & 255;
    out[o++] = (n >> 2) & 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// WHATWG streams codec (the default)
// ---------------------------------------------------------------------------

/**
 * Push `bytes` through a transform and collect the output. Built from a
 * hand-rolled ReadableStream + a reader loop on purpose: `new Response(stream)`
 * would be shorter, but not every host has `Response`, and the reader loop is
 * where the inflate cap is enforced (cancel + throw the moment `maxBytes` is
 * passed, before the rest is even inflated).
 */
async function pumpThrough(
  bytes: Uint8Array,
  // `GenericTransformStream` is what CompressionStream / DecompressionStream
  // extend; their writable side is typed `BufferSource`, wider than the
  // Uint8Array chunks we feed it.
  transform: GenericTransformStream,
  maxBytes: number,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = (source.pipeThrough(transform) as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Share payload too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The default codec: the host's own CompressionStream / DecompressionStream. */
export const streamsShareCodec: ShareCodec = {
  deflateRaw: (bytes) =>
    pumpThrough(bytes, new CompressionStream("deflate-raw"), Number.POSITIVE_INFINITY),
  inflateRaw: (bytes, maxBytes) =>
    pumpThrough(bytes, new DecompressionStream("deflate-raw"), maxBytes),
};

// ---------------------------------------------------------------------------
// JSON payload
// ---------------------------------------------------------------------------

/** `z` + base64url(deflate-raw(utf8(JSON.stringify(value)))). */
export async function encodeSharePayload(
  value: unknown,
  codec: ShareCodec = streamsShareCodec,
): Promise<string> {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  const packed = await codec.deflateRaw(bytes);
  return PAYLOAD_VERSION_PREFIX + toBase64Url(packed);
}

/**
 * Inverse of {@link encodeSharePayload}. Throws on an unknown version prefix,
 * bad base64url, corrupt deflate, an inflated size past
 * {@link MAX_INFLATED_BYTES}, invalid UTF-8, or invalid JSON. Callers turn
 * the throw into a `{ ok: false }` parse result — the URL is user input.
 */
export async function decodeSharePayload(
  payload: string,
  codec: ShareCodec = streamsShareCodec,
): Promise<unknown> {
  if (!payload.startsWith(PAYLOAD_VERSION_PREFIX)) {
    throw new Error("Unsupported share payload version");
  }
  const packed = fromBase64Url(payload.slice(PAYLOAD_VERSION_PREFIX.length));
  const raw = await codec.inflateRaw(packed, MAX_INFLATED_BYTES);
  const json = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  return JSON.parse(json);
}
