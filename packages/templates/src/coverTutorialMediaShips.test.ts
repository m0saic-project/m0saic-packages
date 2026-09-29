import * as fs from "node:fs";
import * as path from "node:path";

import { createDesignContext, getTemplate, listRegisteredTemplateIds } from "@m0saic/template-utils";
import type { MosaicEngineContext } from "@m0saic/types";

import "./m0saic"; // side-effect: register every template

/**
 * Every cover and tutorial ships its own media (W4, 2026-09-27).
 *
 * The first-user test opened Easy Blur's tutorial in the PACKAGED app and it
 * played without its recordings: the clips were `kind:"file"` paths into the
 * sandbox on the author's laptop, which no package carries. The installer
 * check (`verify-packaged-assets.mjs`) cannot catch that class — it compares
 * what the build produced with what shipped, and those files were never in
 * the build. This is the gate that can: it renders every cover and tutorial
 * the way a host does (design mode, no media) and follows every asset to a
 * file the PACKAGE contains.
 *
 *  - `kind:"file"`: the path must resolve INSIDE this package and exist.
 *    (Node runtime — the CLI's `--tutorial`, electron main.)
 *  - `kind:"url"`: must be a `/template-assets/<rel>` URL and `<rel>` must
 *    exist under the package root — that is where the web build mirrors it
 *    from, and where Desktop's host rebases it to (`rebaseTemplateAssetUrls`).
 *  - `kind:"data-uri"`: self-contained.
 *
 * A template that fails here would demo fine on the machine that authored it
 * and break on every other one.
 */

const PKG_ROOT = path.resolve(__dirname, "..");

/**
 * The public mirror leaves `assets/templates/**` out (the media tree; the npm
 * package has never carried it — `files` lists no assets), so there is nothing
 * there to follow an asset TO. The gate holds wherever the tree exists: the
 * monorepo, which is what the CLI, Desktop and the web build package from.
 * Keyed on the WHOLE tree being absent — one missing file still fails.
 */
const HAS_ASSET_TREE = fs.existsSync(path.join(PKG_ROOT, "assets", "templates"));
const itWithAssetTree = HAS_ASSET_TREE ? it : it.skip;

type AnyRec = Record<string, unknown>;

/** The host's own design context — what Make hands a cover or tutorial. */
const ctx = (width = 1280, height = 720): MosaicEngineContext => createDesignContext({ width, height }) as unknown as MosaicEngineContext;
type Surface = (props: unknown, c: MosaicEngineContext) => unknown;

/** Every document in a renderable: the document, or a pipeline's step files; children recursively. */
function docsOf(renderable: unknown, out: AnyRec[] = [], seen = new Set<unknown>()): AnyRec[] {
  const r = renderable as AnyRec | null;
  if (!r || typeof r !== "object" || seen.has(r)) return out;
  seen.add(r);
  if (r.kind === "mosaic_pipeline" && Array.isArray(r.steps)) {
    for (const step of r.steps as AnyRec[]) docsOf(step?.file, out, seen);
    return out;
  }
  if (Array.isArray(r.sources)) out.push(r);
  const children = r.children as Record<string, unknown> | undefined;
  if (children && typeof children === "object") for (const c of Object.values(children)) docsOf(c, out, seen);
  return out;
}

type Problem = { templateId: string; surface: "cover" | "tutorial"; assetId: string; why: string };

function checkAssets(templateId: string, surface: "cover" | "tutorial", renderable: unknown, problems: Problem[]): number {
  let checked = 0;
  for (const doc of docsOf(renderable)) {
    const assets = (doc.assets ?? {}) as Record<string, AnyRec>;
    for (const [assetId, a] of Object.entries(assets)) {
      if (!a || typeof a !== "object") continue;
      checked++;
      if (a.kind === "data-uri") continue;
      if (a.kind === "file") {
        const abs = path.resolve(String(a.path ?? ""));
        if (!abs.startsWith(PKG_ROOT + path.sep)) problems.push({ templateId, surface, assetId, why: `file asset points outside the package: ${a.path}` });
        else if (!fs.existsSync(abs)) problems.push({ templateId, surface, assetId, why: `file asset is not in the package tree: ${path.relative(PKG_ROOT, abs)}` });
        continue;
      }
      if (a.kind === "url") {
        const url = String(a.url ?? "");
        const m = /^\/template-assets\/([^?#]+)/.exec(url);
        if (!m) { problems.push({ templateId, surface, assetId, why: `url asset is not served from /template-assets/: ${url}` }); continue; }
        const abs = path.join(PKG_ROOT, decodeURIComponent(m[1]));
        if (!fs.existsSync(abs)) problems.push({ templateId, surface, assetId, why: `served url has no shipped file at ${path.relative(PKG_ROOT, abs)}` });
        continue;
      }
      problems.push({ templateId, surface, assetId, why: `unexpected asset kind ${String(a.kind)}` });
    }
  }
  return checked;
}

describe("every cover and tutorial ships its own media (W4)", () => {
  itWithAssetTree("resolves each cover / tutorial asset to a file the package carries", async () => {
    const problems: Problem[] = [];
    let covers = 0;
    let tutorials = 0;
    let checked = 0;
    for (const id of listRegisteredTemplateIds()) {
      const t = getTemplate(id) as unknown as AnyRec | undefined;
      if (!t) continue;
      const props = (t.defaultProps ?? {}) as unknown;
      const cover = t.renderCover as Surface | undefined;
      const tutorial = t.renderTutorial as Surface | undefined;
      if (cover) {
        covers++;
        checked += checkAssets(String(id), "cover", await cover.call(t, props, ctx()), problems);
      }
      if (tutorial) {
        tutorials++;
        checked += checkAssets(String(id), "tutorial", await tutorial.call(t, props, ctx()), problems);
      }
    }
    // the fleet has both surfaces, and Easy Blur's recordings are among the assets followed
    expect(covers).toBeGreaterThan(0);
    expect(tutorials).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(0);
    expect(problems.map((p) => `${p.templateId} ${p.surface} ${p.assetId}: ${p.why}`)).toEqual([]);
  });

  it("follows Easy Blur's four recordings to the packaged asset tree", async () => {
    const t = getTemplate("@m0saic/media/blur-regions/v1" as never) as unknown as AnyRec;
    const tut = await (t.renderTutorial as Surface).call(t, t.defaultProps ?? {}, ctx());
    const files = docsOf(tut)
      .flatMap((d) => Object.values((d.assets ?? {}) as Record<string, AnyRec>))
      .filter((a) => a.kind === "file")
      // path.relative yields the platform separator (backslashes on Windows); compare POSIX form.
      .map((a) => path.relative(PKG_ROOT, path.resolve(String(a.path))).split(path.sep).join("/"));
    expect(files.sort()).toEqual(
      ["chat_sr.mp4", "inbox_sr.mp4", "invoice_sr.mp4", "signed-letter_sr.mp4"].map(
        (f) => `assets/templates/@m0saic__media__blur-regions__v1/tutorial/${f}`,
      ),
    );
  });
});
