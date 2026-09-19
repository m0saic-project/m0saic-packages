import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";

import { CARD_BANDS } from "../layout";
import { resolveTiming } from "../plan";
import type { StoryPlan, StoryScene } from "../plan";
import { storyTheme } from "../theme";
import { buildCardDoc, fitHeadingBlock, greedyWrap } from "./card";

const THEME = storyTheme();

function makePlan(): StoryPlan {
  const r = resolveTiming(
    {
      schemaVersion: 1,
      title: "Every Level of a City Block",
      subtitle: "From the sidewalk to the skyline",
      sections: [{ id: "a", title: "Street Level", overrides: { durationMs: 2640 } }],
    },
    { fps: 30, target: { width: 1920, height: 1080 }, narrationDurationMs: () => undefined },
  );
  if ("error" in r) throw new Error(r.error);
  return r.plan;
}

const plan = makePlan();
const landscape = { name: "landscape" as const, width: 1920, height: 1080 };
const portrait = { name: "portrait" as const, width: 1080, height: 1920 };

function sceneOf(kind: StoryScene["kind"]): StoryScene {
  const scene = plan.scenes.find((s) => s.kind === kind);
  if (!scene) throw new Error(`no ${kind} scene`);
  return scene;
}

describe("buildCardDoc", () => {
  it.each(["title", "section-card", "outro"] as const)("%s: one source per band, valid m0, self-declared stamp fields", (kind) => {
    for (const variant of [landscape, portrait]) {
      const doc = buildCardDoc(sceneOf(kind), variant, plan, THEME);
      expect(doc.sources).toHaveLength(CARD_BANDS[kind].length);
      expect(isValidM0String(String(doc.m0))).toBe(true);
      expect(parseM0StringToRenderFrames(String(doc.m0), variant.width, variant.height)).toHaveLength(doc.sources.length);
      expect(doc.size).toEqual({ width: variant.width, height: variant.height });
      expect(doc.fps).toBe(30);
      const scene = sceneOf(kind);
      expect(doc.durationMs).toBe(scene.visibleMs + scene.xfadeOutMs);
    }
  });

  it("title card carries the headline, the subtitle, and the accent bar", () => {
    const flat = JSON.stringify(buildCardDoc(sceneOf("title"), landscape, plan, THEME));
    expect(flat).toContain("Every Level of a City Block");
    expect(flat).toContain("From the sidewalk to the skyline");
    expect(flat).toContain(THEME.accent);
    expect(flat).toContain('"rasterizer":"svg"');
  });

  it("section card carries the numbered kicker and the section heading", () => {
    const flat = JSON.stringify(buildCardDoc(sceneOf("section-card"), landscape, plan, THEME));
    expect(flat).toContain("PART 01");
    expect(flat).toContain("Street Level");
  });

  it("static card text never uses drawtext (R9 — svg only)", () => {
    const flat = JSON.stringify(buildCardDoc(sceneOf("title"), landscape, plan, THEME));
    expect(flat).not.toContain('"rasterizer":"drawtext"');
  });

  it("rejects body scenes", () => {
    expect(() => buildCardDoc(sceneOf("body"), landscape, plan, THEME)).toThrow(/body scene/);
  });

  it("is deterministic", () => {
    const a = buildCardDoc(sceneOf("title"), landscape, plan, THEME);
    expect(buildCardDoc(sceneOf("title"), landscape, plan, THEME)).toEqual(a);
  });
});

describe("fitHeadingBlock / greedyWrap", () => {
  it("keeps a short heading on one line at the cap", () => {
    const fit = fitHeadingBlock("Street Level", 1400, 160, 92, true);
    expect(fit.text).toBe("Street Level");
    expect(fit.fontSize).toBeGreaterThan(50);
  });

  it("wraps a long heading to two lines rather than shrinking to unreadable", () => {
    const fit = fitHeadingBlock(
      "The Extremely Long Section Heading That Would Never Fit One Line",
      900,
      220,
      92,
      true,
    );
    expect(fit.text.split("\n").length).toBeLessThanOrEqual(2);
    expect(fit.fontSize).toBeGreaterThanOrEqual(16);
  });

  it("greedyWrap returns null when a single word exceeds the box", () => {
    expect(greedyWrap("Antidisestablishmentarianism", () => 5000, 100)).toBeNull();
    expect(greedyWrap("two words", (s) => s.length * 10, 100)).toEqual(["two words"]);
  });

  it("a cap below 16 px stays at the cap instead of being promoted to 16", () => {
    const fit = fitHeadingBlock("EVERY LEVEL OF THE CITY BLOCK EXPLAINED", 180, 20, 9, true);
    expect(fit.fontSize).toBeLessThanOrEqual(9);
  });

  it("the last-resort path wraps — never returns an unwrapped overflow line", () => {
    const fit = fitHeadingBlock(
      "An Extraordinarily Long Heading With Many Many Words That Cannot Possibly Fit On Two Lines Here",
      200,
      120,
      92,
      true,
    );
    const lines = fit.text.split("\n");
    expect(lines.length).toBeGreaterThan(2); // beyond the 2-line search = the fallback ran
    for (const line of lines) {
      expect(line.length).toBeLessThan(40); // wrapped to the box, not one overflow line
    }
  });

  it("ellipsizes when even floor-size wrapping exceeds the band height", () => {
    const fit = fitHeadingBlock(
      "An Extraordinarily Long Heading With Many Many Words That Cannot Possibly Fit In This Short Band At All",
      200,
      40, // ~2 lines at the 16px floor
      92,
      true,
    );
    expect(fit.text.split("\n").length).toBeLessThanOrEqual(2);
    expect(fit.text.endsWith("…")).toBe(true);
  });
});
