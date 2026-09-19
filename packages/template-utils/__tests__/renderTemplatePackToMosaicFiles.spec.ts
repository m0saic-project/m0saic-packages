import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { renderTemplatePackToMosaicFiles } from "../src/dev/renderTemplatePackToMosaicFiles";
import { registerTemplate } from "../src/template/templateRegistry";
import type { MosaicTemplate, MosaicEngineContext, MosaicDocument } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";

// Side-effect import: registers all templates (including chart-frame)
import "@m0saic/templates";

// ---------------------------------------------------------------------------
// Test template (trivial, self-contained)
// ---------------------------------------------------------------------------

type TestPackProps = { color?: string };

const TEST_TEMPLATE_ID = asTemplateId("__test__/pack-test/v1");

const testTemplate: MosaicTemplate<TestPackProps> = {
  id: TEST_TEMPLATE_ID,
  label: "Pack Test",
  version: 1,
  description: "test fixture",
  tags: ["test"],
  capabilities: { tier: "core" },
  propsSchema: {},
  defaultProps: { color: "red" },
  render: async (props: TestPackProps, _ctx: MosaicEngineContext) => {
    const color = `${props.color ?? "red"}@1`;
    return {
      kind: "mosaic_document" as const,
      version: 1,
      assets: {},
      m0: toM0String("F", "test"),
      sources: [{ type: "lavfi" as const, color } as any],
    };
  },
};

