/**
 * Meta templates — templates *about* mosaic itself. Currently:
 *   - post-mortem/v1     : renders a sandbox session as a watchable video
 *   - fixture-fetcher/v1 : capability-layer proof fixture (data-fetcher shape)
 *   - upstream-echo/v1   : consumer proof fixture (echoes upstream into sidecars)
 *   - camera-debug/v1    : camera viewport visualized over a gray-box layout
 *   - hot-reload-smoke/v1: dev canary for the desktop app's template hot reload
 */
export * from "./post-mortem";
export * from "./fixture-fetcher";
export * from "./upstream-echo";
export * from "./camera-debug";
export * from "./hot-reload-smoke";
