/**
 * Official dictionary generator: QR Code
 *
 * Encodes arbitrary text as a QR code on the fly. Thin wrapper around
 * `@m0saic/dsl-stdlib`'s `qrToM0`: the encoder + matrix + DSL emission
 * all live in stdlib; this generator just surfaces the knobs in the
 * dictionary's UI grammar.
 *
 * Three flows the user can drive:
 *   1. Basic — type the text (URL, structured payload, etc.), get a QR.
 *      Everything else takes defaults.
 *   2. Advanced — tune error-correction level, quiet zone, and force a
 *      specific QR version.
 *   3. Safe-area — carve out a centred frame for a logo. The canvas
 *      auto-adjusts so the safe area is at least the requested pixel
 *      size; the cell grid is forced to integer pixels so the rendered
 *      F matches the request exactly.
 */

import { parseM0StringToRenderFrames, toCanonicalM0String } from "@m0saic/dsl";
import {
  qrPayloadGeo,
  qrPayloadMailto,
  qrPayloadSms,
  qrPayloadTel,
  qrPayloadVCard,
  qrPayloadWifi,
  qrToM0,
  queryFrames,
  type QrChannel,
  type QrChannelConfig,
} from "@m0saic/dsl-stdlib";
import { serializeM0cFile, type M0cMaskEntry } from "@m0saic/dsl-file-formats";
import { labelTierParam, resolveLabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

export type QrPayloadType = "text" | "wifi" | "vcard" | "mailto" | "sms" | "tel" | "geo";

// ── Descriptor ────────────────────────────────────────────

export const qrCodeDescriptor: GeneratorDescriptor = {
  id: "qr-code",
  title: "QR Code",
  description:
    "Encode any text as a QR — URL, plain string, or structured payload (wifi, vCard, mailto, etc.). Optional centred safe area for a logo, with auto-scaled canvas.",
  category: "brand",
  group: "Core",
  params: [
    {
      key: "payloadType",
      title: "Payload",
      type: "enum",
      default: "text",
      description: "What you're encoding. Pick a structured type to expose the right input fields (the generator builds the canonical text for you); 'Text' is the free-form fallback.",
      options: [
        { value: "text", label: "Text", description: "Any string — URLs, plain text, or a payload you formatted yourself." },
        { value: "wifi", label: "Wi-Fi", description: "Phones offer 'Join Wi-Fi network …' on scan." },
        { value: "vcard", label: "Contact (vCard)", description: "Phones offer 'Add to contacts' on scan." },
        { value: "mailto", label: "Email (mailto:)", description: "Phones open a pre-filled email composer." },
        { value: "sms", label: "SMS", description: "Phones open the messaging app with the body pre-filled." },
        { value: "tel", label: "Phone (tel:)", description: "Phones offer to dial the number." },
        { value: "geo", label: "Geo location", description: "Phones offer to open the coords in Maps." },
      ],
    },

    // ── Text payload ────────────────────────────────────────
    {
      key: "text",
      title: "Text",
      type: "string",
      default: "https://m0saic.io",
      placeholder: "https://example.com",
      description: "The text to encode. Mode is auto-detected: numeric digits, alphanumeric uppercase + a few symbols, or full UTF-8 byte mode.",
      visibleWhen: { payloadType: "text" },
    },

    // ── Wi-Fi payload ───────────────────────────────────────
    {
      key: "wifiSsid",
      title: "SSID",
      type: "string",
      default: "",
      placeholder: "MyNetwork",
      description: "Wi-Fi network name. Required.",
      visibleWhen: { payloadType: "wifi" },
    },
    {
      key: "wifiEncryption",
      title: "Security",
      type: "enum",
      default: "WPA",
      description: "Network security type.",
      options: [
        { value: "WPA", label: "WPA / WPA2 / WPA3", description: "The common modern choice." },
        { value: "WEP", label: "WEP", description: "Legacy; rarely used." },
        { value: "nopass", label: "Open (no password)", description: "Public networks." },
      ],
      visibleWhen: { payloadType: "wifi" },
    },
    {
      key: "wifiPassword",
      title: "Password",
      type: "string",
      default: "",
      placeholder: "(network password)",
      description: "Pre-shared key. Special characters (\\, ;, ,, :, \") are escaped automatically.",
      visibleWhen: { payloadType: "wifi", wifiEncryption: ["WPA", "WEP"] },
    },
    {
      key: "wifiHidden",
      title: "Hidden network",
      type: "bool",
      default: false,
      description: "Mark the SSID as hidden so scanners know to broadcast it explicitly when joining.",
      visibleWhen: { payloadType: "wifi" },
    },

    // ── vCard payload ───────────────────────────────────────
    {
      key: "vcardFullName",
      title: "Full name",
      type: "string",
      default: "",
      placeholder: "Ada Lovelace",
      description: "Display name (the FN field). Required.",
      visibleWhen: { payloadType: "vcard" },
    },
    {
      key: "vcardOrg",
      title: "Organization",
      type: "string",
      default: "",
      placeholder: "Analytical Engine, Ltd.",
      visibleWhen: { payloadType: "vcard" },
    },
    {
      key: "vcardTitle",
      title: "Title",
      type: "string",
      default: "",
      placeholder: "Mathematician",
      visibleWhen: { payloadType: "vcard" },
    },
    {
      key: "vcardPhone",
      title: "Phone",
      type: "string",
      default: "",
      placeholder: "+1 555 123 4567",
      visibleWhen: { payloadType: "vcard" },
    },
    {
      key: "vcardEmail",
      title: "Email",
      type: "string",
      default: "",
      placeholder: "ada@example.com",
      visibleWhen: { payloadType: "vcard" },
    },
    {
      key: "vcardUrl",
      title: "Website",
      type: "string",
      default: "",
      placeholder: "https://example.com",
      visibleWhen: { payloadType: "vcard" },
    },

    // ── Mailto payload ──────────────────────────────────────
    {
      key: "mailtoTo",
      title: "To",
      type: "string",
      default: "",
      placeholder: "you@example.com",
      description: "Recipient address. Required.",
      visibleWhen: { payloadType: "mailto" },
    },
    {
      key: "mailtoSubject",
      title: "Subject",
      type: "string",
      default: "",
      placeholder: "(optional)",
      visibleWhen: { payloadType: "mailto" },
    },
    {
      key: "mailtoBody",
      title: "Body",
      type: "string",
      default: "",
      placeholder: "(optional)",
      visibleWhen: { payloadType: "mailto" },
    },

    // ── SMS payload ─────────────────────────────────────────
    {
      key: "smsPhone",
      title: "Phone",
      type: "string",
      default: "",
      placeholder: "+1 555 123 4567",
      description: "Destination number. Visual separators (spaces, dashes, parens) are stripped.",
      visibleWhen: { payloadType: "sms" },
    },
    {
      key: "smsBody",
      title: "Body",
      type: "string",
      default: "",
      placeholder: "(optional)",
      visibleWhen: { payloadType: "sms" },
    },

    // ── Tel payload ─────────────────────────────────────────
    {
      key: "telPhone",
      title: "Phone",
      type: "string",
      default: "",
      placeholder: "+1 555 123 4567",
      description: "Number to dial. Visual separators are stripped.",
      visibleWhen: { payloadType: "tel" },
    },

    // ── Geo payload ─────────────────────────────────────────
    {
      key: "geoLat",
      title: "Latitude",
      type: "float",
      default: 37.7869,
      min: -90,
      max: 90,
      step: 0.0001,
      description: "Decimal degrees, north positive.",
      visibleWhen: { payloadType: "geo" },
    },
    {
      key: "geoLng",
      title: "Longitude",
      type: "float",
      default: -122.3996,
      min: -180,
      max: 180,
      step: 0.0001,
      description: "Decimal degrees, east positive.",
      visibleWhen: { payloadType: "geo" },
    },
    {
      key: "geoQuery",
      title: "Label",
      type: "string",
      default: "",
      placeholder: "Pier 39",
      description: "Optional search query / label shown by Maps apps.",
      visibleWhen: { payloadType: "geo" },
    },

    // ── Read-only echo of what actually gets encoded ────────
    // For structured payload types the sub-fields are assembled into a
    // canonical string by qrPayload*; this field surfaces that string so
    // users can see (and copy) exactly what the QR carries. Hidden in
    // "text" mode where it would just duplicate the editable input.
    {
      key: "resolvedPayload",
      title: "Encoded text",
      type: "string",
      default: "",
      readOnly: true,
      description: "The exact string fed into the QR encoder. Computed from the structured-payload fields above.",
      visibleWhen: { payloadType: ["wifi", "vcard", "mailto", "sms", "tel", "geo"] },
    },

    // Safe-area knobs — most flows touch this either to enable or skip it.
    {
      key: "safeAreaMode",
      title: "Safe area",
      type: "enum",
      default: "none",
      description: "Reserve a centred region for a logo. 'none' = full QR with no carve. 'carve' = remove modules in the centre and emit a labeled splice point you can replace at render time.",
      options: [
        { value: "none", label: "None", description: "Full QR; no centre carve." },
        { value: "carve", label: "Carve frame", description: "Carve the centre cells out of the base layer and emit a single labeled F overlay. Use replaceNodeByStableId at render time to splice your logo in." },
      ],
    },
    {
      key: "safeAreaWidth",
      title: "Safe area width (px)",
      type: "int",
      default: 272,
      min: 1,
      max: 4096,
      description: "Inner safe-area width in final-canvas pixels. The canvas auto-scales so the safe area is at least this size; cell sizes are forced to integer pixels so the rendered F matches the request exactly.",
      visibleWhen: { safeAreaMode: ["carve"] },
    },
    {
      key: "safeAreaHeight",
      title: "Safe area height (px)",
      type: "int",
      default: 272,
      min: 1,
      max: 4096,
      description: "Inner safe-area height in final-canvas pixels. Non-square targets are letterboxed inside the canonical square via an inner placeRect; the F splice point is the W×H rect.",
      visibleWhen: { safeAreaMode: ["carve"] },
    },
    {
      key: "paddingPct",
      title: "Padding (%)",
      type: "float",
      default: 0,
      min: 0,
      max: 49,
      step: 1,
      description: "Padding between QR modules and the inner safe-area rect, as % of safe-area max dim. Pushes the canvas larger so there's breathing room around the logo.",
      visibleWhen: { safeAreaMode: ["carve"] },
    },

    // Advanced QR encoder knobs.
    {
      key: "errorCorrectionLevel",
      title: "Error correction",
      type: "enum",
      default: "M",
      description: "QR ECC level. Higher = more damage tolerance + larger code. ECC 'H' tolerates ~30% damaged modules (matters when the safe area covers a chunk of the QR).",
      options: [
        { value: "L", label: "L · ~7%", description: "Lowest correction; smallest code." },
        { value: "M", label: "M · ~15%", description: "Default — balanced size + reliability." },
        { value: "Q", label: "Q · ~25%", description: "Tolerant of moderate damage." },
        { value: "H", label: "H · ~30%", description: "Highest correction; recommended when carving a safe area." },
      ],
    },
    {
      key: "quietZoneModules",
      title: "Quiet zone (modules)",
      type: "int",
      default: 4,
      min: 0,
      max: 16,
      description: "Light-cell border around the QR. ISO 18004 mandates ≥4 for reliable scanning. Set 0 to inspect the raw matrix.",
    },
    {
      key: "version",
      title: "Force version (0 = auto)",
      type: "int",
      default: 0,
      min: 0,
      max: 40,
      description: "Force a specific QR version (1–40). 0 lets the encoder pick the smallest version that fits the data at the chosen ECC level.",
    },
    {
      key: "pack",
      title: "Pack dark cells",
      type: "bool",
      default: false,
      description: "Engine-perf optimization: collapse dark cells into the fewest axis-aligned rects (rowwise greedy). Visual output identical; frame count drops 2–3× on typical QRs. Useful for static renders where per-cell control isn't needed.",
    },
    // ── Rounding sliders ─────────────────────────────────────
    // Two independent percentages that drive per-leaf inline masks in
    // the emitted `.m0c`. Each percentage produces a rounded-rect path
    // inscribed in a unit-square bound: 0 = pure square (no mask
    // emitted), 100 = perfect circle (inscribed). Mid values are
    // square-with-radius-corners, ranging continuously.
    //
    // Frame-class routing (by `qrToM0` label):
    //   - unlabeled leaves   → `moduleRoundingPct` (every data cell,
    //                          including the cells inside enabled
    //                          channel regions like eyes/alignment)
    //   - `qr-safe-area`     → `safeAreaRoundingPct`
    //   - all other labels   → no mask (their bounds are either
    //                          non-square or non-rendering anchors)
    {
      key: "moduleRoundingPct",
      title: "Module rounding (%)",
      type: "float",
      default: 0,
      min: 0,
      max: 100,
      step: 5,
      description: "Rounding for data modules (the individual QR cells). 0 = square, 100 = perfect circle, mid values = rounded-corner squares. Hidden when 'Pack dark cells' is on — packed rects are 1×N runs, so an inscribed circle would stretch.",
      visibleWhen: { pack: false },
    },
    {
      key: "safeAreaRoundingPct",
      title: "Safe area rounding (%)",
      type: "float",
      default: 30,
      min: 0,
      max: 100,
      step: 5,
      description: "Rounding for the carved safe-area cutout. 0 = square, 100 = perfect circle. Only takes effect when 'Safe area' is set to 'Carve frame'.",
      visibleWhen: { safeAreaMode: "carve" },
    },

    // Advanced: structural-channel toggles. Gated behind a master switch so
    // basic users don't see them. Each enabled channel emits its function
    // pattern as a single labeled overlay rect AND suppresses those cells
    // from the base grid. Useful for templates that want to mask the eye(s)
    // / alignment patterns / etc. as one visual unit each.
    {
      key: "showAdvancedChannels",
      title: "Show structural-channel toggles",
      type: "bool",
      default: false,
      description: "Reveal per-channel structural-marker toggles below. Each toggle adds a labeled logical-owner overlay at the channel's region — a structural handle (stableKey, label, mask target) callers can address without altering what's painted. The QR is always fully scannable regardless of which channels are enabled; channels never change the rendered output, they only make regions addressable.",
    },
    {
      key: "channelEyes",
      title: "Channel: eyes (3 finders)",
      type: "bool",
      default: false,
      description: "Mark the 3 finder patterns as structural regions (7×7 each). Labels: qr-eye-tl, qr-eye-tr, qr-eye-bl. The painted finder pattern is unchanged.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelAlignmentPatterns",
      title: "Channel: alignment patterns",
      type: "bool",
      default: false,
      description: "Mark each 5×5 alignment pattern as a structural region. v1: 0 patterns. v2+ has at least 1. Labels: qr-align-{i} in row-major order. The painted patterns are unchanged.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelTimingPatterns",
      title: "Channel: timing patterns",
      type: "bool",
      default: false,
      description: "Mark the row-6 and col-6 timing strips as structural regions. Labels: qr-timing-h, qr-timing-v. The painted strips are unchanged.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelFormatInfo",
      title: "Channel: format info",
      type: "bool",
      default: false,
      description: "Mark the 4 format-info L-legs as structural regions. Labels: qr-formatinfo-{0|1}-{h|v}. The painted bits are unchanged.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelVersionInfo",
      title: "Channel: version info (v7+)",
      type: "bool",
      default: false,
      description: "Mark the 2 version-info 3×6 blocks as structural regions. v7+ only — no-op for v1–v6. Labels: qr-versioninfo-{0|1}. The painted bits are unchanged.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelDarkModule",
      title: "Channel: dark module",
      type: "bool",
      default: false,
      description: "Mark the single always-dark cell at (4·v+9, 8) as a structural region. Label: qr-darkmodule. The painted cell is unchanged.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelSeparators",
      title: "Channel: separators",
      type: "bool",
      default: false,
      description: "Mark the 6 separator L-legs (light bands around each eye) as structural regions. Labels: qr-separator-{tl|tr|bl}-{h|v}. The painted bits are unchanged (the regions are pure light — base nulls).",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelQuietZone",
      title: "Channel: quiet zone (4 bands)",
      type: "bool",
      default: false,
      description: "Mark the four quiet-zone bands (top / bottom / left / right) as structural regions. Labels: qr-quiet-zone-{top|bottom|left|right}. The base layer already has the quiet zone as null cells; this toggle just adds labeled logical-owner anchors over them so callers can address each band by name.",
      visibleWhen: { showAdvancedChannels: true },
    },
    // QR defaults to `signposts` (not `silent` like other generators)
    // because its labels — safe-area, qr-eye-*, qr-align-*, etc. — are
    // load-bearing for downstream templates that target the M region or
    // finder patterns by name. Setting "silent" suppresses the labels
    // entirely (and the m0c blob with them), which is the explicit
    // opt-out for callers that just want the bare DSL.
    labelTierParam({
      defaultTier: "signposts",
      description: "QR's labels carry the safe-area / eye / align / timing region names. Default signposts keeps all of those on; silent drops them entirely.",
    }),
  ],
};

// ── Params ────────────────────────────────────────────────

export type QrCodeGeneratorParams = {
  /** Which payload shape to build. Defaults to "text" — i.e. use `text` verbatim. */
  payloadType?: QrPayloadType;
  /** Free-form text. Used when `payloadType` is "text" (or unset). */
  text?: string;

  // Wi-Fi fields (payloadType === "wifi").
  wifiSsid?: string;
  wifiEncryption?: "WPA" | "WEP" | "nopass";
  wifiPassword?: string;
  wifiHidden?: boolean;

  // vCard fields (payloadType === "vcard").
  vcardFullName?: string;
  vcardOrg?: string;
  vcardTitle?: string;
  vcardPhone?: string;
  vcardEmail?: string;
  vcardUrl?: string;

  // Mailto fields (payloadType === "mailto").
  mailtoTo?: string;
  mailtoSubject?: string;
  mailtoBody?: string;

  // SMS fields (payloadType === "sms").
  smsPhone?: string;
  smsBody?: string;

  // Tel fields (payloadType === "tel").
  telPhone?: string;

  // Geo fields (payloadType === "geo").
  geoLat?: number;
  geoLng?: number;
  geoQuery?: string;

  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  quietZoneModules?: number;
  version?: number;
  safeAreaMode?: "none" | "carve";
  safeAreaWidth?: number;
  safeAreaHeight?: number;
  paddingPct?: number;
  /** Engine-perf optimization — collapse dark cells into fewest rects. */
  pack?: boolean;
  /**
   * Rounding percentage (0–100) for data modules (the individual cells).
   * 0 = square (no mask emitted), 100 = perfect circle inscribed in the
   * cell. Suppressed when `pack === true` (packed rects are 1×N).
   */
  moduleRoundingPct?: number;
  /**
   * Rounding percentage (0–100) for the safe-area carve overlay. Only
   * applies when `safeAreaMode === "carve"`.
   */
  safeAreaRoundingPct?: number;
  /** Master toggle for the advanced per-channel switches below (UI-only;
   *  ignored at generator time — channels apply if their toggle is true,
   *  regardless of this gate). */
  showAdvancedChannels?: boolean;
  channelEyes?: boolean;
  channelAlignmentPatterns?: boolean;
  channelTimingPatterns?: boolean;
  channelFormatInfo?: boolean;
  channelVersionInfo?: boolean;
  channelDarkModule?: boolean;
  channelSeparators?: boolean;
  channelQuietZone?: boolean;
  /**
   * Label-emission tier. QR defaults to "signposts" (not "silent" like
   * other generators) — its labels are the only delivery mechanism for
   * structural region names (safe-area, qr-eye-*, etc.) into the
   * editor. Setting "silent" opts out entirely and yields plain m0
   * with no m0c blob; "atlas" is reserved for future per-cell labels
   * but currently behaves like "signposts".
   */
  labels?: string;
};

// ── Build ─────────────────────────────────────────────────

const VALID_ECC = new Set(["L", "M", "Q", "H"]);
const VALID_SAFE_MODE = new Set(["none", "carve"]);
const VALID_PAYLOAD_TYPE = new Set<QrPayloadType>([
  "text", "wifi", "vcard", "mailto", "sms", "tel", "geo",
]);
const VALID_WIFI_ENCRYPTION = new Set(["WPA", "WEP", "nopass"]);

/**
 * Build the canonical text to encode from the selected payload type's
 * sub-fields. Returns the same `params.text` string when the type is
 * "text" (or unset) so the free-form flow stays a no-op.
 */
function resolvePayloadText(params: QrCodeGeneratorParams): string {
  const payloadType: QrPayloadType =
    params.payloadType && VALID_PAYLOAD_TYPE.has(params.payloadType)
      ? params.payloadType
      : "text";

  switch (payloadType) {
    case "text": {
      const text = (params.text ?? "").trim();
      if (!text) throw new Error("qr-code: text is required (non-empty string)");
      return text;
    }
    case "wifi": {
      const ssid = (params.wifiSsid ?? "").trim();
      if (!ssid) throw new Error("qr-code: wifiSsid is required for payloadType 'wifi'");
      const encryption = VALID_WIFI_ENCRYPTION.has(params.wifiEncryption ?? "")
        ? (params.wifiEncryption as "WPA" | "WEP" | "nopass")
        : "WPA";
      return qrPayloadWifi({
        ssid,
        ...(params.wifiPassword ? { password: params.wifiPassword } : {}),
        encryption,
        ...(params.wifiHidden ? { hidden: true } : {}),
      });
    }
    case "vcard": {
      const fullName = (params.vcardFullName ?? "").trim();
      if (!fullName) throw new Error("qr-code: vcardFullName is required for payloadType 'vcard'");
      return qrPayloadVCard({
        fullName,
        ...(params.vcardOrg ? { org: params.vcardOrg } : {}),
        ...(params.vcardTitle ? { title: params.vcardTitle } : {}),
        ...(params.vcardPhone ? { phone: params.vcardPhone } : {}),
        ...(params.vcardEmail ? { email: params.vcardEmail } : {}),
        ...(params.vcardUrl ? { url: params.vcardUrl } : {}),
      });
    }
    case "mailto": {
      const to = (params.mailtoTo ?? "").trim();
      if (!to) throw new Error("qr-code: mailtoTo is required for payloadType 'mailto'");
      return qrPayloadMailto({
        to,
        ...(params.mailtoSubject ? { subject: params.mailtoSubject } : {}),
        ...(params.mailtoBody ? { body: params.mailtoBody } : {}),
      });
    }
    case "sms": {
      const phone = (params.smsPhone ?? "").trim();
      if (!phone) throw new Error("qr-code: smsPhone is required for payloadType 'sms'");
      return qrPayloadSms({
        phone,
        ...(params.smsBody ? { body: params.smsBody } : {}),
      });
    }
    case "tel": {
      const phone = (params.telPhone ?? "").trim();
      if (!phone) throw new Error("qr-code: telPhone is required for payloadType 'tel'");
      return qrPayloadTel({ phone });
    }
    case "geo": {
      if (!Number.isFinite(params.geoLat) || !Number.isFinite(params.geoLng)) {
        throw new Error("qr-code: geoLat and geoLng (finite numbers) are required for payloadType 'geo'");
      }
      return qrPayloadGeo({
        lat: params.geoLat as number,
        lng: params.geoLng as number,
        ...(params.geoQuery ? { query: params.geoQuery } : {}),
      });
    }
  }
}

export function qrCodeGenerator(params: QrCodeGeneratorParams): GeneratorResult {
  const text = resolvePayloadText(params);

  const ecc = VALID_ECC.has(params.errorCorrectionLevel ?? "")
    ? (params.errorCorrectionLevel as "L" | "M" | "Q" | "H")
    : "M";

  const quietZone = Number.isInteger(params.quietZoneModules)
    ? Math.max(0, Math.min(16, params.quietZoneModules as number))
    : 4;

  const safeAreaMode = VALID_SAFE_MODE.has(params.safeAreaMode ?? "")
    ? (params.safeAreaMode as "none" | "carve")
    : "none";

  // Convention: version=0 means "auto-pick"; the stdlib accepts undefined.
  // When carve is on we floor auto-pick at v6 so the 15-cell safe-area
  // square doesn't dominate the matrix — v1–v5 leave too little room
  // around the cutout for the code to read as a QR. Caller-supplied
  // version always wins, including values below the floor.
  const CUTOUT_MIN_VERSION = 6;
  const callerVersion = Number.isInteger(params.version) && (params.version as number) > 0
    ? (params.version as number)
    : undefined;
  const forcedVersion =
    callerVersion ??
    (safeAreaMode === "carve" ? CUTOUT_MIN_VERSION : undefined);

  const safeAreaConfig =
    safeAreaMode === "none"
      ? undefined
      : {
          mode: safeAreaMode,
          size: {
            width: Math.max(1, Math.round(params.safeAreaWidth ?? 272)),
            height: Math.max(1, Math.round(params.safeAreaHeight ?? 272)),
          },
          paddingPct: Math.max(0, Math.min(49, params.paddingPct ?? 0)),
        };

  // Collect per-channel toggles into the qrToM0 channels map. Each `true`
  // toggle becomes `channels.<name>: true` — qrToM0 emits a labeled
  // `-{-}` logical-owner anchor at the region's bounds without touching
  // the base layer, so the QR keeps scanning regardless of which channels
  // are on. We omit the safeArea channel entry — it's driven by
  // `safeArea` above, not the channels map. The master
  // `showAdvancedChannels` is UI-only; we honour individual toggles
  // regardless of its state so the generator is stateless w.r.t. the UI
  // gate.
  const channelToggles: Array<[Exclude<QrChannel, "data" | "safeArea">, boolean | undefined]> = [
    ["eyes", params.channelEyes],
    ["alignmentPatterns", params.channelAlignmentPatterns],
    ["timingPatterns", params.channelTimingPatterns],
    ["formatInfo", params.channelFormatInfo],
    ["versionInfo", params.channelVersionInfo],
    ["darkModule", params.channelDarkModule],
    ["separators", params.channelSeparators],
    ["quietZone", params.channelQuietZone],
  ];
  const channels: Partial<Record<Exclude<QrChannel, "data" | "safeArea">, QrChannelConfig>> = {};
  for (const [name, on] of channelToggles) {
    if (on === true) channels[name] = true;
  }
  const channelsOpt = Object.keys(channels).length > 0 ? channels : undefined;

  const pack = params.pack === true ? true : undefined;

  const result = qrToM0(text, {
    errorCorrectionLevel: ecc,
    quietZoneModules: quietZone,
    version: forcedVersion,
    safeArea: safeAreaConfig,
    ...(channelsOpt ? { channels: channelsOpt } : {}),
    ...(pack !== undefined ? { pack } : {}),
  });

  const m0 = toCanonicalM0String(String(result.m0));
  // Visible-cell count drives the dictionary entry's `sourceCount`. Parse
  // the m0 to count rendered leaves; this is the same number a downstream
  // template's `sources[]` array will be sized to.
  const sourceCount = parseM0StringToRenderFrames(m0, result.canvasW, result.canvasH).length;

  // ── Rounded cells → emit an .m0c with per-leaf circle masks ─────────
  // Skipped when pack is on (the descriptor hides the toggle in that case;
  // this is the runtime belt). Each renderable leaf in the m0 gets a
  // circular clipPath inscribed in its bounding rect — when bounds are a
  // unit square the inscribed circle is a true circle; the engine scales
  // the path to the leaf's actual render dims at clip time.
  // Build mask records, one per renderable leaf, with the rounding
  // amount picked from the matching slider based on the leaf's label.
  // Frames whose bounding rect isn't square (packed runs, timing strips,
  // format/version info legs, separator strips) are skipped — an
  // inscribed mask on them stretches into an oval. Module rounding is
  // additionally hard-suppressed when pack is on as a runtime belt
  // (descriptor hides the slider but stale state could persist).
  const modulePct = clampPct(
    pack === true ? 0 : params.moduleRoundingPct ?? 100,
  );
  const safeAreaPct = clampPct(params.safeAreaRoundingPct ?? 30);

  const masks = buildMasksByLabel(
    m0,
    result.canvasW,
    result.canvasH,
    result.labels,
    { modulePct, safeAreaPct },
  );

  // Emit the m0c blob whenever there's per-leaf data to carry — masks OR
  // labels. Labels are the only delivery channel for channel stableKeys
  // (qr-eye-tl etc.) into the editor's `m0cExtrasRef`; suppressing the
  // m0c when there's no rounding silently drops every channel label.
  //
  // The label-tier param gates label emission: at "silent" tier the user
  // is explicitly opting out, so even if there are labels we drop them
  // (and the m0c) — masks still ride through, because rounding pcts are
  // independent knobs and the user may have rounded modules without
  // wanting region labels.
  // QR's descriptor default is "signposts" (preserves the always-on
  // label channel — see the descriptor's labelTierParam call above).
  // Pass it as the fallback so direct callers (tests, programmatic
  // consumers, ad-hoc CLI use) get the same behavior as the UI dispatch.
  const tier = resolveLabelTier(params.labels, "signposts");
  const hasMasks = Object.keys(masks).length > 0;
  const hasLabels = tier !== "silent" && Object.keys(result.labels).length > 0;
  let m0c: string | undefined;
  if (hasMasks || hasLabels) {
    m0c = serializeM0cFile({
      m0,
      size: { width: result.canvasW, height: result.canvasH },
      app: "qr-code-generator",
      ...(hasLabels ? { labels: toM0cLabels(result.labels) } : {}),
      ...(hasMasks ? { masks } : {}),
    });
  }

  return {
    m0,
    sourceCount,
    idealCanvas: { width: result.canvasW, height: result.canvasH },
    displayFields: { resolvedPayload: text },
    ...(m0c ? { m0c } : {}),
  };
}

// ── Rounding-mask helpers ────────────────────────────────────────────

const UNIT_BOUNDS = { x: 0, y: 0, width: 1, height: 1 } as const;
const UNIT_CIRCLE_PATH =
  "M 0.5 0 A 0.5 0.5 0 1 1 0.5 1 A 0.5 0.5 0 1 1 0.5 0 Z";

/** Clamp `n` to [0, 100]. Non-finite → 0. */
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

/**
 * Build a unit-bounds SVG path for a square-with-rounded-corners at
 * `pct`% of full rounding. 0 → square, 100 → perfect circle inscribed
 * in the unit cell. Intermediate values produce a rounded rect whose
 * corner radius interpolates linearly from 0 to 0.5 (the max where the
 * arcs from each side meet at the rectangle's centerline, yielding a
 * circle). Coords are in [0, 1]; the engine scales the path to the
 * leaf's actual render dims at clip time, so the same path works for
 * any cell size as long as the cell is square.
 */
function roundedRectUnitPath(pct: number): string {
  const p = clampPct(pct);
  if (p <= 0) return "M 0 0 L 1 0 L 1 1 L 0 1 Z";
  if (p >= 100) return UNIT_CIRCLE_PATH;
  const r = p / 200; // (0, 0.5)
  const r1 = 1 - r;
  return (
    `M ${r} 0 L ${r1} 0 ` +
    `A ${r} ${r} 0 0 1 1 ${r} L 1 ${r1} ` +
    `A ${r} ${r} 0 0 1 ${r1} 1 L ${r} 1 ` +
    `A ${r} ${r} 0 0 1 0 ${r1} L 0 ${r} ` +
    `A ${r} ${r} 0 0 1 ${r} 0 Z`
  );
}

/**
 * Classify a `qrToM0` channel label into a rounding bucket. Labels not
 * listed here mean either "data cell" (when missing entirely) or
 * "non-square channel" (timing / format / version / separators / pack
 * rects) — the latter never get masked because their bounding rect
 * isn't square. The string-prefix check matches the labelling
 * convention from `qrToM0`'s `regionsForChannel` (`qr-eye-tl/tr/bl`,
 * `qr-align-{i}`, `qr-darkmodule`, `qr-safe-area`, …).
 */
function roundingBucketForLabel(
  label: string | undefined,
): "module" | "safeArea" | "skip" {
  if (!label) return "module";
  if (label === "qr-safe-area") return "safeArea";
  // Every other channel label (qr-eye-*, qr-align-*, qr-darkmodule,
  // qr-pack-*, qr-timing-*, qr-formatinfo-*, qr-versioninfo-*,
  // qr-separator-*, qr-quiet-zone-*) is either a non-rendering anchor
  // or has non-square bounds. We never emit a dedicated mask for them
  // — the data cells they overlay get module rounding from the loop
  // below, which is the only rounding QR needs.
  return "skip";
}

/**
 * Walk each renderable leaf in the m0 and assign it a mask whose
 * rounding amount comes from the appropriate slider (per
 * `roundingBucketForLabel`). Two buckets:
 *
 *   - `qr-safe-area` (the carve F splice point) → `safeAreaRoundingPct`
 *   - every other rendered leaf                 → `moduleRoundingPct`
 *
 * Channel anchors (`qr-eye-*`, `qr-align-*`, etc.) don't render — they
 * don't appear in the logical walk, so no mask is emitted for them.
 * The cells inside their bounded regions get module rounding because
 * they're plain unlabeled leaves in the base grid.
 */
function buildMasksByLabel(
  m0: string,
  canvasW: number,
  canvasH: number,
  labels: Record<string, string>,
  pcts: { modulePct: number; safeAreaPct: number },
): Record<string, M0cMaskEntry> {
  const bucketPath: Record<"module" | "safeArea", string | null> = {
    module: pcts.modulePct > 0 ? roundedRectUnitPath(pcts.modulePct) : null,
    safeArea:
      pcts.safeAreaPct > 0 ? roundedRectUnitPath(pcts.safeAreaPct) : null,
  };
  const masks: Record<string, M0cMaskEntry> = {};
  const leaves = queryFrames(m0, { width: canvasW, height: canvasH }).logical();
  for (const leaf of leaves) {
    const key = String(leaf.meta.stableKey);
    const bucket = roundingBucketForLabel(labels[key]);
    if (bucket === "skip") continue;
    const path = bucketPath[bucket];
    if (!path) continue;
    masks[key] = { localPath: path, bounds: UNIT_BOUNDS };
  }
  return masks;
}

/**
 * `qrToM0`'s labels come back as `Record<stableKey, string>`; m0c wants
 * `Record<stableKey, M0Label>` (`{ text, color? }`). Lift the strings
 * into the structured shape.
 */
function toM0cLabels(
  qrLabels: Record<string, string>,
): Record<string, { text: string }> {
  const out: Record<string, { text: string }> = {};
  for (const [key, text] of Object.entries(qrLabels)) {
    out[key] = { text };
  }
  return out;
}
