import type { MosaicEngineContext, MosaicTemplate } from "@m0saic/types";
import { renderTemplateLite } from "./renderTemplateLite";

const ctx = {} as unknown as MosaicEngineContext;
const props = { a: 1 };

function makeTemplate(parts: Partial<MosaicTemplate<Record<string, unknown>>>) {
  return parts as unknown as MosaicTemplate<Record<string, unknown>>;
}

describe("renderTemplateLite", () => {
  it("prefers renderLite when the template provides one", async () => {
    let liteCalled = false;
    let renderCalled = false;
    const tmpl = makeTemplate({
      render: async () => {
        renderCalled = true;
        return { kind: "mosaic_document" } as never;
      },
      renderLite: () => {
        liteCalled = true;
        return { kind: "mosaic_document", _lite: true } as never;
      },
    });

    const out = (await renderTemplateLite(tmpl, props, ctx)) as { _lite?: boolean };
    expect(liteCalled).toBe(true);
    expect(renderCalled).toBe(false);
    expect(out._lite).toBe(true);
  });

  it("falls back to render when no renderLite is defined", async () => {
    let renderCalled = false;
    const tmpl = makeTemplate({
      render: async () => {
        renderCalled = true;
        return { kind: "mosaic_document" } as never;
      },
    });

    await renderTemplateLite(tmpl, props, ctx);
    expect(renderCalled).toBe(true);
  });
});
