import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { hostCommunityDir, prefillCommunityDir, schemaWantsCommunityDir } from "./hostCommunityDir";

const SCHEMA = {
  communityDir: { type: "string", required: false, meta: { control: { picker: "folder" } } },
  tile: { type: "string", required: false },
};

describe("hostCommunityDir / prefillCommunityDir", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-cm-host-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("is null until <root>/current/index.json exists", () => {
    expect(hostCommunityDir(root)).toBeNull();
    fs.mkdirSync(path.join(root, "current"));
    expect(hostCommunityDir(root)).toBeNull();
    fs.writeFileSync(path.join(root, "current", "index.json"), "{}");
    expect(hostCommunityDir(root)).toBe(path.join(root, "current"));
  });

  it("only recognises a string prop named communityDir with picker:folder", () => {
    expect(schemaWantsCommunityDir(SCHEMA)).toBe(true);
    expect(schemaWantsCommunityDir({ communityDir: { type: "string" } })).toBe(false);
    expect(schemaWantsCommunityDir({ communityDir: { type: "media", meta: { control: { picker: "folder" } } } })).toBe(false);
    expect(schemaWantsCommunityDir({ outDir: { type: "string", meta: { control: { picker: "folder" } } } })).toBe(false);
    expect(schemaWantsCommunityDir(null)).toBe(false);
  });

  it("returns the SAME object when nothing applies, a filled copy when it does", () => {
    const props = { communityDir: "", tile: "root" };
    // Nothing fetched yet → untouched.
    expect(prefillCommunityDir(props, SCHEMA, { root })).toBe(props);
    fs.mkdirSync(path.join(root, "current"));
    fs.writeFileSync(path.join(root, "current", "index.json"), "{}");
    const filled = prefillCommunityDir(props, SCHEMA, { root });
    expect(filled).not.toBe(props);
    expect(filled).toEqual({ communityDir: path.join(root, "current"), tile: "root" });
    expect(props.communityDir).toBe(""); // never mutates the input
    // Unset (undefined) fills too; a user value always wins; other templates are untouched.
    expect(prefillCommunityDir({ tile: "root" } as Record<string, unknown>, SCHEMA, { root }).communityDir).toBe(path.join(root, "current"));
    const user = { communityDir: "/somewhere/else", tile: "root" };
    expect(prefillCommunityDir(user, SCHEMA, { root })).toBe(user);
    const other = { text: "hi" };
    expect(prefillCommunityDir(other, { text: { type: "string" } }, { root })).toBe(other);
  });
});
