// Share link — the query grammar for a template invocation on the wire.
//
//   t=<templateId>[&p=z<payload>][&w=<int>&h=<int>]
//   [&fps=<int>][&d=<durationMs>][&f=video|image][&a=0|1]
//   [&note=<≤200>][&from=<http(s) url ≤500>]
//
//   t    template id (`@publisher/pack/slug/vN`), exact registry key. The
//        id IS the version: a template is immutable under its id, and a
//        contract change means a new `vN`. There is deliberately no second
//        version pin in the link. It is the ONE required param: a bare
//        `?t=<id>` opens the template at its defaults on its own hinted
//        canvas — short enough for a business card or a tweet.
//   p    props — see payloadCodec.ts. The sender puts ONLY knobs that differ
//        from the template's defaults in here, after stripping machine-local
//        path props (portableProps.ts); the receiver spreads the template's
//        defaults under whatever arrives. Omitted when nothing differs.
//   w h  canvas size, both or neither (2026-09-13: optional). Present, the
//        receiver's size wins over the hints; absent, the template's own
//        `outputHints` canvas applies. Senders omit it when it IS the hint.
//   fps d f a   explicit render asks, present only when they differ from
//        what the template's own hints would set anyway
//   note from   the "where to get this template" handshake for third-party
//        templates. UNTRUSTED: a host renders the note as plain text and the
//        link by hostname, and only when it classifies the id as third-party.
//
// Param ORDER is fixed: a re-share of a received link must be byte-identical.
// Hosts add their own origin and route in front (the web app:
// `https://app.m0saic.io/make?…`) and their own length cap; this module only
// owns the params.

import { NAMESPACED_ID_PATTERN } from "@m0saic/types";
import { decodeSharePayload, encodeSharePayload, PAYLOAD_VERSION_PREFIX, type ShareCodec } from "./payloadCodec";

export const SHARE_NOTE_MAX = 200;
export const SHARE_FROM_MAX = 500;
export const SHARE_TEMPLATE_ID_MAX = 300;
/** Wider than any real canvas; guards the receiver against absurd dims. */
const MAX_CANVAS_DIM = 16384;
const MAX_FPS = 240;
const MAX_DURATION_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Render settings the sender asked for explicitly (beyond the template's hints). */
export type TemplateShareAsks = {
  fps?: number;
  durationMs?: number;
  outputKind?: "video" | "image";
  alpha?: boolean;
};

export type TemplateShareParams = {
  templateId: string;
  props: Record<string, unknown>;
  /** Canvas — both or neither. Absent = the template's hinted canvas. */
  w?: number;
  h?: number;
  asks?: TemplateShareAsks;
  note?: string;
  from?: string;
};

export type TemplateShareParseResult =
  | { ok: true; params: TemplateShareParams }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Sanitizers (used on BOTH build and parse — the URL is user input)
// ---------------------------------------------------------------------------

const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Never travel: input sources are chosen by the recipient. */
const CONVENTION_KEYS = new Set(["sourceId", "sourceIds"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Object.prototype.toString.call(v) === "[object Object]";
}

/** A props bag safe to hand to a template: a plain object with prototype
 *  keys and the input-source convention keys removed. `null` when `v` is
 *  not a plain object at all. */
export function sanitizePropsBag(v: unknown): Record<string, unknown> | null {
  if (!isPlainObject(v)) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v)) {
    if (PROTO_KEYS.has(key) || CONVENTION_KEYS.has(key)) continue;
    out[key] = v[key];
  }
  return out;
}

/** C0 controls + DEL become spaces: a note is one line of plain text. */
function blankControlChars(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out;
}

export function sanitizeShareNote(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = blankControlChars(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > SHARE_NOTE_MAX ? cleaned.slice(0, SHARE_NOTE_MAX) : cleaned;
}

/** Only an absolute http(s) URL survives — `javascript:`, `file:`, relative
 *  paths and oversize strings are dropped, never carried. */
export function sanitizeShareFrom(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > SHARE_FROM_MAX) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return trimmed;
}

function isValidTemplateId(id: string): boolean {
  return id.length > 0 && id.length <= SHARE_TEMPLATE_ID_MAX && NAMESPACED_ID_PATTERN.test(id);
}

function parseBoundedInt(raw: string, min: number, max: number): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Presence / parse / build
// ---------------------------------------------------------------------------

/** True when the query carries the one required param, `t`. */
export function hasTemplateShareParams(search: URLSearchParams): boolean {
  return search.has("t");
}

/**
 * Parse share params from a query. Returns `{ ok: false }` with a message
 * when params are missing or invalid. Optional params that fail validation
 * are an error (a link that says `fps=abc` is broken, not partially right);
 * `note` / `from` are merely dropped, since they never affect what renders.
 */
