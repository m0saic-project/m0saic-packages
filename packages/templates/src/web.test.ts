import "./web";
import { getTemplate } from "@m0saic/template-utils";

describe("browser template entry", () => {
  it("registers the node-clean default Make wireframe for the web gallery", () => {
    expect(getTemplate("@m0saic/wireframe/base/v2")?.id).toBe(
      "@m0saic/wireframe/base/v2",
    );
  });

  it("registers code/snippet-morph/v1 (node-clean since the svg-text promotion) and previews it with render() itself", async () => {
    const tmpl = getTemplate("@m0saic/code/snippet-morph/v1");
    expect(tmpl?.id).toBe("@m0saic/code/snippet-morph/v1");
    expect(tmpl?.capabilities?.tier).toBe("core");
    expect(tmpl?.renderLite).toBeUndefined();
    const ctx = {
      mode: "design",
      target: { width: 640, height: 360, fps: 30, durationMs: 7500 },
      output: { width: 640, height: 360, fps: 30, durationMs: 7500 },
      media: {},
    } as never;
    const out = (await tmpl!.render(tmpl!.defaultProps as never, ctx)) as { kind: string; steps?: unknown[] };
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.steps).toHaveLength(2);
  });
});
