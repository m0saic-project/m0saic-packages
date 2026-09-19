import "./web";
import * as fs from "node:fs";
import * as path from "node:path";
import { listRegisteredTemplateIds } from "@m0saic/template-utils";
import { isWebTemplateId, listWebTemplateIds } from "./webTemplateIds";

// Read, not `import`ed: with resolveJsonModule an imported JSON is emitted into
// dist/, and dist/ ships. Resolved from the package root so it works from src/
// (ts-jest) and dist/ alike.
const SHIPPED_WEB_IDS_FILE = path.resolve(__dirname, "..", "src", "web-template-ids.frozen.json");

describe("webTemplateIds — the ids Mosaic Web can open", () => {
  it("matches the browser entry's registrations exactly (rebuild the package if this drifts)", () => {
    // `./web` is imported above in this fresh test module, so the registry
    // holds precisely the web set. The committed JSON must equal it — the
    // package build regenerates the file; a stale one means `npm run build`
    // was skipped after editing web.ts.
    const registered = listRegisteredTemplateIds().map(String).sort();
    expect(listWebTemplateIds()).toEqual(registered);
  });

  it("answers membership for the templates the first-run flows print links for", () => {
    expect(isWebTemplateId("@m0saic/hello-world/v1")).toBe(true);
    expect(isWebTemplateId("@m0saic/dsl-tutorial/v1")).toBe(true);
    expect(isWebTemplateId("@m0saic/wireframe/base/v2")).toBe(true);
  });

  it("is false for web-excluded built-ins, community ids and unknown ids", () => {
    // Node-tainted families are left out of the browser entry (see web.ts).
    expect(isWebTemplateId("@m0saic/media/watermark/v1")).toBe(false);
    expect(isWebTemplateId("@m0saic-dev/anything/v1")).toBe(false);
    expect(isWebTemplateId("@acme/not-a-template/v1")).toBe(false);
    expect(isWebTemplateId("")).toBe(false);
  });
});

describe("shipped web ids — additive-only lock on web.ts", () => {
  // `web-template-ids.json` ships in the CLI tarball and the CLI prints
  // `app.m0saic.io/make?t=<id>` for exactly those ids. The snapshot pins the
  // list as the 0.2.0 CLI shipped it; an id dropped from web.ts afterwards is
  // a dead link in every installed CLI. Same rule as
  // tools/check-registry.mjs Stage 0b — this is the unit-level twin.
  const shipped = JSON.parse(fs.readFileSync(SHIPPED_WEB_IDS_FILE, "utf8")) as {
    release: string; commit: string; note: string; ids: string[];
  };

  it("is a well-formed, sorted, duplicate-free snapshot of the 0.2.0 cut", () => {
    expect(shipped.release).toBe("0.2.0");
    expect(shipped.commit).toBe("d72fdcea");
    expect(shipped.note.length).toBeGreaterThan(0);
    expect(shipped.ids).toEqual([...shipped.ids].sort());
    expect(new Set(shipped.ids).size).toBe(shipped.ids.length);
    expect(shipped.ids.length).toBeGreaterThan(0);
  });

  it("every id the shipped CLI links to is still registered on web (never remove one from web.ts)", () => {
    const registered = new Set(listRegisteredTemplateIds().map(String));
    const missing = shipped.ids.filter((id) => !registered.has(id));
    expect(missing).toEqual([]);
    for (const id of shipped.ids) expect(isWebTemplateId(id)).toBe(true);
  });
});
