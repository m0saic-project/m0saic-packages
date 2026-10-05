import type { MosaicSource } from "@m0saic/types";
import { bindProp, bindProps } from "@m0saic/template-utils";
import {
  ALPINE_ANIM_FIELDS_BARE,
  ALPINE_THEME_GROUP_BARE,
  findCardHeader,
  withAddHandles,
} from "./alpine-conventions";
import { ALPINE_ANIM_FIELDS } from "./alpine-anim";

type Ed = { editor?: { label?: string; binding?: { propKey: string }; bindings?: Array<{ propKey: string; layer?: number }> } };
const text = (label: string): MosaicSource => ({ type: "text", layers: [], editor: { label } }) as unknown as MosaicSource;

describe("alpine-conventions (0.3.1 shared)", () => {
  it("withAddHandles appends to a single binding, keeping it first", () => {
    const src = withAddHandles(bindProp(text("a"), "title"), [{ propKey: "subtitle" }]) as Ed;
    expect(src.editor?.bindings?.map((b) => b.propKey)).toEqual(["title", "subtitle"]);
    expect(src.editor?.binding).toBeUndefined();
  });

  it("withAddHandles appends to a bindings list, keeping each entry (layer included)", () => {
    const src = withAddHandles(bindProps(text("a"), [{ propKey: "title", layer: 0 }, { propKey: "x", layer: 1 }]), [{ propKey: "subtitle" }]) as Ed;
    expect(src.editor?.bindings).toEqual([{ propKey: "title", layer: 0 }, { propKey: "x", layer: 1 }, { propKey: "subtitle" }]);
  });

  it("withAddHandles with nothing to add leaves the source untouched", () => {
    const src = bindProp(text("a"), "title");
    expect(withAddHandles(src, [])).toEqual(bindProp(text("a"), "title"));
  });

  it("findCardHeader finds the tagged header rect", () => {
    const header = text("card-header");
    expect(findCardHeader([text("x"), header])).toBe(header);
    expect(findCardHeader([text("x")])).toBeUndefined();
  });

  it("the bare anim fields are ALPINE_ANIM_FIELDS minus their copy", () => {
    const strip = (def: Record<string, unknown>) => {
      const { description: _d, ...rest } = def as { description?: string; meta?: Record<string, unknown> };
      const meta = { ...(rest.meta ?? {}) } as Record<string, unknown>;
      delete meta.ui;
      if (meta.control) {
        const { placeholder: _p, ...control } = meta.control as Record<string, unknown>;
        meta.control = control;
      }
      return Object.keys(meta).length ? { ...rest, meta } : { ...rest, meta: undefined };
    };
    for (const key of Object.keys(ALPINE_ANIM_FIELDS)) {
      const bare = JSON.parse(JSON.stringify(ALPINE_ANIM_FIELDS_BARE[key]));
      expect(bare).toEqual(JSON.parse(JSON.stringify(strip(ALPINE_ANIM_FIELDS[key]))));
    }
  });

  it("the bare theme group carries no copy", () => {
    expect(JSON.stringify(ALPINE_THEME_GROUP_BARE)).not.toMatch(/label|description|placeholder/);
  });
});
