import { resolveTiming, resolveVariants } from "./plan";
import type { ResolveTimingOptions } from "./plan";
import type { StoryDocument } from "./props";

const TARGET = { width: 1920, height: 1080 };

function opts(media: Record<string, number> = {}): ResolveTimingOptions {
  return {
    fps: 30,
    target: TARGET,
    narrationDurationMs: (raw) => media[raw],
  };
}

function story(partial: Partial<StoryDocument>): StoryDocument {
  return { schemaVersion: 1, title: "T", ...partial };
}

function planOf(s: StoryDocument, o = opts()) {
  const r = resolveTiming(s, o);
  if ("error" in r) throw new Error(`unexpected timing error: ${r.error}`);
  return r.plan;
}

describe("resolveTiming — the timing model", () => {
  const twoSections = story({
    sections: [
      { id: "a", title: "A", overrides: { durationMs: 2640 } },
      { id: "b", title: "B", overrides: { durationMs: 4120 } },
    ],
  });

  it("storyMs === Σ visible, exactly, as an integer", () => {
    const plan = planOf(twoSections);
    const sumVisible = plan.scenes.reduce((s, x) => s + x.visibleMs, 0);
    expect(plan.storyMs).toBe(sumVisible);
    expect(Number.isInteger(plan.storyMs)).toBe(true);
    // title 3500 + 2×card 2000 + bodies (2640+700, 4120+700) + outro 3000
    expect(plan.storyMs).toBe(3500 + 2000 + 3340 + 2000 + 4820 + 3000);
  });

  it("scene.startMs is the running Σ of previous visible durations", () => {
    const plan = planOf(twoSections);
    let acc = 0;
    for (const scene of plan.scenes) {
      expect(scene.startMs).toBe(acc);
      acc += scene.visibleMs;
    }
    expect(acc).toBe(plan.storyMs);
  });

  it("scene order is title, (card, body)×N, outro with the transition rule encoded", () => {
    const plan = planOf(twoSections);
    expect(plan.scenes.map((s) => s.kind)).toEqual([
      "title",
      "section-card",
      "body",
      "section-card",
      "body",
      "outro",
    ]);
    // Cards CUT into narration (xfadeOut 0); title and bodies fade out; the
    // outro is last and fades into nothing.
    const byKind = Object.fromEntries(plan.scenes.map((s) => [`${s.kind}:${s.name}`, s.xfadeOutMs]));
    expect(byKind["section-card:s0-card"]).toBe(0);
    expect(byKind["section-card:s1-card"]).toBe(0);
    expect(byKind["title:title"]).toBeGreaterThan(0);
    expect(byKind["body:s0-body"]).toBeGreaterThan(0);
    expect(byKind["outro:outro"]).toBe(0);
  });

  it("X = min(xfadeMs, tailPadMs, floor(min visible / 2))", () => {
    // Defaults: xfade 600 / tailPad 700; min visible is the 2000ms card → 600.
    expect(planOf(twoSections).scenes[0].xfadeOutMs).toBe(600);
    // Squeeze the cards down so floor(minVisible/2) wins.
    const squeezed = planOf(
      story({
        defaults: { titleCardMs: 400, sectionCardMs: 400, outroMs: 400, minSectionMs: 400 },
        sections: [{ id: "a", overrides: { durationMs: 100 } }],
      }),
    );
    // body visible = max(400, 100+700) = 800; min visible = 400 → X = 200.
    expect(squeezed.scenes[0].xfadeOutMs).toBe(200);
  });

  it("unequal probed narration durations produce unequal body scenes", () => {
    const s = story({
      sections: [
        { id: "a", narrationAudio: "/abs/a.m4a" },
        { id: "b", narrationAudio: "/abs/b.m4a" },
      ],
    });
    const plan = planOf(s, opts({ "/abs/a.m4a": 2640, "/abs/b.m4a": 5080 }));
    const bodies = plan.scenes.filter((x) => x.kind === "body");
    expect(bodies[0].visibleMs).toBe(3340);
    expect(bodies[1].visibleMs).toBe(5780);
  });

  it("explicit overrides.durationMs outranks the probed duration", () => {
    const s = story({
      sections: [{ id: "a", narrationAudio: "/abs/a.m4a", overrides: { durationMs: 1000 } }],
    });
    const plan = planOf(s, opts({ "/abs/a.m4a": 9999 }));
    expect(plan.scenes.find((x) => x.kind === "body")!.visibleMs).toBe(1700);
  });

  it("warns when overrides.durationMs disagrees with the probe by > 250 ms (override wins)", () => {
    const s = story({
      sections: [{ id: "a", narrationAudio: "/abs/a.m4a", overrides: { durationMs: 1000 } }],
    });
    const plan = planOf(s, opts({ "/abs/a.m4a": 2640 }));
    expect(plan.scenes.find((x) => x.kind === "body")!.visibleMs).toBe(1700); // override won
    expect(plan.diagnostics.some((d) => d.includes("STORY_DURATION_OVERRIDE_DISAGREES"))).toBe(true);

    const close = planOf(s, opts({ "/abs/a.m4a": 1100 }));
    expect(close.diagnostics.some((d) => d.includes("STORY_DURATION_OVERRIDE_DISAGREES"))).toBe(false);
  });

  it("probes by the RAW trimmed path string", () => {
    const s = story({ sections: [{ id: "a", narrationAudio: "  C:\\proj\\a.m4a " }] });
    const plan = planOf(s, opts({ "C:\\proj\\a.m4a": 2000 }));
    expect(plan.scenes.find((x) => x.kind === "body")!.visibleMs).toBe(2700);
  });

  it("narrationAudio present but unprobed and no override → fail fast with the three-way fix", () => {
    const s = story({
      sections: [{ id: "x", title: "How transformers work", narrationAudio: "assets/audio/03.m4a" }],
    });
    const r = resolveTiming(s, opts());
    expect("error" in r).toBe(true);
    const message = (r as { error: string }).error;
    expect(message).toContain('Section 0 ("How transformers work")');
    expect(message).toContain("assets/audio/03.m4a");
    expect(message).toContain("story-studio build");
    expect(message).toContain("overrides.durationMs");
    expect(message).toContain("mediaPaths");
  });

  it("a section with no narration at all is NOT an error — minSectionMs fallback + diagnostic", () => {
    const plan = planOf(story({ sections: [{ id: "quiet", title: "Quiet" }] }));
    const body = plan.scenes.find((x) => x.kind === "body")!;
    expect(body.visibleMs).toBe(1500);
    expect(body.noNarration).toBe(true);
    expect(plan.diagnostics.some((d) => d.includes("STORY_SECTION_NO_NARRATION"))).toBe(true);
  });

  it("fractional narration durations round to integer scene lengths", () => {
    const s = story({ sections: [{ id: "a", narrationAudio: "/abs/a.m4a" }] });
    const plan = planOf(s, opts({ "/abs/a.m4a": 2640.4 }));
    for (const scene of plan.scenes) {
      expect(Number.isInteger(scene.visibleMs)).toBe(true);
      expect(Number.isInteger(scene.xfadeOutMs)).toBe(true);
    }
    expect(Number.isInteger(plan.storyMs)).toBe(true);
  });

  it("is provenance-blind: a differing provenance block changes nothing", () => {
    const base = story({ sections: [{ id: "a", overrides: { durationMs: 2000 } }] });
    const withProv = { ...base, provenance: { generator: "x/9.9.9", secret: "different" } };
    expect(planOf(withProv)).toEqual(planOf(base));
  });

  it("is deterministic", () => {
    expect(planOf(twoSections)).toEqual(planOf(twoSections));
  });

  it("honors a per-section sectionCardMs override", () => {
    const plan = planOf(
      story({
        sections: [
          { id: "a", overrides: { durationMs: 2000, sectionCardMs: 4000 } },
          { id: "b", overrides: { durationMs: 2000 } },
        ],
      }),
    );
    const cards = plan.scenes.filter((x) => x.kind === "section-card");
    expect(cards[0].visibleMs).toBe(4000);
    expect(cards[1].visibleMs).toBe(2000);
  });

  it("names document-level keys that a section tries to override, instead of silently ignoring them", () => {
    const plan = planOf(
      story({
        sections: [{ id: "a", overrides: { durationMs: 2000, xfadeMs: 100, titleCardMs: 1 } }],
      }),
    );
    const notes = plan.diagnostics.filter((d) => d.includes("STORY_OVERRIDE_DOCUMENT_LEVEL"));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("titleCardMs");
    expect(notes[1]).toContain("xfadeMs");
    // The document-level values stayed global.
    expect(plan.scenes[0].visibleMs).toBe(3500);
  });

  it("fails fast on zero-length scenes instead of handing the engine a 0ms step", () => {
    const zeroCard = resolveTiming(
      story({ defaults: { sectionCardMs: 0 }, sections: [{ id: "a", overrides: { durationMs: 2000 } }] }),
      opts(),
    );
    expect("error" in zeroCard).toBe(true);
    expect((zeroCard as { error: string }).error).toContain("sectionCardMs");

    const zeroTitle = resolveTiming(
      story({ defaults: { titleCardMs: 0.4 }, sections: [{ id: "a", overrides: { durationMs: 2000 } }] }),
      opts(),
    );
    expect("error" in zeroTitle).toBe(true);
    expect((zeroTitle as { error: string }).error).toContain("titleCardMs");

    const zeroBody = resolveTiming(
      story({ defaults: { minSectionMs: 0 }, sections: [{ id: "quiet" }] }),
      opts(),
    );
    expect("error" in zeroBody).toBe(true);
  });

  it("captions config flows into the plan and typos get named diagnostics", () => {
    const plan = planOf(
      story({
        captions: { enabled: true, minCueMs: 500, cueGapMs: 40, plate: "never" },
        sections: [{ id: "a", narrationText: "Two short bits. Second bit here.", overrides: { durationMs: 4000 } }],
      }),
    );
    expect(plan.captions).toEqual({ enabled: true, minCueMs: 500, cueGapMs: 40, plate: "never" });
    expect(plan.scenes.find((s) => s.kind === "body")!.cues!.length).toBeGreaterThan(0);

    const typo = planOf(
      story({ captions: { plate: "Never" }, sections: [{ id: "a", overrides: { durationMs: 2000 } }] }),
    );
    expect(typo.captions.plate).toBe("always");
    expect(typo.diagnostics.some((d) => d.includes("STORY_CAPTIONS_PLATE_UNKNOWN"))).toBe(true);
  });

  it("an srt path without inlined cues gets a named diagnostic (templates never read files)", () => {
    const plan = planOf(
      story({ sections: [{ id: "a", srt: "assets/captions/a.srt", overrides: { durationMs: 2000 } }] }),
    );
    expect(plan.diagnostics.some((d) => d.includes("STORY_SRT_NOT_INLINED"))).toBe(true);
  });

  it("advises on narration+music sums above 1.0 only when a music bed exists", () => {
    const noMusic = planOf(
      story({ audio: { narrationVolume: 1, musicVolume: 0.1 }, sections: [{ id: "a", overrides: { durationMs: 2000 } }] }),
    );
    expect(noMusic.diagnostics.some((d) => d.includes("STORY_AUDIO_SUM"))).toBe(false);

    const withMusic = planOf(
      story({
        audio: { narrationVolume: 1, musicVolume: 0.1, music: "/abs/bed.m4a" },
        sections: [{ id: "a", overrides: { durationMs: 2000 } }],
      }),
    );
    expect(withMusic.diagnostics.some((d) => d.includes("STORY_AUDIO_SUM"))).toBe(true);
  });

  it("motion.ease flows into the plan; unknown values fall back to linear with a diagnostic", () => {
    const eased = planOf(
      story({ motion: { ease: "smoothstep" }, sections: [{ id: "a", overrides: { durationMs: 2000 } }] }),
    );
    expect(eased.motion.ease).toBe("smoothstep");

    const unknown = planOf(
      story({ motion: { ease: "bounce" }, sections: [{ id: "a", overrides: { durationMs: 2000 } }] }),
    );
    expect(unknown.motion.ease).toBe("linear");
    expect(unknown.diagnostics.some((d) => d.includes("STORY_MOTION_EASE_UNKNOWN"))).toBe(true);
  });

  it("extreme imageWeights degrade to equal weights instead of starving a slot to 0 ms", () => {
    const plan = planOf(
      story({
        sections: [
          { id: "a", images: ["/a.jpg", "/b.jpg"], overrides: { durationMs: 30000, imageWeights: [1000000, 1] } },
        ],
      }),
    );
    const body = plan.scenes.find((s) => s.kind === "body")!;
    for (const slot of body.images ?? []) {
      expect(slot.durationMs).toBeGreaterThan(0);
    }
    expect(plan.diagnostics.some((d) => d.includes("STORY_IMAGE_WEIGHTS_IGNORED"))).toBe(true);
  });

  it("rejects an empty or oversized section list", () => {
    expect("error" in resolveTiming(story({ sections: [] }), opts())).toBe(true);
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, overrides: { durationMs: 1000 } }));
    expect("error" in resolveTiming(story({ sections: many }), opts())).toBe(true);
  });
});

