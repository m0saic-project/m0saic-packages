import * as fs from "fs";
import * as path from "path";
import { toCanonicalM0String } from "@m0saic/dsl";
import { entries as browserEntries } from "./browser";
import { entries as nodeEntries } from "./index";

/**
 * The browser entry is the one the web app bundles. Every template that
 * reads `entry.m0` synchronously (QR Code's centre M, Brand Marks,
 * community-m) runs against it on web — so it must carry the same m0 the
 * node entry reads from disk, byte for byte, for every entry it inlines.
 * Until 2026-09-16 the brand entries shipped as `m0: ""` and those
 * templates rendered error mosaics on app.m0saic.io.
 */
describe("@m0saic/dictionary browser entry", () => {
  const ENTRIES_DIR = path.join(__dirname, "entries");

  it("ships every entry the node entry ships, under the same id", () => {
    expect(browserEntries.all.map((e) => e.id).sort()).toEqual(nodeEntries.all.map((e) => e.id).sort());
  });

  it("inlines the brand m0s the web templates read synchronously — byte-equal to the node entry", () => {
    for (const id of ["brand/m-33", "brand/m0", "brand/m0saic-pattern", "brand/qr"]) {
      const web = browserEntries.byId[id];
      const node = nodeEntries.byId[id];
      expect(web).toBeDefined();
      expect(web.m0.length).toBeGreaterThan(100);
      expect(web.m0).toBe(node.m0);
    }
    // masks and rank sets ride in metadata.json, so they are on web too
    expect(Object.keys(browserEntries.byId["brand/m-33"].masks ?? {}).length).toBe(33);
    expect(browserEntries.byId["brand/m-33"].sourceCount).toBe(nodeEntries.byId["brand/m-33"].sourceCount);
  });

  it("keeps only the 149 KB bitmap lazy", () => {
    const lazy = browserEntries.all.filter((e) => e.m0 === "");
    expect(lazy.map((e) => e.id)).toEqual(["brand/m-33_bitmap"]);
    expect(lazy[0].m0File).toBe("entries/brand/m-33_bitmap/m0saic.m0");
  });

  it("every inlined m0 — literal or generated — matches the entry's generated m0.json and the node entry (canonically: the light literals are written in F-form)", () => {
    for (const web of browserEntries.all) {
      if (web.m0 === "") continue;
      const node = nodeEntries.byId[web.id];
      expect(toCanonicalM0String(web.m0)).toBe(toCanonicalM0String(node.m0));
      const [category, slug] = web.id.split("/");
      const dir = fs.readdirSync(ENTRIES_DIR).find((d) => fs.existsSync(path.join(ENTRIES_DIR, d, slug, "metadata.json")));
      expect(dir).toBeDefined();
      const gen = path.join(ENTRIES_DIR, dir!, slug, "m0.json");
      expect(fs.existsSync(gen)).toBe(true);
      expect(toCanonicalM0String(JSON.parse(fs.readFileSync(gen, "utf8")).m0)).toBe(toCanonicalM0String(web.m0));
      void category;
    }
  });
});
