// Ported beside the template-utils copy from
// `packages/templates/src/m0saic/media/screencap_grid/v2/screencap-grid-cover.test.ts`
// (import paths only).
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import {
  coverTypeRamp,
  onboardingTextBlock,
  onboardingTypeRamp,
  renderScreencapGridV2Cover,
  resolveScreencapOnboardingTheme,
  SCREENCAP_ONBOARDING_THEME,
} from "./screencap-grid-cover";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]>,
  upstreamData?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): MosaicEngineContext {
  const target = {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    ...overrides,
  };
  return {
    mode: "design" as const,
    target,
    output: { ...target, workspaceDir: "" },
    media: {},
    ...(upstreamData ? { upstreamData } : {}),
  };
}

function sourceLabel(source: MosaicSource): string | undefined {
  return source.editor?.label;
}

function textSources(doc: MosaicDocument): MosaicTextSource[] {
  return doc.sources.filter(
    (source): source is MosaicTextSource => source.type === "text",
  );
}

function mediaSources(doc: MosaicDocument): MosaicMediaSource[] {
  return doc.sources.filter(
    (source): source is MosaicMediaSource => source.type === "media",
  );
}

const SUPPORTED_COPY = /^[\x20-\x7E·—×]*$/u;

describe("renderScreencapGridV2Cover", () => {
  it("uses the canonical Desktop brand tokens", () => {
    expect(SCREENCAP_ONBOARDING_THEME.surfaceApp).toBe("#050314");
    expect(SCREENCAP_ONBOARDING_THEME.accent).toBe("#EF7525");
    const doc = renderScreencapGridV2Cover(makeCtx());
    expect(doc.backgroundColor).toBe("#050314");
    expect(JSON.stringify(doc.sources)).toContain("#EF7525");
  });

  it("is a valid target-sized document at landscape, portrait, and compact sizes", () => {
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 640, height: 360 },
      { width: 360, height: 640 },
    ]) {
      const doc = renderScreencapGridV2Cover(makeCtx(size));
      expect(doc.kind).toBe("mosaic_document");
      expect(doc.size).toEqual(size);
      expect(isValidM0String(doc.m0)).toBe(true);
      const frames = parseM0StringToRenderFrames(
        doc.m0,
        size.width,
        size.height,
      );
      expect(frames.length).toBe(doc.sources.length);
      expect(frames.length).toBeGreaterThan(18);
    }
  });

  it("uses the M logo and exact registered template preview as real media geometry", () => {
    const doc = renderScreencapGridV2Cover(makeCtx());
    const frames = parseM0StringToRenderFrames(doc.m0, 1920, 1080);
    const logoIndex = doc.sources.findIndex(
      (source) => sourceLabel(source) === "m0saic M logo",
    );
    const nameIndex = doc.sources.findIndex(
      (source) => sourceLabel(source) === "cover product name",
    );
    const heroIndex = doc.sources.findIndex(
      (source) => sourceLabel(source) === "Screencap Grid registered preview",
    );
    expect(logoIndex).toBeGreaterThanOrEqual(0);
    expect(nameIndex).toBeGreaterThan(logoIndex);
    expect(heroIndex).toBeGreaterThan(logoIndex);

    const logo = frames[logoIndex];
    const name = frames[nameIndex];
    const hero = frames[heroIndex];
    expect(logo.y - 1080 * 0.05).toBeGreaterThan(30);
    expect(name.x - (logo.x + logo.width)).toBeGreaterThan(20);
    expect(hero.x).toBeGreaterThan(logo.x);
    expect(hero.width).toBeGreaterThan(1920 * 0.55);
    expect(hero.height).toBeGreaterThan(1080 * 0.8);

    const media = mediaSources(doc);
    expect(media).toHaveLength(2);
    expect(media.find((source) => sourceLabel(source) === "m0saic M logo"))
      .toMatchObject({ mediaType: "image", placement: { fit: "contain" } });
    expect(
      media.find(
        (source) =>
          sourceLabel(source) === "Screencap Grid registered preview",
      ),
    )
      .toMatchObject({
        mediaType: "image",
        placement: { fit: "contain" },
      });

    const inlineAssets = Object.values(doc.assets)
      .filter((asset) => asset.kind === "data-uri")
      .map((asset) => asset.uri);
    expect(inlineAssets).toHaveLength(1);
    expect(
      inlineAssets.some((uri) =>
        uri.startsWith("data:image/svg+xml;base64,"),
      ),
    ).toBe(true);

    const previewAssets = Object.values(doc.assets)
      .filter((asset) => asset.kind === "url")
      .map((asset) => asset.url);
    expect(previewAssets).toEqual([
      "/template-assets/assets/templates/@m0saic__media__screencap_grid__v2/preview.png?v=3846a527",
    ]);
  });

  it("uses a neutral chat-style overview with the core setup instructions", () => {
    const doc = renderScreencapGridV2Cover(makeCtx());
    const text = textSources(doc)
      .map((source) =>
        source.layers
          .map((layer) =>
            layer.content.kind === "literal" ? layer.content.text : "",
          )
          .join(" "),
      )
      .join(" ");
    expect(text).toContain("Screencap Grid");
    expect(text).toContain("Video at a glance.");
    expect(text).toContain("ADD SOURCE(S)");
    expect(text).toContain("multiple files");
    expect(text).toContain("folder");
    expect(text).toContain("rows");
    expect(text).toContain("columns");
    expect(text).toContain("PNG");
    expect(text).toContain("MP4");
    expect(text).toContain("custom m0 layout");
    expect(text).toContain("START HERE");
    expect(text).toContain("edit any prop to start");
    expect(text).toContain("Open ? for the full tutorial.");
    expect(text).not.toMatch(
      /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves)\b/i,
    );

    const frames = parseM0StringToRenderFrames(doc.m0, 1920, 1080);
    const cardLabelX = [
      "cover add source(s) label",
      "cover shape the grid label",
      "cover export or customize label",
    ].map((label) => {
      const index = doc.sources.findIndex(
        (source) => sourceLabel(source) === label,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      return frames[index].x;
    });
    expect(new Set(cardLabelX).size).toBe(1);

    const tipLines = doc.sources.filter((source) =>
      /^cover start tip \d+$/.test(sourceLabel(source) ?? ""),
    );
    expect(tipLines).toHaveLength(2);

    for (const label of [
      "cover add source(s) message",
      "cover shape the grid message",
      "cover export or customize message",
    ]) {
      const indices = doc.sources
        .map((source, index) => ({ index, label: sourceLabel(source) }))
        .filter((entry) => entry.label?.startsWith(label))
        .map((entry) => entry.index);
      expect(indices).toHaveLength(2);
      const top = Math.min(...indices.map((index) => frames[index].y));
      const bottom = Math.max(
        ...indices.map(
          (index) => frames[index].y + frames[index].height,
        ),
      );
      expect(bottom - top).toBeLessThan(90);
    }
  });

  it("uses one literal SVG layer per text cell", () => {
    const doc = renderScreencapGridV2Cover(makeCtx());
    const sources = textSources(doc);
    expect(sources.length).toBeGreaterThan(6);
    for (const source of sources) {
      expect(source.rasterizer).toBe("svg");
      expect(source.renderMode).toEqual({ kind: "image" });
      expect(source.layers).toHaveLength(1);
      expect(source.layers[0].content.kind).toBe("literal");
    }
  });

  it("uses only glyphs verified in the bundled Roboto font", () => {
    const doc = renderScreencapGridV2Cover(makeCtx());
    for (const source of textSources(doc)) {
      const content = source.layers[0].content;
      const text = content.kind === "literal" ? content.text : "";
      expect(text).toMatch(SUPPORTED_COPY);
      expect(text).not.toContain("→");
    }
  });

  it("honors a published theme through the standard upstream channel", () => {
    const ctx = makeCtx(undefined, {
      theme: { accent: "#12AB34", surfaceApp: "#010203" },
    });
    const theme = resolveScreencapOnboardingTheme(ctx);
    expect(theme.accent).toBe("#12AB34");
    expect(theme.surfaceApp).toBe("#010203");
    expect(theme.textPrimary).toBe(
      SCREENCAP_ONBOARDING_THEME.textPrimary,
    );
    const doc = renderScreencapGridV2Cover(ctx);
    expect(doc.backgroundColor).toBe("#010203");
    expect(JSON.stringify(doc.sources)).toContain("#12AB34");
  });

  it("never marks itself as an error and is deterministic", () => {
    const first = renderScreencapGridV2Cover(makeCtx());
    const second = renderScreencapGridV2Cover(makeCtx());
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('"renderStatus":"error"');
  });
});