describe("resolveVariants", () => {
  it("defaults to a single landscape variant at the requested canvas", () => {
    expect(resolveVariants(undefined, TARGET)).toEqual([
      { name: "landscape", width: 1920, height: 1080 },
    ]);
  });

  it("an omitted outputs list ADOPTS the requested orientation — a portrait canvas stays portrait", () => {
    expect(resolveVariants(undefined, { width: 1080, height: 1920 })).toEqual([
      { name: "portrait", width: 1080, height: 1920 },
    ]);
    expect(resolveVariants([], { width: 1080, height: 1920 })).toEqual([
      { name: "portrait", width: 1080, height: 1920 },
    ]);
  });

  it("portrait is the swapped canvas (short × long), never a stretch", () => {
    expect(resolveVariants(["landscape", "portrait"], TARGET)).toEqual([
      { name: "landscape", width: 1920, height: 1080 },
      { name: "portrait", width: 1080, height: 1920 },
    ]);
  });

  it("a portrait-shaped request keeps portrait at the requested canvas", () => {
    expect(resolveVariants(["portrait"], { width: 1080, height: 1920 })).toEqual([
      { name: "portrait", width: 1080, height: 1920 },
    ]);
  });

  it("drops duplicate outputs, preserving order", () => {
    expect(resolveVariants(["portrait", "landscape", "portrait"], TARGET).map((v) => v.name)).toEqual([
      "portrait",
      "landscape",
    ]);
  });
});
