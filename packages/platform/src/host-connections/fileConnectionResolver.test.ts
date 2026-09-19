import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { makeM0saicTempPrefix } from "../paths";
import { createFileConnectionStore } from "./fileConnectionResolver";

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), makeM0saicTempPrefix("conn-test")));
}

describe("createFileConnectionStore — store roundtrip", () => {
  it("writes and reads back a connection's values", async () => {
    const dir = await mkTmpDir();
    const { store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });

    await store.writeOne("github-dev@default", {
      githubUrl: "http://localhost:9999",
    });

    expect(await store.readOne("github-dev@default")).toEqual({
      githubUrl: "http://localhost:9999",
    });
    expect(await store.listIds()).toEqual(["github-dev@default"]);
  });

  it("overwrites a previous entry", async () => {
    const dir = await mkTmpDir();
    const { store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });
    await store.writeOne("github-dev@default", { githubUrl: "a" });
    await store.writeOne("github-dev@default", { githubUrl: "b" });
    expect(await store.readOne("github-dev@default")).toEqual({ githubUrl: "b" });
  });

  it("deleteOne removes only the targeted entry", async () => {
    const dir = await mkTmpDir();
    const { store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });
    await store.writeOne("github-dev@default", { githubUrl: "a" });
    await store.writeOne("plex-dev@default", { plexUrl: "b" });
    await store.deleteOne("github-dev@default");
    expect(await store.listIds()).toEqual(["plex-dev@default"]);
    expect(await store.readOne("github-dev@default")).toBeUndefined();
  });

  it("deleteOne is no-op when id is absent", async () => {
    const dir = await mkTmpDir();
    const { store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });
    await store.writeOne("github-dev@default", { x: 1 });
    await expect(store.deleteOne("never@here")).resolves.toBeUndefined();
    expect(await store.listIds()).toEqual(["github-dev@default"]);
  });

  it("readAll returns the full map", async () => {
    const dir = await mkTmpDir();
    const { store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });
    await store.writeOne("a-dev@default", { a: 1 });
    await store.writeOne("b-dev@default", { b: 2 });
    const all = await store.readAll();
    expect(all).toEqual({
      "a-dev@default": { a: 1 },
      "b-dev@default": { b: 2 },
    });
  });
});

describe("createFileConnectionStore — missing file", () => {
  it("treats absent file as empty map", async () => {
    const dir = await mkTmpDir();
    const { resolver, store } = createFileConnectionStore({
      storePath: path.join(dir, "nope.json"),
    });
    expect(await store.readAll()).toEqual({});
    expect(await store.listIds()).toEqual([]);
    expect(await resolver.has("anything@default")).toBe(false);
    expect(await resolver.get("anything@default")).toBeUndefined();
  });

  it("creates the file lazily on first write", async () => {
    const dir = await mkTmpDir();
    const p = path.join(dir, "connections.json");
    const { store } = createFileConnectionStore({ storePath: p });
    await expect(fs.access(p)).rejects.toThrow();
    await store.writeOne("github-dev@default", { githubUrl: "x" });
    await expect(fs.access(p)).resolves.toBeUndefined();
  });

  it("creates parent directories as needed", async () => {
    const dir = await mkTmpDir();
    const nested = path.join(dir, "a", "b", "connections.json");
    const { store } = createFileConnectionStore({ storePath: nested });
    await store.writeOne("github-dev@default", { githubUrl: "x" });
    await expect(fs.access(nested)).resolves.toBeUndefined();
  });
});

describe("createFileConnectionStore — resolver shape", () => {
  it("resolver mirrors store reads", async () => {
    const dir = await mkTmpDir();
    const { resolver, store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });
    await store.writeOne("github-dev@default", { githubUrl: "http://x" });
    expect(await resolver.has("github-dev@default")).toBe(true);
    expect(await resolver.get("github-dev@default")).toEqual({
      githubUrl: "http://x",
    });
    expect(await resolver.has("never@here")).toBe(false);
    expect(await resolver.get("never@here")).toBeUndefined();
  });

  it("resolver re-reads the file (no in-memory cache)", async () => {
    const dir = await mkTmpDir();
    const p = path.join(dir, "connections.json");
    const { resolver, store } = createFileConnectionStore({ storePath: p });
    await store.writeOne("github-dev@default", { githubUrl: "a" });
    expect(await resolver.get("github-dev@default")).toEqual({ githubUrl: "a" });

    // External mutation between reads — resolver must pick it up.
    await fs.writeFile(
      p,
      JSON.stringify({ "github-dev@default": { githubUrl: "b" } }),
    );
    expect(await resolver.get("github-dev@default")).toEqual({ githubUrl: "b" });
  });
});

describe("createFileConnectionStore — validation", () => {
  it("rejects malformed connection ids", async () => {
    const dir = await mkTmpDir();
    const { store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });
    await expect(store.writeOne("", {})).rejects.toThrow();
    await expect(store.writeOne("no-at-sign", {})).rejects.toThrow();
    await expect(store.writeOne("a@b@c", {})).rejects.toThrow();
    await expect(store.writeOne("has space@default", {})).rejects.toThrow();
  });

  it("rejects non-object values", async () => {
    const dir = await mkTmpDir();
    const { store } = createFileConnectionStore({
      storePath: path.join(dir, "connections.json"),
    });
    await expect(
      store.writeOne("github-dev@default", null as unknown as Record<string, unknown>),
    ).rejects.toThrow();
    await expect(
      store.writeOne("github-dev@default", [] as unknown as Record<string, unknown>),
    ).rejects.toThrow();
    await expect(
      store.writeOne(
        "github-dev@default",
        "string" as unknown as Record<string, unknown>,
      ),
    ).rejects.toThrow();
  });
});

describe("createFileConnectionStore — corrupt file handling", () => {
  it("rejects when JSON root is not an object", async () => {
    const dir = await mkTmpDir();
    const p = path.join(dir, "connections.json");
    await fs.writeFile(p, JSON.stringify(["unexpected", "array"]));
    const { store } = createFileConnectionStore({ storePath: p });
    await expect(store.readAll()).rejects.toThrow(/not a JSON object/);
  });

  it("filters out non-object entries silently", async () => {
    const dir = await mkTmpDir();
    const p = path.join(dir, "connections.json");
    await fs.writeFile(
      p,
      JSON.stringify({
        "github-dev@default": { githubUrl: "ok" },
        "bad@entry": "not-an-object",
        "another-bad@entry": ["array"],
      }),
    );
    const { store } = createFileConnectionStore({ storePath: p });
    const all = await store.readAll();
    expect(Object.keys(all).sort()).toEqual(["github-dev@default"]);
  });
});

describe("createFileConnectionStore — atomicity", () => {
  it("uses temp-file + rename (no .tmp leftover after success)", async () => {
    const dir = await mkTmpDir();
    const p = path.join(dir, "connections.json");
    const { store } = createFileConnectionStore({ storePath: p });
    await store.writeOne("github-dev@default", { githubUrl: "x" });
    const dirents = await fs.readdir(dir);
    expect(dirents).toContain("connections.json");
    expect(dirents).not.toContain("connections.json.tmp");
  });
});
