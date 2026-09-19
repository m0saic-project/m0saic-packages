import { definePropsSchema } from "@m0saic/template-utils";

/**
 * `@m0saic/brand/community-m/v1` — props.
 *
 * The provenance video for one Community M tile: the M with its identity,
 * a zoom into the tile, the tile's original image revealed, the
 * contributor's own canvas (their `.mosaic` piece), then back out to the M
 * and the brand closer. m0saic owns the harness; the piece is theirs.
 *
 * Every knob has a deterministic default or a placeholder (the
 * `defaultProps` convention), and no default is a local path
 * (`noLocalPaths`): `communityDir` defaults to `""` = the bundled seed; the
 * host pre-fills the real cache path when it exists.
 */
export type CommunityMProvenanceProps = {
  /** Community M id, e.g. "001". */
  m?: string;
  /** Which tile: a 1-based claim number ("7"), "root", or a handle ("@octocat"). */
  tile?: string;
  /** Local checkout / cache of the community-m repo. "" = the bundled seed. */
  communityDir?: string;
  /** Show the M as it stands now, or as it stood when this tile was claimed. */
  asOf?: "now" | "claim";
  /** Hold on the whole M before the zoom (ms). */
  introMs?: number;
  /** Zoom travel into the tile (ms). */
  zoomMs?: number;
  /** Hold on the zoomed tile (ms). */
  holdMs?: number;
  /** Reveal: the M fades out while the original image fades in (ms). */
  revealMs?: number;
  /** Slide: the original glides aside to make room for the canvas (ms); the same slide brings it back. */
  slideMs?: number;
  /** Pop: the contributor canvas scales into place (ms). */
  popMs?: number;
  /** Cap on the contributor piece's declared duration (ms). */
  pieceMaxMs?: number;
  /** Outro: zoom back out to the whole M (ms). */
  outroMs?: number;
  /** Brand closer beat (ms). 0 = no closer. */
  closerMs?: number;
  /** Crossfade between beats (ms). */
  xfadeMs?: number;
  /** Camera zoom into the tile. Unset = auto (the tile fills the frame's tighter axis). */
  zoom?: number;
  /** Accent (claimed edges, captions). */
  accentColor?: string;
  /** Dormant tile colour. */
  dormantColor?: string;
  /** Canvas colour behind everything. */
  canvasColor?: string;
  /** Caption text colour. */
  textColor?: string;

  /**
   * Dev levers — design the harness before the M fills up. Off by default;
   * see `preview.ts`.
   */
  preview?: {
    /** Paint this many tiles as claimed using stand-in art. 0 = only real claims. */
    claims?: number;
    /** Which stand-in family fills open tiles. */
    style?: "faces" | "logos" | "mix";
    /** Re-deal the stand-in art. */
    seed?: number;
    /** Share of a mix that is logos rather than faces (0..1). */
    mix?: number;
    /**
     * Make the video about claim N in the M's award order (1..32 — the order
     * the Community page lists open tiles in, and the order "claims" deals
     * stand-ins in); 0 = the root. Unset = the resolved slot.
     */
    tile?: number;
    /** Replace the contributor piece with a generated card. */
    piece?: "off" | "lorem" | "card" | "bars" | "reel" | "grid";
    /** Shape of that generated card. */
    aspect?: "16:9" | "1:1" | "9:16";
  };
};

export const DEFAULT_PROPS: Required<Omit<CommunityMProvenanceProps, "zoom">> = {
  m: "001",
  tile: "root",
  communityDir: "",
  asOf: "now",
  introMs: 2400,
  zoomMs: 1800,
  holdMs: 600,
  revealMs: 2000,
  slideMs: 900,
  popMs: 450,
  pieceMaxMs: 18000,
  outroMs: 2000,
  closerMs: 2500,
  xfadeMs: 500,
  accentColor: "#f97316",
  dormantColor: "#34343A",
  canvasColor: "#0E1220",
  textColor: "#F4F4F5",
  preview: { claims: 0, style: "mix", seed: 1, mix: 0.34, piece: "off", aspect: "16:9" },
};

