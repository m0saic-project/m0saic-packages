// covers: dev-harness ctx construction — optional secrets/connections
// threading (F1 Phase 2 task 2.3). The harness is the dev authoring
// loop; capability-tier fetchers need the resolvers on the dev ctx to
// be exercisable outside a full host.
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { defineMosaicTemplate } from "../template/defineMosaicTemplate";
import { registerTemplate } from "../template/templateRegistry";
import { renderTemplateToMosaicFile } from "./renderTemplateToMosaicFile";

const fakeSecrets = { get: async () => "s3cret", has: async () => true };
const fakeConnections = {
  get: async () => ({ url: "http://localhost" }),
  has: async () => true,
};

const observed: Record<string, { secrets?: unknown; connections?: unknown }> = {};

function docOf(): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as MosaicDocument["assets"],
    m0: toM0String("F", "devharness"),
    sources: [{ type: "lavfi", color: "#000000" } as MosaicDocument["sources"][number]],
  };
}

registerTemplate(
  defineMosaicTemplate<Record<string, never>>({
    id: asTemplateId("DevHarnessCapProbe"),
    label: "capability probe",
    version: 1,
    capabilities: { tier: "capability", caps: {} },
    description: "test fixture",
    tags: ["test"],
    propsSchema: {},
    defaultProps: {},
    async render(_props, ctx: MosaicEngineContext) {
      observed.cap = {
        secrets: (ctx as { secrets?: unknown }).secrets,
        connections: (ctx as { connections?: unknown }).connections,
      };
      return docOf();
    },
  }),
);

describe("renderTemplateToMosaicFile — secrets/connections opts", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "m0saic-devharness-test-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("threads opts.secrets / opts.connections onto the dev ctx", async () => {
    const outPath = path.join(dir, "with-caps.mosaic");
    await renderTemplateToMosaicFile("DevHarnessCapProbe", {}, {
      outPath,
      secrets: fakeSecrets,
      connections: fakeConnections,
    });

    expect(observed.cap.secrets).toBe(fakeSecrets);
    expect(observed.cap.connections).toBe(fakeConnections);
    await expect(fs.stat(outPath)).resolves.toBeTruthy();
  });

  it("leaves both absent when opts omit them (prior behavior)", async () => {
    const outPath = path.join(dir, "without-caps.mosaic");
    await renderTemplateToMosaicFile("DevHarnessCapProbe", {}, { outPath });

    expect(observed.cap.secrets).toBeUndefined();
    expect(observed.cap.connections).toBeUndefined();
  });
});
