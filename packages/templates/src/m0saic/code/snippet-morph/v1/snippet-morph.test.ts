import {
  parseM0StringToRenderFrames,
  validateM0String,
} from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicEngineContext,
} from "@m0saic/types";
import { CODE_THEME_PRESET_KEYS, CODE_TOKEN_KINDS } from "../../_shared/code-theme";
import { measureCodeGrid } from "../../_shared/code-metrics";
import { resolvePropBindings } from "@m0saic/template-utils";
import { computeSnippetFrameGeometry } from "./internal/chrome";
import { buildSnippetMorphPlan } from "./internal/plan";
import {
  SNIPPET_MORPH_V1_ID,
  SnippetMorphV1,
  resolveSnippetVisualLayout,
  type SnippetMorphV1Props,
} from "./snippet-morph";

function ctx(
  mode: "design" | "render",
  workspaceDir?: string,
  size: { width: number; height: number } = { width: 1280, height: 720 },
): MosaicEngineContext {
  return {
    mode,
    target: { ...size, fps: 30, durationMs: 3750 },
    output: {
      ...size,
      fps: 30,
      durationMs: 3750,
      ...(workspaceDir == null ? {} : { workspaceDir }),
    },
  } as MosaicEngineContext;
}

const props = (): SnippetMorphV1Props => ({
  ...(SnippetMorphV1.defaultProps as SnippetMorphV1Props),
  states: [
    "type Result = { ok: boolean };\nconst result: Result = { ok: true };",
  ],
});

/** The render is a PIPELINE (one doc per state, gate 32); the final state is its last step. */
function liteFinal(file: unknown): MosaicDocument {
  const f = file as { kind?: string; steps?: Array<{ file: MosaicDocument }> };
  if (f.kind === "mosaic_pipeline") return f.steps![f.steps!.length - 1]!.file;
  return file as MosaicDocument;
}

function expectErrorMosaic(doc: MosaicDocument, message: RegExp): void {
  expect(doc.kind).toBe("mosaic_document");
  expect(doc.sources).toHaveLength(1);
  expect(doc.sources[0]?.engine).toMatchObject({
    renderStatus: "error",
    renderError: {
      code: "SNIPPET_MORPH_INVALID_INPUT",
      message: expect.stringMatching(message),
    },
  });
}