export const propsSchema = definePropsSchema<CommunityMProvenanceProps>({
  m: {
    type: "string",
    required: false,
    description: "Community M id (three digits), e.g. 001.",
    meta: { ui: { label: "Community M", order: 1 } },
  },
  tile: {
    type: "string",
    required: false,
    description: 'Which tile the video is about: a claim number ("7"), "root" for the root award, or a GitHub handle ("@octocat").',
    meta: { ui: { label: "Tile", order: 2 } },
  },
  communityDir: {
    type: "string",
    required: false,
    description: "Folder holding the community-m repo (its index.json). Leave empty for the bundled seed; Mosaic Desktop and the CLI fill in the local cache automatically.",
    meta: { control: { picker: "folder", placeholder: "bundled seed" }, ui: { label: "community-m folder", order: 3 } },
  },
  asOf: {
    type: "string",
    required: false,
    description: "Show the M as it stands now (re-renders age into the record) or as it stood when this tile was claimed.",
    meta: { constraints: { oneOf: ["now", "claim"] }, control: { options: [{ value: "now", label: "As it is now" }, { value: "claim", label: "As it was when claimed" }] }, ui: { label: "M as of", order: 4 } },
  },
  introMs: { type: "number", required: false, description: "Hold on the whole M before the zoom (ms).", meta: { constraints: { min: 200, max: 15000 }, ui: { label: "Intro hold" } } },
  zoomMs: { type: "number", required: false, description: "Zoom travel into the tile (ms).", meta: { constraints: { min: 200, max: 10000 }, ui: { label: "Zoom" } } },
  holdMs: { type: "number", required: false, description: "Hold on the zoomed tile (ms).", meta: { constraints: { min: 0, max: 10000 }, ui: { label: "Tile hold" } } },
  revealMs: { type: "number", required: false, description: "The M fades out while the tile's original image fades in (ms).", meta: { constraints: { min: 400, max: 10000 }, ui: { label: "Reveal" } } },
  slideMs: { type: "number", required: false, description: "The original slides aside for the canvas, and back again at the end (ms).", meta: { constraints: { min: 200, max: 5000 }, ui: { label: "Slide aside" } } },
  popMs: { type: "number", required: false, description: "The contributor canvas pops into place (ms).", meta: { constraints: { min: 100, max: 3000 }, ui: { label: "Canvas pop" } } },
  pieceMaxMs: { type: "number", required: false, description: "Longest the contributor piece may play (ms); shorter pieces play their declared length.", meta: { constraints: { min: 500, max: 60000 }, ui: { label: "Piece cap" } } },
  outroMs: { type: "number", required: false, description: "Zoom back out to the whole M (ms).", meta: { constraints: { min: 200, max: 10000 }, ui: { label: "Outro" } } },
  closerMs: { type: "number", required: false, description: "Brand closer at the end (ms). 0 removes it.", meta: { constraints: { min: 0, max: 10000 }, ui: { label: "Closer" } } },
  xfadeMs: { type: "number", required: false, description: "Crossfade between beats (ms).", meta: { constraints: { min: 0, max: 2000 }, ui: { label: "Crossfade" } } },
  zoom: {
    type: "number",
    required: false,
    description: "Camera zoom into the tile (1–4). Unset = auto: the tile fills the frame's tighter axis, capped at 4.",
    meta: { constraints: { min: 1, max: 4 }, control: { placeholder: "auto (fit the tile)" }, ui: { label: "Camera zoom" } },
  },
  accentColor: { type: "string", required: false, description: "Accent colour: claimed-tile edges and captions.", meta: { ui: { label: "Accent color" }, constraints: { isColor: true }, control: { colorPicker: true } } },
  dormantColor: { type: "string", required: false, description: "Colour of open (unclaimed) tiles.", meta: { ui: { label: "Open tile color" }, constraints: { isColor: true }, control: { colorPicker: true } } },
  canvasColor: { type: "string", required: false, description: "Canvas behind the M and the piece.", meta: { ui: { label: "Canvas color" }, constraints: { isColor: true }, control: { colorPicker: true } } },
  textColor: { type: "string", required: false, description: "Caption text colour.", meta: { ui: { label: "Caption color" }, constraints: { isColor: true }, control: { colorPicker: true } } },

  preview: {
    type: "group" as never,
    required: false,
    description:
      "Dev levers: stand in art for open tiles, point the video at any tile, and swap the contributor piece for a generated card — so the harness can be designed before real claims exist. All off by default.",
    meta: { ui: { label: "Dev preview", order: 20, collapsedByDefault: true } },
    fields: {
      claims: { type: "number", required: false, description: "Paint this many tiles as claimed using stand-in art (the same bank the Community page previews with), dealt in the M's own claim order. 0 = only real claims.", meta: { constraints: { min: 0, max: 33 }, ui: { label: "Filled tiles" } } },
      style: {
        type: "string", required: false, description: "Which stand-in family fills open tiles.",
        meta: { constraints: { oneOf: ["faces", "logos", "mix"] }, control: { options: [{ value: "mix", label: "Mix" }, { value: "faces", label: "Faces" }, { value: "logos", label: "Logos" }] }, ui: { label: "Stand-ins" } },
      },
      seed: { type: "number", required: false, description: "Re-deal the stand-in art (shuffle).", meta: { constraints: { min: 1, max: 9999 }, ui: { label: "Shuffle" } } },
      mix: { type: "number", required: false, description: "Share of a mix that is logos rather than faces.", meta: { constraints: { min: 0, max: 1 }, ui: { label: "Logo share" } } },
      tile: { type: "number", required: false, description: "Make the video about claim N in the M's award order (1..32 — the same order the Community page lists open tiles in, and the order Filled tiles deals stand-ins in) with stand-in art; 0 = the root. The way to exercise the zoom and crop on a wide, tall or diagonal tile instead of the root's V. Unset = the tile the slot resolves to.", meta: { constraints: { min: 0, max: 32 }, control: { placeholder: "the resolved tile" }, ui: { label: "Subject tile (claim #)" } } },
      piece: {
        type: "string", required: false, description: "Replace the contributor piece with a generated card, so the canvas beat has something in it before a real .mosaic exists.",
        meta: {
          constraints: { oneOf: ["off", "lorem", "card", "bars", "reel", "grid"] },
          control: {
            options: [
              { value: "off", label: "Real piece" },
              { value: "lorem", label: "Lorem card" },
              { value: "card", label: "Stat card" },
              { value: "bars", label: "Colour bars" },
              { value: "reel", label: "Reel (3 beats)" },
              { value: "grid", label: "Grid (builds in)" },
            ],
          },
          ui: { label: "Canvas" },
        },
      },
      aspect: {
        type: "string", required: false, description: "Shape of that generated card — the portrait option is the one the harness has to survive.",
        meta: { constraints: { oneOf: ["16:9", "1:1", "9:16"] }, control: { options: [{ value: "16:9", label: "Landscape 16:9" }, { value: "1:1", label: "Square" }, { value: "9:16", label: "Portrait 9:16" }] }, ui: { label: "Canvas shape" } },
      },
    },
  } as never,
});

