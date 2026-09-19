import { DslInspector } from "./dsl-inspector";
import { buildInspectorProjection } from "../../../pipeline/inspector";
import { buildSteps } from "../../../pipeline/buildSteps";
import { computeTiming } from "../../../pipeline/timing";

function ctx(w: number, h: number): any {
  return {
    mode: "render",
    output: { width: w, height: h, fps: 30, durationMs: 12000, workspaceDir: "/tmp" },
    target: { width: w, height: h, fps: 30, durationMs: 12000 },
    media: {},
  };
}

function projectionFor(m0: string) {
  const { steps } = buildSteps(m0 as any, 1000, 600);
  return buildInspectorProjection(steps, computeTiming(steps.length, 1));
}

describe("DslInspector — render", () => {
  test("no text source has empty layers[] (engine rejects those)", async () => {
    const doc: any = await DslInspector.render(
      { preset: "dark", ...projectionFor("4(1,1,1,1)") },
      ctx(460, 430),
    );
    for (const s of doc.sources as any[]) {
      if (s?.type === "text") {
        expect(Array.isArray(s.layers)).toBe(true);
        expect(s.layers.length).toBeGreaterThan(0);
      }
    }
  });

  test("emits each live value as a VIDEO text source with enable-gated literal layers", async () => {
    const doc: any = await DslInspector.render(
      { preset: "dark", ...projectionFor("2(1,1)") },
      ctx(460, 430),
    );
    // Each field's value is one video text source whose LAYERS are enable-gated
    // literals (one per distinct value) — the narration-collapse idiom, replacing
    // the old single %{eif} expr that hit drawtext's parser ceiling on dense grids.
    const valueSources = (doc.sources as any[]).filter(
      (s) =>
        s?.type === "text" &&
        s?.renderMode?.kind === "video" &&
        (s.layers ?? []).some(
          (l: any) => l?.content?.kind === "literal" && typeof l?.overlay?.enable === "string",
        ),
    );
    // 8 fields (X/Y/W/H/Z/N/R/C) → at least six gated video value sources.
    expect(valueSources.length).toBeGreaterThanOrEqual(6);
    // No leftover per-frame %{eif} expr layers.
    const eifLayers = (doc.sources as any[]).filter((s) =>
      (s?.layers ?? []).some((l: any) => l?.content?.kind === "expr"),
    );
    expect(eifLayers.length).toBe(0);
  });

  test("renders with no projection (defaults) without throwing", async () => {
    const doc: any = await DslInspector.render({ preset: "dark" }, ctx(460, 430));
    expect(doc.kind).toBe("mosaic_document");
  });
});