describe("shared onboarding typography", () => {
  it("scales the cover type proportionally above a 1080px short edge", () => {
    const fullHd = coverTypeRamp(1920, 1080);
    const fourK = coverTypeRamp(3840, 2160);
    for (const role of Object.keys(fullHd) as Array<keyof typeof fullHd>) {
      expect(fourK[role]).toBe(fullHd[role] * 2);
    }
    expect(coverTypeRamp(640, 360)).toEqual(onboardingTypeRamp(640, 360));
  });

  it("uses a role-specific optical ramp with independent clamps", () => {
    const full = onboardingTypeRamp(1920, 1080);
    expect(full.display).toBeGreaterThan(full.headline);
    expect(full.headline).toBeGreaterThan(full.body);
    expect(full.body).toBeGreaterThan(full.label);

    const portrait = onboardingTypeRamp(1080, 1920);
    expect(portrait).toEqual(full);

    const tiny = onboardingTypeRamp(64, 64);
    expect(tiny.display).toBe(18);
    expect(tiny.body).toBe(11);

    const huge = onboardingTypeRamp(7680, 4320);
    expect(huge.display).toBe(88);
    expect(huge.headline).toBe(58);
    expect(huge.micro).toBe(14);
  });

  it("wraps static copy into separate real SVG text cells", () => {
    const block = onboardingTextBlock({
      text: "one two three four five six seven eight nine ten eleven twelve",
      fontSize: 30,
      color: SCREENCAP_ONBOARDING_THEME.textPrimary,
      cellWidthPx: 240,
      hAlign: "left",
    });
    expect(block.sources.length).toBeGreaterThan(2);
    expect(isValidM0String(block.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(block.m0, 240, 240);
    expect(frames.length).toBe(block.sources.length);
    expect(new Set(frames.map((frame) => frame.y)).size).toBe(frames.length);
    for (const source of block.sources) {
      expect(source.type).toBe("text");
      expect((source as MosaicTextSource).rasterizer).toBe("svg");
      expect((source as MosaicTextSource).layers).toHaveLength(1);
    }
  });
});
