import { DEFAULT_PROPS, propsSchema, resolveProps } from "./props";

describe("community-m props", () => {
  it("resolves defaults deterministically", () => {
    const r = resolveProps({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.m).toBe("001");
      expect(r.value.tile).toBe("root");
      expect(r.value.communityDir).toBe("");
      expect(r.value.zoom).toBeNull();
      expect(r.value.asOf).toBe("now");
    }
  });
  it("every knob has a default or a placeholder, and no default is a local path", () => {
    for (const [k, def] of Object.entries(propsSchema)) {
      const hasDefault = k in DEFAULT_PROPS;
      const hasPlaceholder = !!(def as { meta?: { control?: { placeholder?: string } } }).meta?.control?.placeholder;
      expect(hasDefault || hasPlaceholder).toBe(true);
    }
    for (const v of Object.values(DEFAULT_PROPS)) if (typeof v === "string") expect(v.startsWith("/")).toBe(false);
  });
  it("fails fast on bad values", () => {
    const r = resolveProps({ m: "1", asOf: "yesterday" as never, zoom: 9, accentColor: "orange", introMs: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/m must be three digits/);
      expect(r.errors.join("\n")).toMatch(/asOf/);
      expect(r.errors.join("\n")).toMatch(/zoom must be 1..4/);
      expect(r.errors.join("\n")).toMatch(/accentColor/);
      expect(r.errors.join("\n")).toMatch(/introMs/);
    }
  });
});
