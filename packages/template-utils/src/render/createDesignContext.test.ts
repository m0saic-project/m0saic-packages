import { createDesignContext } from "./createDesignContext";
import { DEFAULT_FPS, DEFAULT_DURATION_MS } from "@m0saic/types";

describe("createDesignContext", () => {
  test("produces the design-mode shape with explicit fields", () => {
    const ctx = createDesignContext({
      width: 1920,
      height: 1080,
      fps: 24,
      durationMs: 3000,
      media: {},
      workspaceDir: "/tmp/ws",
    });
    expect(ctx.mode).toBe("design");
    expect(ctx.output).toEqual({
      width: 1920,
      height: 1080,
      workspaceDir: "/tmp/ws",
      fps: 24,
      durationMs: 3000,
    });
    expect(ctx.target).toEqual({
      width: 1920,
      height: 1080,
      fps: 24,
      durationMs: 3000,
    });
    expect(ctx.media).toEqual({});
  });

  test("applies defaults for fps / durationMs / media / workspaceDir", () => {
    const ctx = createDesignContext({ width: 800, height: 600 });
    expect(ctx.output.fps).toBe(DEFAULT_FPS);
    expect(ctx.output.durationMs).toBe(DEFAULT_DURATION_MS);
    expect(ctx.output.workspaceDir).toBe("");
    expect(ctx.target.fps).toBe(DEFAULT_FPS);
    expect(ctx.media).toEqual({});
  });

  test("never attaches the analysis probe (design mode is spawn-free)", () => {
    const ctx = createDesignContext({ width: 100, height: 100 });
    expect(ctx.analysis).toBeUndefined();
  });

  describe("cache side channel", () => {
    test("get / set round-trip", () => {
      const ctx = createDesignContext({ width: 10, height: 10 });
      expect(ctx.cache.get("k")).toBeUndefined();
      ctx.cache.set("k", 42);
      expect(ctx.cache.get<number>("k")).toBe(42);
    });

    test("getOrCompute memoizes and de-duplicates in-flight work", async () => {
      const ctx = createDesignContext({ width: 10, height: 10 });
      let calls = 0;
      const compute = () => {
        calls += 1;
        return Promise.resolve("v");
      };
      // Two concurrent calls share ONE compute; a later call hits the cache.
      const [a, b] = await Promise.all([
        ctx.cache.getOrCompute("key", compute),
        ctx.cache.getOrCompute("key", compute),
      ]);
      const c = await ctx.cache.getOrCompute("key", compute);
      expect([a, b, c]).toEqual(["v", "v", "v"]);
      expect(calls).toBe(1);
    });
  });
});
