export { WireframeCell } from "./utils/wireframeCell";
// v2 is the current default (single-pass: each frame is one masked color tile,
// text + border as glyph outlines). v1 is kept, deprecated, as the nested-cell
// baseline — useful for perf comparison and as living documentation of how the
// template evolved as we learned more about the engine.
export { WireframeV2 } from "./base/v2";
export { Wireframe, Wireframe as WireframeV1 } from "./base/v1";
export { AnimatedWireframe } from "./animated/v1";