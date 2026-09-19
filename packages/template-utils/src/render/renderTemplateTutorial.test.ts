import type { MosaicEngineContext, MosaicTemplate } from "@m0saic/types";
import { renderTemplateTutorial } from "./renderTemplateTutorial";

const ctx = {} as unknown as MosaicEngineContext;
const props = { a: 1 };

function makeTemplate(parts: Partial<MosaicTemplate<Record<string, unknown>>>) {
  return parts as unknown as MosaicTemplate<Record<string, unknown>>;
}

describe("renderTemplateTutorial", () => {
  it("invokes renderTutorial with the caller's props and ctx", async () => {
    const seen: { props?: unknown; ctx?: unknown } = {};
    const tmpl = makeTemplate({
      render: async () => ({ kind: "mosaic_document" } as never),
      renderTutorial: (p, c) => {
        seen.props = p;
        seen.ctx = c;
        return { kind: "mosaic_pipeline", _tutorial: true } as never;
      },
    });

    const out = (await renderTemplateTutorial(tmpl, props, ctx)) as {
      _tutorial?: boolean;
    } | null;
    expect(seen.props).toBe(props);
    expect(seen.ctx).toBe(ctx);
    expect(out?._tutorial).toBe(true);
  });

  it("returns null when the template declares no renderTutorial — never falls back to render", async () => {
    let renderCalled = false;
    let liteCalled = false;
    const tmpl = makeTemplate({
      render: async () => {
        renderCalled = true;
        return { kind: "mosaic_document" } as never;
      },
      renderLite: () => {
        liteCalled = true;
        return { kind: "mosaic_document" } as never;
      },
    });

    await expect(renderTemplateTutorial(tmpl, props, ctx)).resolves.toBeNull();
    expect(renderCalled).toBe(false);
    expect(liteCalled).toBe(false);
  });

  it("awaits an async renderTutorial", async () => {
    const tmpl = makeTemplate({
      render: async () => ({ kind: "mosaic_document" } as never),
      renderTutorial: async () =>
        ({ kind: "mosaic_pipeline", _async: true } as never),
    });

    const out = (await renderTemplateTutorial(tmpl, props, ctx)) as {
      _async?: boolean;
    } | null;
    expect(out?._async).toBe(true);
  });
});