registerTemplate(testTemplate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderTemplatePackToMosaicFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), makeM0saicTempPrefix("pack-test")));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("generates .mosaic files and index.json for each variant", async () => {
    const outDir = path.join(tmpDir, "out");

    const result = await renderTemplatePackToMosaicFiles(
      TEST_TEMPLATE_ID,
      [
        { name: "variant_a", props: { color: "blue" } },
        { name: "variant_b", props: { color: "green" } },
        { name: "variant_c" },
      ],
      { outDir, width: 320, height: 180, fps: 30, durationMs: 1000, warnOnMissingRefs: false },
    );

    // correct count
    expect(result.variants).toHaveLength(3);

    // .mosaic files exist
    for (const v of result.variants) {
      expect(await exists(v.outPath)).toBe(true);
    }

    // index.json exists and matches count
    const indexPath = path.join(outDir, "index.json");
    expect(await exists(indexPath)).toBe(true);
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    expect(index).toHaveLength(3);
    expect(index[0].name).toBe("variant_a");
    expect(index[1].name).toBe("variant_b");
    expect(index[2].name).toBe("variant_c");

    // each .mosaic contains kind=mosaic_document
    for (const v of result.variants) {
      const doc = JSON.parse(await fs.readFile(v.outPath, "utf8"));
      expect(doc.kind).toBe("mosaic_document");
    }
  });

  test("merges variant props over base propsPath", async () => {
    // Write base props to a temp file
    const propsPath = path.join(tmpDir, "base.props.json");
    await fs.writeFile(propsPath, JSON.stringify({ color: "blue" }));

    const outDir = path.join(tmpDir, "out");

    const result = await renderTemplatePackToMosaicFiles(
      TEST_TEMPLATE_ID,
      [
        { name: "base_only", propsPath },
        { name: "override", propsPath, props: { color: "yellow" } },
      ],
      { outDir, width: 320, height: 180, fps: 30, durationMs: 1000, warnOnMissingRefs: false },
    );

    // base_only uses "blue" from propsPath
    const baseDoc = JSON.parse(await fs.readFile(result.variants[0].outPath, "utf8"));
    expect(baseDoc.sources[0].color).toBe("blue@1");

    // override uses "yellow" (variant.props wins)
    const overrideDoc = JSON.parse(await fs.readFile(result.variants[1].outPath, "utf8"));
    expect(overrideDoc.sources[0].color).toBe("yellow@1");

    // index tracks propsPath
    const index = JSON.parse(await fs.readFile(path.join(outDir, "index.json"), "utf8"));
    expect(index[0].propsPath).toBe(propsPath);
    expect(index[1].propsPath).toBe(propsPath);
  });

  test("injects children from injectPath and they appear in the output", async () => {
    // Write inject file with a "plot-area" child doc
    const plotAreaDoc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {},
      m0: toM0String("F", "test"),
      sources: [{ type: "lavfi" as any, color: "green@1" }],
    };
    const injectPath = path.join(tmpDir, "inject.json");
    await fs.writeFile(injectPath, JSON.stringify({ "plot-area": plotAreaDoc }));

    const outDir = path.join(tmpDir, "out");

    const result = await renderTemplatePackToMosaicFiles(
      TEST_TEMPLATE_ID,
      [
        { name: "with_inject", injectPath, props: { color: "red" } },
        { name: "no_inject", props: { color: "red" } },
      ],
      { outDir, width: 320, height: 180, fps: 30, durationMs: 1000, warnOnMissingRefs: false },
    );

    // with_inject: children["plot-area"] present
    const injected = JSON.parse(await fs.readFile(result.variants[0].outPath, "utf8"));
    expect(injected.children).toBeDefined();
    expect(injected.children["plot-area"]).toBeDefined();
    expect(injected.children["plot-area"].kind).toBe("mosaic_document");

    // no_inject: no children (or at least no plot-area)
    const plain = JSON.parse(await fs.readFile(result.variants[1].outPath, "utf8"));
    expect(plain.children?.["plot-area"]).toBeUndefined();

    // index tracks injectPath
    const index = JSON.parse(await fs.readFile(path.join(outDir, "index.json"), "utf8"));
    expect(index[0].injectPath).toBe(injectPath);
    expect(index[1].injectPath).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Chart-frame preset token integration tests
// ---------------------------------------------------------------------------

const CHART_FRAME_ID = "@m0saic/charts/bar-graph/internal/chart-frame/v1";

// Expected tokens per preset (mirrors tokensForPreset in chart-frame.ts)
// sources[0].color = tokens.card (card surface, NOT canvas bg — that's the parent's job)
const EXPECTED_TOKENS: Record<string, { card: string; border: string; borderAlpha: number }> = {
  dark:     { card: "#0f172a", border: "#ffffff", borderAlpha: 0.08 },
  terminal: { card: "#0b0b0b", border: "#22c55e", borderAlpha: 0.18 },
  glass:    { card: "#111827", border: "#ffffff", borderAlpha: 0.10 },
  paper:    { card: "#ffffff", border: "#0f172a", borderAlpha: 0.10 },
  neutral:  { card: "#0f172a", border: "#ffffff", borderAlpha: 0.08 },
};

describe("chart-frame preset tokens via pack", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), makeM0saicTempPrefix("chartframe-pack-test")));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Stub plot-area inject
  const plotAreaStub: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    assets: {},
    m0: toM0String("F", "test"),
    sources: [{ type: "lavfi", color: "green@1" } as any],
  };

  const BASE_PROPS = {
    padding: { top: 0.04, right: 0.04, bottom: 0.04, left: 0.04 },
    cornerRadius: 0.18,
    preset: "neutral",
    plotAreaRef: "plot-area",
  };

  test("each preset produces correct backgroundColor, stroke.color, and stroke.alpha", async () => {
    const injectPath = path.join(tmpDir, "inject.json");
    await fs.writeFile(injectPath, JSON.stringify({ "plot-area": plotAreaStub }));

    const propsPath = path.join(tmpDir, "base.props.json");
    await fs.writeFile(propsPath, JSON.stringify(BASE_PROPS));

    const outDir = path.join(tmpDir, "out");
    const presets = Object.keys(EXPECTED_TOKENS);

    const result = await renderTemplatePackToMosaicFiles(
      CHART_FRAME_ID,
      presets.map((preset) => ({
        name: preset,
        propsPath,
        injectPath,
        props: { preset },
      })),
      { outDir, width: 1920, height: 1080, fps: 30, durationMs: 2000, warnOnMissingRefs: false },
    );

    expect(result.variants).toHaveLength(presets.length);

    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i];
      const expected = EXPECTED_TOKENS[preset];
      const doc = JSON.parse(await fs.readFile(result.variants[i].outPath, "utf8"));

      // Background source is sources[0] in the chart-frame render
      const bgSource = doc.sources[0];

      expect(bgSource.color).toBe(expected.card);
      expect(bgSource.effects.stroke.color).toBe(expected.border);
      // stroke.alpha = borderAlpha + 0.02 (per chart-frame.ts line 168)
      expect(bgSource.effects.stroke.alpha).toBeCloseTo(expected.borderAlpha + 0.02, 10);
    }
  });

  test("cornerRadius variants produce correct rounding.borderRadius", async () => {
    const injectPath = path.join(tmpDir, "inject.json");
    await fs.writeFile(injectPath, JSON.stringify({ "plot-area": plotAreaStub }));

    const propsPath = path.join(tmpDir, "base.props.json");
    await fs.writeFile(propsPath, JSON.stringify(BASE_PROPS));

    const outDir = path.join(tmpDir, "out");
    const radii = [0.12, 0.18, 0.24];

    const result = await renderTemplatePackToMosaicFiles(
      CHART_FRAME_ID,
      radii.map((r) => ({
        name: `r${String(r).replace(".", "")}`,
        propsPath,
        injectPath,
        props: { preset: "dark", cornerRadius: r },
      })),
      { outDir, width: 1920, height: 1080, fps: 30, durationMs: 2000, warnOnMissingRefs: false },
    );

    for (let i = 0; i < radii.length; i++) {
      const doc = JSON.parse(await fs.readFile(result.variants[i].outPath, "utf8"));
      const bgSource = doc.sources[0];
      expect(bgSource.effects.rounding.borderRadius).toBe(radii[i]);
      expect(bgSource.effects.rounding.cornerStyle).toBe("rounded");
    }
  });

  test("injected plot-area child appears in all preset variants", async () => {
    const injectPath = path.join(tmpDir, "inject.json");
    await fs.writeFile(injectPath, JSON.stringify({ "plot-area": plotAreaStub }));

    const propsPath = path.join(tmpDir, "base.props.json");
    await fs.writeFile(propsPath, JSON.stringify(BASE_PROPS));

    const outDir = path.join(tmpDir, "out");

    const result = await renderTemplatePackToMosaicFiles(
      CHART_FRAME_ID,
      [
        { name: "dark", propsPath, injectPath, props: { preset: "dark" } },
        { name: "paper", propsPath, injectPath, props: { preset: "paper" } },
      ],
      { outDir, width: 1920, height: 1080, fps: 30, durationMs: 2000, warnOnMissingRefs: false },
    );

    for (const v of result.variants) {
      const doc = JSON.parse(await fs.readFile(v.outPath, "utf8"));
      expect(doc.children["plot-area"]).toBeDefined();
      expect(doc.children["plot-area"].kind).toBe("mosaic_document");
    }
  });
});