export type ResolvedPreview = {
  claims: number;
  style: "faces" | "logos" | "mix";
  seed: number;
  logoShare: number;
  /** null = the video is about the tile the slot resolves to. */
  tile: number | null;
  piece: "off" | "lorem" | "card" | "bars" | "reel" | "grid";
  pieceAspect: "16:9" | "1:1" | "9:16";
};

export type ResolvedProps = Required<Omit<CommunityMProvenanceProps, "zoom" | "preview">> & { zoom: number | null; preview: ResolvedPreview };

/** Merge defaults + fail-fast validation. Returns a list of problems when invalid. */
export function resolveProps(props: CommunityMProvenanceProps): { ok: true; value: ResolvedProps } | { ok: false; errors: string[] } {
  const d = DEFAULT_PROPS.preview;
  const pv = { ...d, ...stripUndefined(props.preview ?? {}) };
  const preview: ResolvedPreview = {
    claims: pv.claims as number,
    style: pv.style as ResolvedPreview["style"],
    seed: pv.seed as number,
    logoShare: pv.mix as number,
    tile: props.preview?.tile ?? null,
    piece: pv.piece as ResolvedPreview["piece"],
    pieceAspect: pv.aspect as ResolvedPreview["pieceAspect"],
  };
  const v: ResolvedProps = { ...DEFAULT_PROPS, ...stripUndefined(props), zoom: props.zoom ?? null, preview };
  const errors: string[] = [];
  if (!/^\d{3}$/.test(v.m)) errors.push(`m must be three digits (got "${v.m}")`);
  if (typeof v.tile !== "string" || v.tile.trim() === "") errors.push("tile is required");
  if (v.asOf !== "now" && v.asOf !== "claim") errors.push(`asOf must be "now" or "claim" (got "${String(v.asOf)}")`);
  const num = (name: keyof ResolvedProps, lo: number, hi: number) => {
    const n = v[name] as number;
    if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`${name} must be ${lo}..${hi} ms (got ${String(n)})`);
  };
  num("introMs", 200, 15000); num("zoomMs", 200, 10000); num("holdMs", 0, 10000); num("revealMs", 400, 10000);
  num("slideMs", 200, 5000); num("popMs", 100, 3000);
  num("pieceMaxMs", 500, 60000); num("outroMs", 200, 10000); num("closerMs", 0, 10000); num("xfadeMs", 0, 2000);
  if (v.zoom !== null && !(Number.isFinite(v.zoom) && v.zoom >= 1 && v.zoom <= 4)) errors.push(`zoom must be 1..4 (got ${String(v.zoom)})`);
  const rng = (name: string, n: number, lo: number, hi: number) => {
    if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`preview.${name} must be ${lo}..${hi} (got ${String(n)})`);
  };
  rng("claims", preview.claims, 0, 33); rng("seed", preview.seed, 1, 9999); rng("mix", preview.logoShare, 0, 1);
  if (preview.tile !== null && !(Number.isInteger(preview.tile) && preview.tile >= 0 && preview.tile <= 32)) errors.push(`preview.tile must be a claim number 1..32 in award order, or 0 for the root (got ${String(preview.tile)})`);
  if (!["faces", "logos", "mix"].includes(preview.style)) errors.push(`preview.style must be faces, logos or mix (got "${String(preview.style)}")`);
  if (!["off", "lorem", "card", "bars", "reel", "grid"].includes(preview.piece)) errors.push(`preview.piece must be off, lorem, card, bars, reel or grid (got "${String(preview.piece)}")`);
  if (!["16:9", "1:1", "9:16"].includes(preview.pieceAspect)) errors.push(`preview.aspect must be 16:9, 1:1 or 9:16 (got "${String(preview.pieceAspect)}")`);
  for (const c of ["accentColor", "dormantColor", "canvasColor", "textColor"] as const) {
    if (!/^#[0-9a-fA-F]{6}$/.test(v[c])) errors.push(`${c} must be #rrggbb (got "${v[c]}")`);
  }
  if (v.xfadeMs * 2 > Math.min(v.outroMs, v.pieceMaxMs)) errors.push("xfadeMs is too long for the outro / piece beats");
  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
