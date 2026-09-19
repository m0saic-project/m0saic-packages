import { definePropsSchema } from "@m0saic/template-utils";

/**
 * `@m0saic/story/scrapbook/v1` — props.
 *
 * THE CONTRACT (what this template is, before any layout):
 *
 * A short personal film. A handful of pictures, each with a line in the
 * author's own words, laid down like the pages of a scrapbook: pinned
 * slightly askew on paper, drifting gently, handing over with soft
 * cross-fades, optionally over music. Warm and unhurried — the opposite
 * register to a product demo.
 *
 * What it is NOT: a gallery, a grid, or a slideshow with effects. One page
 * at a time, and the words matter as much as the pictures.
 *
 * CONTENT COMES LATER. `photos` and `notes` are index-aligned and both may
 * be empty: at defaults the template lays out generated stand-in pages so
 * the pacing and motion can be judged before a single real picture exists.
 * Dropping real files in replaces them one for one.
 */
export type ScrapbookProps = {
  /** Opening line — a name, usually. */
  title?: string;
  /** Under the title: a date range, a place, a dedication. */
  subtitle?: string;
  /** The pictures, in order. Empty = generated stand-in pages. */
  photos?: string[];
  /** One line per picture, index-aligned with `photos`. Blank entries are fine. */
  notes?: string[];
  /** The last thing on screen. */
  closing?: string;
  /** Optional music bed under the whole film. */
  music?: string;
  /** How long each page holds (ms). */
  perPageMs?: number;
  /** The opening card (ms). */
  introMs?: number;
  /** The closing card (ms). */
  outroMs?: number;
  /** Cross-fade between pages (ms) — the scrapbook's page turn. */
  xfadeMs?: number;
  /** How far each picture drifts while it holds (0 = still, 1 = a lot). */
  drift?: number;
  /** How far off square a picture is pinned, in degrees. */
  tilt?: number;
  /** The paper the scrapbook is made of. */
  paperColor?: string;
  /** The pen. */
  inkColor?: string;
  /** The one colour that is not paper or ink. */
  accentColor?: string;
};

export const DEFAULT_PROPS: Required<Omit<ScrapbookProps, "photos" | "notes" | "music">> & {
  photos: string[];
  notes: string[];
  music: string;
} = {
  title: "A few good years",
  subtitle: "the people who were there",
  photos: [],
  notes: [],
  closing: "more soon",
  music: "",
  perPageMs: 3600,
  introMs: 2200,
  outroMs: 2600,
  xfadeMs: 700,
  drift: 0.18,
  tilt: 2.2,
  paperColor: "#EFE7D8",
  inkColor: "#221E19",
  accentColor: "#C2410C",
};

export const propsSchema = definePropsSchema<ScrapbookProps>({
  title: { type: "string", required: false, description: "Opening line — a name, usually.", meta: { ui: { label: "Title", order: 1, primary: true } } },
  subtitle: { type: "string", required: false, description: "Under the title: a date range, a place, a dedication.", meta: { ui: { label: "Subtitle", order: 2 } } },
  photos: {
    type: "media[]",
    required: false,
    description: "The pictures, in order. Leave empty to lay the film out with generated stand-in pages and drop real ones in later.",
    meta: { control: { accept: ["image"], picker: "folder", multiple: true }, ui: { label: "Photos", order: 3, primary: true } },
  },
  notes: {
    type: "string[]",
    required: false,
    description: "One line per picture, in the same order. A blank entry leaves that page wordless.",
    meta: { ui: { label: "Notes", order: 4, primary: true } },
  },
  closing: { type: "string", required: false, description: "The last thing on screen.", meta: { ui: { label: "Closing line", order: 5 } } },
  music: {
    type: "media",
    required: false,
    description: "Optional music bed under the whole film.",
    meta: { control: { accept: ["audio"], placeholder: "no music" }, ui: { label: "Music", order: 6 } },
  },
  perPageMs: { type: "number", required: false, description: "How long each page holds (ms).", meta: { constraints: { min: 800, max: 20000 }, ui: { label: "Per page" } } },
  introMs: { type: "number", required: false, description: "The opening card (ms).", meta: { constraints: { min: 0, max: 15000 }, ui: { label: "Opening" } } },
  outroMs: { type: "number", required: false, description: "The closing card (ms).", meta: { constraints: { min: 0, max: 15000 }, ui: { label: "Closing" } } },
  xfadeMs: { type: "number", required: false, description: "Cross-fade between pages (ms) — the page turn.", meta: { constraints: { min: 0, max: 3000 }, ui: { label: "Page turn" } } },
  drift: { type: "number", required: false, description: "How far each picture drifts while it holds. 0 = perfectly still.", meta: { constraints: { min: 0, max: 1 }, ui: { label: "Drift" } } },
  tilt: { type: "number", required: false, description: "How far off square a picture is pinned, in degrees.", meta: { constraints: { min: 0, max: 8 }, ui: { label: "Tilt" } } },
  paperColor: { type: "string", required: false, description: "The paper the scrapbook is made of.", meta: { ui: { label: "Paper" }, constraints: { isColor: true }, control: { colorPicker: true } } },
  inkColor: { type: "string", required: false, description: "The pen.", meta: { ui: { label: "Ink" }, constraints: { isColor: true }, control: { colorPicker: true } } },
  accentColor: { type: "string", required: false, description: "The one colour that is not paper or ink.", meta: { ui: { label: "Accent" }, constraints: { isColor: true }, control: { colorPicker: true } } },
});

export type ResolvedProps = typeof DEFAULT_PROPS;

/** Merge defaults + fail-fast validation. */
export function resolveProps(props: ScrapbookProps): { ok: true; value: ResolvedProps } | { ok: false; errors: string[] } {
  const given = Object.fromEntries(Object.entries(props ?? {}).filter(([, v]) => v !== undefined));
  const v = { ...DEFAULT_PROPS, ...given } as ResolvedProps;
  const errors: string[] = [];
  const num = (name: keyof ResolvedProps, lo: number, hi: number) => {
    const n = v[name] as number;
    if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`${String(name)} must be ${lo}..${hi} (got ${String(n)})`);
  };
  num("perPageMs", 800, 20000); num("introMs", 0, 15000); num("outroMs", 0, 15000);
  num("xfadeMs", 0, 3000); num("drift", 0, 1); num("tilt", 0, 8);
  if (!Array.isArray(v.photos)) errors.push("photos must be a list");
  if (!Array.isArray(v.notes)) errors.push("notes must be a list");
  for (const c of ["paperColor", "inkColor", "accentColor"] as const) {
    if (!/^#[0-9a-fA-F]{6}$/.test(v[c])) errors.push(`${c} must be #rrggbb (got "${v[c]}")`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}