describe("SnippetMorphV1 template surface", () => {
  it("is a pure CORE template since the svg-text promotion: no filesystem caps, no renderLite", () => {
    expect(SnippetMorphV1.id).toBe(SNIPPET_MORPH_V1_ID);
    expect(SnippetMorphV1.version).toBe(1);
    expect(SnippetMorphV1.capabilities).toEqual({ tier: "core" });
    expect(SnippetMorphV1.renderLite).toBeUndefined();
    expect(SnippetMorphV1.defaultProps).toMatchObject({
      animation: { reduceMotion: false, addEntrance: "rise" },
    });
    expect(SnippetMorphV1.propsSchema).toMatchObject({
      animation: {
        type: "group",
        fields: {
          reduceMotion: { type: "boolean" },
          addEntrance: {
            type: "string",
            meta: { constraints: { oneOf: ["fade", "rise"] } },
          },
        },
      },
    });
  });

  it("locks every B5 knob into grouped authoring fields and the animate dual", () => {
    const schema = SnippetMorphV1.propsSchema!;
    expect(Object.keys(schema).sort()).toEqual([
      "animate",
      "animation",
      "chrome",
      "debugLayout",
      "language",
      "states",
      "theme",
      "timing",
      "typography",
    ]);
    expect(Object.keys(schema.typography!.fields!).sort()).toEqual([
      "fontSize",
      "lineHeight",
      "tabWidth",
    ]);
    expect(Object.keys(schema.timing!.fields!).sort()).toEqual([
      "holdMs",
      "leadMs",
      "morphMs",
      "trailMs",
    ]);
    expect(Object.keys(schema.theme!.fields!).sort()).toEqual([
      ...CODE_TOKEN_KINDS,
      "preset",
    ].sort());
    expect(Object.keys(schema.chrome!.fields!).sort()).toEqual([
      "codeAlign",
      "fullBleed",
      "lineNumbers",
      "show",
      "title",
      "trafficLights",
    ]);
    expect(Object.keys(schema.animation!.fields!).sort()).toEqual([
      "addEntrance",
      "reduceMotion",
    ]);
    expect(schema.theme!.fields!.preset).toMatchObject({
      meta: { constraints: { oneOf: [...CODE_THEME_PRESET_KEYS] } },
    });
    for (const kind of CODE_TOKEN_KINDS) {
      expect(schema.theme!.fields![kind]).toMatchObject({
        type: "string",
        meta: {
          constraints: { isColor: true },
          control: { colorPicker: true },
        },
      });
    }
    expect(schema.animate).toMatchObject({
      meta: {
        control: {
          syncsTo: [
            {
              prop: "animation.reduceMotion",
              map: { kind: "boolInvert" },
            },
          ],
        },
        ui: { consumer: "human" },
      },
    });
    expect(SnippetMorphV1.defaultProps).not.toHaveProperty("animate");
  });

  it("render succeeds without a workspace (pure) and returns one doc per state (final state last)", async () => {
    const pipe = (await SnippetMorphV1.render(
      {
        ...props(),
        states: ["const before = 1;", "const finalState = 2;"],
      },
      ctx("design"),
    )) as unknown as { kind: string; steps: Array<{ file: MosaicDocument }> };
    expect(pipe.kind).toBe("mosaic_pipeline");
    expect(pipe.steps).toHaveLength(2);
    const doc = liteFinal(pipe);

    expect(doc.kind).toBe("mosaic_document");
    expect(Object.keys(doc.assets)).toEqual([]);
    expect(doc.sources.every((source) => source.type !== "media")).toBe(true);
    expect(validateM0String(doc.m0).ok).toBe(true);
    expect(parseM0StringToRenderFrames(doc.m0, 1280, 720)).toHaveLength(
      doc.sources.length,
    );
    expect(JSON.stringify(doc)).toContain("#C792EA");
  });

  it("render is byte-deterministic", async () => {
    const a = await SnippetMorphV1.render(props(), ctx("design"));
    const b = await SnippetMorphV1.render(props(), ctx("design"));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("render returns a valid error mosaic for malformed states", async () => {
    const doc = (await SnippetMorphV1.render(
      { ...props(), states: [] },
      ctx("design"),
    )) as MosaicDocument;

    expectErrorMosaic(doc, /states must contain at least one code state/);
    expect(validateM0String(doc.m0).ok).toBe(true);
  });

  it("applies a curated preset and explicit token overrides without pinning cleared colors", async () => {
    const renderLite = SnippetMorphV1.render;
    const doc = (await renderLite(
      {
        ...props(),
        states: ['const answer = "yes";'],
        theme: {
          preset: "rubber-duck",
          keyword: "#123456",
          string: "none",
        },
      },
      ctx("design"),
    )) as MosaicDocument;
    const serialized = JSON.stringify(doc);

    expect(serialized).toContain("#123456");
    expect(serialized).toContain("#7BDFF2");
    expect(serialized).toContain("#070A16");
  });

  it("selects the largest shared integer font that fits every state", () => {
    const plan = buildSnippetMorphPlan({
      states: [
        "const short = true;",
        `const longest = "${"x".repeat(72)}";`,
      ],
    });
    const visual = {
      fontSize: 32,
      lineHeight: 1.5,
      fontFamily: "JetBrains Mono",
      fontWeight: "normal" as const,
      fontStyle: "normal" as const,
      supersample: 2 as const,
      title: "fit.ts",
      showChrome: true,
      trafficLights: true,
      lineNumbers: true,
      codeAlign: "left" as const,
    };
    const fitted = resolveSnippetVisualLayout(
      plan.states,
      { width: 640, height: 640 },
      visual,
    );
    const nextSize = fitted.visual.fontSize + 1;
    const nextGeometry = computeSnippetFrameGeometry({
      width: 640,
      height: 640,
      fontSize: nextSize,
      showChrome: true,
      lineNumbers: true,
    });

    expect(fitted.fits).toBe(true);
    expect(fitted.visual.fontSize).toBeLessThan(32);
    expect(
      plan.states.some((state) => {
        const metrics = measureCodeGrid(state.lines, {
          fontSize: nextSize,
          lineHeight: visual.lineHeight,
        });
        return metrics.width > nextGeometry.codeArea.w ||
          metrics.height > nextGeometry.codeArea.h;
      }),
    ).toBe(true);
    expect(JSON.stringify(fitted)).toBe(
      JSON.stringify(
        resolveSnippetVisualLayout(
          plan.states,
          { width: 640, height: 640 },
          visual,
        ),
      ),
    );
  });

  it("holds the 8px floor and distinguishes horizontal clipping from vertical overflow", () => {
    const horizontal = buildSnippetMorphPlan({
      states: [`const value = "${"x".repeat(240)}";`],
    });
    const vertical = buildSnippetMorphPlan({
      states: [Array.from({ length: 120 }, (_, index) => `line${index}();`).join("\n")],
    });
    const visual = {
      fontSize: 16,
      lineHeight: 1.5,
      fontFamily: "JetBrains Mono",
      fontWeight: "normal" as const,
      fontStyle: "normal" as const,
      supersample: 2 as const,
      title: "floor.ts",
      showChrome: true,
      trafficLights: true,
      lineNumbers: true,
      codeAlign: "left" as const,
    };

    expect(
      resolveSnippetVisualLayout(
        horizontal.states,
        { width: 360, height: 640 },
        visual,
      ),
    ).toMatchObject({
      fits: false,
      overflowX: true,
      overflowY: false,
      visual: { fontSize: 8 },
    });
    expect(
      resolveSnippetVisualLayout(
        vertical.states,
        { width: 360, height: 640 },
        visual,
      ),
    ).toMatchObject({
      fits: false,
      overflowY: true,
      visual: { fontSize: 8 },
    });
  });

  it.each([
    [1280, 720],
    [1080, 1080],
    [720, 1280],
  ])("passes the labeled debug contract at %ix%i", async (width, height) => {
    const renderLite = SnippetMorphV1.render;
    const doc = liteFinal(await renderLite(
      { ...props(), debugLayout: true },
      ctx("design", undefined, { width, height }),
    ));

    expect(doc.editor?.layoutContract).toMatchObject({
      ok: true,
      templateId: SNIPPET_MORPH_V1_ID,
      canvas: { w: width, h: height },
      constraintCount: 4,
    });
    // Since e5e70287 debug-on SHOWS the contract (green wireframe + a banner
    // per rule) instead of the stamped lite doc, so the rule members appear
    // as banner text rather than backfilled `doc.labels`.
    const banner = doc.sources
      .filter((s) => s.type === "text")
      .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""))
      .join("\n");
    expect(banner).toMatch(/LAYOUT_CONTRACT OK/);
    expect(banner).toMatch(/"card"/);
    expect(banner).toMatch(/"code-area"/);
  });

  it("render needs no workspace: a bare design ctx and a render ctx with a workspace produce the same pipeline", async () => {
    const design = await SnippetMorphV1.render(props(), ctx("design"));
    const render = await SnippetMorphV1.render(props(), ctx("render", "/tmp/ws"));
    expect(JSON.stringify(design)).toBe(JSON.stringify(render));
    const pipe = design as unknown as { kind: string; format?: unknown; audio?: unknown };
    expect(pipe.kind).toBe("mosaic_pipeline");
    expect(pipe.format).toEqual({ kind: "video", container: "mp4" });
    expect(pipe.audio).toEqual({ mode: "off" });
  });

  it("returns an error mosaic for line counts outside the vertical 8px envelope", async () => {
    const result = await SnippetMorphV1.render(
      {
        ...props(),
        states: [
          Array.from({ length: 120 }, (_, index) => `line${index}();`).join("\n"),
        ],
      },
      ctx("render"),
    );

    if (result.kind !== "mosaic_document") {
      throw new Error("expected an error mosaic document");
    }
    expectErrorMosaic(result, /8px autofit floor.*fewer lines/);
  });
});

