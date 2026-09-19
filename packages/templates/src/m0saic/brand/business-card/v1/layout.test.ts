/**
 * @m0saic/brand/business-card/v1 — print geometry gate.
 *
 * Locks the print spec (trim / bleed / safe at 300 DPI), the even
 * lattice-friendly canvas snap (and that it keeps the printer's aspect), the
 * MOO preset's EXACT box (1098 x 648 — the uploader fits the file to it), the
 * DPI scaling, and that every front / back rect lands inside the safe area
 * at print legibility.
 */
import { latticeAxisTier } from "@m0saic/template-utils";
import {
  BLEEDS,
  BLEED_IN,
  buildBackLayout,
  buildFrontLayout,
  cardCanvas,
  effectiveDpi,
  fitLine,
  inToPx,
  outlineRects,
  pickBleed,
  ptToPx,
  rectInside,
  sharedLineFont,
  snapCanvasEven,
  type Rect,
} from "./layout";

const COPY = { name: "Quentin S", role: "Founder, m0saic", email: "quentin@m0saic.io", site: "m0saic.io", handle: "@qsbuilds" };

describe("business-card layout — units", () => {
  it("inches and points scale by dpi", () => {
    expect(inToPx(3.5, 300)).toBe(1050);
    expect(inToPx(2, 300)).toBe(600);
    expect(inToPx(0.125, 300)).toBe(38);
    expect(ptToPx(6, 300)).toBe(25);
    expect(ptToPx(6, 150)).toBe(13);
  });
});

describe("business-card layout — canvas snap", () => {
  it("leaves an already lattice-excellent canvas alone", () => {
    expect(snapCanvasEven(1050, 600)).toEqual({ w: 1050, h: 600 });
    expect(snapCanvasEven(2100, 1200)).toEqual({ w: 2100, h: 1200 });
  });

  it("moves a divisor-poor canvas to even, tier-2 axes and keeps the spec aspect", () => {
    const s = snapCanvasEven(1126, 676); // 3.75 x 2.25 in at 300 (38px bleed each side)
    expect(s).toEqual({ w: 1130, h: 678 });
    expect(s.w % 2).toBe(0);
    expect(s.h % 2).toBe(0);
    expect(latticeAxisTier(s.w)).toBe(2);
    expect(latticeAxisTier(s.h)).toBe(2);
    expect(Math.abs(s.w / s.h - 1126 / 676) / (1126 / 676)).toBeLessThan(0.002);
  });

  it("is a pure function of its inputs", () => {
    expect(snapCanvasEven(1088, 638)).toEqual(snapCanvasEven(1088, 638));
  });
});

describe("business-card layout — card canvas", () => {
  it.each([
    ["moo", 300, 1098, 648],
    ["moo", 600, 2196, 1296],
    ["moo", 150, 550, 324],
    ["none", 300, 1050, 600],
    ["sixteenth", 300, 1092, 642],
    ["eighth", 300, 1130, 678],
    ["eighth", 150, 560, 336],
    ["eighth", 600, 2250, 1350],
  ] as const)("%s bleed @%i dpi → %ix%i", (bleed, dpi, W, H) => {
    const c = cardCanvas(bleed, dpi);
    expect([c.W, c.H]).toEqual([W, H]);
    expect(c.W % 2).toBe(0);
    expect(c.H % 2).toBe(0);
  });

  it("MOO is the default preset and its box is EXACT at 300 DPI: 3.66 x 2.16 in → 1098 x 648, trim 24 px in, no lattice snap", () => {
    expect(pickBleed(undefined)).toBe("moo");
    expect(pickBleed("lots")).toBe("moo");
    const c = cardCanvas("moo", 300);
    expect([c.W, c.H]).toEqual([1098, 648]);
    expect(c.trim).toEqual({ x: 24, y: 24, w: 1050, h: 600 });
    expect(c.safe).toEqual({ x: 62, y: 62, w: 974, h: 524 });
    // The general snap WOULD move this box (1100 is the tier-2 neighbour); the preset holds it.
    expect(snapCanvasEven(1098, 648)).not.toEqual({ w: 1098, h: 648 });
    expect(latticeAxisTier(648)).toBe(2);
  });

  it("keeps the trim centred with at least the spec bleed on every side, safe 1/8 in inside", () => {
    for (const bleed of BLEEDS) {
      const c = cardCanvas(bleed, 300);
      expect(c.trim.w).toBe(1050);
      expect(c.trim.h).toBe(600);
      expect(Math.abs(c.trim.x - (c.W - c.trim.w - c.trim.x))).toBeLessThanOrEqual(1);
      expect(Math.abs(c.trim.y - (c.H - c.trim.h - c.trim.y))).toBeLessThanOrEqual(1);
      const minBleed = Math.floor(BLEED_IN[bleed] * 300);
      expect(c.trim.x).toBeGreaterThanOrEqual(minBleed);
      expect(c.trim.y).toBeGreaterThanOrEqual(minBleed);
      expect(c.safe).toEqual({ x: c.trim.x + 38, y: c.trim.y + 38, w: 1050 - 76, h: 600 - 76 });
    }
  });
});

