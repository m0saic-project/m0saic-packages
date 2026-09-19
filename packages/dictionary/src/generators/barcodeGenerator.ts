/**
 * Official dictionary generator: Barcode (1D)
 *
 * Encodes a payload string into a 1D barcode (Code 128, EAN-13, UPC-A) on
 * the fly. Thin wrapper around `@m0saic/dsl-stdlib`'s `barcodeToM0`: the
 * encoder + bar layout + DSL emission all live in stdlib; this generator
 * just surfaces the knobs in the dictionary's UI grammar.
 *
 * Format dispatch:
 *   - Code 128 — general-purpose alphanumeric (URL slugs, asset IDs, …).
 *   - EAN-13   — 13-digit product code (retail GTIN); 12-digit input auto-checks.
 *   - UPC-A    — 12-digit product code (North America); 11-digit input auto-checks.
 *
 * HRI (human-readable interpretation) carve: since the m0 DSL is pure
 * geometry, the digit caption can't be painted directly. When enabled, the
 * generator carves a labeled frame below the bars; downstream templates
 * splice a text source into the carved F via `replaceNodeByStableId`.
 *
 * Mirrors `qrCodeGenerator` in shape (descriptor + params + GeneratorResult).
 */

import { parseM0StringToRenderFrames, toCanonicalM0String } from "@m0saic/dsl";
import {
  barcodeToM0,
  type BarcodeChannel,
  type BarcodeChannelConfig,
  type BarcodeFormat,
} from "@m0saic/dsl-stdlib";
import { serializeM0cFile } from "@m0saic/dsl-file-formats";
import { labelTierParam, resolveLabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const barcodeDescriptor: GeneratorDescriptor = {
  id: "barcode",
  title: "Barcode (1D)",
  description:
    "Encode a payload as a 1D barcode (Code 128 / EAN-13 / UPC-A). Optional carved frame for the human-readable digit caption — splice a text source in at template time.",
  category: "brand",
  group: "Core",
  params: [
    // ── Format + payload ────────────────────────────────────
    {
      key: "format",
      title: "Format",
      type: "enum",
      default: "code128",
      description:
        "Symbology. Code 128: general-purpose ASCII. EAN-13: 13-digit product code. UPC-A: 12-digit product code.",
      options: [
        {
          value: "code128",
          label: "Code 128",
          description:
            "Variable-length ASCII. Auto-picks Code Set C for even-length digit strings, Code Set B otherwise.",
        },
        {
          value: "ean13",
          label: "EAN-13",
          description:
            "13-digit retail GTIN. 12-digit input auto-appends the check digit; 13-digit input verifies it.",
        },
        {
          value: "upca",
          label: "UPC-A",
          description:
            "12-digit product code (North America). Structurally EAN-13 with implicit leading '0'.",
        },
      ],
    },
    {
      key: "text",
      title: "Payload",
      type: "string",
      default: "M0SAIC",
      placeholder: "(input string)",
      description:
        "The data to encode. Code 128: ASCII 32–127. EAN-13: 12 or 13 digits. UPC-A: 11 or 12 digits.",
    },
    // Read-only echo of the canonical payload (after any check-digit
    // append). Useful for EAN/UPC where the user may type 12 digits and
    // the generator appends the 13th.
    {
      key: "resolvedPayload",
      title: "Encoded payload",
      type: "string",
      default: "",
      readOnly: true,
      description:
        "The exact string fed into the encoder. For EAN-13 / UPC-A this includes the auto-appended check digit when the user supplied the shorter form.",
    },

    // ── Geometry (module-grid units — pixels derive from a fixed scale) ───
    {
      key: "barHeightModules",
      title: "Bar height (modules)",
      type: "int",
      default: 40,
      min: 8,
      max: 256,
      description:
        "Bar region height in modules. With the bar-region width fixed by the encoded payload (modules wide), this knob controls the aspect ratio. 40 ≈ a traditional barcode aspect for typical Code 128 payloads.",
    },
    {
      key: "quietZoneModules",
      title: "Quiet zone (modules)",
      type: "int",
      default: 10,
      min: 0,
      max: 32,
      description:
        "Light-cell border on each side. Code 128 minimum is 10; EAN-13 / UPC-A minimum is 9. Set 0 to inspect the raw bar pattern.",
    },

    // ── HRI carve ───────────────────────────────────────────
    {
      key: "showHumanReadable",
      title: "Human-readable caption",
      type: "bool",
      default: true,
      description:
        "Reserve a band below the bars for the digit caption. The generator carves a labeled splice-point per HRI frame (1 for Code 128; 3 for EAN-13; 4 for UPC-A) — templates splice a text source in via replaceNodeByStableId.",
    },
    {
      key: "humanReadableHeightPct",
      title: "Caption height (% of bars)",
      type: "float",
      default: 15,
      min: 5,
      max: 50,
      step: 1,
      description:
        "HRI band height as a percent of the bar-region height. 15% is a common default that mirrors traditional retail barcodes.",
      visibleWhen: { showHumanReadable: true },
    },

    // ── Advanced: structural channels ───────────────────────
    {
      key: "showAdvancedChannels",
      title: "Show structural-channel toggles",
      type: "bool",
      default: false,
      description:
        "Reveal per-channel structural-marker toggles below. Each toggle adds a labeled `-{-}` logical-owner overlay at the channel's region — a structural handle (stableKey + label) callers can address without altering what's painted. The barcode is always fully scannable regardless of which channels are enabled.",
    },
    {
      key: "channelQuietZoneLeft",
      title: "Channel: quiet zone (left)",
      type: "bool",
      default: false,
      description:
        "Mark the left quiet zone as a structural region. Label: barcode-quiet-zone-left.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelQuietZoneRight",
      title: "Channel: quiet zone (right)",
      type: "bool",
      default: false,
      description:
        "Mark the right quiet zone as a structural region. Label: barcode-quiet-zone-right.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelStartGuard",
      title: "Channel: start guard",
      type: "bool",
      default: false,
      description:
        "Mark the start guard (Code 128: first symbol, 11 modules; EAN/UPC: 3-module 101 guard) as a structural region. Label: barcode-start-guard.",
      visibleWhen: { showAdvancedChannels: true },
    },
    {
      key: "channelStopGuard",
      title: "Channel: stop guard",
      type: "bool",
      default: false,
      description:
        "Mark the stop guard (Code 128: 13-module stop; EAN/UPC: 3-module 101 guard) as a structural region. Label: barcode-stop-guard.",
      visibleWhen: { showAdvancedChannels: true },
    },

    // ── Labels tier ─────────────────────────────────────────
    // Barcode defaults to `signposts` — labels are load-bearing for
    // downstream templates that target the HRI splice points or the
    // start/stop guards by name. `silent` opts out entirely.
    labelTierParam({
      defaultTier: "signposts",
      description:
        "Barcode's labels carry the bar-index / HRI-role / guard region names. signposts keeps them; silent drops them entirely.",
    }),
  ],
};

// ── Params ────────────────────────────────────────────────

export type BarcodeGeneratorParams = {
  /** Symbology. Default "code128". */
  format?: BarcodeFormat;
  /** Payload string. Default "M0SAIC". */
  text?: string;
  /**
   * Bar region height in modules. Drives the aspect ratio of the rendered
   * barcode (since `modulesWide` is set by the encoded payload). Default 40.
   */
  barHeightModules?: number;
  /** Quiet-zone modules per side. Default 10. */
  quietZoneModules?: number;
  /** Reserve + carve the HRI digit caption band. Default true. */
  showHumanReadable?: boolean;
  /** HRI band height as % of bar height (0..100). Default 15. */
  humanReadableHeightPct?: number;

  /** Master toggle for the per-channel switches below (UI-only). */
  showAdvancedChannels?: boolean;
  channelQuietZoneLeft?: boolean;
  channelQuietZoneRight?: boolean;
  channelStartGuard?: boolean;
  channelStopGuard?: boolean;

  /** Label-emission tier. Default "signposts". */
  labels?: string;
};

// ── Build ─────────────────────────────────────────────────

/**
 * Hardcoded pixel-per-module scale for the dictionary generator's
 * `idealCanvas`. Mirrors QR's `DEFAULT_PX_PER_CELL = 25` convention —
 * the user's UI surface is unitless (modules + percentages), and a single
 * constant sets the render scale.
 *
 * 4 px/module keeps a typical Code 128 payload's canvas in the 400–600 px
 * range — comfortable for the dictionary preview, scales cleanly to any
 * larger drop canvas via integer multiples.
 */
const DEFAULT_PX_PER_MODULE = 4;

const VALID_FORMATS = new Set<BarcodeFormat>(["code128", "ean13", "upca"]);

function clampInt(n: unknown, min: number, max: number, dflt: number): number {
  if (!Number.isInteger(n)) return dflt;
  const v = n as number;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clampFloat(n: unknown, min: number, max: number, dflt: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return dflt;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function barcodeGenerator(
  params: BarcodeGeneratorParams,
): GeneratorResult {
  const text = (params.text ?? "").trim();
  if (!text) {
    throw new Error("barcode: text is required (non-empty string)");
  }

  const format: BarcodeFormat =
    params.format && VALID_FORMATS.has(params.format) ? params.format : "code128";

  const barHeightModules = clampInt(params.barHeightModules, 8, 256, 40);
  const heightPx = barHeightModules * DEFAULT_PX_PER_MODULE;
  const quietZoneModules = clampInt(params.quietZoneModules, 0, 32, 10);

  const showHumanReadable = params.showHumanReadable !== false;
  const humanReadableHeightPct = clampFloat(
    params.humanReadableHeightPct,
    5,
    50,
    15,
  );

  // Collect per-channel toggles. Each `true` toggle becomes a structural
  // anchor in the m0; the master `showAdvancedChannels` is UI-only and is
  // ignored at generator time so the generator stays stateless w.r.t. the
  // UI gate.
  const channelToggles: Array<[
    Exclude<BarcodeChannel, "bars" | "humanReadable">,
    boolean | undefined,
  ]> = [
    ["quietZoneLeft", params.channelQuietZoneLeft],
    ["quietZoneRight", params.channelQuietZoneRight],
    ["startGuard", params.channelStartGuard],
    ["stopGuard", params.channelStopGuard],
  ];
  const channels: Partial<Record<
    Exclude<BarcodeChannel, "bars" | "humanReadable">,
    BarcodeChannelConfig
  >> = {};
  for (const [name, on] of channelToggles) {
    if (on === true) channels[name] = true;
  }
  const channelsOpt = Object.keys(channels).length > 0 ? channels : undefined;

  const result = barcodeToM0(text, {
    format,
    moduleWidthPx: DEFAULT_PX_PER_MODULE,
    heightPx,
    quietZoneModules,
    humanReadable: showHumanReadable
      ? { mode: "carve", heightPct: humanReadableHeightPct / 100 }
      : { mode: "none" },
    ...(channelsOpt ? { channels: channelsOpt } : {}),
  });

  const m0 = toCanonicalM0String(String(result.m0));
  const sourceCount = parseM0StringToRenderFrames(
    m0,
    result.canvasW,
    result.canvasH,
  ).length;

  // Emit .m0c when the label tier is non-silent and there are labels to
  // carry. Barcode doesn't currently emit per-leaf masks (bar paint cells
  // are variable-width rects, not square unit cells — an inscribed circle
  // mask wouldn't apply cleanly), so the m0c carries labels only.
  const tier = resolveLabelTier(params.labels, "signposts");
  const hasLabels = tier !== "silent" && Object.keys(result.labels).length > 0;
  let m0c: string | undefined;
  if (hasLabels) {
    const m0cLabels: Record<string, { text: string }> = {};
    for (const [key, label] of Object.entries(result.labels)) {
      m0cLabels[key] = { text: label };
    }
    m0c = serializeM0cFile({
      m0,
      size: { width: result.canvasW, height: result.canvasH },
      app: "barcode-generator",
      labels: m0cLabels,
    });
  }

  return {
    m0,
    sourceCount,
    idealCanvas: { width: result.canvasW, height: result.canvasH },
    displayFields: { resolvedPayload: result.payload },
    ...(m0c ? { m0c } : {}),
  };
}
