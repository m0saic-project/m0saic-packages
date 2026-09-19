import { getComplexityMetricsFast, parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import {
  buildQuoteCardLayout,
  fitQuoteBlock,
  wrapQuoteLines,
  QuoteLayoutError,
  type QuoteLayoutOptions,
} from "./layout";

const base = (over: Partial<QuoteLayoutOptions> = {}): QuoteLayoutOptions => ({
  W: 1080,
  H: 1080,
  quote: "Everything is rectangles on a canvas.",
  attribution: "The m0saic Thesis",
  role: null,
  hasAvatar: false,
  align: "center",
  quoteMark: true,
  marginFrac: 0.09,
  ...over,
});

describe("quote-card layout — m0 emission", () => {
  it("emits one valid cell per painted region, in paint order", () => {
    const layout = buildQuoteCardLayout(base({ role: "Role", hasAvatar: true }));
    expect(validateM0String(String(layout.m0)).ok).toBe(true);
    expect(layout.cells.map((c) => c.kind)).toEqual([
      "mark",
      "quote",
      "accent-bar",
      "avatar",
      "name",
      "role",
    ]);
  });

  it("emits a RATIO m0 — precision bounded by the lattice basis, not the canvas", () => {
    // The inset-recovery rebuild: precision no longer tracks the canvas (was
    // precisionCost == canvas — slope 1.0 / ABSOLUTE). It stays flat, bounded by
    // the ~120 lattice basis, so the card nests cleanly. Exactness rides each
    // source's placement.inset, not the m0.
    const opts = base({ role: "Mathematician", hasAvatar: true, align: "left" });
    const at = (W: number, H: number) =>
      getComplexityMetricsFast(String(buildQuoteCardLayout({ ...opts, W, H }).m0));
    const small = at(1080, 1080);
    const large = at(2160, 2160);
    expect(small.precisionCost).toBeLessThanOrEqual(200);
    expect(large.precisionCost).toBeLessThanOrEqual(200);
    // Doesn't scale with the canvas — a 2× canvas keeps the same precision.
    expect(large.precisionCost).toBeLessThanOrEqual(small.precisionCost + 40);
    // One frame per cell still survives the pack.
    expect(small.frameCount).toBe(buildQuoteCardLayout(opts).cells.length);
  });

  it("thin cells on a tall canvas stay under the engine's 0.49 inset cap", () => {
    // The ~7px accent bar over-insets on 1080x1920 at the lean lattice;
    // placeInsetRects' cap guard auto-escalates the pitch so no recovery inset
    // exceeds the cap the engine asserts at render time.
    const maxInset = (over: Partial<QuoteLayoutOptions>) => {
      const L = buildQuoteCardLayout(base({ W: 1080, H: 1920, ...over }));
      let mx = 0;
      for (const s of L.sources) {
        const ins = (s as { placement?: { inset?: Record<string, number> } }).placement?.inset;
        if (ins) for (const e of ["top", "right", "bottom", "left"]) mx = Math.max(mx, ins[e] ?? 0);
      }
      return mx;
    };
    expect(maxInset({ role: "Author", hasAvatar: true })).toBeLessThanOrEqual(0.49);
    expect(maxInset({ quoteMark: false })).toBeLessThanOrEqual(0.49);
  });

  it("the avatar cell is exactly square (a pill clip must be a circle)", () => {
    const layout = buildQuoteCardLayout(base({ hasAvatar: true, role: "A role line" }));
    const avatar = layout.cells.find((c) => c.kind === "avatar")!;
    expect(avatar.rect.w).toBe(avatar.rect.h);
    expect(avatar.rect.w).toBeGreaterThan(0);
  });

  it("center alignment centers the accent bar; left pins it to the interior edge", () => {
    const centered = buildQuoteCardLayout(base());
    const left = buildQuoteCardLayout(base({ align: "left" }));
    const S = 1080;
    const margin = Math.round(0.09 * S);
    const cBar = centered.cells.find((c) => c.kind === "accent-bar")!;
    const lBar = left.cells.find((c) => c.kind === "accent-bar")!;
    expect(lBar.rect.x).toBe(margin);
    const mid = cBar.rect.x + cBar.rect.w / 2;
    expect(Math.abs(mid - 1080 / 2)).toBeLessThanOrEqual(1);
  });

  it("quoteMark off removes the mark band and gives its space to the quote", () => {
    const withMark = buildQuoteCardLayout(base());
    const noMark = buildQuoteCardLayout(base({ quoteMark: false }));
    expect(noMark.cells.some((c) => c.kind === "mark")).toBe(false);
    const q1 = withMark.cells.find((c) => c.kind === "quote")!;
    const q2 = noMark.cells.find((c) => c.kind === "quote")!;
    expect(q2.rect.h).toBeGreaterThan(q1.rect.h);
  });

  it("no attribution and no avatar: only mark, quote and accent bar remain", () => {
    const layout = buildQuoteCardLayout(base({ attribution: null }));
    expect(layout.cells.map((c) => c.kind)).toEqual(["mark", "quote", "accent-bar"]);
  });

  it("name and role stack inside the attribution band; beside an avatar they left-compose", () => {
    const layout = buildQuoteCardLayout(base({ role: "Author", hasAvatar: true }));
    const avatar = layout.cells.find((c) => c.kind === "avatar")!;
    const name = layout.cells.find((c) => c.kind === "name")!;
    const role = layout.cells.find((c) => c.kind === "role")!;
    expect(name.rect.x).toBe(role.rect.x);
    expect(name.rect.y + name.rect.h).toBeLessThanOrEqual(role.rect.y);
    expect(name.rect.x).toBeGreaterThan(avatar.rect.x + avatar.rect.w);
    if (name.kind === "name") expect(name.hAlign).toBe("left");
  });

  it("deterministic: identical inputs produce identical layouts", () => {
    const a = buildQuoteCardLayout(base({ role: "Role", hasAvatar: true }));
    const b = buildQuoteCardLayout(base({ role: "Role", hasAvatar: true }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("re-derives from the canvas: a portrait card keeps every cell inside bounds", () => {
    const layout = buildQuoteCardLayout(base({ W: 1080, H: 1920, role: "Stories", hasAvatar: true }));
    for (const c of layout.cells) {
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.y).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(1080);
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(1920);
    }
  });

  it("throws QuoteLayoutError on an empty quote and on a hopeless canvas", () => {
    expect(() => buildQuoteCardLayout(base({ quote: "   " }))).toThrow(QuoteLayoutError);
    expect(() => buildQuoteCardLayout(base({ W: 60, H: 60 }))).toThrow(QuoteLayoutError);
  });
});

describe("quote-card layout — wrap + fit", () => {
  it("greedy wrap: every line fits the box width at the chosen font", () => {
    const layout = buildQuoteCardLayout(
      base({
        quote:
          "The instinct to keep the string small or readable is wrong — pushing all complexity into the string is precisely what keeps everything downstream simple.",
      }),
    );
    const q = layout.cells.find((c) => c.kind === "quote")!;
    if (q.kind !== "quote") return;
    expect(q.lines).toBeGreaterThan(1);
    expect(q.text.split("\n").length).toBe(q.lines);
  });

  it("a longer quote never gets a larger font than a shorter one (same box)", () => {
    const short = buildQuoteCardLayout(base({ quote: "Less is more." }));
    const long = buildQuoteCardLayout(
      base({
        quote:
          "A very much longer quotation that will have to wrap across a good number of lines before it fits into exactly the same card interior.",
      }),
    );
    const fs = (l: typeof short) => {
      const q = l.cells.find((c) => c.kind === "quote")!;
      return q.kind === "quote" ? q.fontSize : 0;
    };
    expect(fs(long)).toBeLessThanOrEqual(fs(short));
  });

  it("wrapQuoteLines hard-breaks an unbroken over-long token instead of overflowing", () => {
    const lines = wrapQuoteLines("supercalifragilisticexpialidocious".repeat(4), 40, 300);
    expect(lines).not.toBeNull();
    expect(lines!.length).toBeGreaterThan(1);
  });

  it("wrapQuoteLines returns null when even one glyph cannot fit", () => {
    expect(wrapQuoteLines("m", 100, 2)).toBeNull();
  });

  it("fitQuoteBlock floors at 8px and ellipsis-truncates when the box is hopeless", () => {
    const fitted = fitQuoteBlock("word ".repeat(400).trim(), 300, 60, 64);
    expect(fitted.fontSize).toBe(8);
    expect(fitted.text.endsWith("…")).toBe(true);
  });

  it("fitQuoteBlock is deterministic", () => {
    const a = fitQuoteBlock("Same input, same output, every time.", 800, 400, 90);
    const b = fitQuoteBlock("Same input, same output, every time.", 800, 400, 90);
    expect(a).toEqual(b);
  });
});

describe("quote-card layout — adversarial inputs", () => {
  // Slimmed from the overnight fuzz sweep: representative nasty inputs only,
  // so the case stays fast in the suite. The full cartesian sweep is a
  // one-off dev tool, not a regression test.
  const NASTY_QUOTES = [
    "x",
    "“Curly quotes” — em-dashes… and ellipsis characters everywhere, naturally.",
    "supercalifragilisticexpialidocious".repeat(4),
    "word ".repeat(60).trim(),
    "https://example.com/some/extremely/long/url/path/that/never/breaks?with=query&params=1234567890",
    "多语言 текст mixé ✓",
    "🎉🎉🎉 emoji only 🎉🎉🎉",
    "a\nb\nc explicit newlines in the prop",
    "Tab\tand   runs    of spaces",
  ];
  const SIZES: Array<[number, number]> = [
    [1080, 1080],
    [540, 675],
    [300, 80],
    [90, 90],
    [1, 1],
  ];

  it("throws nothing but QuoteLayoutError; every emitted m0 keeps one frame per cell", () => {
    for (const [W, H] of SIZES) {
      for (const quote of NASTY_QUOTES) {
        for (const hasAvatar of [false, true]) {
          const tag = `${W}x${H} avatar=${hasAvatar} "${quote.slice(0, 16)}"`;
          let layout;
          try {
            layout = buildQuoteCardLayout(
              base({ W, H, quote, role: "Writer of notes", hasAvatar }),
            );
          } catch (e) {
            if (!(e instanceof QuoteLayoutError)) throw new Error(`${tag} crashed: ${(e as Error).message}`);
            continue;
          }
          const parsed = parseM0StringComplete(String(layout.m0), W, H);
          if (!parsed.ok) throw new Error(`${tag} emitted an unparseable m0`);
          expect(parsed.ir.renderFrames.length).toBe(layout.cells.length);
        }
      }
    }
  }, 30000);
});