describe("business-card layout — effective dpi", () => {
  it("uses the requested dpi at (or within 4px of) the natural canvas", () => {
    expect(effectiveDpi("moo", 300, { width: 1098, height: 648 })).toBe(300);
    expect(effectiveDpi("eighth", 300, { width: 1130, height: 678 })).toBe(300);
    expect(effectiveDpi("eighth", 300, { width: 1128, height: 680 })).toBe(300);
    expect(effectiveDpi("eighth", 300, null)).toBe(300);
  });

  it("scales uniformly into a foreign canvas, aspect preserved, and the result fits", () => {
    const dpi = effectiveDpi("eighth", 300, { width: 1920, height: 1080 });
    const c = cardCanvas("eighth", dpi);
    expect(c.W).toBeLessThanOrEqual(1920);
    expect(c.H).toBeLessThanOrEqual(1080);
    expect(Math.abs(c.W / c.H - 5 / 3)).toBeLessThan(0.02);
    expect(dpi).toBeGreaterThan(300);
  });
});

describe("business-card layout — text fitting", () => {
  it("never goes below MOO's 8pt floor (33 px at 300 DPI); ellipsizes only when the floor overflows", () => {
    expect(ptToPx(8, 300)).toBe(33);
    const fit = fitLine("quentin@m0saic.io", 900, 40, 300, "JetBrains Mono", false);
    expect(fit.fontSize).toBe(40);
    expect(fit.text).toBe("quentin@m0saic.io");
    const tight = fitLine("a-deliberately-very-long-string-that-cannot-fit-in-a-tiny-box", 120, 40, 300, "JetBrains Mono", false);
    expect(tight.fontSize).toBe(33);
    expect(tight.text.endsWith("…")).toBe(true);
    expect(tight.width).toBeLessThanOrEqual(120);
  });

  it("a ceiling under the floor IS the floor (the shared command size rides through fitLine untouched)", () => {
    const fit = fitLine("npx m0saic hello-world", 900, 30, 300, "JetBrains Mono", false);
    expect(fit.fontSize).toBe(30);
    expect(fit.text).toBe("npx m0saic hello-world");
  });

  it("sharedLineFont: the largest size <= ceiling at which the longest line fits — no floor", () => {
    const longest = "npx m0saic make @m0saic/alpine/contributor-table/v1"; // 51 chars
    const boxW = 926; // the back's inner width at 300 DPI on the MOO canvas
    const px = sharedLineFont(longest, boxW, 33, "JetBrains Mono", false);
    expect(px).toBe(30); // 7.2 pt — JetBrains Mono advances 0.6 em: 51 x 18 = 918 <= 920
    expect(sharedLineFont("npx m0saic hello-world", boxW, 33, "JetBrains Mono", false)).toBe(33); // short → the ceiling
    expect(sharedLineFont(longest, boxW, 20, "JetBrains Mono", false)).toBe(20);
  });
});

const inside = (r: Rect, outer: Rect) => expect(rectInside(r, outer)).toBe(true);