export async function parseTemplateShareQuery(
  search: URLSearchParams,
  codec?: ShareCodec,
): Promise<TemplateShareParseResult> {
  const t = search.get("t");
  if (t == null) return { ok: false, error: "Missing param: t" };
  if (!isValidTemplateId(t)) {
    return { ok: false, error: "Invalid template id" };
  }

  // Canvas: both or neither. Absent = the template's hinted canvas.
  const wRaw = search.get("w");
  const hRaw = search.get("h");
  if ((wRaw == null) !== (hRaw == null)) return { ok: false, error: "Width and height go together" };
  let w: number | undefined;
  let h: number | undefined;
  if (wRaw != null && hRaw != null) {
    const wv = parseBoundedInt(wRaw, 1, MAX_CANVAS_DIM);
    if (wv == null) return { ok: false, error: `Invalid width: ${wRaw}` };
    const hv = parseBoundedInt(hRaw, 1, MAX_CANVAS_DIM);
    if (hv == null) return { ok: false, error: `Invalid height: ${hRaw}` };
    w = wv;
    h = hv;
  }

  // Props: absent = the template's defaults.
  let props: Record<string, unknown> = {};
  const p = search.get("p");
  if (p != null) {
    if (!p.startsWith(PAYLOAD_VERSION_PREFIX)) {
      return { ok: false, error: "Unsupported share payload" };
    }
    let decoded: unknown;
    try {
      decoded = await decodeSharePayload(p, codec);
    } catch {
      return { ok: false, error: "Invalid share payload" };
    }
    const bag = sanitizePropsBag(decoded);
    if (!bag) return { ok: false, error: "Share payload is not a props object" };
    props = bag;
  }

  const asks: TemplateShareAsks = {};
  const fpsRaw = search.get("fps");
  if (fpsRaw != null) {
    const fps = parseBoundedInt(fpsRaw, 1, MAX_FPS);
    if (fps == null) return { ok: false, error: `Invalid fps: ${fpsRaw}` };
    asks.fps = fps;
  }
  const dRaw = search.get("d");
  if (dRaw != null) {
    const d = parseBoundedInt(dRaw, 1, MAX_DURATION_MS);
    if (d == null) return { ok: false, error: `Invalid duration: ${dRaw}` };
    asks.durationMs = d;
  }
  const fRaw = search.get("f");
  if (fRaw != null) {
    if (fRaw !== "video" && fRaw !== "image") return { ok: false, error: `Invalid format: ${fRaw}` };
    asks.outputKind = fRaw;
  }
  const aRaw = search.get("a");
  if (aRaw != null) {
    if (aRaw !== "0" && aRaw !== "1") return { ok: false, error: `Invalid alpha: ${aRaw}` };
    asks.alpha = aRaw === "1";
  }

  const note = sanitizeShareNote(search.get("note"));
  const from = sanitizeShareFrom(search.get("from"));

  return {
    ok: true,
    params: {
      templateId: t,
      props,
      ...(w != null && h != null ? { w, h } : {}),
      ...(Object.keys(asks).length > 0 ? { asks } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(from !== undefined ? { from } : {}),
    },
  };
}

/** Build the query for a share. Param order is the wire contract (see header). */
export async function buildTemplateShareQuery(
  params: TemplateShareParams,
  codec?: ShareCodec,
): Promise<URLSearchParams> {
  const qs = new URLSearchParams();
  qs.set("t", params.templateId);
  // `p` only when a knob differs from the defaults; `w`/`h` only when the
  // caller passes a canvas (both or neither) — a bare `?t=<id>` is the link
  // to a template at its defaults.
  const bag = sanitizePropsBag(params.props) ?? {};
  if (Object.keys(bag).length > 0) qs.set("p", await encodeSharePayload(bag, codec));
  if ((params.w == null) !== (params.h == null)) throw new Error("Width and height go together");
  if (params.w != null && params.h != null) {
    qs.set("w", String(params.w));
    qs.set("h", String(params.h));
  }
  const asks = params.asks ?? {};
  if (asks.fps != null) qs.set("fps", String(asks.fps));
  if (asks.durationMs != null) qs.set("d", String(asks.durationMs));
  if (asks.outputKind) qs.set("f", asks.outputKind);
  if (asks.alpha !== undefined) qs.set("a", asks.alpha ? "1" : "0");
  const note = sanitizeShareNote(params.note);
  if (note) qs.set("note", note);
  const from = sanitizeShareFrom(params.from);
  if (from) qs.set("from", from);
  return qs;
}
