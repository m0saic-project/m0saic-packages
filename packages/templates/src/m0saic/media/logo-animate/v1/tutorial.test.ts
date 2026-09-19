import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import { renderLogoAnimateTutorial } from "./tutorial";
import { LogoAnimateV1 } from "./logo-animate";

function ctx(w = 1280, h = 720): MosaicEngineContext {
  const target = { width: w, height: h, fps: 30, durationMs: 4000 };
  return { mode: "design", target, output: target, media: {} } as unknown as MosaicEngineContext;
}

describe("logo-animate tutorial", () => {
  it("is wired on the template", () => {
    expect(typeof LogoAnimateV1.renderTutorial).toBe("function");
  });

  it("six beats, durations sum, every beat a sized VALID doc", () => {
    const tut = renderLogoAnimateTutorial(ctx());
    expect(tut.kind).toBe("mosaic_pipeline");
    expect(tut.steps.map((s) => s.name)).toEqual(["hero", "yoursvg", "modes", "bitmap", "finish"]);
    expect(tut.durationMs).toBe(tut.steps.reduce((a, s) => a + s.durationMs, 0));
    for (const step of tut.steps) {
      const doc = step.file as MosaicDocument;
      expect(doc.size).toEqual({ width: 1280, height: 720 });
      expect(validateM0String(String(doc.m0)).ok).toBe(true);
      // Inline-flat law: tutorial beats carry NO children (child composites
      // break the audio concat + bleed mask seams).
      expect(doc.children).toBeUndefined();
      expect((doc.sources ?? []).length).toBeGreaterThan(0);
    }
  });

  it("live inline logos: hero carries animated (overlay-alpha) mask tiles; bitmap mock ANIMATES", () => {
    const tut = renderLogoAnimateTutorial(ctx());
    const hero = tut.steps[0]!.file as MosaicDocument;
    const animated = hero.sources.filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(animated.length).toBeGreaterThan(10); // the 33-shape M, inlined
    // bitmap beat: every mock pixel fades in (founder: was static)
    const bitmap = tut.steps.find((st) => st.name === "bitmap")!.file as MosaicDocument;
    const px = bitmap.sources.filter((s) => {
      const src = s as { overlay?: { alpha?: string }; type?: string };
      return src.overlay?.alpha && src.type !== "text";
    });
    expect(px.length).toBeGreaterThan(60); // the 11x11 circle's inside cells
  });

  it("determinism: two renders byte-identical", () => {
    const a = renderLogoAnimateTutorial(ctx());
    const b = renderLogoAnimateTutorial(ctx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("geometry contract: the M's rect is exactly 1:1 (founder ruling, gate 21)", () => {
  const { resolveDocFrames } = require("@m0saic/template-utils");

  /** Bounding box of the hero beat's animated (overlay-alpha) logo tiles. */
  function heroLogoBBoxAspect(w: number, h: number): number {
    const hero = renderLogoAnimateTutorial(ctx(w, h)).steps[0]!.file as MosaicDocument;
    const rd = resolveDocFrames(hero, w, h);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of rd.frames) {
      const src = hero.sources[f.logicalIndex] as { overlay?: { alpha?: string }; type?: string };
      // Logo tiles only: alpha-animated NON-TEXT sources (the copy column
      // fades in with alpha too — including it measured the whole page).
      if (!src?.overlay?.alpha || src?.type === "text") continue;
      minX = Math.min(minX, f.x); minY = Math.min(minY, f.y);
      maxX = Math.max(maxX, f.x + f.width); maxY = Math.max(maxY, f.y + f.height);
    }
    expect(maxX).toBeGreaterThan(minX);
    return (maxX - minX) / (maxY - minY);
  }

  it("tutorial hero M is square at square AND landscape canvases", () => {
    for (const [w, h] of [[1080, 1080], [1280, 720], [1920, 1080]] as const) {
      const aspect = heroLogoBBoxAspect(w, h);
      expect(Math.abs(aspect - 1)).toBeLessThanOrEqual(0.06);
    }
  });

  it("cover M bbox is square at square AND landscape canvases", async () => {
    for (const [w, h] of [[1080, 1080], [1280, 720], [1920, 1080]] as const) {
      const target = { width: w, height: h, fps: 30, durationMs: 2520 };
      const cover = (await LogoAnimateV1.renderCover!({}, {
        mode: "design", target, output: target, media: {},
      } as unknown as MosaicEngineContext)) as MosaicDocument;
      const rd = resolveDocFrames(cover, w, h);
      // Logo tiles = every tile painted the INK color (masked caps + plain
      // rects alike). Position-independent: the branded band layout puts
      // frame borders + the plate before them, and only the M uses the ink.
      const ink = (cover.sources.find(
        (s) => (s as { mask?: { kind?: string } }).mask?.kind === "inline-mask",
      ) as { color?: string })?.color;
      expect(ink).toBeTruthy();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < cover.sources.length; i++) {
        const src = cover.sources[i] as { type?: string; color?: string };
        if (src.type !== "lavfi" || src.color !== ink) continue;
        const f = rd.framesByLogical[i];
        if (!f) continue;
        minX = Math.min(minX, f.x); minY = Math.min(minY, f.y);
        maxX = Math.max(maxX, f.x + f.width); maxY = Math.max(maxY, f.y + f.height);
      }
      expect(maxX).toBeGreaterThan(minX);
      expect(Math.abs((maxX - minX) / (maxY - minY) - 1)).toBeLessThanOrEqual(0.04);
    }
  });

});

describe("text-fit contract: tutorial text is never cut (founder ruling, gate 21)", () => {
  const { resolveDocFrames, textEmUnits } = require("@m0saic/template-utils");

  it("every text line's glyphs fit its resolved cell at common canvases", () => {
    for (const [w, h] of [[960, 540], [1080, 1080], [1280, 720], [1920, 1080]] as const) {
      const tut = renderLogoAnimateTutorial(ctx(w, h));
      for (const step of tut.steps) {
        const doc = step.file as MosaicDocument;
        const rd = resolveDocFrames(doc, w, h);
        doc.sources.forEach((src, i) => {
          const s = src as {
            type?: string;
            style?: { fontSize?: number };
            layers?: Array<{ content?: { text?: string } }>;
          };
          if (s.type !== "text" || !s.style?.fontSize) return;
          const f = rd.framesByLogical[i];
          if (!f) return;
          const font = s.style.fontSize;
          const text = s.layers?.[0]?.content?.text ?? "";
          const id = `${w}x${h} ${step.name} "${text.slice(0, 28)}"`;
          // Vertical: glyph box + leading must fit the line cell.
          expect({ id, vfit: f.height >= font * 1.12 }).toEqual({ id, vfit: true });
          // Horizontal: script-aware width model vs the TRUE cell.
          const wpx = textEmUnits(text) * font * 0.62;
          expect({ id, hfit: wpx <= f.width * 1.03 }).toEqual({ id, hfit: true });
        });
      }
    }
  });
});