describe("SnippetMorphV1 — prop bindings (Make inline edit)", () => {
  const schema = SnippetMorphV1.propsSchema;
  const bindingsOf = async (p: SnippetMorphV1Props) => {
    const doc = liteFinal(await SnippetMorphV1.render(p, ctx("design")));
    return { doc, ...resolvePropBindings(doc, 1280, 720, { propsSchema: schema }) };
  };
  const ownerOf = (doc: MosaicDocument, childPath: string[]): MosaicDocument =>
    childPath.reduce(
      (d, ref) => (d.children as Record<string, MosaicDocument>)[ref],
      doc,
    );

  it("binds chrome.title to the single title-slot rect and every code LINE to its span of states[i] (gate 32)", async () => {
    const r = await bindingsOf(props());
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["chrome.title", "states"]);
    expect(r.byProp["chrome.title"]).toHaveLength(1);
    // props() has ONE state of two lines → one line source each, both bound to states[0]
    const st = props().states[0];
    const lines = r.byProp["states"] as Array<{ index?: number; range?: { start: number; end: number } }>;
    expect(lines).toHaveLength(2);
    expect(lines.every((b) => b.index === 0)).toBe(true);
    expect(lines.map((b) => st.slice(b.range!.start, b.range!.end))).toEqual(st.split("\n"));
    const b = r.byProp["chrome.title"][0];
    expect("index" in b).toBe(false);
    const src = ownerOf(r.doc, b.childPath).sources[b.sourceIndex] as { editor?: { label?: string } };
    expect(src.editor?.label).toBe("title");
  });

  it("stays bound with a blank title (double-click to ADD); chrome hidden → no rect, no binding", async () => {
    const base = props();
    const blank = await bindingsOf({ ...base, chrome: { ...base.chrome, title: "" } });
    expect(blank.rejected).toEqual([]);
    expect(blank.byProp["chrome.title"]).toHaveLength(1);
    const hidden = await bindingsOf({ ...base, chrome: { ...base.chrome, show: false } });
    expect(hidden.rejected).toEqual([]);
    expect(hidden.byProp["chrome.title"]).toBeUndefined();
  });
});
