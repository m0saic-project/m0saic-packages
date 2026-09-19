import { isValidM0String } from "@m0saic/dsl";
import { classify, capFont, pulseTiming, buildHeader, buildFooter, text1, insetSafe, backdrop, chromeAssets, type Rect } from "./pulse-chrome";
import { pulseTheme } from "./pulse-theme";

const theme = pulseTheme("dark");

describe("pulse-chrome — classify", () => {
  it("maps the canvas aspect to a variant key", () => {
    expect(classify(1920, 1080)).toBe("desktop");
    expect(classify(1080, 1080)).toBe("square");
    expect(classify(1080, 1920)).toBe("mobile");
  });
});

describe("pulse-chrome — capFont", () => {
  it("never lets text exceed the cell width", () => {
    const f = capFont(200, "ACTIVITY TREND", 400, 20, 0.62);
    expect(14 * f * 0.62).toBeLessThanOrEqual(400 + 1);
    expect(capFont(40, "BEAT 2", 9999, 10)).toBe(40); // short text capped by px, not width
  });
});

describe("pulse-chrome — pulseTiming", () => {
  it("bg reveals first, then chrome, then cards; reduceMotion collapses to t=0", () => {
    const t = pulseTiming(9000, false);
    expect(t.bgFinishT).toBeCloseTo(9 * 0.22, 3);
    expect(t.cardsStart).toBeGreaterThan(t.bgFinishT);
    expect(t.animOn).toBe(true);
    const r = pulseTiming(9000, true);
    expect(r.bgFinishT).toBe(0);
    expect(r.animOn).toBe(false);
  });
});

describe("pulse-chrome — header/footer/leaf builders", () => {
  const t = pulseTiming(9000, true); // static → deterministic, no alpha
  const W = 1920, H = 1080;
  const rects = { beat: { x: 140, y: 66, w: 128, h: 42 }, logo: { x: 140, y: 138, w: 116, h: 116 }, title: { x: 276, y: 150, w: 680, h: 92 }, subtitle: { x: 142, y: 282, w: 680, h: 34 } };

  it("text1 is fixed-font (no fit:'contain')", () => {
    const src = text1("HELLO", 40, "#fff");
    expect((src.layers[0].placement as { fit?: string }).fit).toBeUndefined();
  });

  it("buildHeader yields 4 nodes (beat/logo/title/subtitle) with valid m0 + a bbox", () => {
    const { nodes, bbox } = buildHeader(rects, theme, { eyebrow: "BEAT 2", title: "ACTIVITY TREND", subtitle: "Commits over the week." }, t, W, H);
    expect(nodes.length).toBe(4);
    for (const n of nodes) expect(isValidM0String(n.m0)).toBe(true);
    expect(bbox.x).toBe(140); // leftmost of the 4 rects
    expect(bbox.y).toBe(66);
  });

  it("buildFooter + backdrop produce valid nodes", () => {
    expect(isValidM0String(buildFooter({ x: 140, y: 1006, w: 560, h: 50 }, theme, "WEEK 20 · May 12 – May 18, 2025", t, W, H).m0)).toBe(true);
    expect(isValidM0String(backdrop(theme.card, { x: 100, y: 100, w: 800, h: 400 }, W, H, 0, 0, false).m0)).toBe(true);
  });

  it("insetSafe omits 0-weight margins (edge-flush rect stays valid)", () => {
    const node = insetSafe({ m0: "F", sources: [text1("x", 20, "#fff")] }, { x: 0, y: 0, w: W, h: 100 } as Rect, W, H);
    expect(isValidM0String(node.m0)).toBe(true);
  });
});

describe("pulse-chrome — chromeAssets", () => {
  it("resolves the FFmpeg logo + the per-aspect baked scatter", () => {
    const a = chromeAssets("square");
    expect(a.ffmpegLogo.path).toMatch(/ffmpeg-logo\.png$/);
    expect(a.scatterBg.path).toMatch(/scatter-square\.mp4$/);
    expect(a.scatterBg.mediaType).toBe("video");
  });
});