describe("business-card layout — front", () => {
  const c = cardCanvas("moo", 300);
  const f = buildFrontLayout(c, COPY);

  it("places the lockup and every text line inside the safe area, at print size", () => {
    inside(f.mark, c.safe);
    inside(f.wordmark, c.safe);
    expect(f.mark.w).toBe(f.mark.h);
    for (const l of [f.name, f.role, f.email, f.site, f.handle]) {
      expect(l).not.toBeNull();
      inside(l!.rect, c.safe);
      expect(l!.fontSize).toBeGreaterThanOrEqual(33); // MOO's 8 pt floor
    }
    expect(f.name.bold).toBe(true);
    expect(f.name.fontSize).toBeGreaterThan(f.role!.fontSize);
  });

  it("covers the whole bleed canvas with field tiles", () => {
    expect(f.field.length).toBeGreaterThan(40);
    for (const r of f.field) inside(r, { x: 0, y: 0, w: c.W, h: c.H });
  });

  it("puts the handle beside the site when both fit, under it otherwise", () => {
    expect(f.handle!.rect.y).toBe(f.site!.rect.y);
    expect(f.handle!.rect.x).toBeGreaterThan(f.site!.rect.x + f.site!.rect.w);
    const long = buildFrontLayout(c, { ...COPY, site: "a-very-long-subdomain.example-company-website.io", handle: "@an-equally-long-social-handle" });
    expect(long.handle!.rect.y).toBeGreaterThan(long.site!.rect.y);
    inside(long.handle!.rect, c.safe);
  });

  it("drops empty lines", () => {
    const g = buildFrontLayout(c, { ...COPY, role: "", handle: "" });
    expect(g.role).toBeNull();
    expect(g.handle).toBeNull();
    expect(g.email!.rect.y).toBeLessThan(f.email!.rect.y + 200);
  });

  it("scales with dpi (150 DPI proof is the same layout, half size)", () => {
    const half = buildFrontLayout(cardCanvas("moo", 150), COPY);
    expect(Math.abs(half.mark.w * 2 - f.mark.w)).toBeLessThanOrEqual(2);
  });
});

describe("business-card layout — back", () => {
  const c = cardCanvas("moo", 300);
  const LONGEST = "npx m0saic make @m0saic/alpine/contributor-table/v1";
  const copy = { title: "Donut Chart", url: "m0saic.io/t/alpine/donut/v3", command: "npx m0saic make @m0saic/alpine/donut/v3", commandSizedFor: LONGEST, posterAspect: 1 };
  const b = buildBackLayout(c, copy);

  it("poster (aspect-fit, even), QR (square) and the text band sit inside the safe area", () => {
    inside(b.poster, c.safe);
    inside(b.qr, c.safe);
    expect(b.qr.w).toBe(b.qr.h);
    expect(b.qr.w).toBeGreaterThanOrEqual(inToPx(1.0, 300));
    expect(b.poster.w % 2).toBe(0);
    expect(Math.abs(b.poster.w / b.poster.h - 1)).toBeLessThan(0.02);
    for (const l of [b.title, b.url, b.command]) inside(l.rect, c.safe);
    expect(b.title.fontSize).toBe(38); // 9 pt
    expect(b.url.fontSize).toBe(33); // 8 pt — the floor
    expect(b.command.fontSize).toBe(30); // the shared size: the longest catalog command at 7.2 pt
    expect(b.poster.x + b.poster.w).toBeLessThan(b.qr.x);
    expect(b.title.rect.y).toBeGreaterThan(b.poster.y + b.poster.h);
  });

  it("every back prints the command at ONE size — the longest command's — never ellipsized", () => {
    const short = buildBackLayout(c, { ...copy, command: "npx m0saic hello-world" });
    const longest = buildBackLayout(c, { ...copy, command: LONGEST });
    expect(short.command.fontSize).toBe(longest.command.fontSize);
    expect(longest.command.text).toBe(LONGEST);
    expect(longest.command.rect.x + longest.command.rect.w).toBeLessThanOrEqual(c.safe.x + c.safe.w);
    // Without a set to size for, a lone command sizes itself (the ceiling when it fits).
    expect(buildBackLayout(c, { ...copy, command: "npx m0saic hello-world", commandSizedFor: undefined }).command.fontSize).toBe(33);
  });

  it("aspect-fits a wide poster into the same box", () => {
    const wide = buildBackLayout(c, { ...copy, posterAspect: 16 / 9 });
    expect(Math.abs(wide.poster.w / wide.poster.h - 16 / 9)).toBeLessThan(0.02);
    expect(wide.poster.w).toBeGreaterThan(b.poster.w);
    inside(wide.poster, c.safe);
  });

  it("the longest catalog id prints the typeable url at the floor and the command whole", () => {
    const long = buildBackLayout(c, { ...copy, url: "m0saic.io/t/alpine/contributor-table/v1", command: LONGEST });
    expect(long.url.fontSize).toBe(33);
    expect(long.url.text.endsWith("…")).toBe(false);
    expect(long.command.text.endsWith("…")).toBe(false);
    // Title + url + command still clear the safe bottom at the new sizes.
    expect(long.command.rect.y + long.command.rect.h).toBeLessThanOrEqual(c.safe.y + c.safe.h);
  });
});

describe("business-card layout — guides", () => {
  it("outlines a rect with four strokes inside it", () => {
    const r = { x: 10, y: 20, w: 100, h: 50 };
    const o = outlineRects(r, 2);
    expect(o).toHaveLength(4);
    for (const s of o) inside(s, r);
  });
});
