import type {
  MosaicEngineContext,
  MosaicMediaRegistry,
} from "@m0saic/types";
import { DEFAULT_FPS, DEFAULT_DURATION_MS } from "@m0saic/types";

/**
 * Pure render cache — mirrors `@m0saic/core`'s `createMosaicTemplateRenderCache`
 * (which lives in the closed engine). Preview / design renders never need the
 * engine, so the tiny memoization cache is replicated here for templates that
 * cache sub-renders via `ctx.cache`.
 */
type DesignRenderCache = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T>;
};

function createDesignRenderCache(): DesignRenderCache {
  const values = new Map<string, unknown>();
  const inflight = new Map<string, Promise<unknown>>();
  return {
    get<T = unknown>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set<T = unknown>(key: string, value: T): void {
      values.set(key, value);
    },
    async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
      if (values.has(key)) return values.get(key) as T;
      const existing = inflight.get(key);
      if (existing) return existing as Promise<T>;
      const p: Promise<T> = compute().then((result) => {
        values.set(key, result);
        inflight.delete(key);
        return result;
      });
      inflight.set(key, p as Promise<unknown>);
      return p;
    },
  };
}

/**
 * The design-mode context plus the engine-internal `cache` side channel. Core
 * attaches `cache` via intersection (it's not on the public
 * {@link MosaicEngineContext}); we mirror that so nested-render callers that
 * reach for `ctx.cache` keep working in a preview pass.
 */
export type DesignEngineContext = MosaicEngineContext & {
  cache: DesignRenderCache;
};

/**
 * Build a pure `mode: "design"` engine context for in-browser preview renders.
 *
 * A plain object mirroring the design-mode shape `@m0saic/core`'s
 * `createEngineContext` produces — so a preview host (the web build) can drive
 * `renderTemplateLite(tmpl, props, ctx)` WITHOUT the closed engine
 * (`@m0saic/core`), a workspace directory, or an ffmpeg toolchain.
 *
 * `media` defaults to `{}` (a valid empty {@link MosaicMediaRegistry}); design
 * mode never spawns the `analysis` probe, so it's intentionally absent.
 */
export function createDesignContext(args: {
  width: number;
  height: number;
  fps?: number;
  durationMs?: number;
  media?: MosaicMediaRegistry;
  /** Cosmetic — a preview host has no real workspace. Defaults to "". */
  workspaceDir?: string;
}): DesignEngineContext {
  const { width, height } = args;
  const fps = args.fps ?? DEFAULT_FPS;
  const durationMs = args.durationMs ?? DEFAULT_DURATION_MS;
  return {
    mode: "design",
    output: {
      width,
      height,
      workspaceDir: args.workspaceDir ?? "",
      fps,
      durationMs,
    },
    target: { width, height, fps, durationMs },
    media: args.media ?? {},
    cache: createDesignRenderCache(),
  };
}
