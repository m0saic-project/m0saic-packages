/**
 * @m0saic/hello-world/v1 — Hello, World (the CLI's first render).
 *
 * The brand card — the app's Home screen, said as a greeting. Since
 * 2026-09-14 the card lives in `@m0saic/template-utils` as
 * `defineHelloWorldTemplate`, so every template repo (the starters, a
 * third-party pack) ships the same canonical card with one call; this file is
 * that call for the core id. The chrome, the props, the geometry, the motion
 * and the layout contract are documented on the factory.
 */
import { defineHelloWorldTemplate, registerTemplate } from "@m0saic/template-utils";

export type {
  HelloGeometry,
  HelloMarkReveal,
  HelloSweep,
  HelloTextLine,
  HelloTimeline,
  HelloWorldProps,
  HelloWorldTemplateOptions,
  MarkAssembly,
  Rect,
} from "@m0saic/template-utils";
export {
  ASSEMBLE_BOXES_PER_TRACK,
  DEFAULT_FIELD_OPACITY,
  HELLO_MARK_REVEALS,
  HELLO_SWEEPS,
  NAVY,
  NAVY_SOFT,
  assemblyTracks,
  buildHelloGeometry,
  coverFitField,
  fieldWipe,
  helloLayoutConstraints,
  helloTimeline,
  inverseSmoothstep,
  isPortraitField,
  markAssembly,
  markRectsIn,
  mixHex,
  sweepStripPx,
} from "@m0saic/template-utils";

export const HelloWorld = defineHelloWorldTemplate({ id: "@m0saic/hello-world/v1" });

registerTemplate(HelloWorld);
export default HelloWorld;
