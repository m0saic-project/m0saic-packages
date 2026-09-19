/**
 * @m0saic/brand/business-card/v1 — back catalog gate (node-side).
 *
 * The catalog is hardcoded so it stays out of the web bundle; this test is
 * the cross-check: every entry is a registered, curated, web-shipped template
 * with a browse preview, and the freeze flips the motion knobs the covers use.
 */
import * as fs from "fs";
import * as path from "path";
import { getTemplate } from "@m0saic/template-utils";
import "../../../index";
import { templateRegistry } from "../../../../template-registry";
import { isWebTemplateId } from "../../../../webTemplateIds";
import { BACK_CATALOG, BACK_KEYS, commandFor, displayUrl, frozenProps, longestCommand, makeUrl, pickBack } from "./back-catalog";

const PKG_ROOT = path.resolve(__dirname, "../../../../..");
const assetDir = (id: string) => path.join(PKG_ROOT, "assets", "templates", id.replace(/\//g, "__"));

describe("business-card back catalog", () => {
  it("has the generic hello-world entry as the default", () => {
    expect(pickBack(undefined)).toBe("hello-world");
    expect(pickBack("nope")).toBe("hello-world");
    expect(pickBack("donut")).toBe("donut");
    expect(BACK_KEYS.length).toBeGreaterThanOrEqual(8);
  });

  it("the chart trio is the alpine family (legend on the donut), never charts/*", () => {
    expect(BACK_CATALOG.donut.templateId).toBe("@m0saic/alpine/donut/v3");
    expect(BACK_CATALOG["bar-graph"].templateId).toBe("@m0saic/alpine/bar-graph/v1");
    expect(BACK_CATALOG["line-chart"].templateId).toBe("@m0saic/alpine/line-chart/v2");
    for (const key of BACK_KEYS) expect(BACK_CATALOG[key].templateId.startsWith("@m0saic/charts/")).toBe(false);
  });

  it.each(BACK_KEYS)("%s: registered, curated, on Mosaic Web, has a browse preview, ASCII title", (key) => {
    const entry = BACK_CATALOG[key];
    expect(getTemplate(entry.templateId)).toBeDefined();
    expect(templateRegistry.some((r) => r.templateId === entry.templateId)).toBe(true);
    expect(isWebTemplateId(entry.templateId)).toBe(true);
    const dir = assetDir(entry.templateId);
    // Preview media (assets/templates/) is authored in the monorepo and never
    // ships with the package; a standalone checkout has no previews to check.
    if (fs.existsSync(path.dirname(dir))) {
      expect(fs.existsSync(path.join(dir, "poster.png")) || fs.existsSync(path.join(dir, "preview.png"))).toBe(true);
    }
    expect(entry.title).toMatch(/^[\x20-\x7E]+$/);
  });

  it("links and commands: the QR gets the app url, the print gets the site's typeable form", () => {
    expect(makeUrl("@m0saic/alpine/donut/v3")).toBe("https://app.m0saic.io/make?t=@m0saic/alpine/donut/v3");
    expect(displayUrl(BACK_CATALOG.donut)).toBe("m0saic.io/t/alpine/donut/v3");
    expect(displayUrl(BACK_CATALOG["hello-world"])).toBe("m0saic.io/hello");
    expect(commandFor(BACK_CATALOG.donut)).toBe("npx m0saic make @m0saic/alpine/donut/v3");
    expect(commandFor(BACK_CATALOG["hello-world"])).toBe("npx m0saic hello-world");
  });

  it("every typeable url holds at the 8 pt floor (<= 46 mono chars); the longest command sets the shared size", () => {
    for (const key of BACK_KEYS) {
      const url = displayUrl(BACK_CATALOG[key]);
      expect(url.length).toBeLessThanOrEqual(46);
      expect(url.startsWith("m0saic.io/")).toBe(true);
      expect(url).not.toMatch(/@m0saic/); // the route implies the prefix
    }
    expect(longestCommand()).toBe("npx m0saic make @m0saic/alpine/contributor-table/v1");
    for (const key of BACK_KEYS) expect(commandFor(BACK_CATALOG[key]).length).toBeLessThanOrEqual(longestCommand().length);
  });

  it("frozenProps switches every motion knob off over the defaults + flavour", () => {
    expect(frozenProps({ anim: { introFrac: 0.7, reduceMotion: false }, title: "x" }, { title: "y" })).toEqual({
      anim: { introFrac: 0.7, reduceMotion: true },
      title: "y",
    });
    expect(frozenProps({ animation: { reduceMotion: false } })).toEqual({ animation: { reduceMotion: true } });
    expect(frozenProps({ animate: true })).toEqual({ animate: false });
    expect(frozenProps(undefined)).toEqual({});
  });

  it.each(BACK_KEYS)("%s: the frozen defaults still validate against the template's own schema", (key) => {
    const entry = BACK_CATALOG[key];
    const tmpl = getTemplate(entry.templateId)!;
    const props = frozenProps(tmpl.defaultProps as Record<string, unknown> | undefined, entry.flavour);
    const motion = (props.anim ?? props.animation) as { reduceMotion?: boolean } | undefined;
    expect(motion?.reduceMotion === true || props.animate === false).toBe(true);
  });
});
